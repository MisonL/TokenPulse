import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { requestContextMiddleware } from "../src/middleware/request-context";
import enterprise from "../src/routes/enterprise";

function createAdminApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.route("/api/admin", enterprise);
  return app;
}

function ownerHeaders(traceId: string) {
  return {
    "Content-Type": "application/json",
    "x-admin-user": "policy-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function countSuccessAuditEventsByTraceId(traceId: string) {
  const result = await db.execute(
    sql.raw(`
      SELECT COUNT(*)::int AS count
      FROM enterprise.audit_events
      WHERE trace_id = '${escapeSqlLiteral(traceId)}'
        AND result = 'success'
    `),
  );
  const rows =
    (result as unknown as {
      rows?: Array<{
        count: number | string;
      }>;
    }).rows || [];
  return Number(rows[0]?.count || 0);
}

async function readLatestAuditEventByTraceId(traceId: string) {
  const result = await db.execute(
    sql.raw(`
      SELECT action, resource, resource_id, result, trace_id
      FROM enterprise.audit_events
      WHERE trace_id = '${escapeSqlLiteral(traceId)}'
      ORDER BY id DESC
      LIMIT 1
    `),
  );
  const rows =
    (result as unknown as {
      rows?: Array<{
        action: string;
        resource: string;
        resource_id: string | null;
        result: string;
        trace_id?: string | null;
      }>;
    }).rows || [];
  return rows[0] || null;
}

async function ensureEnterprisePolicyTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.tenants (
        id text PRIMARY KEY,
        name text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.admin_roles (
        key text PRIMARY KEY,
        name text NOT NULL,
        permissions text NOT NULL,
        builtin integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.admin_users (
        id text PRIMARY KEY,
        username text NOT NULL,
        password_hash text NOT NULL,
        display_name text,
        status text NOT NULL DEFAULT 'active',
        created_at text NOT NULL,
        updated_at text NOT NULL
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
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS quota_usage_windows_unique_idx ON enterprise.quota_usage_windows (policy_id, bucket_type, window_start)",
    ),
  );
}

async function seedPolicyScopeFixtures() {
  const nowIso = new Date().toISOString();
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM enterprise.quota_usage_windows"));
  await db.execute(sql.raw("DELETE FROM enterprise.quota_policies"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_users"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
  await db.execute(sql.raw("DELETE FROM enterprise.tenants"));

  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
      VALUES
        ('default', '默认租户', 'active', '${nowIso}', '${nowIso}'),
        ('tenant-a', '租户 A', 'active', '${nowIso}', '${nowIso}')
    `),
  );

  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
      VALUES
        ('owner', '所有者', '["admin.dashboard.read","admin.users.manage","admin.org.read","admin.org.manage","admin.rbac.manage","admin.tenants.manage","admin.oauth.manage","admin.billing.manage","admin.audit.read","admin.audit.write"]', 1, '${nowIso}', '${nowIso}'),
        ('auditor', '审计员', '["admin.dashboard.read","admin.audit.read","admin.org.read"]', 1, '${nowIso}', '${nowIso}'),
        ('operator', '运维员', '["admin.dashboard.read","admin.users.manage"]', 1, '${nowIso}', '${nowIso}')
    `),
  );

  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.admin_users (id, username, password_hash, display_name, status, created_at, updated_at)
      VALUES
        ('admin-policy-owner', 'policy-owner', 'hash-value', 'Policy Owner', 'active', '${nowIso}', '${nowIso}'),
        ('admin-quota-user', 'quota-user', 'hash-value', 'Quota User', 'active', '${nowIso}', '${nowIso}')
    `),
  );
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;

describe("企业域计费策略范围校验", () => {
  beforeAll(async () => {
    await ensureEnterprisePolicyTables();
  });

  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    await seedPolicyScopeFixtures();
  });

  afterAll(async () => {
    await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
    await db.execute(sql.raw("DELETE FROM enterprise.quota_usage_windows"));
    await db.execute(sql.raw("DELETE FROM enterprise.quota_policies"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_users"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
    await db.execute(sql.raw("DELETE FROM enterprise.tenants"));
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("scopeType=global 时传 scopeValue 应返回 400", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-global-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Global Invalid",
          scopeType: "global",
          scopeValue: "tenant-a",
          requestsPerMinute: 30,
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("scopeType=global 时不允许提供 scopeValue");
    expect(payload.traceId).toBe(traceId);
  });

  it("requestsPerMinute 为负数时应返回 400，并且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-invalid-negative-rpm-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Negative RPM",
          scopeType: "global",
          requestsPerMinute: -1,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("scopeType=user 缺少 scopeValue 时应返回 400 并回传 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-user-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "User Scope Missing",
          scopeType: "user",
          requestsPerMinute: 12,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("scopeType=user 时必须提供 scopeValue");
    expect(payload.traceId).toBe(traceId);
  });

  it("scopeType=tenant 缺少 scopeValue 时应返回 400 并回传 traceId，且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-tenant-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Tenant Scope Missing",
          scopeType: "tenant",
          requestsPerMinute: 12,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("scopeType=tenant 时必须提供 scopeValue");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("scopeType=role 缺少 scopeValue 时应返回 400 并回传 traceId，且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-role-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Role Scope Missing",
          scopeType: "role",
          requestsPerMinute: 12,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("scopeType=role 时必须提供 scopeValue");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("scopeType=tenant 传入大小写和空白 scopeValue 时应归一化为小写并保持审计 traceId 一致", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-tenant-normalized-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Tenant Scope Normalized",
          scopeType: "tenant",
          scopeValue: "  TENANT-A  ",
          requestsPerMinute: 18,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.scopeType).toBe("tenant");
    expect(payload.data.scopeValue).toBe("tenant-a");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(1);

    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.billing.policy.create");
    expect(audit?.resource_id).toBe(String(payload.data.id || ""));
    expect(audit?.trace_id).toBe(traceId);
  });

  it("scopeType=user 且用户不存在时应返回 404 并回传 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-user-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "User Scope Missing User",
          scopeType: "user",
          scopeValue: "user-not-exists",
          requestsPerMinute: 12,
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("用户不存在");
    expect(payload.traceId).toBe(traceId);
  });

  it("scopeType=user 且用户存在时应成功创建策略", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-user-valid-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "User Scope Valid",
          scopeType: "user",
          scopeValue: "quota-user",
          requestsPerMinute: 14,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.scopeType).toBe("user");
    expect(payload.data.scopeValue).toBe("quota-user");
    expect(payload.traceId).toBe(traceId);
  });

  it("scopeType=user 创建时传带空白用户名应 trim 后命中已存在用户并成功", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-user-trim-create-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "User Scope Trim Create",
          scopeType: "user",
          scopeValue: "  quota-user  ",
          requestsPerMinute: 60,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.scopeType).toBe("user");
    expect(payload.data.scopeValue).toBe("quota-user");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(1);
  });

  it("scopeType=user 创建时传大写用户名应归一化为小写并成功", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-user-uppercase-create-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "User Policy Uppercase Create",
          scopeType: "user",
          scopeValue: "QUOTA-USER",
          requestsPerMinute: 17,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.scopeType).toBe("user");
    expect(payload.data.scopeValue).toBe("quota-user");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(1);
  });

  it("PUT 切换为 scopeType=global 且未传 scopeValue 时应清空并保存成功", async () => {
    const app = createAdminApp();

    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-scope-update-001"),
        body: JSON.stringify({
          name: "Tenant Policy",
          scopeType: "tenant",
          scopeValue: "tenant-a",
          requestsPerMinute: 25,
        }),
      }),
    );

    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    expect(createPayload.success).toBe(true);
    expect(createPayload.data.scopeType).toBe("tenant");
    expect(createPayload.data.scopeValue).toBe("tenant-a");

    const policyId = String(createPayload.data.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders("trace-policy-scope-update-002"),
        body: JSON.stringify({
          scopeType: "global",
        }),
      }),
    );

    expect(updateResponse.status).toBe(200);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.scopeType).toBe("global");
    expect(updatePayload.data.scopeValue).toBeUndefined();
  });

  it("PUT 切换为 scopeType=global 且仍传 scopeValue 时应返回 400", async () => {
    const app = createAdminApp();

    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-scope-update-invalid-001"),
        body: JSON.stringify({
          name: "Tenant Policy Invalid Update",
          scopeType: "tenant",
          scopeValue: "tenant-a",
          requestsPerMinute: 20,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);

    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-scope-update-invalid-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "global",
          scopeValue: "tenant-a",
        }),
      }),
    );

    expect(updateResponse.status).toBe(400);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.error).toBe("scopeType=global 时不允许提供 scopeValue");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT 从 global 切换到 tenant 但缺少 scopeValue 时应返回 400", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-tenant-missing-001"),
        body: JSON.stringify({
          name: "Global Baseline",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);

    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-tenant-missing-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "tenant",
        }),
      }),
    );

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.error).toBe("scopeType=tenant 时必须提供 scopeValue");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT 切换为 scopeType=tenant 时应将 scopeValue 归一化为小写，并保持审计 traceId 一致", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-tenant-normalized-001"),
        body: JSON.stringify({
          name: "Global To Tenant Normalized",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-tenant-normalized-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "tenant",
          scopeValue: "  TENANT-A  ",
        }),
      }),
    );

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.scopeType).toBe("tenant");
    expect(updatePayload.data.scopeValue).toBe("tenant-a");
    expect(updatePayload.traceId).toBe(traceId);

    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.billing.policy.update");
    expect(audit?.resource_id).toBe(policyId);
    expect(audit?.trace_id).toBe(traceId);
  });

  it("PUT scopeType 不变但 scopeValue 非法时应返回 404 并回传 traceId", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-invalid-scope-value-001"),
        body: JSON.stringify({
          name: "Tenant Policy Scope Value Update",
          scopeType: "tenant",
          scopeValue: "tenant-a",
          requestsPerMinute: 35,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-invalid-scope-value-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeValue: "tenant-missing",
        }),
      }),
    );

    expect(updateResponse.status).toBe(404);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(String(updatePayload.error || "")).toContain("租户不存在");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT 切换为 scopeType=user 且用户不存在时应返回 404 并回传 traceId", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-user-missing-001"),
        body: JSON.stringify({
          name: "Global To User Missing",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-user-missing-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "user",
          scopeValue: "user-not-exists",
        }),
      }),
    );

    expect(updateResponse.status).toBe(404);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(String(updatePayload.error || "")).toContain("用户不存在");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT 切换为 scopeType=user 且用户存在时应成功更新", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-user-valid-001"),
        body: JSON.stringify({
          name: "Global To User Valid",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-user-valid-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "user",
          scopeValue: "quota-user",
        }),
      }),
    );

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.scopeType).toBe("user");
    expect(updatePayload.data.scopeValue).toBe("quota-user");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT 显式传空白 scopeValue 且 scopeType=user 时应返回 400 并回传 traceId", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-user-blank-001"),
        body: JSON.stringify({
          name: "Global To User Blank Scope",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-user-blank-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "user",
          scopeValue: "   ",
        }),
      }),
    );

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.error).toBe("scopeType=user 时必须提供 scopeValue");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT 显式传空白 scopeValue 且 scopeType=role 时应返回 400 并回传 traceId", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-role-blank-001"),
        body: JSON.stringify({
          name: "Global To Role Blank Scope",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-role-blank-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "role",
          scopeValue: "   ",
        }),
      }),
    );

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.error).toBe("scopeType=role 时必须提供 scopeValue");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT scopeType=user 传带空白用户名时应 trim 后命中已存在用户并成功", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-user-trim-001"),
        body: JSON.stringify({
          name: "Global To User Trim",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-user-trim-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "user",
          scopeValue: "  quota-user  ",
        }),
      }),
    );

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.scopeType).toBe("user");
    expect(updatePayload.data.scopeValue).toBe("quota-user");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT scopeType=user 传大写用户名时应归一化为小写并成功", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-user-uppercase-001"),
        body: JSON.stringify({
          name: "User Policy Uppercase Update",
          scopeType: "tenant",
          scopeValue: "tenant-a",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-user-uppercase-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "user",
          scopeValue: "QUOTA-USER",
        }),
      }),
    );

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.scopeType).toBe("user");
    expect(updatePayload.data.scopeValue).toBe("quota-user");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("已是 scopeType=user 的策略仅更新其他字段时不应破坏既有 scopeValue", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-user-keep-scope-001"),
        body: JSON.stringify({
          name: "User Policy Keep Scope",
          scopeType: "user",
          scopeValue: "quota-user",
          requestsPerMinute: 16,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-user-keep-scope-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          requestsPerMinute: 33,
        }),
      }),
    );

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.scopeType).toBe("user");
    expect(updatePayload.data.scopeValue).toBe("quota-user");
    expect(updatePayload.data.requestsPerMinute).toBe(33);
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("PUT 更新不存在策略时应返回 404", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-update-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies/policy-missing", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Missing Policy",
        }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toBe("策略不存在");
    expect(payload.traceId).toBe(traceId);
  });

  it("DELETE 不存在策略时应返回 404 并回传 traceId，且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-delete-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies/policy-missing", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("策略不存在");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("DELETE 成功后应级联清理 usage，并在再次删除时返回 404 + traceId", async () => {
    const app = createAdminApp();
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-delete-success-001"),
        body: JSON.stringify({
          name: "Delete With Usage",
          scopeType: "tenant",
          scopeValue: "tenant-a",
          requestsPerMinute: 22,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);

    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.quota_usage_windows (
          policy_id,
          bucket_type,
          window_start,
          request_count,
          token_count,
          estimated_token_count,
          actual_token_count,
          reconciled_delta,
          created_at,
          updated_at
        )
        VALUES
          ('${escapeSqlLiteral(policyId)}', 'minute', 1700000000000, 3, 30, 30, 30, 0, '${nowIso}', '${nowIso}'),
          ('${escapeSqlLiteral(policyId)}', 'day', 1700006400000, 7, 70, 70, 70, 0, '${nowIso}', '${nowIso}')
      `),
    );

    const deleteTraceId = "trace-policy-delete-success-002";
    const deleteResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "DELETE",
        headers: ownerHeaders(deleteTraceId),
      }),
    );

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.headers.get("x-request-id")).toBe(deleteTraceId);
    const deletePayload = await deleteResponse.json();
    expect(deletePayload.success).toBe(true);
    expect(deletePayload.traceId).toBe(deleteTraceId);
    expect(await countSuccessAuditEventsByTraceId(deleteTraceId)).toBe(1);

    const policyRows = await db.execute(
      sql.raw(`
        SELECT COUNT(*)::int AS count
        FROM enterprise.quota_policies
        WHERE id = '${escapeSqlLiteral(policyId)}'
      `),
    );
    const policyCount = Number(
      ((policyRows as unknown as { rows?: Array<{ count: number | string }> }).rows || [])[0]
        ?.count || 0,
    );
    expect(policyCount).toBe(0);

    const usageRows = await db.execute(
      sql.raw(`
        SELECT COUNT(*)::int AS count
        FROM enterprise.quota_usage_windows
        WHERE policy_id = '${escapeSqlLiteral(policyId)}'
      `),
    );
    const usageCount = Number(
      ((usageRows as unknown as { rows?: Array<{ count: number | string }> }).rows || [])[0]
        ?.count || 0,
    );
    expect(usageCount).toBe(0);

    const missingTraceId = "trace-policy-delete-success-003";
    const secondDeleteResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "DELETE",
        headers: ownerHeaders(missingTraceId),
      }),
    );

    expect(secondDeleteResponse.status).toBe(404);
    expect(secondDeleteResponse.headers.get("x-request-id")).toBe(missingTraceId);
    const missingPayload = await secondDeleteResponse.json();
    expect(missingPayload.error).toBe("策略不存在");
    expect(missingPayload.traceId).toBe(missingTraceId);
    expect(await countSuccessAuditEventsByTraceId(missingTraceId)).toBe(0);
  });

  it("POST 传已存在策略 id 时应返回 409，且不得覆盖既有策略", async () => {
    const app = createAdminApp();

    const firstTraceId = "trace-policy-create-duplicate-id-001";
    const firstResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(firstTraceId),
        body: JSON.stringify({
          id: "policy-duplicate-id",
          name: "Original Policy",
          scopeType: "tenant",
          scopeValue: "tenant-a",
          requestsPerMinute: 22,
        }),
      }),
    );

    expect(firstResponse.status).toBe(200);
    const firstPayload = await firstResponse.json();
    expect(firstPayload.success).toBe(true);
    expect(firstPayload.data.id).toBe("policy-duplicate-id");

    const traceId = "trace-policy-create-duplicate-id-002";
    const secondResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          id: "policy-duplicate-id",
          name: "Overwritten Policy",
          scopeType: "global",
          requestsPerMinute: 99,
        }),
      }),
    );

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.headers.get("x-request-id")).toBe(traceId);
    const payload = await secondResponse.json();
    expect(payload.error).toBe("策略已存在");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);

    const policyRows = await db.execute(
      sql.raw(`
        SELECT name, scope_type, scope_value, requests_per_minute
        FROM enterprise.quota_policies
        WHERE id = 'policy-duplicate-id'
        LIMIT 1
      `),
    );
    const policies =
      (policyRows as unknown as {
        rows?: Array<{
          name: string;
          scope_type: string;
          scope_value: string | null;
          requests_per_minute: number | string | null;
        }>;
      }).rows || [];
    expect(policies.length).toBe(1);
    expect(policies[0]?.name).toBe("Original Policy");
    expect(policies[0]?.scope_type).toBe("tenant");
    expect(policies[0]?.scope_value).toBe("tenant-a");
    expect(Number(policies[0]?.requests_per_minute || 0)).toBe(22);
  });

  it("scopeType=tenant 且租户不存在时应返回 404", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-scope-tenant-001"),
        body: JSON.stringify({
          name: "Tenant Missing",
          scopeType: "tenant",
          scopeValue: "tenant-missing",
          requestsPerMinute: 20,
        }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("租户不存在");
  });

  it("scopeType=role 且角色不存在时应返回 404", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-scope-role-001"),
        body: JSON.stringify({
          name: "Role Missing",
          scopeType: "role",
          scopeValue: "platform-admin",
          requestsPerMinute: 20,
        }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色不存在");
  });

  it("PUT 切换为 scopeType=role 且角色不存在时应返回 404 并回传 traceId", async () => {
    const app = createAdminApp();

    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-role-missing-001"),
        body: JSON.stringify({
          name: "Global To Role Missing",
          scopeType: "global",
          requestsPerMinute: 18,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-role-missing-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "role",
          scopeValue: "platform-admin",
        }),
      }),
    );

    expect(updateResponse.status).toBe(404);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(String(updatePayload.error || "")).toContain("角色不存在");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("scopeType=role 应将 scopeValue 归一化为小写并成功创建", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-scope-role-002"),
        body: JSON.stringify({
          name: "Role Owner",
          scopeType: "role",
          scopeValue: " OWNER ",
          requestsPerMinute: 50,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.scopeType).toBe("role");
    expect(payload.data.scopeValue).toBe("owner");
    expect(typeof payload.traceId).toBe("string");
  });

  it("scopeType=tenant 传带空白 scopeValue 时应 trim 后命中已存在租户并成功创建", async () => {
    const app = createAdminApp();
    const traceId = "trace-policy-scope-tenant-normalize-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Tenant Normalize",
          scopeType: "tenant",
          scopeValue: " tenant-a ",
          requestsPerMinute: 77,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe(traceId);
    expect(payload.data.scopeType).toBe("tenant");
    expect(payload.data.scopeValue).toBe("tenant-a");
  });

  it("PUT 切换为 scopeType=role 时应将 scopeValue 归一化为小写", async () => {
    const app = createAdminApp();

    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-role-normalize-001"),
        body: JSON.stringify({
          name: "Global To Role Normalize",
          scopeType: "global",
          requestsPerMinute: 21,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    const traceId = "trace-policy-update-role-normalize-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          scopeType: "role",
          scopeValue: " OWNER ",
        }),
      }),
    );

    expect(updateResponse.status).toBe(200);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);
    expect(updatePayload.data.scopeType).toBe("role");
    expect(updatePayload.data.scopeValue).toBe("owner");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("tenant scope 策略在 tenant 删除后，执行与 scope 无关的 PUT 更新应返回 404 并回传 traceId", async () => {
    const app = createAdminApp();

    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-tenant-deleted-001"),
        body: JSON.stringify({
          name: "Tenant Scope Deleted Tenant",
          scopeType: "tenant",
          scopeValue: "tenant-a",
          requestsPerMinute: 22,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    await db.execute(sql.raw("DELETE FROM enterprise.tenants WHERE id = 'tenant-a'"));

    const traceId = "trace-policy-update-tenant-deleted-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "Tenant Scope Deleted Tenant Updated",
        }),
      }),
    );

    expect(updateResponse.status).toBe(404);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(String(updatePayload.error || "")).toContain("租户不存在");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("user scope 策略在 user 删除后，执行与 scope 无关的 PUT 更新应返回 404 并回传 traceId", async () => {
    const app = createAdminApp();

    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-user-deleted-001"),
        body: JSON.stringify({
          name: "User Scope Deleted User",
          scopeType: "user",
          scopeValue: "quota-user",
          requestsPerMinute: 16,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    await db.execute(sql.raw("DELETE FROM enterprise.admin_users WHERE username = 'quota-user'"));

    const traceId = "trace-policy-update-user-deleted-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          requestsPerMinute: 26,
        }),
      }),
    );

    expect(updateResponse.status).toBe(404);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(String(updatePayload.error || "")).toContain("用户不存在");
    expect(updatePayload.traceId).toBe(traceId);
  });

  it("role scope 策略在角色删除后，执行与 scope 无关的 PUT 更新应返回 404 并回传 traceId", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('custom-stale-role', '陈旧角色', '["admin.billing.manage"]', 0, '${nowIso}', '${nowIso}')
      `),
    );

    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-update-role-deleted-001"),
        body: JSON.stringify({
          name: "Role Scope Deleted Role",
          scopeType: "role",
          scopeValue: "custom-stale-role",
          requestsPerMinute: 16,
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json();
    const policyId = String(createPayload.data?.id || "");
    expect(policyId.length).toBeGreaterThan(0);

    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles WHERE key = 'custom-stale-role'"));

    const traceId = "trace-policy-update-role-deleted-002";
    const updateResponse = await app.fetch(
      new Request(`http://localhost/api/admin/billing/policies/${policyId}`, {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          requestsPerMinute: 28,
        }),
      }),
    );

    expect(updateResponse.status).toBe(404);
    expect(updateResponse.headers.get("x-request-id")).toBe(traceId);
    const updatePayload = await updateResponse.json();
    expect(String(updatePayload.error || "")).toContain("角色不存在");
    expect(String(updatePayload.error || "")).toContain("custom-stale-role");
    expect(updatePayload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("admin_roles 为空时应回退内置角色进行 scopeType=role 校验", async () => {
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));

    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-scope-role-003"),
        body: JSON.stringify({
          name: "Role Owner Fallback",
          scopeType: "role",
          scopeValue: "owner",
          requestsPerMinute: 15,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.scopeType).toBe("role");
    expect(payload.data.scopeValue).toBe("owner");
  });
});
