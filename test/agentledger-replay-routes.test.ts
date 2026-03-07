import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { register } from "../src/lib/metrics";
import { requestContextMiddleware } from "../src/middleware/request-context";
import enterprise from "../src/routes/enterprise";
import {
  __resetAgentLedgerWorkerHeartbeatForTests,
  __setAgentLedgerWorkerHeartbeatForTests,
  recordAgentLedgerRuntimeEvent,
} from "../src/lib/agentledger/runtime-events";

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

async function resetAgentLedgerRouteTables() {
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_delivery_attempts"));
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

async function listAuditActions() {
  const result = await db.execute(
    sql.raw(`
      SELECT action
      FROM enterprise.audit_events
      ORDER BY id ASC
    `),
  );
  return (
    (result as unknown as {
      rows?: Array<{ action: string }>;
    }).rows || []
  ).map((row) => String(row.action || ""));
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
    __resetAgentLedgerWorkerHeartbeatForTests();
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
    }) as unknown as typeof fetch;

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

  it("health 与 replay audits 路由应返回聚合结果，并更新 AgentLedger gauges", async () => {
    await seedOutboxEvent("trace-agentledger-route-004");
    config.agentLedger.secret = "";

    const healthResponse = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/health", {
        headers: auditorHeaders("trace-agentledger-health"),
      }),
    );
    expect(healthResponse.status).toBe(200);
    const healthPayload = await healthResponse.json();
    expect(healthPayload.data?.enabled).toBe(true);
    expect(healthPayload.data?.deliveryConfigured).toBe(false);
    expect(healthPayload.data?.backlog?.pending).toBe(1);
    expect(healthPayload.data?.backlog?.total).toBe(1);
    expect(healthPayload.data?.openBacklogTotal).toBe(1);
    expect(healthPayload.data?.oldestOpenBacklogAgeSec).toBeGreaterThanOrEqual(0);
    expect(healthPayload.data?.lastCycleAt ?? null).toBeNull();
    expect(healthPayload.data?.lastSuccessAt ?? null).toBeNull();

    const denied = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/health", {
        headers: operatorHeaders("trace-agentledger-health-denied"),
      }),
    );
    expect(denied.status).toBe(403);

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'tokenpulse_agentledger_runtime_worker_config_state{state="enabled"} 1',
    );
    expect(metricsText).toContain(
      'tokenpulse_agentledger_runtime_worker_config_state{state="delivery_configured"} 0',
    );
    expect(metricsText).toContain(
      'tokenpulse_agentledger_runtime_outbox_backlog{delivery_state="pending"} 1',
    );
    expect(metricsText).toContain("tokenpulse_agentledger_runtime_open_backlog_total 1");

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;
    config.agentLedger.secret = "tp_agl_v1_shared_secret";
    const outboxId = await seedOutboxEvent("trace-agentledger-route-005");
    const replay = await app.fetch(
      new Request(`http://localhost/api/admin/observability/agentledger-outbox/${outboxId}/replay`, {
        method: "POST",
        headers: ownerHeaders("trace-agentledger-health-replay"),
      }),
    );
    expect(replay.status).toBe(200);

    const attemptList = await app.fetch(
      new Request(
        `http://localhost/api/admin/observability/agentledger-delivery-attempts?page=1&pageSize=10&outboxId=${outboxId}&source=manual_replay&result=delivered`,
        {
          headers: auditorHeaders("trace-agentledger-delivery-attempts"),
        },
      ),
    );
    expect(attemptList.status).toBe(200);
    const attemptListPayload = await attemptList.json();
    expect(attemptListPayload.total).toBe(1);
    expect(attemptListPayload.data?.[0]?.outboxId).toBe(outboxId);
    expect(attemptListPayload.data?.[0]?.source).toBe("manual_replay");
    expect(attemptListPayload.data?.[0]?.result).toBe("delivered");

    const attemptSummary = await app.fetch(
      new Request(
        `http://localhost/api/admin/observability/agentledger-delivery-attempts/summary?outboxId=${outboxId}&source=manual_replay&result=delivered`,
        {
          headers: auditorHeaders("trace-agentledger-delivery-attempts-summary"),
        },
      ),
    );
    expect(attemptSummary.status).toBe(200);
    const attemptSummaryPayload = await attemptSummary.json();
    expect(attemptSummaryPayload.data?.total).toBe(1);
    expect(attemptSummaryPayload.data?.bySource?.manual_replay).toBe(1);
    expect(attemptSummaryPayload.data?.byResult?.delivered).toBe(1);

    const deniedAttempts = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-delivery-attempts", {
        headers: operatorHeaders("trace-agentledger-delivery-attempts-denied"),
      }),
    );
    expect(deniedAttempts.status).toBe(403);

    const auditList = await app.fetch(
      new Request(
        "http://localhost/api/admin/observability/agentledger-replay-audits?page=1&pageSize=10",
        {
          headers: auditorHeaders("trace-agentledger-replay-audits"),
        },
      ),
    );
    expect(auditList.status).toBe(200);
    const auditListPayload = await auditList.json();
    expect(Array.isArray(auditListPayload.data)).toBe(true);
    expect(auditListPayload.total).toBeGreaterThanOrEqual(1);
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const filteredAuditList = await app.fetch(
      new Request(
        `http://localhost/api/admin/observability/agentledger-replay-audits?page=1&pageSize=10&outboxId=${outboxId}&result=delivered&triggerSource=manual&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        {
          headers: auditorHeaders("trace-agentledger-replay-audits-filtered"),
        },
      ),
    );
    expect(filteredAuditList.status).toBe(200);
    const filteredAuditListPayload = await filteredAuditList.json();
    expect(filteredAuditListPayload.total).toBe(1);
    expect(filteredAuditListPayload.data?.[0]?.outboxId).toBe(outboxId);
    expect(filteredAuditListPayload.data?.[0]?.result).toBe("delivered");
    expect(filteredAuditListPayload.data?.[0]?.triggerSource).toBe("manual");

    const auditSummary = await app.fetch(
      new Request(
        `http://localhost/api/admin/observability/agentledger-replay-audits/summary?outboxId=${outboxId}&result=delivered&triggerSource=manual&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        {
          headers: auditorHeaders("trace-agentledger-replay-audits-summary"),
        },
      ),
    );
    expect(auditSummary.status).toBe(200);
    const auditSummaryPayload = await auditSummary.json();
    expect(auditSummaryPayload.data?.total).toBe(1);
    expect(auditSummaryPayload.data?.byResult?.delivered).toBe(1);
  });

  it("readiness 路由应区分 disabled / blocking / degraded，并阻断已知坏状态", async () => {
    config.agentLedger.enabled = false;
    const disabled = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/readiness", {
        headers: auditorHeaders("trace-agentledger-readiness-disabled"),
      }),
    );
    expect(disabled.status).toBe(200);
    const disabledPayload = await disabled.json();
    expect(disabledPayload.data?.ready).toBe(true);
    expect(disabledPayload.data?.status).toBe("disabled");

    config.agentLedger.enabled = true;
    config.agentLedger.secret = "";
    const blocking = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/readiness", {
        headers: auditorHeaders("trace-agentledger-readiness-blocking"),
      }),
    );
    expect(blocking.status).toBe(503);
    const blockingPayload = await blocking.json();
    expect(blockingPayload.data?.ready).toBe(false);
    expect(blockingPayload.data?.status).toBe("blocking");
    expect(blockingPayload.data?.blockingReasons).toContain("delivery_not_configured");

    config.agentLedger.secret = "tp_agl_v1_shared_secret";
    __setAgentLedgerWorkerHeartbeatForTests({
      lastCycleAt: Date.now(),
      lastSuccessAt: Date.now(),
    });
    const degradedId = await seedOutboxEvent("trace-agentledger-readiness-degraded");
    await db.execute(
      sql.raw(`
        UPDATE core.agentledger_runtime_outbox
        SET delivery_state = 'retryable_failure',
            next_retry_at = ${Date.now() + 60_000},
            updated_at = ${Date.now()}
        WHERE id = ${degradedId}
      `),
    );

    const degraded = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/readiness", {
        headers: auditorHeaders("trace-agentledger-readiness-degraded"),
      }),
    );
    expect(degraded.status).toBe(200);
    const degradedPayload = await degraded.json();
    expect(degradedPayload.data?.ready).toBe(true);
    expect(degradedPayload.data?.status).toBe("degraded");
    expect(degradedPayload.data?.degradedReasons).toContain("retryable_backlog");

    const replayRequiredId = await seedOutboxEvent("trace-agentledger-readiness-replay-required");
    await db.execute(
      sql.raw(`
        UPDATE core.agentledger_runtime_outbox
        SET delivery_state = 'replay_required',
            updated_at = ${Date.now()}
        WHERE id = ${replayRequiredId}
      `),
    );
    const replayRequired = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/readiness", {
        headers: auditorHeaders("trace-agentledger-readiness-replay-required"),
      }),
    );
    expect(replayRequired.status).toBe(503);
    const replayRequiredPayload = await replayRequired.json();
    expect(replayRequiredPayload.data?.ready).toBe(false);
    expect(replayRequiredPayload.data?.blockingReasons).toContain("replay_required_backlog");

    const stalePendingId = await seedOutboxEvent("trace-agentledger-readiness-pending-stale");
    await db.execute(
      sql.raw(`
        UPDATE core.agentledger_runtime_outbox
        SET delivery_state = 'pending',
            next_retry_at = ${Date.now() - 300_000},
            updated_at = ${Date.now() - 300_000}
        WHERE id = ${stalePendingId}
      `),
    );
    const stalePending = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/readiness", {
        headers: auditorHeaders("trace-agentledger-readiness-pending-stale"),
      }),
    );
    expect(stalePending.status).toBe(503);
    const stalePendingPayload = await stalePending.json();
    expect(stalePendingPayload.data?.ready).toBe(false);
    expect(stalePendingPayload.data?.blockingReasons).toContain("pending_backlog_stale");

    await resetAgentLedgerRouteTables();
    const missingCycleId = await seedOutboxEvent("trace-agentledger-readiness-missing-cycle");
    await db.execute(
      sql.raw(`
        UPDATE core.agentledger_runtime_outbox
        SET delivery_state = 'pending',
            next_retry_at = ${Date.now()},
            updated_at = ${Date.now()}
        WHERE id = ${missingCycleId}
      `),
    );
    __setAgentLedgerWorkerHeartbeatForTests({
      lastCycleAt: null,
      lastSuccessAt: null,
    });
    const missingCycle = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/readiness", {
        headers: auditorHeaders("trace-agentledger-readiness-missing-cycle"),
      }),
    );
    expect(missingCycle.status).toBe(503);
    const missingCyclePayload = await missingCycle.json();
    expect(missingCyclePayload.data?.ready).toBe(false);
    expect(missingCyclePayload.data?.blockingReasons).toContain("worker_cycle_missing");

    await resetAgentLedgerRouteTables();
    __setAgentLedgerWorkerHeartbeatForTests({
      lastCycleAt: Date.now() - 300_000,
      lastSuccessAt: Date.now() - 300_000,
    });
    const staleCycle = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/readiness", {
        headers: auditorHeaders("trace-agentledger-readiness-stale-cycle"),
      }),
    );
    expect(staleCycle.status).toBe(503);
    const staleCyclePayload = await staleCycle.json();
    expect(staleCyclePayload.data?.ready).toBe(false);
    expect(staleCyclePayload.data?.blockingReasons).toContain("worker_cycle_stale");
  });

  it("batch replay 应支持去重、部分 not_found，并写入 batch 审计", async () => {
    const firstId = await seedOutboxEvent("trace-agentledger-route-006");
    const secondId = await seedOutboxEvent("trace-agentledger-route-007");

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    const response = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/replay-batch", {
        method: "POST",
        headers: ownerHeaders("trace-agentledger-replay-batch"),
        body: JSON.stringify({
          ids: [firstId, secondId, firstId, 999999],
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.data?.requestedCount).toBe(4);
    expect(payload.data?.processedCount).toBe(3);
    expect(payload.data?.successCount).toBe(2);
    expect(payload.data?.notFoundCount).toBe(1);
    expect(payload.data?.notConfiguredCount).toBe(0);
    expect(payload.data?.failureCount).toBe(1);

    expect(await countReplayAudits()).toBe(2);
    const actions = await listAuditActions();
    expect(actions).toContain("agentledger.outbox.replay_batch");
  });

  it("batch replay 在 delivery 未配置时应返回 not_configured 失败语义", async () => {
    const outboxId = await seedOutboxEvent("trace-agentledger-route-008");
    config.agentLedger.secret = "";

    const response = await app.fetch(
      new Request("http://localhost/api/admin/observability/agentledger-outbox/replay-batch", {
        method: "POST",
        headers: ownerHeaders("trace-agentledger-replay-batch-not-configured"),
        body: JSON.stringify({
          ids: [outboxId],
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.data?.requestedCount).toBe(1);
    expect(payload.data?.processedCount).toBe(1);
    expect(payload.data?.successCount).toBe(0);
    expect(payload.data?.failureCount).toBe(1);
    expect(payload.data?.notConfiguredCount).toBe(1);
    expect(payload.data?.items?.[0]?.code).toBe("not_configured");
    expect(await countReplayAudits()).toBe(1);
  });
});
