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
    "x-admin-user": "delete-cascade-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function ensureEnterpriseAdminDeleteTables() {
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

async function resetEnterpriseAdminDeleteFixtures() {
  const nowIso = new Date().toISOString();
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_sessions"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_user_tenants"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_user_roles"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_users"));
  await db.execute(sql.raw("DELETE FROM enterprise.tenants"));
  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
      VALUES ('default', '默认租户', 'active', '${escapeSqlLiteral(nowIso)}', '${escapeSqlLiteral(nowIso)}')
    `),
  );
}

function getRows<T>(result: unknown): T[] {
  return (
    (result as {
      rows?: T[];
    })?.rows || []
  );
}

describe("企业域管理员删除联动回归", () => {
  beforeAll(async () => {
    await ensureEnterpriseAdminDeleteTables();
  });

  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    config.admin.authMode = "hybrid";
    await resetEnterpriseAdminDeleteFixtures();
  });

  afterAll(async () => {
    await resetEnterpriseAdminDeleteFixtures();
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
    config.admin.authMode = originalAuthMode;
  });

  it("DELETE /api/admin/users/:id 应清理 sessions/roles/tenants 绑定，并写入审计事件", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-user-delete-cascade-001";
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    const userId = "admin-user-delete-001";
    const username = "user_delete_001";
    const sessionId = "session-delete-001";

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_users (id, username, password_hash, display_name, status, created_at, updated_at)
        VALUES (
          '${escapeSqlLiteral(userId)}',
          '${escapeSqlLiteral(username)}',
          'hash-value',
          'Delete User',
          'active',
          '${escapeSqlLiteral(nowIso)}',
          '${escapeSqlLiteral(nowIso)}'
        )
      `),
    );

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_sessions (id, user_id, role_key, tenant_id, ip, user_agent, created_at, expires_at, last_seen_at)
        VALUES (
          '${escapeSqlLiteral(sessionId)}',
          '${escapeSqlLiteral(userId)}',
          'owner',
          'default',
          '127.0.0.1',
          'bun-test',
          ${nowMs},
          ${nowMs + 3600_000},
          ${nowMs}
        )
      `),
    );

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES ('${escapeSqlLiteral(userId)}', 'owner', 'default', '${escapeSqlLiteral(nowIso)}')
      `),
    );

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
        VALUES ('${escapeSqlLiteral(userId)}', 'default', '${escapeSqlLiteral(nowIso)}')
      `),
    );

    const response = await app.fetch(
      new Request(`http://localhost/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe(traceId);

    const userRows = getRows<{ id: string }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.admin_users WHERE id = '${escapeSqlLiteral(userId)}' LIMIT 1`,
        ),
      ),
    );
    expect(userRows.length).toBe(0);

    const sessionRows = getRows<{ id: string }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.admin_sessions WHERE user_id = '${escapeSqlLiteral(userId)}' LIMIT 1`,
        ),
      ),
    );
    expect(sessionRows.length).toBe(0);

    const roleRows = getRows<{ id: number }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.admin_user_roles WHERE user_id = '${escapeSqlLiteral(userId)}' LIMIT 1`,
        ),
      ),
    );
    expect(roleRows.length).toBe(0);

    const tenantRows = getRows<{ id: number }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.admin_user_tenants WHERE user_id = '${escapeSqlLiteral(userId)}' LIMIT 1`,
        ),
      ),
    );
    expect(tenantRows.length).toBe(0);

    const auditRows = getRows<{
      action: string;
      trace_id?: string | null;
    }>(
      await db.execute(
        sql.raw(
          `SELECT action, trace_id FROM enterprise.audit_events WHERE action = 'admin.user.delete' ORDER BY id DESC LIMIT 1`,
        ),
      ),
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]!.action).toBe("admin.user.delete");
    expect(auditRows[0]!.trace_id).toBe(traceId);
  });

  it("DELETE /api/admin/tenants/:id 应删除租户并清理绑定（用户保留）", async () => {
    const app = createAdminApp();
    const traceId = "trace-admin-tenant-delete-cascade-001";
    const nowIso = new Date().toISOString();

    const tenantId = "tenant-delete-001";
    const userId = "admin-user-tenant-binding-001";

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.tenants (id, name, status, created_at, updated_at)
        VALUES (
          '${escapeSqlLiteral(tenantId)}',
          '待删除租户',
          'active',
          '${escapeSqlLiteral(nowIso)}',
          '${escapeSqlLiteral(nowIso)}'
        )
      `),
    );

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_users (id, username, password_hash, display_name, status, created_at, updated_at)
        VALUES (
          '${escapeSqlLiteral(userId)}',
          'bind-user',
          'hash-value',
          'Bind User',
          'active',
          '${escapeSqlLiteral(nowIso)}',
          '${escapeSqlLiteral(nowIso)}'
        )
      `),
    );

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_roles (user_id, role_key, tenant_id, created_at)
        VALUES ('${escapeSqlLiteral(userId)}', 'operator', '${escapeSqlLiteral(tenantId)}', '${escapeSqlLiteral(nowIso)}')
      `),
    );

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_user_tenants (user_id, tenant_id, created_at)
        VALUES ('${escapeSqlLiteral(userId)}', '${escapeSqlLiteral(tenantId)}', '${escapeSqlLiteral(nowIso)}')
      `),
    );

    const response = await app.fetch(
      new Request(`http://localhost/api/admin/tenants/${tenantId}`, {
        method: "DELETE",
        headers: ownerHeaders(traceId),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);

    const tenantRows = getRows<{ id: string }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.tenants WHERE id = '${escapeSqlLiteral(tenantId)}' LIMIT 1`,
        ),
      ),
    );
    expect(tenantRows.length).toBe(0);

    const tenantBindingRows = getRows<{ id: number }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.admin_user_tenants WHERE tenant_id = '${escapeSqlLiteral(tenantId)}' LIMIT 1`,
        ),
      ),
    );
    expect(tenantBindingRows.length).toBe(0);

    const roleBindingRows = getRows<{ id: number }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.admin_user_roles WHERE tenant_id = '${escapeSqlLiteral(tenantId)}' LIMIT 1`,
        ),
      ),
    );
    expect(roleBindingRows.length).toBe(0);

    const userRows = getRows<{ id: string }>(
      await db.execute(
        sql.raw(
          `SELECT id FROM enterprise.admin_users WHERE id = '${escapeSqlLiteral(userId)}' LIMIT 1`,
        ),
      ),
    );
    expect(userRows.length).toBe(1);
  });
});

