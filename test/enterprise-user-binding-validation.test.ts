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
    "x-admin-user": "binding-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

async function ensureEnterpriseUserBindingTables() {
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
    sql.raw("ALTER TABLE enterprise.admin_users ADD COLUMN IF NOT EXISTS display_name text"),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.admin_user_roles (
        id serial PRIMARY KEY,
        user_id text NOT NULL,
        role_key text NOT NULL,
        tenant_id text,
        created_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS admin_user_roles_unique_idx ON enterprise.admin_user_roles (user_id, role_key, tenant_id)",
    ),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.admin_user_tenants (
        id serial PRIMARY KEY,
        user_id text NOT NULL,
        tenant_id text NOT NULL,
        created_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS admin_user_tenants_unique_idx ON enterprise.admin_user_tenants (user_id, tenant_id)",
    ),
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

async function seedUserBindingFixtures() {
  const nowIso = new Date().toISOString();
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_user_tenants"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_user_roles"));
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
        ('owner', '所有者', '["admin.dashboard.read","admin.users.manage","admin.org.manage","admin.rbac.manage","admin.tenants.manage","admin.oauth.manage","admin.billing.manage","admin.audit.read","admin.audit.write"]', 1, '${nowIso}', '${nowIso}'),
        ('operator', '运维员', '["admin.dashboard.read","admin.users.manage"]', 1, '${nowIso}', '${nowIso}')
    `),
  );

  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.admin_users (id, username, password_hash, display_name, status, created_at, updated_at)
      VALUES ('user-1', 'target-user', 'hash-value', 'Target User', 'active', '${nowIso}', '${nowIso}')
    `),
  );

  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
      VALUES ('user-1', 'operator', 'default', '${nowIso}')
    `),
  );

  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
      VALUES ('user-1', 'default', '${nowIso}')
    `),
  );
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;

describe("企业域用户绑定校验矩阵", () => {
  beforeAll(async () => {
    await ensureEnterpriseUserBindingTables();
  });

  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    await seedUserBindingFixtures();
  });

  afterAll(async () => {
    await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_user_tenants"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_user_roles"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_users"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
    await db.execute(sql.raw("DELETE FROM enterprise.tenants"));
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("roleBindings 为空数组应返回 400", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-empty-role-bindings"),
        body: JSON.stringify({
          roleBindings: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("roleBindings 至少需要一个绑定项");
  });

  it("tenantIds 为空数组应返回 400", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-empty-tenant-ids"),
        body: JSON.stringify({
          tenantIds: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("tenantIds 至少需要一个租户");
  });

  it("roleBindings 与 tenantIds 不一致应返回 409", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-tenant-mismatch"),
        body: JSON.stringify({
          roleBindings: [{ roleKey: "owner", tenantId: "tenant-a" }],
          tenantIds: ["default"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色绑定租户不在 tenantIds 中");
  });

  it("roleBindings 存在重复绑定项应返回 409", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-duplicate-binding"),
        body: JSON.stringify({
          roleBindings: [
            { roleKey: "owner", tenantId: "default" },
            { roleKey: " OWNER ", tenantId: " default " },
          ],
          tenantIds: ["default"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("roleBindings 存在重复绑定");
  });

  it("角色资源不存在应返回 404", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-role-missing"),
        body: JSON.stringify({
          roleBindings: [{ roleKey: "platform-admin", tenantId: "default" }],
          tenantIds: ["default"],
        }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色不存在");
  });

  it("租户资源不存在应返回 404", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-tenant-missing"),
        body: JSON.stringify({
          roleBindings: [{ roleKey: "owner", tenantId: "tenant-missing" }],
          tenantIds: ["tenant-missing"],
        }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("租户不存在");
  });

  it("用户资源不存在应返回 404", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-not-exists", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-user-missing"),
        body: JSON.stringify({
          roleBindings: [{ roleKey: "owner", tenantId: "default" }],
          tenantIds: ["default"],
        }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toBe("用户不存在");
  });

  it("成功路径响应结构保持 success + traceId", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders("trace-user-bindings-success"),
        body: JSON.stringify({
          roleBindings: [{ roleKey: "owner", tenantId: "tenant-a" }],
          tenantIds: ["tenant-a"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe("trace-user-bindings-success");
  });
});
