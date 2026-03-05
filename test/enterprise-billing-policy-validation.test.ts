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
}

async function seedPolicyScopeFixtures() {
  const nowIso = new Date().toISOString();
  await db.execute(sql.raw("DELETE FROM enterprise.quota_policies"));
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
    await db.execute(sql.raw("DELETE FROM enterprise.quota_policies"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
    await db.execute(sql.raw("DELETE FROM enterprise.tenants"));
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("scopeType=global 时传 scopeValue 应返回 400", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/billing/policies", {
        method: "POST",
        headers: ownerHeaders("trace-policy-scope-global-001"),
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
