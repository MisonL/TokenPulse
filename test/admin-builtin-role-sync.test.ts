import { beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { syncBuiltinRolesToDb } from "../src/lib/admin/auth";

async function ensureAdminRolesTable() {
  await db.run(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS admin_roles (
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
    await db.run(sql.raw("DELETE FROM admin_roles"));
  });

  it("应覆盖旧版 owner 权限并补齐新增权限", async () => {
    const now = new Date().toISOString();
    await db.run(
      sql.raw(`
        INSERT INTO admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES ('owner', '所有者', '["admin.dashboard.read","admin.users.manage"]', 1, '${now}', '${now}')
      `),
    );

    await syncBuiltinRolesToDb();

    const rows = await db.all(
      sql.raw(
        "SELECT key, permissions, builtin FROM admin_roles WHERE key = 'owner' LIMIT 1",
      ),
    );

    expect(rows.length).toBe(1);
    const owner = rows[0] as {
      key: string;
      permissions: string;
      builtin: number;
    };

    const permissions = JSON.parse(owner.permissions) as string[];
    expect(owner.key).toBe("owner");
    expect(owner.builtin).toBe(1);
    expect(permissions).toContain("admin.oauth.manage");
    expect(permissions).toContain("admin.tenants.manage");
    expect(permissions).toContain("admin.rbac.manage");
  });
});
