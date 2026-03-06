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
    expect(payload.traceId).toBe("trace-user-bindings-empty-role-bindings");
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
    expect(payload.traceId).toBe("trace-user-bindings-empty-tenant-ids");
  });

  it("roleBindings 缺少 roleKey 时应返回 400，并且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-invalid-role-binding-item";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          roleBindings: [{ tenantId: "default" }],
          tenantIds: ["default"],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
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
    expect(payload.traceId).toBe("trace-user-bindings-tenant-mismatch");
  });

  it("roleBindings 存在重复绑定项应返回 409", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-duplicate-binding";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
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
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("roleBindings 存在重复绑定");
    expect(payload.traceId).toBe(traceId);
  });

  it("roleBindings 与 tenantIds 不一致时应透传响应头 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-tenant-mismatch-header";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          roleBindings: [{ roleKey: "owner", tenantId: "tenant-a" }],
          tenantIds: ["default"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色绑定租户不在 tenantIds 中");
    expect(payload.traceId).toBe(traceId);
  });

  it("roleKey+tenantId 路径与 tenantIds 冲突应返回 409 并回传 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-legacy-path-tenant-mismatch";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          roleKey: "owner",
          tenantId: "tenant-a",
          tenantIds: ["default"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色绑定租户不在 tenantIds 中");
    expect(String(payload.error || "")).toContain("tenant-a");
    expect(payload.traceId).toBe(traceId);
  });

  it("tenantIds 与 roleBindings 中带大小写和空白的 tenantId 应归一化后成功，并保持审计 traceId 一致", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-normalized-tenant-id";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          roleBindings: [{ roleKey: " OWNER ", tenantId: "  TENANT-A  " }],
          tenantIds: [" tenant-a ", " TENANT-A "],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe(traceId);

    const roleBindingRows = await db.execute(
      sql.raw(`
        SELECT role_key, tenant_id
        FROM enterprise.admin_user_roles
        WHERE user_id = 'user-1'
        ORDER BY id ASC
      `),
    );
    const roleBindings =
      (roleBindingRows as unknown as {
        rows?: Array<{ role_key: string; tenant_id: string | null }>;
      }).rows || [];
    expect(roleBindings.length).toBe(1);
    expect(roleBindings[0]?.role_key).toBe("owner");
    expect(roleBindings[0]?.tenant_id).toBe("tenant-a");

    const tenantBindingRows = await db.execute(
      sql.raw(`
        SELECT tenant_id
        FROM enterprise.admin_user_tenants
        WHERE user_id = 'user-1'
        ORDER BY id ASC
      `),
    );
    const tenantBindings =
      (tenantBindingRows as unknown as {
        rows?: Array<{ tenant_id: string }>;
      }).rows || [];
    expect(tenantBindings.length).toBe(1);
    expect(tenantBindings[0]?.tenant_id).toBe("tenant-a");

    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(1);
    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.user.update");
    expect(audit?.resource_id).toBe("user-1");
    expect(audit?.trace_id).toBe(traceId);
  });

  it("仅变更 tenantIds 且未传 roleBindings 时应校验现有角色租户约束", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-tenant-only-mismatch";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          tenantIds: ["tenant-a"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色绑定租户不在 tenantIds 中");
    expect(String(payload.error || "")).toContain("default");
    expect(payload.traceId).toBe(traceId);
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
    expect(payload.traceId).toBe("trace-user-bindings-role-missing");
  });

  it("legacy roleKey/tenantId 路径中的角色不存在时应返回 404，并且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-legacy-role-missing";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          roleKey: "platform-admin",
          tenantId: "default",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色不存在");
    expect(String(payload.error || "")).toContain("platform-admin");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
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
    expect(payload.traceId).toBe("trace-user-bindings-tenant-missing");
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
    expect(payload.traceId).toBe("trace-user-bindings-user-missing");
  });

  it("已有自定义角色绑定在角色删除后，执行与绑定无关的 PUT 应返回 404 并且不写成功审计", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();

    await db.execute(sql.raw("DELETE FROM enterprise.admin_user_roles WHERE user_id = 'user-1'"));
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('custom-stale', '陈旧角色', '["admin.users.manage"]', 0, '${nowIso}', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES ('user-1', 'custom-stale', 'default', '${nowIso}')
      `),
    );
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles WHERE key = 'custom-stale'"));

    const traceId = "trace-user-bindings-stale-role-after-delete";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          displayName: "Role Deleted",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("角色不存在");
    expect(String(payload.error || "")).toContain("custom-stale");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("已有租户绑定在租户删除后，执行与绑定无关的 PUT 应返回 404 并且不写成功审计", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();

    await db.execute(sql.raw("DELETE FROM enterprise.admin_user_roles WHERE user_id = 'user-1'"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_user_tenants WHERE user_id = 'user-1'"));
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES ('user-1', 'operator', 'tenant-a', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
        VALUES ('user-1', 'tenant-a', '${nowIso}')
      `),
    );
    await db.execute(sql.raw("DELETE FROM enterprise.tenants WHERE id = 'tenant-a'"));

    const traceId = "trace-user-bindings-stale-tenant-after-delete";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          displayName: "Tenant Deleted",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("租户不存在");
    expect(String(payload.error || "")).toContain("tenant-a");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("角色绑定记录被删除后，仅更新非绑定字段应返回 400 并且不写成功审计", async () => {
    const app = createAdminApp();
    await db.execute(sql.raw("DELETE FROM enterprise.admin_user_roles WHERE user_id = 'user-1'"));

    const traceId = "trace-user-bindings-role-bindings-deleted";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          displayName: "No Bindings Left",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("用户至少需要一个角色绑定");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("租户绑定记录被删除后，仅更新非绑定字段应返回 400 并且不写成功审计", async () => {
    const app = createAdminApp();
    await db.execute(sql.raw("DELETE FROM enterprise.admin_user_tenants WHERE user_id = 'user-1'"));

    const traceId = "trace-user-bindings-tenant-bindings-deleted";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          displayName: "No Tenant Bindings Left",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("用户至少需要一个租户绑定");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("存在额外失效 tenant 绑定时，仅更新非绑定字段应返回 404 并且不写成功审计", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
        VALUES ('user-1', 'tenant-a', '${nowIso}')
        ON CONFLICT DO NOTHING
      `),
    );
    await db.execute(sql.raw("DELETE FROM enterprise.tenants WHERE id = 'tenant-a'"));

    const traceId = "trace-user-bindings-stale-extra-tenant-binding";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          displayName: "Stale Extra Tenant Binding",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("租户不存在");
    expect(String(payload.error || "")).toContain("tenant-a");
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
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

  it("tenantIds 带空白与重复值时应归一化去重后成功保存", async () => {
    const app = createAdminApp();
    const traceId = "trace-user-bindings-tenant-normalize-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          roleBindings: [{ roleKey: "owner", tenantId: " tenant-a " }],
          tenantIds: [" tenant-a ", "tenant-a", "default", " default "],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe(traceId);
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(1);

    const tenantRows = await db.execute(
      sql.raw(
        "SELECT tenant_id FROM enterprise.admin_user_tenants WHERE user_id = 'user-1' ORDER BY tenant_id ASC",
      ),
    );
    const tenants =
      (tenantRows as unknown as { rows?: Array<{ tenant_id: string }> }).rows || [];
    expect(tenants.map((item) => item.tenant_id)).toEqual(["default", "tenant-a"]);
  });
});
