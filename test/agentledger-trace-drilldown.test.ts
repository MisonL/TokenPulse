import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { getAgentLedgerTraceDrilldown } from "../src/lib/agentledger/trace-drilldown";
import {
  __resetAgentLedgerWorkerHeartbeatForTests,
  __setAgentLedgerWorkerHeartbeatForTests,
} from "../src/lib/agentledger/runtime-events";

const originalAgentLedgerEnabled = config.agentLedger.enabled;
const originalAgentLedgerSecret = config.agentLedger.secret;
const originalAgentLedgerIngestUrl = config.agentLedger.ingestUrl;

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function ensureTraceDrilldownTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
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

async function resetTraceDrilldownTables() {
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_replay_audits"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_delivery_attempts"));
  await db.execute(sql.raw("DELETE FROM core.agentledger_runtime_outbox"));
}

async function insertOutboxRow(options: {
  traceId: string;
  status: "success" | "failure" | "blocked" | "timeout";
  deliveryState?: "pending" | "delivered" | "retryable_failure" | "replay_required";
  createdAt?: number;
  updatedAt?: number;
}) {
  const now = options.createdAt ?? Date.now();
  const updatedAt = options.updatedAt ?? now;
  const traceId = escapeSqlLiteral(options.traceId);
  const deliveryState = options.deliveryState || "pending";

  await db.execute(
    sql.raw(`
      INSERT INTO core.agentledger_runtime_outbox (
        trace_id, tenant_id, project_id, provider, model, resolved_model, route_policy, account_id,
        status, started_at, finished_at, error_code, cost, idempotency_key, spec_version, key_id,
        target_url, payload_json, payload_hash, headers_json, delivery_state, attempt_count,
        last_http_status, last_error_class, last_error_message, first_failed_at, last_failed_at,
        next_retry_at, delivered_at, created_at, updated_at
      ) VALUES (
        '${traceId}', 'default', NULL, 'claude', 'claude-sonnet',
        'claude:claude-3-7-sonnet-20250219', 'latest_valid', NULL,
        '${options.status}', '2026-03-09T10:00:00.000Z', NULL, NULL, NULL,
        'idem-${traceId}', 'v1', 'tokenpulse-runtime-v1', 'https://agentledger.example.test/runtime',
        '{}', 'hash-${traceId}', '{}', '${deliveryState}', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        ${Math.floor(now)}, ${Math.floor(updatedAt)}
      )
    `),
  );
}

async function insertAuditEventRow(options: {
  traceId: string;
  details: string;
  createdAt?: string;
}) {
  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.audit_events (
        actor, action, resource, resource_id, result, details, ip, user_agent, trace_id, created_at
      ) VALUES (
        'system', 'agentledger.trace.inspect', 'agentledger.trace', NULL, 'success',
        '${escapeSqlLiteral(options.details)}', '127.0.0.1', 'bun-test',
        '${escapeSqlLiteral(options.traceId)}',
        '${escapeSqlLiteral(options.createdAt || new Date().toISOString())}'
      )
    `),
  );
}

describe("AgentLedger trace drilldown", () => {
  beforeAll(async () => {
    await ensureTraceDrilldownTables();
  });

  beforeEach(async () => {
    config.agentLedger.enabled = true;
    config.agentLedger.secret = "tp_agl_v1_shared_secret";
    config.agentLedger.ingestUrl = "https://agentledger.example.test/runtime";
    __resetAgentLedgerWorkerHeartbeatForTests();
    __setAgentLedgerWorkerHeartbeatForTests({
      lastCycleAt: Date.now(),
      lastSuccessAt: Date.now(),
    });
    await resetTraceDrilldownTables();
  });

  afterAll(() => {
    config.agentLedger.enabled = originalAgentLedgerEnabled;
    config.agentLedger.secret = originalAgentLedgerSecret;
    config.agentLedger.ingestUrl = originalAgentLedgerIngestUrl;
    __resetAgentLedgerWorkerHeartbeatForTests();
  });

  it("空 traceId 应直接返回 null", async () => {
    expect(await getAgentLedgerTraceDrilldown("")).toBeNull();
    expect(await getAgentLedgerTraceDrilldown("   ")).toBeNull();
  });

  it("outbox 为 blocked 时应返回 blocked 当前态与健康摘要", async () => {
    const traceId = "trace-agentledger-drilldown-blocked";
    const now = Date.now();
    await insertOutboxRow({
      traceId,
      status: "blocked",
      deliveryState: "pending",
      createdAt: now - 5_000,
      updatedAt: now - 2_000,
    });

    const result = await getAgentLedgerTraceDrilldown(traceId);

    expect(result?.traceId).toBe(traceId);
    expect(result?.summary.currentState).toBe("blocked");
    expect(result?.summary.needsReplay).toBe(false);
    expect(result?.summary.outboxCount).toBe(1);
    expect(result?.summary.deliveryAttemptCount).toBe(0);
    expect(result?.summary.replayAuditCount).toBe(0);
    expect(result?.health.enabled).toBe(true);
    expect(result?.readiness.status).toBeTruthy();
    expect(Number(result?.summary.firstSeenAt || 0)).toBe(now - 5_000);
    expect(Number(result?.summary.lastUpdatedAt || 0)).toBe(now - 2_000);
  });

  it("outbox 为 timeout 时应返回 timeout 当前态", async () => {
    const traceId = "trace-agentledger-drilldown-timeout";
    await insertOutboxRow({
      traceId,
      status: "timeout",
      deliveryState: "pending",
    });

    const result = await getAgentLedgerTraceDrilldown(traceId);

    expect(result?.summary.currentState).toBe("timeout");
    expect(result?.summary.latestAttemptResult).toBeNull();
    expect(result?.summary.latestReplayResult).toBeNull();
    expect(result?.summary.needsReplay).toBe(false);
    expect(result?.outbox[0]?.status).toBe("timeout");
  });

  it("仅命中审计事件且 details 非 JSON 时应保留原始字符串", async () => {
    const traceId = "trace-agentledger-drilldown-audit-raw";
    await insertAuditEventRow({
      traceId,
      details: "raw-details-without-json",
    });

    const result = await getAgentLedgerTraceDrilldown(traceId);

    expect(result?.summary.currentState).toBe("unknown");
    expect(result?.summary.auditEventCount).toBe(1);
    expect(result?.auditEvents[0]?.details).toBe("raw-details-without-json");
    expect(result?.outbox).toEqual([]);
    expect(result?.deliveryAttempts).toEqual([]);
    expect(result?.replayAudits).toEqual([]);
  });
});
