import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { agentLedgerRuntimeOutbox } from "../src/db/schema";
import {
  buildAgentLedgerRuntimeContract,
  buildAgentLedgerRuntimeSignedHeaders,
} from "../src/lib/agentledger/runtime-contract";
import {
  claimAgentLedgerOutboxBatch,
  claimAgentLedgerOutboxRow,
  getAgentLedgerOutboxHealth,
  recordAgentLedgerRuntimeEvent,
  resolveAgentLedgerTenantIdFromHeaders,
  runAgentLedgerOutboxDeliveryCycle,
} from "../src/lib/agentledger/runtime-events";
import { register } from "../src/lib/metrics";

const originalFetch = globalThis.fetch;
const originalAgentLedgerConfig = {
  enabled: config.agentLedger.enabled,
  ingestUrl: config.agentLedger.ingestUrl,
  defaultTenantId: config.agentLedger.defaultTenantId,
  secret: config.agentLedger.secret,
  keyId: config.agentLedger.keyId,
  maxAttempts: config.agentLedger.maxAttempts,
  retryScheduleSec: [...config.agentLedger.retryScheduleSec],
  workerBatchSize: config.agentLedger.workerBatchSize,
  requestTimeoutMs: config.agentLedger.requestTimeoutMs,
  outboxRetentionDays: config.agentLedger.outboxRetentionDays,
};

