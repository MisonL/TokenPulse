import { eq } from "drizzle-orm";
import { db } from "../../db";
import { adminRoles } from "../../db/schema";

export interface PermissionItem {
  key: string;
  name: string;
}

export interface RoleItem {
  key: string;
  name: string;
  permissions: string[];
  builtin?: boolean;
}

export const RBAC_PERMISSIONS: PermissionItem[] = [
  { key: "admin.dashboard.read", name: "查看企业仪表盘" },
  { key: "admin.users.manage", name: "管理企业用户" },
  { key: "admin.billing.manage", name: "管理计费与配额" },
  { key: "admin.audit.read", name: "查看审计日志" },
  { key: "admin.audit.write", name: "写入审计事件" },
];

export const RBAC_ROLES: RoleItem[] = [
  {
    key: "owner",
    name: "所有者",
    permissions: [
      "admin.dashboard.read",
      "admin.users.manage",
      "admin.billing.manage",
      "admin.audit.read",
      "admin.audit.write",
    ],
    builtin: true,
  },
  {
    key: "auditor",
    name: "审计员",
    permissions: ["admin.dashboard.read", "admin.audit.read"],
    builtin: true,
  },
  {
    key: "operator",
    name: "运维员",
    permissions: ["admin.dashboard.read", "admin.users.manage"],
    builtin: true,
  },
];

function normalizeRoleKey(input?: string): string {
  return (input || "").trim().toLowerCase();
}

function parsePermissions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function resolveAdminRole(input?: string): string {
  const normalized = normalizeRoleKey(input);
  if (!normalized) return "owner";
  const exists = RBAC_ROLES.some((role) => role.key === normalized);
  return exists ? normalized : "owner";
}

export async function listRoleItems(): Promise<RoleItem[]> {
  try {
    const rows = await db.select().from(adminRoles);
    if (!rows.length) return RBAC_ROLES;

    const roles = rows.map((row) => ({
      key: row.key,
      name: row.name,
      permissions: parsePermissions(row.permissions),
      builtin: row.builtin === 1,
    }));

    if (roles.length > 0) {
      return roles;
    }
    return RBAC_ROLES;
  } catch {
    // 数据库迁移尚未执行时降级到内置角色。
    return RBAC_ROLES;
  }
}

export async function getRoleItem(roleKey: string): Promise<RoleItem | null> {
  const normalized = normalizeRoleKey(roleKey);
  if (!normalized) return null;

  try {
    const rows = await db
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.key, normalized))
      .limit(1);
    const row = rows[0];
    if (row) {
      return {
        key: row.key,
        name: row.name,
        permissions: parsePermissions(row.permissions),
        builtin: row.builtin === 1,
      };
    }
  } catch {
    // ignore
  }

  const fallback = RBAC_ROLES.find((item) => item.key === normalized);
  return fallback || null;
}

export async function hasPermission(
  roleKey: string,
  permission: string,
): Promise<boolean> {
  const role = await getRoleItem(roleKey);
  if (!role) return false;
  return role.permissions.includes(permission);
}
