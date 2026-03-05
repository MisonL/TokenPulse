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
    "x-admin-user": "regression-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as unknown as {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = response.headers.get("set-cookie");
  return raw ? [raw] : [];
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function expectJsonErrorTraceId(response: Response) {
  const requestId = response.headers.get("x-request-id") || "";
  expect(requestId).toBeTruthy();

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  expect(contentType).toContain("application/json");

  const payload = await response.json();
  expect(payload.traceId).toBe(requestId);
  return payload as Record<string, unknown>;
}

async function ensureEnterpriseAdminTables() {
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
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_unique_idx ON enterprise.admin_users (username)",
    ),
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
      CREATE TABLE IF NOT EXISTS enterprise.admin_sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        role_key text NOT NULL,
        tenant_id text,
        ip text,
        user_agent text,
        created_at bigint NOT NULL,
        expires_at bigint NOT NULL,
        last_seen_at bigint NOT NULL
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

async function seedEnterpriseAdminFixtures() {
  const nowIso = new Date().toISOString();
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_sessions"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_user_tenants"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_user_roles"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_users"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
  await db.execute(sql.raw("DELETE FROM enterprise.tenants"));
  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
      VALUES ('default', '默认租户', 'active', '${nowIso}', '${nowIso}')
    `),
  );
}

async function insertAdminUser(input: {
  id: string;
  username: string;
  password: string;
  status?: "active" | "disabled";
}) {
  const nowIso = new Date().toISOString();
  const passwordHash = await Bun.password.hash(input.password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 2,
  });

  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.admin_users (id, username, password_hash, display_name, status, created_at, updated_at)
      VALUES (
        '${escapeSqlLiteral(input.id)}',
        '${escapeSqlLiteral(input.username.trim().toLowerCase())}',
        '${escapeSqlLiteral(passwordHash)}',
        '回归测试用户',
        '${escapeSqlLiteral(input.status || "active")}',
        '${nowIso}',
        '${nowIso}'
      )
    `),
  );
}

