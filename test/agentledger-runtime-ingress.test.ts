import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import openaiCompat from "../src/api/unified/openai";
import { saveQuotaPolicy } from "../src/lib/admin/quota";
import { encryptCredential } from "../src/lib/auth/crypto_helpers";
import { config } from "../src/config";
import { db } from "../src/db";
import { agentLedgerRuntimeOutbox, credentials } from "../src/db/schema";
import { HTTPError } from "../src/lib/http";
import { invalidateModelGovernanceCache } from "../src/lib/model-governance";
import { updateOAuthSelectionConfig } from "../src/lib/oauth-selection-policy";
import { BaseProvider } from "../src/lib/providers/base";
import { updateRouteExecutionPolicy } from "../src/lib/routing/route-policy";
import { strictAuthMiddleware } from "../src/middleware/auth";
import { quotaMiddleware } from "../src/middleware/quota";
import { requestContextMiddleware } from "../src/middleware/request-context";

const originalFetch = globalThis.fetch;
const originalEncryptionSecret = process.env.ENCRYPTION_SECRET;
const originalAgentLedgerConfig = {
  enabled: config.agentLedger.enabled,
  ingestUrl: config.agentLedger.ingestUrl,
  keyId: config.agentLedger.keyId,
  secret: config.agentLedger.secret,
  requestTimeoutMs: config.agentLedger.requestTimeoutMs,
  maxAttempts: config.agentLedger.maxAttempts,
  retryScheduleSec: [...config.agentLedger.retryScheduleSec],
  workerBatchSize: config.agentLedger.workerBatchSize,
  outboxRetentionDays: config.agentLedger.outboxRetentionDays,
};

const MOCK_PROVIDER_ID = "mock";
const MOCK_UPSTREAM_URL = "https://mock-provider.local/v1/chat/completions";

class AgentLedgerIngressProvider extends BaseProvider {
  protected override providerId = MOCK_PROVIDER_ID;
  protected override authConfig = {
    providerId: MOCK_PROVIDER_ID,
    clientId: "test-client",
    clientSecret: "test-secret",
    authUrl: "https://example.com/auth",
    tokenUrl: "https://example.com/token",
    redirectUri: "https://example.com/callback",
    scopes: [],
  };
  protected override endpoint = MOCK_UPSTREAM_URL;

  constructor() {
    super();
    this.init();
  }

  protected override async transformRequest(body: Record<string, unknown>) {
    if (body.model === "provider-timeout") {
      throw new HTTPError(
        504,
        "Gateway Timeout",
        JSON.stringify({ error: "provider timeout" }),
        new Headers({ "content-type": "application/json; charset=utf-8" }),
      );
    }
    return body;
  }

  protected override async getCustomHeaders(
    token: string,
  ): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  protected override async transformResponse(response: Response): Promise<Response> {
    return response;
  }
}

const mockProvider = new AgentLedgerIngressProvider();

function createIngressApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.use("/v1/*", strictAuthMiddleware);
  app.use("/v1/*", quotaMiddleware);
  app.use("/api/*", strictAuthMiddleware);
  app.route("/v1", openaiCompat);
  app.route(`/api/${MOCK_PROVIDER_ID}`, mockProvider.router);
  return app;
}

const app = createIngressApp();

