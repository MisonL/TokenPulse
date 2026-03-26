import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { requestContextMiddleware } from "../src/middleware/request-context";
import enterprise from "../src/routes/enterprise";

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;
const originalAuthMode = config.admin.authMode;

function createAdminApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.route("/api/admin", enterprise);
  return app;
}

function ownerHeaders(traceId: string) {
  return {
    "Content-Type": "application/json",
    "x-admin-user": "audit-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

function auditorHeaders(traceId: string) {
  return {
    "Content-Type": "application/json",
    "x-admin-user": "audit-auditor",
    "x-admin-role": "auditor",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function ensureAuditTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
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

async function resetAuditFixtures() {
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
}

async function countAuditEventsByTraceId(traceId: string) {
  const rows =
    (await db.execute(
      sql.raw(`
        SELECT COUNT(*)::int AS count
        FROM enterprise.audit_events
        WHERE trace_id = '${escapeSqlLiteral(traceId)}'
      `),
    )) as unknown as { rows?: Array<{ count: number | string }> };
  return Number(rows.rows?.[0]?.count || 0);
}

async function readLatestAuditEventByTraceId(traceId: string) {
  const rows =
    (await db.execute(
      sql.raw(`
        SELECT actor, action, resource, resource_id, result, details, trace_id
        FROM enterprise.audit_events
        WHERE trace_id = '${escapeSqlLiteral(traceId)}'
        ORDER BY id DESC
        LIMIT 1
      `),
    )) as unknown as {
      rows?: Array<{
        actor: string;
        action: string;
        resource: string;
        resource_id: string | null;
        result: string;
        details: string | null;
        trace_id: string | null;
      }>;
    };
  return rows.rows?.[0] || null;
}

function parseJsonObject(raw?: string | null) {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe("企业域审计事件写入边界", () => {
  beforeAll(async () => {
    await ensureAuditTables();
  });

  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    config.admin.authMode = "hybrid";
    await resetAuditFixtures();
  });

  afterAll(async () => {
    await resetAuditFixtures();
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
    config.admin.authMode = originalAuthMode;
  });

  it("POST /api/admin/audit/events 未显式传 result 时应默认写 success", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-audit-write-default-success-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/audit/events", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          action: "admin.audit.write",
          resource: "audit.events",
          details: {
            reason: "default result",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);

    const event = await readLatestAuditEventByTraceId(traceId);
    expect(event?.actor).toBe("audit-owner");
    expect(event?.action).toBe("admin.audit.write");
    expect(event?.resource).toBe("audit.events");
    expect(event?.result).toBe("success");
    expect(event?.trace_id).toBe(traceId);
    const details = parseJsonObject(event?.details);
    expect(details.reason).toBe("default result");
  });

  it("POST /api/admin/audit/events 显式传 result=failure 时应写入 failure", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-audit-write-failure-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/audit/events", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          action: "admin.audit.failure.demo",
          resource: "billing.policy",
          resourceId: "policy-1",
          result: "failure",
          details: "policy validation failed",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);

    const event = await readLatestAuditEventByTraceId(traceId);
    expect(event?.actor).toBe("audit-owner");
    expect(event?.action).toBe("admin.audit.failure.demo");
    expect(event?.resource).toBe("billing.policy");
    expect(event?.resource_id).toBe("policy-1");
    expect(event?.result).toBe("failure");
    expect(event?.details).toBe("policy validation failed");
    expect(event?.trace_id).toBe(traceId);
  });

  it("auditor 调用 POST /api/admin/audit/events 应返回 403，并且不写入审计事件", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-audit-write-forbidden-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/audit/events", {
        method: "POST",
        headers: auditorHeaders(traceId),
        body: JSON.stringify({
          action: "admin.audit.write",
          resource: "audit.events",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.traceId).toBe(traceId);
    expect(payload.required).toBe("admin.audit.write");
    expect(payload.role).toBe("auditor");
    expect(await countAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("请求体缺少 action/resource 时应返回 400，并且不写入审计事件", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-audit-write-invalid-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/audit/events", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          resource: "audit.events",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.traceId).toBe(traceId);
    expect(await countAuditEventsByTraceId(traceId)).toBe(0);
  });
});
