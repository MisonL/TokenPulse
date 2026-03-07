import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { requestContextMiddleware } from "../src/middleware/request-context";
import auth from "../src/routes/auth";
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

function createAuthProbeApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.route("/api/auth", auth);
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

function extractSessionIdFromSetCookie(headers: string[]): string {
  const sessionCookie = headers.find((value) =>
    value.includes(`${config.admin.sessionCookieName}=`),
  );
  if (!sessionCookie) return "";
  const firstPart = sessionCookie.split(";")[0] || "";
  const [, value = ""] = firstPart.split("=");
  return value;
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
      SELECT action, resource, resource_id, result, details, trace_id
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
        details?: string | null;
        trace_id?: string | null;
      }>;
    }).rows || [];
  return rows[0] || null;
}

function parseAuditDetails(details?: string | null) {
  if (!details) return {};
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return {};
  }
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

  it("login 传大小写混合 tenantId 时应命中归一化后的租户绑定", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-login-tenant-normalized-001";
    const userId = "user-login-tenant-normalized-001";
    const username = "login_tenant_normalized";
    const password = "CorrectPass123";
    const nowIso = new Date().toISOString();

    await insertAdminUser({ id: userId, username, password });
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
        VALUES ('tenant-a', '租户 A', 'active', '${nowIso}', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES
          ('${escapeSqlLiteral(userId)}', 'owner', 'default', '${nowIso}'),
          ('${escapeSqlLiteral(userId)}', 'auditor', 'tenant-a', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
        VALUES
          ('${escapeSqlLiteral(userId)}', 'default', '${nowIso}'),
          ('${escapeSqlLiteral(userId)}', 'tenant-a', '${nowIso}')
      `),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": traceId,
        },
        body: JSON.stringify({
          username,
          password,
          tenantId: "  TENANT-A  ",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data?.roleKey).toBe("auditor");
    expect(payload.data?.tenantId).toBe("tenant-a");

    const sessionId = extractSessionIdFromSetCookie(getSetCookieHeaders(response));
    expect(sessionId).toBeTruthy();

    const sessionRows = await db.execute(
      sql.raw(`
        SELECT role_key, tenant_id
        FROM enterprise.admin_sessions
        WHERE id = '${escapeSqlLiteral(sessionId)}'
        LIMIT 1
      `),
    );
    const sessions =
      (sessionRows as unknown as {
        rows?: Array<{
          role_key: string;
          tenant_id?: string | null;
        }>;
      }).rows || [];
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.role_key).toBe("auditor");
    expect(sessions[0]?.tenant_id).toBe("tenant-a");

    const audit = await readLatestAuditEventByTraceId(traceId);
    const details = parseAuditDetails(audit?.details);
    expect(details.roleKey).toBe("auditor");
    expect(details.tenantId).toBe("tenant-a");
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

  it("GET /api/auth/verify-secret 携带正确 Bearer API_SECRET 应返回 200", async () => {
    const app = createAuthProbeApp();
    const response = await app.fetch(
      new Request("http://localhost/api/auth/verify-secret", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiSecret}`,
          "x-request-id": "trace-auth-verify-secret-success-001",
        },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ success: true });
  });

  it("GET /api/auth/verify-secret 未携带或携带错误 API_SECRET 应返回 401 JSON，并对齐 traceId", async () => {
    const app = createAuthProbeApp();
    const traceId = "trace-auth-verify-secret-failed-001";
    const response = await app.fetch(
      new Request("http://localhost/api/auth/verify-secret", {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-secret",
          "x-request-id": traceId,
        },
      }),
    );

    expect(response.status).toBe(401);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("未授权：缺少认证信息或认证无效");
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
      expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
    }
  });

  it("PUT /api/admin/rbac/roles/:key 目标不存在应返回 404，并保持 traceId 对齐且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-role-put-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles/missing-role-001", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "缺失角色",
          permissions: ["admin.rbac.manage"],
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("角色不存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("DELETE /api/admin/rbac/roles/:key 目标不存在应返回 404，并保持 traceId 对齐且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-role-delete-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles/missing-role-002", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("角色不存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("普通角色可删（删除后 admin_roles/admin_user_roles/admin_sessions 均应清理，并记录 revokedSessionCount）", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
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
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_sessions (id, user_id, role_key, tenant_id, ip, user_agent, created_at, expires_at, last_seen_at)
        VALUES
          ('session-role-custom-001', 'user-custom-001', 'custom', 'default', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs}),
          ('session-role-custom-002', 'user-custom-002', 'custom', 'default', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs}),
          ('session-role-owner-001', 'user-owner-001', 'owner', 'default', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs})
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

    const deletedSessionRows = await db.execute(
      sql.raw(
        "SELECT id FROM enterprise.admin_sessions WHERE role_key = 'custom' ORDER BY id ASC",
      ),
    );
    const deletedSessions =
      (deletedSessionRows as unknown as { rows?: Array<{ id: string }> }).rows ||
      [];
    expect(deletedSessions.length).toBe(0);

    const remainingSessionRows = await db.execute(
      sql.raw(
        "SELECT id FROM enterprise.admin_sessions WHERE id = 'session-role-owner-001' LIMIT 1",
      ),
    );
    const remainingSessions =
      (remainingSessionRows as unknown as { rows?: Array<{ id: string }> }).rows ||
      [];
    expect(remainingSessions.length).toBe(1);

    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(1);
    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.role.delete");
    expect(audit?.resource).toBe("admin.role");
    expect(audit?.resource_id).toBe("custom");
    const details = parseAuditDetails(audit?.details);
    expect(details.revokedSessionCount).toBe(2);
  });

  it("普通角色删除后再次删除应返回 404，并保持 traceId 对齐且不写成功审计", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('custom-redelete', '重复删除角色', '[]', 0, '${nowIso}', '${nowIso}')
      `),
    );

    const firstResponse = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles/custom-redelete", {
        method: "DELETE",
        headers: ownerHeaders("trace-role-delete-custom-redelete-001"),
      }),
    );
    expect(firstResponse.status).toBe(200);

    const traceId = "trace-role-delete-custom-redelete-002";
    const secondResponse = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles/custom-redelete", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(secondResponse.status).toBe(404);
    expect(secondResponse.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(secondResponse);
    expect(payload.error).toBe("角色不存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
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

  it("PUT /api/admin/tenants/:id 目标不存在应返回 404，并保持 traceId 对齐且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-tenant-put-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/tenants/missing-tenant-001", {
        method: "PUT",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          name: "缺失租户",
          status: "disabled",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("租户不存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("DELETE /api/admin/tenants/:id 目标不存在应返回 404，并保持 traceId 对齐且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-tenant-delete-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/tenants/missing-tenant-002", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("租户不存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("POST /api/admin/tenants 使用危险保留 ID default 应返回 409，且不得覆盖默认租户", async () => {
    const app = createAdminApp();
    const traceId = "trace-tenant-create-default-reserved-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          id: " Default ",
          name: "试图覆盖默认租户",
          status: "disabled",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("租户已存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);

    const tenantRows = await db.execute(
      sql.raw(
        "SELECT id, name, status FROM enterprise.tenants WHERE id = 'default' LIMIT 1",
      ),
    );
    const tenants =
      (tenantRows as unknown as {
        rows?: Array<{
          id: string;
          name: string;
          status: string;
        }>;
      }).rows || [];
    expect(tenants.length).toBe(1);
    expect(tenants[0]?.id).toBe("default");
    expect(tenants[0]?.name).toBe("默认租户");
    expect(tenants[0]?.status).toBe("active");
  });

  it("POST /api/admin/tenants 重复创建同 ID 租户应返回 409，且不得覆盖既有数据", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
        VALUES ('tenant-dup', '原始租户', 'active', '${nowIso}', '${nowIso}')
      `),
    );

    const traceId = "trace-tenant-create-duplicate-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          id: "tenant-dup",
          name: "重复写入租户",
          status: "disabled",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("租户已存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);

    const tenantRows = await db.execute(
      sql.raw(
        "SELECT name, status FROM enterprise.tenants WHERE id = 'tenant-dup' LIMIT 1",
      ),
    );
    const tenants =
      (tenantRows as unknown as {
        rows?: Array<{
          name: string;
          status: string;
        }>;
      }).rows || [];
    expect(tenants.length).toBe(1);
    expect(tenants[0]?.name).toBe("原始租户");
    expect(tenants[0]?.status).toBe("active");
  });

  it("租户创建、更新与删除成功应写入审计事件", async () => {
    const app = createAdminApp();

    const createTraceId = "trace-tenant-create-success-audit-001";
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        headers: ownerHeaders(createTraceId),
        body: JSON.stringify({
          id: "tenant-audit",
          name: "审计租户",
          status: "active",
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    expect(await countSuccessAuditEventsByTraceId(createTraceId)).toBe(1);
    const createAudit = await readLatestAuditEventByTraceId(createTraceId);
    expect(createAudit?.action).toBe("admin.tenant.create");
    expect(createAudit?.resource).toBe("tenant");
    expect(createAudit?.resource_id).toBe("tenant-audit");

    const updateTraceId = "trace-tenant-update-success-audit-001";
    const updateResponse = await app.fetch(
      new Request("http://localhost/api/admin/tenants/tenant-audit", {
        method: "PUT",
        headers: ownerHeaders(updateTraceId),
        body: JSON.stringify({
          name: "审计租户已更新",
          status: "disabled",
        }),
      }),
    );
    expect(updateResponse.status).toBe(200);
    expect(await countSuccessAuditEventsByTraceId(updateTraceId)).toBe(1);
    const updateAudit = await readLatestAuditEventByTraceId(updateTraceId);
    expect(updateAudit?.action).toBe("admin.tenant.update");
    expect(updateAudit?.resource).toBe("tenant");
    expect(updateAudit?.resource_id).toBe("tenant-audit");

    const deleteTraceId = "trace-tenant-delete-success-audit-001";
    const deleteResponse = await app.fetch(
      new Request("http://localhost/api/admin/tenants/tenant-audit", {
        method: "DELETE",
        headers: ownerHeaders(deleteTraceId),
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(await countSuccessAuditEventsByTraceId(deleteTraceId)).toBe(1);
    const deleteAudit = await readLatestAuditEventByTraceId(deleteTraceId);
    expect(deleteAudit?.action).toBe("admin.tenant.delete");
    expect(deleteAudit?.resource).toBe("tenant");
    expect(deleteAudit?.resource_id).toBe("tenant-audit");
  });

  it("删除租户应记录 revokedSessionCount，并仅清理目标 tenant 的 sessions", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
        VALUES ('tenant-session-audit', '审计会话租户', 'active', '${nowIso}', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_sessions (id, user_id, role_key, tenant_id, ip, user_agent, created_at, expires_at, last_seen_at)
        VALUES
          ('session-tenant-audit-001', 'user-tenant-001', 'operator', 'tenant-session-audit', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs}),
          ('session-tenant-audit-002', 'user-tenant-002', 'auditor', 'tenant-session-audit', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs}),
          ('session-tenant-default-001', 'user-default-001', 'owner', 'default', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs})
      `),
    );

    const traceId = "trace-tenant-delete-session-audit-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/tenants/tenant-session-audit", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(200);

    const deletedSessionRows = await db.execute(
      sql.raw(
        "SELECT id FROM enterprise.admin_sessions WHERE tenant_id = 'tenant-session-audit' ORDER BY id ASC",
      ),
    );
    const deletedSessions =
      (deletedSessionRows as unknown as { rows?: Array<{ id: string }> }).rows ||
      [];
    expect(deletedSessions.length).toBe(0);

    const remainingSessionRows = await db.execute(
      sql.raw(
        "SELECT id FROM enterprise.admin_sessions WHERE id = 'session-tenant-default-001' LIMIT 1",
      ),
    );
    const remainingSessions =
      (remainingSessionRows as unknown as { rows?: Array<{ id: string }> }).rows ||
      [];
    expect(remainingSessions.length).toBe(1);

    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.tenant.delete");
    expect(audit?.resource_id).toBe("tenant-session-audit");
    const details = parseAuditDetails(audit?.details);
    expect(details.revokedSessionCount).toBe(2);
  });

  it("删除租户时应清理 admin_user_roles/admin_user_tenants 的目标租户绑定，并保持审计 traceId 一致", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
        VALUES ('tenant-binding-cleanup', '绑定清理租户', 'active', '${nowIso}', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES
          ('user-binding-cleanup-target', 'operator', 'tenant-binding-cleanup', '${nowIso}'),
          ('user-binding-cleanup-keep', 'operator', 'default', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
        VALUES
          ('user-binding-cleanup-target', 'tenant-binding-cleanup', '${nowIso}'),
          ('user-binding-cleanup-keep', 'default', '${nowIso}')
      `),
    );

    const traceId = "trace-tenant-delete-binding-cleanup-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/tenants/tenant-binding-cleanup", {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);

    const deletedRoleBindingRows = await db.execute(
      sql.raw(
        "SELECT tenant_id FROM enterprise.admin_user_roles WHERE tenant_id = 'tenant-binding-cleanup'",
      ),
    );
    const deletedRoleBindings =
      (deletedRoleBindingRows as unknown as { rows?: Array<{ tenant_id: string }> }).rows || [];
    expect(deletedRoleBindings.length).toBe(0);

    const deletedTenantBindingRows = await db.execute(
      sql.raw(
        "SELECT tenant_id FROM enterprise.admin_user_tenants WHERE tenant_id = 'tenant-binding-cleanup'",
      ),
    );
    const deletedTenantBindings =
      (deletedTenantBindingRows as unknown as { rows?: Array<{ tenant_id: string }> }).rows || [];
    expect(deletedTenantBindings.length).toBe(0);

    const remainingRoleBindingRows = await db.execute(
      sql.raw(
        "SELECT tenant_id FROM enterprise.admin_user_roles WHERE user_id = 'user-binding-cleanup-keep' LIMIT 1",
      ),
    );
    const remainingRoleBindings =
      (remainingRoleBindingRows as unknown as { rows?: Array<{ tenant_id: string }> }).rows || [];
    expect(remainingRoleBindings.length).toBe(1);
    expect(remainingRoleBindings[0]?.tenant_id).toBe("default");

    const remainingTenantBindingRows = await db.execute(
      sql.raw(
        "SELECT tenant_id FROM enterprise.admin_user_tenants WHERE user_id = 'user-binding-cleanup-keep' LIMIT 1",
      ),
    );
    const remainingTenantBindings =
      (remainingTenantBindingRows as unknown as { rows?: Array<{ tenant_id: string }> }).rows || [];
    expect(remainingTenantBindings.length).toBe(1);
    expect(remainingTenantBindings[0]?.tenant_id).toBe("default");

    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.tenant.delete");
    expect(audit?.resource_id).toBe("tenant-binding-cleanup");
    expect(audit?.trace_id).toBe(traceId);
  });

  it("创建 adminUsers 时 roleKey 不存在应返回 404，并保持 traceId 对齐且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-users-create-role-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          username: "missing_role_user",
          password: "StrongPass123",
          roleKey: "platform-admin",
          tenantId: "default",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("角色不存在: platform-admin");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("创建 adminUsers 时 tenantId 不存在应返回 404，并保持 traceId 对齐且不写成功审计", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-users-create-tenant-missing-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          username: "missing_tenant_user",
          password: "StrongPass123",
          roleKey: "operator",
          tenantId: "tenant-missing",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("租户不存在: tenant-missing");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);
  });

  it("创建 adminUsers 时 tenantId 带大小写与空白应归一化为小写并写入一致审计", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
        VALUES ('tenant-a', '租户 A', 'active', '${nowIso}', '${nowIso}')
      `),
    );

    const traceId = "trace-admin-users-create-tenant-normalized-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          username: "tenant_normalized_user",
          password: "StrongPass123",
          roleKey: "operator",
          tenantId: "  TENANT-A  ",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe(traceId);

    const userId = String(payload.id || "");
    expect(userId).toBeTruthy();

    const roleBindingRows = await db.execute(
      sql.raw(`
        SELECT role_key, tenant_id
        FROM enterprise.admin_user_roles
        WHERE user_id = '${escapeSqlLiteral(userId)}'
        ORDER BY id ASC
      `),
    );
    const roleBindings =
      (roleBindingRows as unknown as {
        rows?: Array<{ role_key: string; tenant_id: string | null }>;
      }).rows || [];
    expect(roleBindings.length).toBe(1);
    expect(roleBindings[0]?.role_key).toBe("operator");
    expect(roleBindings[0]?.tenant_id).toBe("tenant-a");

    const tenantBindingRows = await db.execute(
      sql.raw(`
        SELECT tenant_id
        FROM enterprise.admin_user_tenants
        WHERE user_id = '${escapeSqlLiteral(userId)}'
        ORDER BY id ASC
      `),
    );
    const tenantBindings =
      (tenantBindingRows as unknown as {
        rows?: Array<{ tenant_id: string }>;
      }).rows || [];
    expect(tenantBindings.length).toBe(1);
    expect(tenantBindings[0]?.tenant_id).toBe("tenant-a");

    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.user.create");
    expect(audit?.resource_id).toBe(userId);
    expect(audit?.trace_id).toBe(traceId);
  });

  it("POST /api/admin/rbac/roles 重复创建同 key 角色应返回 409，且不覆盖既有角色", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('custom-dup', '原始角色', '["admin.dashboard.read"]', 0, '${nowIso}', '${nowIso}')
      `),
    );

    const traceId = "trace-role-create-duplicate-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          key: "custom-dup",
          name: "重复写入角色",
          permissions: ["admin.rbac.manage"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("角色已存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);

    const roleRows = await db.execute(
      sql.raw(
        "SELECT name, permissions FROM enterprise.admin_roles WHERE key = 'custom-dup' LIMIT 1",
      ),
    );
    const roles =
      (roleRows as unknown as {
        rows?: Array<{
          name: string;
          permissions: string;
        }>;
      }).rows || [];
    expect(roles.length).toBe(1);
    expect(roles[0]?.name).toBe("原始角色");
    expect(roles[0]?.permissions).toBe('["admin.dashboard.read"]');
  });

  it("POST /api/admin/rbac/roles 在 trim + lowercase 后重复创建同 key 角色也应返回 409，且不覆盖既有角色", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('custom-case-dup', '大小写原始角色', '["admin.dashboard.read"]', 0, '${nowIso}', '${nowIso}')
      `),
    );

    const traceId = "trace-role-create-duplicate-normalized-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles", {
        method: "POST",
        headers: ownerHeaders(traceId),
        body: JSON.stringify({
          key: "  CUSTOM-CASE-DUP  ",
          name: "大小写重复写入角色",
          permissions: ["admin.rbac.manage"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("角色已存在");
    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(0);

    const roleRows = await db.execute(
      sql.raw(
        "SELECT name, permissions FROM enterprise.admin_roles WHERE key = 'custom-case-dup' LIMIT 1",
      ),
    );
    const roles =
      (roleRows as unknown as {
        rows?: Array<{
          name: string;
          permissions: string;
        }>;
      }).rows || [];
    expect(roles.length).toBe(1);
    expect(roles[0]?.name).toBe("大小写原始角色");
    expect(roles[0]?.permissions).toBe('["admin.dashboard.read"]');
  });

  it("角色创建与更新成功应写入审计事件", async () => {
    const app = createAdminApp();

    const createTraceId = "trace-role-create-success-audit-001";
    const createResponse = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles", {
        method: "POST",
        headers: ownerHeaders(createTraceId),
        body: JSON.stringify({
          key: "audit-role",
          name: "审计角色",
          permissions: ["admin.dashboard.read", "admin.audit.read"],
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    expect(await countSuccessAuditEventsByTraceId(createTraceId)).toBe(1);
    const createAudit = await readLatestAuditEventByTraceId(createTraceId);
    expect(createAudit?.action).toBe("admin.role.create");
    expect(createAudit?.resource).toBe("admin.role");
    expect(createAudit?.resource_id).toBe("audit-role");

    const updateTraceId = "trace-role-update-success-audit-001";
    const updateResponse = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles/audit-role", {
        method: "PUT",
        headers: ownerHeaders(updateTraceId),
        body: JSON.stringify({
          name: "审计角色已更新",
          permissions: ["admin.dashboard.read"],
        }),
      }),
    );
    expect(updateResponse.status).toBe(200);
    expect(await countSuccessAuditEventsByTraceId(updateTraceId)).toBe(1);
    const updateAudit = await readLatestAuditEventByTraceId(updateTraceId);
    expect(updateAudit?.action).toBe("admin.role.update");
    expect(updateAudit?.resource).toBe("admin.role");
    expect(updateAudit?.resource_id).toBe("audit-role");
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

  it("创建 adminUsers 用户名在 trim + lowercase 后重复时也应返回 409，且不写成功审计", async () => {
    const app = createAdminApp();

    const firstTraceId = "trace-admin-users-create-dup-normalized-001";
    const firstResponse = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: ownerHeaders(firstTraceId),
        body: JSON.stringify({
          username: "dup_user_normalized",
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

    const secondTraceId = "trace-admin-users-create-dup-normalized-002";
    const secondResponse = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: ownerHeaders(secondTraceId),
        body: JSON.stringify({
          username: "  DUP_USER_NORMALIZED  ",
          password: "StrongPass456",
          roleKey: "operator",
          tenantId: "default",
        }),
      }),
    );

    expect(secondResponse.status).toBe(409);
    const payload = await expectJsonErrorTraceId(secondResponse);
    expect(payload.error).toBe("用户名已存在");
    expect(await countSuccessAuditEventsByTraceId(secondTraceId)).toBe(0);
  });

  it("DELETE /api/admin/users/:id 成功时应级联清理目标用户的会话与绑定，并写入审计", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const targetUserId = "user-delete-target-001";
    const keepUserId = "user-delete-keep-001";
    const targetUsername = "delete_target";

    await insertAdminUser({
      id: targetUserId,
      username: targetUsername,
      password: "StrongPass123",
    });
    await insertAdminUser({
      id: keepUserId,
      username: "delete_keep",
      password: "StrongPass456",
    });
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
        VALUES ('tenant-user-delete', '用户删除租户', 'active', '${nowIso}', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES
          ('${targetUserId}', 'operator', 'default', '${nowIso}'),
          ('${targetUserId}', 'auditor', 'tenant-user-delete', '${nowIso}'),
          ('${keepUserId}', 'owner', 'default', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
        VALUES
          ('${targetUserId}', 'default', '${nowIso}'),
          ('${targetUserId}', 'tenant-user-delete', '${nowIso}'),
          ('${keepUserId}', 'default', '${nowIso}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_sessions (id, user_id, role_key, tenant_id, ip, user_agent, created_at, expires_at, last_seen_at)
        VALUES
          ('session-user-delete-target-001', '${targetUserId}', 'operator', 'default', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs}),
          ('session-user-delete-target-002', '${targetUserId}', 'auditor', 'tenant-user-delete', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs}),
          ('session-user-delete-keep-001', '${keepUserId}', 'owner', 'default', '127.0.0.1', 'bun-test', ${nowMs}, ${nowMs + 3600_000}, ${nowMs})
      `),
    );

    const traceId = "trace-admin-users-delete-success-001";
    const response = await app.fetch(
      new Request(`http://localhost/api/admin/users/${targetUserId}`, {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe(traceId);

    const deletedUserRows = await db.execute(
      sql.raw(
        `SELECT id FROM enterprise.admin_users WHERE id = '${escapeSqlLiteral(targetUserId)}' LIMIT 1`,
      ),
    );
    const deletedUsers =
      (deletedUserRows as unknown as { rows?: Array<{ id: string }> }).rows || [];
    expect(deletedUsers.length).toBe(0);

    const deletedRoleBindingRows = await db.execute(
      sql.raw(`
        SELECT user_id
        FROM enterprise.admin_user_roles
        WHERE user_id = '${escapeSqlLiteral(targetUserId)}'
        ORDER BY id ASC
      `),
    );
    const deletedRoleBindings =
      (deletedRoleBindingRows as unknown as { rows?: Array<{ user_id: string }> }).rows || [];
    expect(deletedRoleBindings.length).toBe(0);

    const deletedTenantBindingRows = await db.execute(
      sql.raw(`
        SELECT user_id
        FROM enterprise.admin_user_tenants
        WHERE user_id = '${escapeSqlLiteral(targetUserId)}'
        ORDER BY id ASC
      `),
    );
    const deletedTenantBindings =
      (deletedTenantBindingRows as unknown as { rows?: Array<{ user_id: string }> }).rows || [];
    expect(deletedTenantBindings.length).toBe(0);

    const deletedSessionRows = await db.execute(
      sql.raw(`
        SELECT id
        FROM enterprise.admin_sessions
        WHERE user_id = '${escapeSqlLiteral(targetUserId)}'
        ORDER BY id ASC
      `),
    );
    const deletedSessions =
      (deletedSessionRows as unknown as { rows?: Array<{ id: string }> }).rows || [];
    expect(deletedSessions.length).toBe(0);

    const remainingUserRows = await db.execute(
      sql.raw(
        `SELECT id FROM enterprise.admin_users WHERE id = '${escapeSqlLiteral(keepUserId)}' LIMIT 1`,
      ),
    );
    const remainingUsers =
      (remainingUserRows as unknown as { rows?: Array<{ id: string }> }).rows || [];
    expect(remainingUsers.length).toBe(1);

    const remainingRoleBindingRows = await db.execute(
      sql.raw(`
        SELECT user_id, role_key, tenant_id
        FROM enterprise.admin_user_roles
        WHERE user_id = '${escapeSqlLiteral(keepUserId)}'
        ORDER BY id ASC
      `),
    );
    const remainingRoleBindings =
      (remainingRoleBindingRows as unknown as {
        rows?: Array<{ user_id: string; role_key: string; tenant_id: string | null }>;
      }).rows || [];
    expect(remainingRoleBindings.length).toBe(1);
    expect(remainingRoleBindings[0]?.role_key).toBe("owner");
    expect(remainingRoleBindings[0]?.tenant_id).toBe("default");

    const remainingTenantBindingRows = await db.execute(
      sql.raw(`
        SELECT user_id, tenant_id
        FROM enterprise.admin_user_tenants
        WHERE user_id = '${escapeSqlLiteral(keepUserId)}'
        ORDER BY id ASC
      `),
    );
    const remainingTenantBindings =
      (remainingTenantBindingRows as unknown as {
        rows?: Array<{ user_id: string; tenant_id: string }>;
      }).rows || [];
    expect(remainingTenantBindings.length).toBe(1);
    expect(remainingTenantBindings[0]?.tenant_id).toBe("default");

    const remainingSessionRows = await db.execute(
      sql.raw(`
        SELECT id, user_id
        FROM enterprise.admin_sessions
        WHERE user_id = '${escapeSqlLiteral(keepUserId)}'
        ORDER BY id ASC
      `),
    );
    const remainingSessions =
      (remainingSessionRows as unknown as {
        rows?: Array<{ id: string; user_id: string }>;
      }).rows || [];
    expect(remainingSessions.length).toBe(1);
    expect(remainingSessions[0]?.id).toBe("session-user-delete-keep-001");

    expect(await countSuccessAuditEventsByTraceId(traceId)).toBe(1);
    const audit = await readLatestAuditEventByTraceId(traceId);
    expect(audit?.action).toBe("admin.user.delete");
    expect(audit?.resource).toBe("admin.user");
    expect(audit?.resource_id).toBe(targetUserId);
    expect(audit?.trace_id).toBe(traceId);
    const details = parseAuditDetails(audit?.details);
    expect(details.username).toBe(targetUsername);
  });

  it("仅带 cookie 访问受 requireAdminIdentity 保护接口应返回 200（不依赖 x-admin-*）", async () => {
    const app = createAdminApp();
    const userId = "user-cookie-access-001";
    const username = "cookie_access";
    const password = "CorrectPass123";

    await insertAdminUser({ id: userId, username, password });

    const loginResponse = await app.fetch(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "trace-admin-cookie-login-001",
        },
        body: JSON.stringify({ username, password }),
      }),
    );

    expect(loginResponse.status).toBe(200);
    const sessionId = extractSessionIdFromSetCookie(
      getSetCookieHeaders(loginResponse),
    );
    expect(sessionId).toBeTruthy();

    const traceId = "trace-admin-cookie-access-001";
    const protectedResponse = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles", {
        method: "GET",
        headers: {
          Cookie: `${config.admin.sessionCookieName}=${sessionId}`,
          "x-request-id": traceId,
        },
      }),
    );

    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.headers.get("x-request-id")).toBe(traceId);
    const payload = await protectedResponse.json();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data.length).toBeGreaterThan(0);
  });

  it("cookie 无效时访问受保护接口应返回 403，并对齐 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-cookie-invalid-001";

    const response = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles", {
        method: "GET",
        headers: {
          Cookie: `${config.admin.sessionCookieName}=invalid-session-001`,
          "x-request-id": traceId,
        },
      }),
    );

    expect(response.status).toBe(403);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("管理员未登录或无权限");
  });

  it("cookie 过期时访问受保护接口应返回 403，并对齐 traceId", async () => {
    const app = createAdminApp();
    const userId = "user-cookie-expired-001";
    const username = "cookie_expired";
    const password = "CorrectPass123";

    await insertAdminUser({ id: userId, username, password });

    const loginResponse = await app.fetch(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "trace-admin-cookie-expired-login-001",
        },
        body: JSON.stringify({ username, password }),
      }),
    );

    expect(loginResponse.status).toBe(200);
    const sessionId = extractSessionIdFromSetCookie(
      getSetCookieHeaders(loginResponse),
    );
    expect(sessionId).toBeTruthy();

    await db.execute(
      sql.raw(
        `UPDATE enterprise.admin_sessions SET expires_at = ${
          Date.now() - 1000
        } WHERE id = '${escapeSqlLiteral(sessionId)}'`,
      ),
    );

    const traceId = "trace-admin-cookie-expired-001";
    const response = await app.fetch(
      new Request("http://localhost/api/admin/rbac/roles", {
        method: "GET",
        headers: {
          Cookie: `${config.admin.sessionCookieName}=${sessionId}`,
          "x-request-id": traceId,
        },
      }),
    );

    expect(response.status).toBe(403);
    const payload = await expectJsonErrorTraceId(response);
    expect(payload.error).toBe("管理员未登录或无权限");
  });
});