async function ensureRuntimeIngressTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.system_logs (
        id serial PRIMARY KEY,
        timestamp text NOT NULL,
        level text NOT NULL,
        source text NOT NULL,
        message text NOT NULL
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.settings (
        key text PRIMARY KEY,
        value text NOT NULL,
        description text,
        updated_at text
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.credentials (
        id text PRIMARY KEY,
        provider text NOT NULL,
        account_id text NOT NULL DEFAULT 'default',
        email text,
        access_token text,
        refresh_token text,
        expires_at bigint,
        metadata text,
        status text DEFAULT 'active',
        attributes text,
        next_refresh_after bigint,
        device_profile text,
        consecutive_failures integer NOT NULL DEFAULT 0,
        last_failure_at bigint,
        last_failure_reason text,
        last_refresh text,
        created_at text,
        updated_at text
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.audit_events (
        id serial PRIMARY KEY,
        actor text NOT NULL DEFAULT 'system',
        action text NOT NULL,
        resource text NOT NULL,
        resource_id text,
        result text NOT NULL DEFAULT 'success',
        details text,
        ip text,
        user_agent text,
        trace_id text,
        created_at text NOT NULL
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.quota_policies (
        id text PRIMARY KEY,
        name text NOT NULL,
        scope_type text NOT NULL,
        scope_value text,
        provider text,
        model_pattern text,
        requests_per_minute integer,
        tokens_per_minute integer,
        tokens_per_day integer,
        enabled integer NOT NULL DEFAULT 1,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.quota_usage_windows (
        id serial PRIMARY KEY,
        policy_id text NOT NULL,
        bucket_type text NOT NULL,
        window_start bigint NOT NULL,
        request_count integer NOT NULL DEFAULT 0,
        token_count integer NOT NULL DEFAULT 0,
        estimated_token_count integer NOT NULL DEFAULT 0,
        actual_token_count integer NOT NULL DEFAULT 0,
        reconciled_delta integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        UNIQUE(policy_id, bucket_type, window_start)
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.agentledger_runtime_outbox (
        id serial PRIMARY KEY,
        trace_id text NOT NULL,
        tenant_id text NOT NULL,
        project_id text,
        provider text NOT NULL,
        model text NOT NULL,
        resolved_model text NOT NULL,
        route_policy text NOT NULL,
        account_id text,
        status text NOT NULL,
        started_at text NOT NULL,
        finished_at text,
        error_code text,
        cost text,
        idempotency_key text NOT NULL,
        spec_version text NOT NULL DEFAULT 'v1',
        key_id text NOT NULL,
        target_url text NOT NULL,
        payload_json text NOT NULL,
        payload_hash text NOT NULL,
        headers_json text NOT NULL DEFAULT '{}',
        delivery_state text NOT NULL DEFAULT 'pending',
        attempt_count integer NOT NULL DEFAULT 0,
        last_http_status integer,
        last_error_class text,
        last_error_message text,
        first_failed_at bigint,
        last_failed_at bigint,
        next_retry_at bigint,
        delivered_at bigint,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )
    `),
  );

  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS agentledger_runtime_outbox_idempotency_unique_idx ON core.agentledger_runtime_outbox (idempotency_key)",
    ),
  );
}

async function resetRuntimeIngressTables() {
  await db.execute(sql.raw("DELETE FROM enterprise.quota_usage_windows"));
  await db.execute(sql.raw("DELETE FROM enterprise.quota_policies"));
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_runtime_outbox"));
  await db.execute(sql.raw("DELETE FROM core.credentials"));
  await db.execute(sql.raw("DELETE FROM core.settings"));
  await db.execute(sql.raw("DELETE FROM core.system_logs"));
}

function authHeaders(traceId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${config.apiSecret}`,
    "Content-Type": "application/json",
    "X-Request-Id": traceId,
    ...extra,
  };
}

async function postJson(
  path: string,
  traceId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: authHeaders(traceId, headers),
      body: JSON.stringify(body),
    }),
  );
}

async function seedCredential(accountId: string) {
  const nowIso = new Date().toISOString();
  const record = {
    id: `cred-${accountId}`,
    provider: MOCK_PROVIDER_ID,
    accountId,
    email: `${accountId}@example.com`,
    accessToken: `access-${accountId}`,
    refreshToken: `refresh-${accountId}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    metadata: JSON.stringify({ accountId }),
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await db.insert(credentials).values(
    process.env.ENCRYPTION_SECRET ? encryptCredential(record) : record,
  );
}

type InternalDispatchMode = "delegate" | "failure" | "timeout";

function installFetchRouter(mode: InternalDispatchMode = "delegate") {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (
      url.origin === `http://localhost:${config.port}` &&
      url.pathname === `/api/${MOCK_PROVIDER_ID}/v1/chat/completions`
    ) {
      if (mode === "failure") {
        throw new Error("mock dispatch failed");
      }
      if (mode === "timeout") {
        const timeoutError = new Error("mock dispatch timeout");
        (timeoutError as Error & { name: string }).name = "AbortError";
        throw timeoutError;
      }
      return app.fetch(request);
    }

    if (url.href === MOCK_UPSTREAM_URL) {
      const body = (await request.clone().json().catch(() => ({}))) as {
        model?: string;
      };
      if (body.model === "provider-success") {
        return new Response(
          JSON.stringify({
            id: "chatcmpl_mock_success",
            object: "chat.completion",
            model: "provider-success",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 4,
              completion_tokens: 2,
              total_tokens: 6,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        );
      }

      if (body.model === "provider-failure") {
        return new Response(
          JSON.stringify({ error: "provider rejected" }),
          {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        );
      }

      throw new Error(`unexpected upstream model: ${String(body.model || "unknown")}`);
    }

    throw new Error(`unexpected fetch target: ${request.url}`);
  }) as unknown as typeof fetch;
}

async function readOutboxRow(traceId: string) {
  const rows = await db
    .select()
    .from(agentLedgerRuntimeOutbox)
    .where(eq(agentLedgerRuntimeOutbox.traceId, traceId));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function expectRuntimeEvent(
  traceId: string,
  expected: {
    status: string;
    errorCode?: string | null;
    provider: string;
    model: string;
    resolvedModel: string;
    accountId?: string | null;
  },
) {
  const row = await readOutboxRow(traceId);
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;

  expect(row.status).toBe(expected.status);
  expect(row.errorCode).toBe(expected.errorCode ?? null);
  expect(row.provider).toBe(expected.provider);
  expect(row.model).toBe(expected.model);
  expect(row.resolvedModel).toBe(expected.resolvedModel);
  expect(row.accountId).toBe(expected.accountId ?? null);
  expect(row.deliveryState).toBe("pending");
  expect(row.targetUrl).toBe("http://agentledger.test/runtime-events");
  expect(payload.traceId).toBe(traceId);
  expect(payload.status).toBe(expected.status);
  expect(payload.errorCode ?? null).toBe(expected.errorCode ?? null);

  return row;
}

describe("AgentLedger 真实入口回归", () => {
  beforeAll(async () => {
    if (originalEncryptionSecret) {
      process.env.ENCRYPTION_SECRET = originalEncryptionSecret;
    } else {
      delete process.env.ENCRYPTION_SECRET;
    }
    await ensureRuntimeIngressTables();
  });

  beforeEach(async () => {
    invalidateModelGovernanceCache();
    await resetRuntimeIngressTables();

    config.agentLedger.enabled = true;
    config.agentLedger.ingestUrl = "http://agentledger.test/runtime-events";
    config.agentLedger.keyId = "tokenpulse-runtime-v1";
    config.agentLedger.secret = "tp_agentledger_runtime_secret";
    config.agentLedger.requestTimeoutMs = 1000;
    config.agentLedger.maxAttempts = 5;
    config.agentLedger.retryScheduleSec = [0, 30, 120, 600, 1800];
    config.agentLedger.workerBatchSize = 20;
    config.agentLedger.outboxRetentionDays = 7;

    await updateOAuthSelectionConfig({
      defaultPolicy: "round_robin",
      allowHeaderOverride: true,
      allowHeaderAccountOverride: false,
      failureCooldownSec: 0,
      maxRetryOnAccountFailure: 0,
    });
    await updateRouteExecutionPolicy({
      emitRouteHeaders: true,
      retryStatusCodes: [401, 403, 429, 500, 502, 503, 504],
      claudeFallbackStatusCodes: [401, 403, 408, 409, 425, 429, 500, 502, 503, 504],
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  afterAll(async () => {
    invalidateModelGovernanceCache();
    await resetRuntimeIngressTables();
    await updateOAuthSelectionConfig({
      defaultPolicy: config.oauthSelection.defaultPolicy,
      allowHeaderOverride: config.oauthSelection.allowHeaderOverride,
      allowHeaderAccountOverride: config.oauthSelection.allowHeaderAccountOverride,
      failureCooldownSec: config.oauthSelection.failureCooldownSec,
      maxRetryOnAccountFailure: config.oauthSelection.maxRetryOnAccountFailure,
    });
    await updateRouteExecutionPolicy({
      emitRouteHeaders: true,
      retryStatusCodes: [401, 403, 429, 500, 502, 503, 504],
      claudeFallbackStatusCodes: [401, 403, 408, 409, 425, 429, 500, 502, 503, 504],
    });
    await db.execute(sql.raw("DELETE FROM core.settings"));

    config.agentLedger.enabled = originalAgentLedgerConfig.enabled;
    config.agentLedger.ingestUrl = originalAgentLedgerConfig.ingestUrl;
    config.agentLedger.keyId = originalAgentLedgerConfig.keyId;
    config.agentLedger.secret = originalAgentLedgerConfig.secret;
    config.agentLedger.requestTimeoutMs = originalAgentLedgerConfig.requestTimeoutMs;
    config.agentLedger.maxAttempts = originalAgentLedgerConfig.maxAttempts;
    config.agentLedger.retryScheduleSec = [...originalAgentLedgerConfig.retryScheduleSec];
    config.agentLedger.workerBatchSize = originalAgentLedgerConfig.workerBatchSize;
    config.agentLedger.outboxRetentionDays = originalAgentLedgerConfig.outboxRetentionDays;

    process.env.ENCRYPTION_SECRET = originalEncryptionSecret;
  });

  it("应在 quota 拒绝时通过 /v1 入口写入 blocked 事件", async () => {
    await saveQuotaPolicy({
      id: "quota-block-all",
      name: "quota-block-all",
      scopeType: "global",
      provider: MOCK_PROVIDER_ID,
      modelPattern: "*",
      tokensPerMinute: 1,
      enabled: true,
    });

    const traceId = "trace-agentledger-ingress-quota";
    const response = await postJson("/v1/chat/completions", traceId, {
      model: `${MOCK_PROVIDER_ID}:quota-blocked`,
      messages: [{ role: "user", content: "quota limit should block this request" }],
      max_tokens: 8,
    });

    expect(response.status).toBe(429);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("请求超过配额限制");
    expect(payload.traceId).toBe(traceId);

    await expectRuntimeEvent(traceId, {
      status: "blocked",
      errorCode: "quota_rejected",
      provider: MOCK_PROVIDER_ID,
      model: `${MOCK_PROVIDER_ID}:quota-blocked`,
      resolvedModel: `${MOCK_PROVIDER_ID}:quota-blocked`,
      accountId: null,
    });
  });

  it("应在 openai compat dispatch catch 异常时写入 failure 事件", async () => {
    installFetchRouter("failure");

    const traceId = "trace-agentledger-ingress-dispatch-failure";
    const response = await postJson("/v1/chat/completions", traceId, {
      model: `${MOCK_PROVIDER_ID}:dispatch-failure`,
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.status).toBe(502);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("网关转发失败");
    expect(payload.traceId).toBe(traceId);

    await expectRuntimeEvent(traceId, {
      status: "failure",
      errorCode: "gateway_dispatch_failed",
      provider: MOCK_PROVIDER_ID,
      model: `${MOCK_PROVIDER_ID}:dispatch-failure`,
      resolvedModel: `${MOCK_PROVIDER_ID}:dispatch-failure`,
      accountId: null,
    });
  });

  it("应在 openai compat dispatch catch 超时时写入 timeout 事件", async () => {
    installFetchRouter("timeout");

    const traceId = "trace-agentledger-ingress-dispatch-timeout";
    const response = await postJson("/v1/chat/completions", traceId, {
      model: `${MOCK_PROVIDER_ID}:dispatch-timeout`,
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.status).toBe(502);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("网关转发失败");
    expect(payload.traceId).toBe(traceId);

    await expectRuntimeEvent(traceId, {
      status: "timeout",
      errorCode: "gateway_timeout",
      provider: MOCK_PROVIDER_ID,
      model: `${MOCK_PROVIDER_ID}:dispatch-timeout`,
      resolvedModel: `${MOCK_PROVIDER_ID}:dispatch-timeout`,
      accountId: null,
    });
  });

  it("应在 /v1 成功入口保留 tenant/project，并在未信任代理时拒绝 header route policy 覆盖", async () => {
    await seedCredential("acct-header-success");
    installFetchRouter();

    const traceId = "trace-agentledger-ingress-openai-header-success";
    const response = await postJson(
      "/v1/chat/completions",
      traceId,
      {
        model: `${MOCK_PROVIDER_ID}:provider-success`,
        messages: [{ role: "user", content: "ping" }],
      },
      {
        "X-TokenPulse-Tenant": "Tenant_X",
        "X-Project-Id": "project-alpha",
        "X-TokenPulse-Selection-Policy": "sticky_user",
      },
    );

    expect(response.status).toBe(200);
    const row = await readOutboxRow(traceId);
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;

    expect(row.tenantId).toBe("tenant_x");
    expect(row.projectId).toBe("project-alpha");
    expect(row.provider).toBe(MOCK_PROVIDER_ID);
    expect(row.model).toBe(`${MOCK_PROVIDER_ID}:provider-success`);
    expect(row.resolvedModel).toBe(`${MOCK_PROVIDER_ID}:provider-success`);
    expect(row.routePolicy).toBe("round_robin");
    expect(row.status).toBe("success");
    expect(payload.tenantId).toBe("tenant_x");
    expect(payload.projectId).toBe("project-alpha");
    expect(payload.routePolicy).toBe("round_robin");
    expect(payload.resolvedModel).toBe(`${MOCK_PROVIDER_ID}:provider-success`);
  });

  it("应在 provider base 无可用账号时写入 blocked 终态", async () => {
    const traceId = "trace-agentledger-ingress-provider-blocked";
    const response = await postJson(`/api/${MOCK_PROVIDER_ID}/v1/chat/completions`, traceId, {
      model: "provider-blocked",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.status).toBe(401);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe(`No authenticated ${MOCK_PROVIDER_ID} account`);
    expect(payload.traceId).toBe(traceId);

    await expectRuntimeEvent(traceId, {
      status: "blocked",
      errorCode: "no_authenticated_account",
      provider: MOCK_PROVIDER_ID,
      model: "provider-blocked",
      resolvedModel: `${MOCK_PROVIDER_ID}:provider-blocked`,
      accountId: null,
    });
  });

  it("应在 provider base 成功返回时写入 success 终态", async () => {
    await seedCredential("acct-success");
    installFetchRouter();

    const traceId = "trace-agentledger-ingress-provider-success";
    const response = await postJson(`/api/${MOCK_PROVIDER_ID}/v1/chat/completions`, traceId, {
      model: "provider-success",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tokenpulse-provider")).toBe(MOCK_PROVIDER_ID);

    await expectRuntimeEvent(traceId, {
      status: "success",
      errorCode: null,
      provider: MOCK_PROVIDER_ID,
      model: "provider-success",
      resolvedModel: `${MOCK_PROVIDER_ID}:provider-success`,
      accountId: "acct-success",
    });
  });

  it("应在 provider base 上游失败时写入 failure 终态", async () => {
    await seedCredential("acct-failure");
    installFetchRouter();

    const traceId = "trace-agentledger-ingress-provider-failure";
    const response = await postJson(`/api/${MOCK_PROVIDER_ID}/v1/chat/completions`, traceId, {
      model: "provider-failure",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("x-tokenpulse-provider")).toBe(MOCK_PROVIDER_ID);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("provider rejected");
    expect(payload.traceId).toBe(traceId);

    await expectRuntimeEvent(traceId, {
      status: "failure",
      errorCode: "upstream_http_400",
      provider: MOCK_PROVIDER_ID,
      model: "provider-failure",
      resolvedModel: `${MOCK_PROVIDER_ID}:provider-failure`,
      accountId: "acct-failure",
    });
  });

  it("应在 provider base 超时时写入 timeout 终态", async () => {
    await seedCredential("acct-timeout");

    const traceId = "trace-agentledger-ingress-provider-timeout";
    const response = await postJson(`/api/${MOCK_PROVIDER_ID}/v1/chat/completions`, traceId, {
      model: "provider-timeout",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.status).toBe(504);
    expect(response.headers.get("x-tokenpulse-provider")).toBe(MOCK_PROVIDER_ID);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("provider timeout");
    expect(payload.traceId).toBe(traceId);

    await expectRuntimeEvent(traceId, {
      status: "timeout",
      errorCode: "upstream_http_504",
      provider: MOCK_PROVIDER_ID,
      model: "provider-timeout",
      resolvedModel: `${MOCK_PROVIDER_ID}:provider-timeout`,
      accountId: "acct-timeout",
    });
  });
});