async function ensureAgentLedgerTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
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
      CREATE TABLE IF NOT EXISTS core.agentledger_delivery_attempts (
        id serial PRIMARY KEY,
        outbox_id integer NOT NULL,
        trace_id text NOT NULL,
        idempotency_key text NOT NULL,
        source text NOT NULL,
        attempt_number integer NOT NULL,
        result text NOT NULL,
        http_status integer,
        error_class text,
        error_message text,
        duration_ms integer,
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

async function resetAgentLedgerTables() {
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_delivery_attempts"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_replay_audits"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_runtime_outbox"));
}

async function readOutboxRows() {
  const result = await db.execute(
    sql.raw(`
      SELECT *
      FROM core.agentledger_runtime_outbox
      ORDER BY id ASC
    `),
  );
  return (
    (result as unknown as {
      rows?: Array<Record<string, unknown>>;
    }).rows || []
  );
}

async function readAttemptRows() {
  const result = await db.execute(
    sql.raw(`
      SELECT *
      FROM core.agentledger_delivery_attempts
      ORDER BY id ASC
    `),
  );
  return (
    (result as unknown as {
      rows?: Array<Record<string, unknown>>;
    }).rows || []
  );
}

async function readAuditRows() {
  const result = await db.execute(
    sql.raw(`
      SELECT *
      FROM enterprise.audit_events
      ORDER BY id ASC
    `),
  );
  return (
    (result as unknown as {
      rows?: Array<Record<string, unknown>>;
    }).rows || []
  );
}

describe("AgentLedger tenantId header fallback", () => {
  const originalDefaultTenantId = config.agentLedger.defaultTenantId;

  afterEach(() => {
    config.agentLedger.defaultTenantId = originalDefaultTenantId;
  });

  it("未提供 tenantId header 时应回退到 config.agentLedger.defaultTenantId", () => {
    config.agentLedger.defaultTenantId = "tenant_x";
    const headers = new Headers();
    expect(resolveAgentLedgerTenantIdFromHeaders(headers)).toBe("tenant_x");
  });

  it("tenantId header 为空白时应回退到 config.agentLedger.defaultTenantId", () => {
    config.agentLedger.defaultTenantId = "tenant_x";
    const headers = new Headers({
      "x-tokenpulse-tenant": "  ",
    });
    expect(resolveAgentLedgerTenantIdFromHeaders(headers)).toBe("tenant_x");
  });

  it("tenantId header 存在时应优先使用 header（并归一化）", () => {
    config.agentLedger.defaultTenantId = "tenant_x";
    const headers = new Headers({
      "x-tokenpulse-tenant": " TENANT_A ",
    });
    expect(resolveAgentLedgerTenantIdFromHeaders(headers)).toBe("tenant_a");
  });

  it("缺少 x-tokenpulse-tenant 时应使用 x-admin-tenant", () => {
    config.agentLedger.defaultTenantId = "tenant_x";
    const headers = new Headers({
      "x-admin-tenant": " TENANT_B ",
    });
    expect(resolveAgentLedgerTenantIdFromHeaders(headers)).toBe("tenant_b");
  });
});

describe("AgentLedger runtime outbox", () => {
  beforeAll(async () => {
    await ensureAgentLedgerTables();
  });

  beforeEach(async () => {
    await resetAgentLedgerTables();
    config.agentLedger.enabled = true;
    config.agentLedger.ingestUrl = "http://agentledger.test/runtime-events";
    config.agentLedger.secret = "tp_agl_v1_shared_secret";
    config.agentLedger.keyId = "tokenpulse-runtime-v1";
    config.agentLedger.maxAttempts = 5;
    config.agentLedger.retryScheduleSec = [0, 30, 120, 600, 1800];
    config.agentLedger.workerBatchSize = 20;
    config.agentLedger.requestTimeoutMs = 1000;
    config.agentLedger.outboxRetentionDays = 7;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  afterAll(() => {
    config.agentLedger.enabled = originalAgentLedgerConfig.enabled;
    config.agentLedger.ingestUrl = originalAgentLedgerConfig.ingestUrl;
    config.agentLedger.defaultTenantId = originalAgentLedgerConfig.defaultTenantId;
    config.agentLedger.secret = originalAgentLedgerConfig.secret;
    config.agentLedger.keyId = originalAgentLedgerConfig.keyId;
    config.agentLedger.maxAttempts = originalAgentLedgerConfig.maxAttempts;
    config.agentLedger.retryScheduleSec = [...originalAgentLedgerConfig.retryScheduleSec];
    config.agentLedger.workerBatchSize = originalAgentLedgerConfig.workerBatchSize;
    config.agentLedger.requestTimeoutMs = originalAgentLedgerConfig.requestTimeoutMs;
    config.agentLedger.outboxRetentionDays = originalAgentLedgerConfig.outboxRetentionDays;
  });

  it("应写入一条幂等 outbox 记录，并在重复事件时不重复插入", async () => {
    const payload = {
      traceId: "trace-agentledger-runtime-001",
      tenantId: "default",
      provider: "claude",
      model: "claude-sonnet",
      resolvedModel: "claude:claude-3-7-sonnet-20250219",
      routePolicy: "latest_valid",
      status: "success" as const,
      startedAt: "2026-03-07T10:00:00.000Z",
      finishedAt: "2026-03-07T10:00:01.000Z",
      cost: "0.002310",
    };

    const first = await recordAgentLedgerRuntimeEvent(payload);
    const second = await recordAgentLedgerRuntimeEvent(payload);

    expect(first.queued).toBe(true);
    expect(second.duplicate).toBe(true);

    const rows = await readOutboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trace_id).toBe("trace-agentledger-runtime-001");
    expect(rows[0]?.delivery_state).toBe("pending");
    expect(rows[0]?.target_url).toBe("http://agentledger.test/runtime-events");
    expect(String(rows[0]?.payload_json || "")).toContain("\"routePolicy\":\"latest_valid\"");
  });

  it("缺少 traceId 时应拒绝入队", async () => {
    const missingTraceIdEvent = {
      provider: "claude",
      model: "claude-sonnet",
      resolvedModel: "claude:claude-3-7-sonnet-20250219",
      routePolicy: "latest_valid",
      status: "success",
      startedAt: "2026-03-07T10:05:00.000Z",
    } as unknown as Parameters<typeof recordAgentLedgerRuntimeEvent>[0];

    const result = await recordAgentLedgerRuntimeEvent(missingTraceIdEvent);

    expect(result.queued).toBe(false);

    const rows = await readOutboxRows();
    expect(rows).toHaveLength(0);
  });

  it("缺少 startedAt 时应拒绝入队", async () => {
    const missingStartedAtEvent = {
      traceId: "trace-agentledger-runtime-missing-started-at",
      provider: "claude",
      model: "claude-sonnet",
      resolvedModel: "claude:claude-3-7-sonnet-20250219",
      routePolicy: "latest_valid",
      status: "success",
    } as unknown as Parameters<typeof recordAgentLedgerRuntimeEvent>[0];

    const result = await recordAgentLedgerRuntimeEvent(missingStartedAtEvent);

    expect(result.queued).toBe(false);

    const rows = await readOutboxRows();
    expect(rows).toHaveLength(0);
  });

  it("显式 traceId 与 startedAt 时，payloadJson / 幂等键 / 落库字段应保持一致", async () => {
    const input = {
      traceId: "trace-agentledger-runtime-explicit-001",
      tenantId: "default",
      provider: "claude",
      model: "claude-sonnet",
      resolvedModel: "claude:claude-3-7-sonnet-20250219",
      routePolicy: "latest_valid",
      status: "success",
      startedAt: "2026-03-07T10:05:00.000Z",
      finishedAt: "2026-03-07T10:05:01.000Z",
    } as const;
    const expectedContract = buildAgentLedgerRuntimeContract(input, {
      defaultRoutePolicy: config.oauthSelection.defaultPolicy,
      specVersion: config.agentLedger.specVersion,
      keyId: config.agentLedger.keyId,
    });
    const result = await recordAgentLedgerRuntimeEvent(input);

    expect(result.queued).toBe(true);

    const rows = await readOutboxRows();
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(String(row.payload_json || "")).toBe(expectedContract.payloadJson);
    expect(String(row.trace_id || "")).toBe(expectedContract.payload.traceId);
    expect(String(row.started_at || "")).toBe(expectedContract.payload.startedAt);
    expect(String(row.provider || "")).toBe(expectedContract.payload.provider);
    expect(String(row.model || "")).toBe(expectedContract.payload.model);
    expect(String(row.payload_hash || "")).toBe(expectedContract.payloadHash);
    expect(String(row.idempotency_key || "")).toBe(expectedContract.idempotencyKey);
  });

  it("outbox 入库失败时应记录失败审计并更新指标", async () => {
    await db.execute(sql.raw("DROP TABLE core.agentledger_runtime_outbox"));

    const result = await recordAgentLedgerRuntimeEvent({
      traceId: "trace-agentledger-runtime-write-failed-001",
      tenantId: "default",
      provider: "claude",
      model: "claude-sonnet",
      resolvedModel: "claude:claude-3-7-sonnet-20250219",
      routePolicy: "latest_valid",
      status: "failure",
      startedAt: "2026-03-07T10:06:00.000Z",
      finishedAt: "2026-03-07T10:06:01.000Z",
      errorCode: "outbox_write_failed",
    });

    expect(result).toEqual({ queued: false });

    const auditRows = await readAuditRows();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("agentledger.outbox.write_failed");
    expect(auditRows[0]?.resource).toBe("agentledger.runtime.outbox");
    expect(auditRows[0]?.result).toBe("failure");
    expect(auditRows[0]?.trace_id).toBe("trace-agentledger-runtime-write-failed-001");
    expect(String(auditRows[0]?.details || "")).toContain("\"failureReason\":\"outbox_write_failed\"");
    expect(String(auditRows[0]?.details || "")).toContain("\"headersJson\":");

    const metricsText = await register.metrics();
    expect(metricsText).toContain("tokenpulse_agentledger_runtime_outbox_write_total");
    expect(metricsText).toContain('result="failed",reason="outbox_write_failed"');

    await ensureAgentLedgerTables();
  });

  it("投递成功后应标记 delivered，并携带冻结头部参与签名", async () => {
    await recordAgentLedgerRuntimeEvent({
      traceId: "trace-agentledger-runtime-002",
      tenantId: "default",
      provider: "claude",
      model: "claude-sonnet",
      resolvedModel: "claude:claude-3-7-sonnet-20250219",
      routePolicy: "latest_valid",
      status: "success",
      startedAt: "2026-03-07T10:10:00.000Z",
      finishedAt: "2026-03-07T10:10:01.000Z",
    });

    let capturedHeaders: Headers | null = null;
    let capturedBody = "";
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body || "");
      return new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    const result = await runAgentLedgerOutboxDeliveryCycle();
    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(1);
    expect(capturedHeaders).not.toBeNull();
    if (!capturedHeaders) {
      throw new Error("expected captured headers");
    }
    const headers = new Headers(capturedHeaders);
    const expectedSignedHeaders = buildAgentLedgerRuntimeSignedHeaders({
      specVersion: "v1",
      keyId: "tokenpulse-runtime-v1",
      timestampSec: headers.get("X-TokenPulse-Timestamp") || "",
      idempotencyKey: headers.get("X-TokenPulse-Idempotency-Key") || "",
      rawBody: capturedBody,
      secret: config.agentLedger.secret,
    });
    expect(headers.get("X-TokenPulse-Spec-Version")).toBe("v1");
    expect(headers.get("X-TokenPulse-Key-Id")).toBe("tokenpulse-runtime-v1");
    expect(headers.get("X-TokenPulse-Idempotency-Key")).toBeTruthy();
    expect(headers.get("X-TokenPulse-Timestamp")).toMatch(/^\d+$/);
    expect(headers.get("X-TokenPulse-Signature")).toBe(
      expectedSignedHeaders.headers["X-TokenPulse-Signature"],
    );
    expect(capturedBody).toContain("\"traceId\":\"trace-agentledger-runtime-002\"");

    const rows = await readOutboxRows();
    expect(rows[0]?.delivery_state).toBe("delivered");
    expect(rows[0]?.attempt_count).toBe(1);
    expect(rows[0]?.last_http_status).toBe(202);
    expect(rows[0]?.delivered_at).toBeTruthy();

    const attempts = await readAttemptRows();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.source).toBe("worker");
    expect(attempts[0]?.result).toBe("delivered");
    expect(attempts[0]?.http_status).toBe(202);
    expect(Number(attempts[0]?.duration_ms || 0)).toBeGreaterThanOrEqual(0);

    const health = await getAgentLedgerOutboxHealth();
    expect(health.openBacklogTotal).toBe(0);
    expect(health.lastCycleAt).toBeTruthy();
    expect(health.lastSuccessAt).toBeTruthy();

    const metricsText = await register.metrics();
    expect(metricsText).toContain("tokenpulse_agentledger_runtime_last_cycle_timestamp_seconds");
    expect(metricsText).toContain("tokenpulse_agentledger_runtime_last_success_timestamp_seconds");
    expect(metricsText).toContain("tokenpulse_agentledger_runtime_open_backlog_total 0");
  });

  it("429/5xx 网络类失败应进入 retryable_failure，超过最大次数后进入 replay_required", async () => {
    config.agentLedger.maxAttempts = 2;
    config.agentLedger.retryScheduleSec = [0, 1];

    for (const status of [429, 500, 501, 503]) {
      const traceId = `trace-agentledger-runtime-retry-${status}`;
      await resetAgentLedgerTables();

      await recordAgentLedgerRuntimeEvent({
        traceId,
        tenantId: "default",
        provider: "codex",
        model: "gpt-4.1",
        resolvedModel: "codex:gpt-4.1",
        routePolicy: "round_robin",
        status: "failure",
        startedAt: "2026-03-07T10:20:00.000Z",
        finishedAt: "2026-03-07T10:20:01.000Z",
        errorCode: `upstream_http_${status}`,
      });

      globalThis.fetch = mock(async () => {
        return new Response("temporary unavailable", { status });
      }) as unknown as typeof fetch;

      const first = await runAgentLedgerOutboxDeliveryCycle();
      expect(first.attempted).toBe(1);

      let rows = await readOutboxRows();
      expect(rows[0]?.delivery_state).toBe("retryable_failure");
      expect(rows[0]?.attempt_count).toBe(1);
      expect(rows[0]?.next_retry_at).toBeTruthy();

      await db.execute(
        sql.raw(`
          UPDATE core.agentledger_runtime_outbox
          SET next_retry_at = 0
          WHERE trace_id = '${traceId}'
        `),
      );

      const second = await runAgentLedgerOutboxDeliveryCycle();
      expect(second.attempted).toBe(1);

      rows = await readOutboxRows();
      expect(rows[0]?.delivery_state).toBe("replay_required");
      expect(rows[0]?.attempt_count).toBe(2);
      expect(rows[0]?.last_http_status).toBe(status);

      const attempts = await readAttemptRows();
      expect(attempts).toHaveLength(2);
      expect(attempts[0]?.source).toBe("worker");
      expect(attempts[0]?.result).toBe("retryable_failure");
      expect(attempts[1]?.source).toBe("worker");
      expect(attempts[1]?.result).toBe("permanent_failure");

      const health = await getAgentLedgerOutboxHealth();
      expect(health.openBacklogTotal).toBe(1);
      expect(health.oldestOpenBacklogAgeSec).toBeGreaterThanOrEqual(0);
    }
  });

  it("claim lease 应阻止同一条 outbox 被重复认领，并在租约过期后允许再次认领", async () => {
    await recordAgentLedgerRuntimeEvent({
      traceId: "trace-agentledger-runtime-004",
      tenantId: "default",
      provider: "openai",
      model: "gpt-4.1",
      resolvedModel: "openai:gpt-4.1",
      routePolicy: "sticky_user",
      status: "timeout",
      startedAt: "2026-03-07T10:30:00.000Z",
      finishedAt: "2026-03-07T10:30:05.000Z",
      errorCode: "request_timeout",
    });

    const [candidate] = await db.select().from(agentLedgerRuntimeOutbox).limit(1);
    expect(candidate).toBeTruthy();

    const claimedAt = Math.max(Number(candidate?.nextRetryAt || 0), Date.now()) + 1_000;
    const leaseUntil = claimedAt + 30_000;
    const first = await claimAgentLedgerOutboxRow(candidate!, claimedAt, leaseUntil);
    const duplicate = await claimAgentLedgerOutboxRow(candidate!, claimedAt, leaseUntil);

    expect(first?.id).toBe(candidate?.id);
    expect(duplicate).toBeNull();

    let rows = await readOutboxRows();
    expect(rows[0]?.next_retry_at).toBe(leaseUntil);

    const stillLeased = await claimAgentLedgerOutboxBatch(claimedAt + 1);
    expect(stillLeased).toHaveLength(0);

    const reclaimed = await claimAgentLedgerOutboxBatch(leaseUntil + 1);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.id).toBe(candidate?.id);
  });
});