describe("企业域管理员认证与 RBAC 回归", () => {
  beforeAll(async () => {
    await ensureEnterpriseAdminTables();
  });

  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    config.admin.authMode = "hybrid";
    await seedEnterpriseAdminFixtures();
  });

  afterAll(() => {
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
    config.admin.authMode = originalAuthMode;
  });

  it("login 成功应 set-cookie 且写入审计事件", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-login-success-001";
    const userId = "user-login-success-001";
    const username = "login_success";
    const password = "CorrectPass123";

    await insertAdminUser({ id: userId, username, password });

    const response = await app.fetch(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": traceId,
        },
        body: JSON.stringify({ username, password }),
      }),
    );

    expect(response.status).toBe(200);

    const cookies = getSetCookieHeaders(response);
    expect(cookies.length).toBeGreaterThan(0);
    const sessionCookie = cookies.find((value) =>
      value.includes(`${config.admin.sessionCookieName}=`),
    );
    expect(sessionCookie).toBeTruthy();
    expect((sessionCookie || "").toLowerCase()).toContain("httponly");
    expect(sessionCookie).toContain("SameSite=Lax");

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data?.user?.username).toBe(username);

    const sessionId = (() => {
      const raw = sessionCookie || "";
      const firstPart = raw.split(";")[0] || "";
      const [, value = ""] = firstPart.split("=");
      return value;
    })();
    expect(sessionId).toBeTruthy();

    const sessionRows = await db.execute(
      sql.raw(
        `SELECT id, user_id, role_key, tenant_id FROM enterprise.admin_sessions WHERE id = '${escapeSqlLiteral(sessionId)}' LIMIT 1`,
      ),
    );
    const sessions =
      (sessionRows as unknown as {
        rows?: Array<{
          id: string;
          user_id: string;
          role_key: string;
          tenant_id?: string | null;
        }>;
      }).rows || [];
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.user_id).toBe(userId);

    const auditRows = await db.execute(
      sql.raw(
        "SELECT actor, action, resource, resource_id, result, details, trace_id FROM enterprise.audit_events WHERE action = 'admin.auth.login' ORDER BY id DESC LIMIT 1",
      ),
    );
    const audits =
      (auditRows as unknown as {
        rows?: Array<{
          actor: string;
          action: string;
          resource: string;
          resource_id?: string | null;
          result: string;
          details?: string | null;
          trace_id?: string | null;
        }>;
      }).rows || [];
    expect(audits.length).toBe(1);

    const audit = audits[0]!;
    expect(audit.actor).toBe(username);
    expect(audit.action).toBe("admin.auth.login");
    expect(audit.resource).toBe("admin.session");
    expect(audit.result).toBe("success");
    expect(audit.resource_id).toBe(sessionId);
    expect(audit.trace_id).toBe(traceId);

    const details = (() => {
      try {
        return JSON.parse(audit.details || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    expect(details.roleKey).toBeTruthy();
    expect(details.tenantId).toBeTruthy();
  });

  it("login 失败（错误密码）应返回 400 + application/json，并对齐 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-login-failed-001";
    const username = "login_failed";
    const password = "CorrectPass123";

    await insertAdminUser({
      id: "user-login-failed-001",
      username,
      password,
    });

    const response = await app.fetch(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": traceId,
        },
        body: JSON.stringify({ username, password: "WrongPass123" }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("用户名或密码错误");
  });

  it("me 未登录应返回 authenticated=false", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/auth/me", { method: "GET" }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.authenticated).toBe(false);
  });

  it("logout 成功应返回 success=true", async () => {
    const app = createAdminApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/auth/logout", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
  });

  it("删除内置角色（owner/auditor/operator）应返回 400，并对齐 traceId", async () => {
    const app = createAdminApp();
    const builtins = ["owner", "auditor", "operator"] as const;

    for (const key of builtins) {
      const traceId = `trace-role-delete-builtin-${key}`;
      const response = await app.fetch(
        new Request(`http://localhost/api/admin/rbac/roles/${key}`, {
          method: "DELETE",
          headers: ownerHeaders(traceId),
        }),
      );

      expect(response.status).toBe(400);
      const payload = await expectJsonErrorTraceId(response);
      expect(payload.error).toBe("内置角色不允许删除");
    }
  });

  it("普通角色可删（删除后 admin_roles/admin_user_roles 均应清理）", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('custom', '自定义角色', '[]', 0, '${nowIso}', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES ('user-custom-001', 'custom', 'default', '${nowIso}')
      `),
    );

    const traceId = "trace-role-delete-custom-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles/custom", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);

    const roleRows = await db.execute(
      sql.raw("SELECT key FROM enterprise.admin_roles WHERE key = 'custom'"),
    );
    const roles =
      (roleRows as unknown as { rows?: Array<{ key: string }> }).rows || [];
    expect(roles.length).toBe(0);

    const bindingRows = await db.execute(
      sql.raw(
        "SELECT role_key FROM enterprise.admin_user_roles WHERE role_key = 'custom'",
      ),
    );
    const bindings =
      (bindingRows as unknown as { rows?: Array<{ role_key: string }> }).rows ||
      [];
    expect(bindings.length).toBe(0);
  });

  it("删除 default 租户应返回 400，并对齐 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-tenant-delete-default-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/tenants/default", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("默认租户不可删除");
  });

  it("创建 adminUsers 用户名重复应返回 409，并对齐 traceId", async () => {
    const app = createAdminApp();

    const firstTraceId = "trace-admin-users-create-dup-001";
    const firstResponse = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: ownerHeaders(firstTraceId),
        body: JSON.stringify({
          username: "dup_user",
          password: "StrongPass123",
          roleKey: "operator",
          tenantId: "default",
        }),
      }),
    );

    expect(firstResponse.status).toBe(200);
    const firstPayload = await firstResponse.json();
    expect(firstPayload.success).toBe(true);
    expect(firstPayload.traceId).toBe(firstTraceId);

    const secondTraceId = "trace-admin-users-create-dup-002";
    const secondResponse = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: ownerHeaders(secondTraceId),
        body: JSON.stringify({
          username: "dup_user",
          password: "StrongPass456",
          roleKey: "operator",
          tenantId: "default",
        }),
      }),
    );

    expect(secondResponse.status).toBe(409);
    const payload = await expectJsonErrorTraceId(secondResponse);
    expect(payload.error).toBe("用户名已存在");
  });
});

