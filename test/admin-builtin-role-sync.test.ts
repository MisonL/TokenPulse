import { beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { syncBuiltinRolesToDb } from "../src/lib/admin/auth";

async function ensureAdminRolesTable() {
  await db.execute(
    sql.raw(`CREATE SCHEMA IF NOT EXISTS enterprise`),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.admin_roles (
        key text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        permissions text NOT NULL,
        builtin integer DEFAULT 0 NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
}

describe("内置角色同步", () => {
  beforeEach(async () => {
    await ensureAdminRolesTable();
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
  });

  it("应覆盖旧版 owner 权限并补齐新增权限", async () => {
    const now = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('owner', '所有者', '["admin.dashboard.read","admin.users.manage"]', 1, '${now}', '${now}')
      `),
    );

    await syncBuiltinRolesToDb();

    const rows = await db.execute(
      sql.raw(
        "SELECT key, permissions, builtin FROM enterprise.admin_roles WHERE key = 'owner' LIMIT 1",
      ),
    );
    const resultRows = (rows as unknown as { rows?: Array<{
      key: string;
      permissions: string;
      builtin: number;
    }> }).rows || [];

    expect(resultRows.length).toBe(1);
    const owner = resultRows[0]!;

    const permissions = JSON.parse(owner.permissions) as string[];
    expect(owner.key).toBe("owner");
    expect(owner.builtin).toBe(1);
    expect(permissions).toContain("admin.oauth.manage");
    expect(permissions).toContain("admin.tenants.manage");
    expect(permissions).toContain("admin.rbac.manage");
  });
});
