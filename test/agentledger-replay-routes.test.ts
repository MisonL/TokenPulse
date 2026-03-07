import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { requestContextMiddleware } from "../src/middleware/request-context";
import enterprise from "../src/routes/enterprise";
import { recordAgentLedgerRuntimeEvent } from "../src/lib/agentledger/runtime-events";

const originalFetch = globalThis.fetch;
const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;
const originalAgentLedgerConfig = {
  enabled: config.agentLedger.enabled,
  ingestUrl: config.agentLedger.ingestUrl,
  secret: config.agentLedger.secret,
};

function createAdminApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.route("/api/admin", enterprise);
  return app;
}

function ownerHeaders(traceId = "trace-agentledger-admin-owner") {
  return {
    "content-type": "application/json",
    "x-admin-user": "agentledger-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

function auditorHeaders(traceId = "trace-agentledger-admin-auditor") {
  return {
    ...ownerHeaders(traceId),
    "x-admin-user": "agentledger-auditor",
    "x-admin-role": "auditor",
  };
}

function operatorHeaders(traceId = "trace-agentledger-admin-operator") {
  return {
    ...ownerHeaders(traceId),
    "x-admin-user": "agentledger-operator",
    "x-admin-role": "operator",
  };
}

async function ensureAgentLedgerRouteTables() {
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
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.agentledger_replay_audits (
        id serial PRIMARY KEY,
        outbox_id integer NOT NULL,
        trace_id text NOT NULL,
        idempotency_key text NOT NULL,
        operator_id text NOT NULL,
        trigger_source text NOT NULL,
        attempt_number integer NOT NULL,
        result text NOT NULL,
        http_status integer,
        error_class text,
        created_at bigint NOT NULL
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
}

async function resetAgentLedgerRouteTables() {
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_replay_audits"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_runtime_outbox"));
}

async function seedOutboxEvent(traceId: string) {
  await recordAgentLedgerRuntimeEvent({
    traceId,
    tenantId: "default",
    provider: "claude",
    model: "claude-sonnet",
    resolvedModel: "claude:claude-3-7-sonnet-20250219",
    routePolicy: "latest_valid",
    status: "failure",
    startedAt: "2026-03-07T11:00:00.000Z",
    finishedAt: "2026-03-07T11:00:01.000Z",
    errorCode: "upstream_http_503",
  });
  const result = await db.execute(
    sql.raw(`
      SELECT id
      FROM core.agentledger_runtime_outbox
      WHERE trace_id = '${traceId.replaceAll("'", "''")}'
      ORDER BY id DESC
      LIMIT 1
    `),
  );
  return Number(
    ((result as unknown as { rows?: Array<{ id: number | string }> }).rows || [])[0]?.id || 0,
  );
}

async function countReplayAudits() {
  const result = await db.execute(
    sql.raw("SELECT COUNT(*)::int AS count FROM core.agentledger_replay_audits"),
  );
  return Number(
    ((result as unknown as { rows?: Array<{ count: number | string }> }).rows || [])[0]?.count ||
      0,
  );
}

describe("AgentLedger outbox 管理路由", () => {
  const app = createAdminApp();

  beforeAll(async () => {
    await ensureAgentLedgerRouteTables();
  });

  beforeEach(async () => {
    await resetAgentLedgerRouteTables();
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    config.agentLedger.enabled = true;
    config.agentLedger.ingestUrl = "http://agentledger.test/runtime-events";
    config.agentLedger.secret = "tp_agl_v1_shared_secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  afterAll(() => {
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
    config.agentLedger.enabled = originalAgentLedgerConfig.enabled;
    config.agentLedger.ingestUrl = originalAgentLedgerConfig.ingestUrl;
    config.agentLedger.secret = originalAgentLedgerConfig.secret;
  });

  it("owner/auditor 应可查询 outbox 列表与汇总，operator 应被拒绝", async () => {
    await seedOutboxEvent("trace-agentledger-route-001");

    const listResponse = await app.fetch(
      new Request(
        "http://localhost/api/admin/observability/agentledger-outbox?page=1&pageSize=10",
        {
          headers: ownerHeaders(),
        },
      ),
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(Array.isArray(listPayload.data)).toBe(true);
    expect(listPayload.data[0]?.traceId || listPayload.data[0]?.trace_id).toBeTruthy();

    const summaryResponse = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/summary", {
        headers: auditorHeaders(),
      }),
    );
    expect(summaryResponse.status).toBe(200);
    const summaryPayload = await summaryResponse.json();
    expect(summaryPayload.data?.total).toBe(1);
    expect(summaryPayload.data?.byStatus?.failure).toBe(1);

    const denied = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox", {
        headers: operatorHeaders(),
      }),
    );
    expect(denied.status).toBe(403);
  });

  it("导出接口应返回 CSV，owner replay 成功后应写 replay 审计", async () => {
    const outboxId = await seedOutboxEvent("trace-agentledger-route-002");

    const exportResponse = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/export", {
        headers: auditorHeaders("trace-agentledger-export"),
      }),
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
    const csv = await exportResponse.text();
    expect(csv).toContain("traceId");
    expect(csv).toContain("trace-agentledger-route-002");

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as typeof fetch;

    const replayResponse = await app.fetch(
      new Request(`http://localhost/api/admin/observability/agentledger-outbox/${outboxId}/replay`, {
        method: "POST",
        headers: ownerHeaders("trace-agentledger-replay"),
      }),
    );
    expect(replayResponse.status).toBe(200);
    const replayPayload = await replayResponse.json();
    expect(replayPayload.success).toBe(true);
    expect(replayPayload.data?.deliveryState || replayPayload.data?.delivery_state).toBe(
      "delivered",
    );
    expect(await countReplayAudits()).toBe(1);
  });

  it("auditor 不可 replay，未配置 webhook 时 owner replay 应返回 409", async () => {
    const outboxId = await seedOutboxEvent("trace-agentledger-route-003");

    const forbidden = await app.fetch(
      new Request(`http://localhost/api/admin/observability/agentledger-outbox/${outboxId}/replay`, {
        method: "POST",
        headers: auditorHeaders("trace-agentledger-replay-forbidden"),
      }),
    );
    expect(forbidden.status).toBe(403);

    config.agentLedger.secret = "";
    const conflict = await app.fetch(
      new Request(`http://localhost/api/admin/observability/agentledger-outbox/${outboxId}/replay`, {
        method: "POST",
        headers: ownerHeaders("trace-agentledger-replay-unconfigured"),
      }),
    );
    expect(conflict.status).toBe(409);
    const payload = await conflict.json();
    expect(String(payload.error || "")).toContain("AgentLedger webhook");
    expect(await countReplayAudits()).toBe(1);
  });
});
