import type { Context, Next } from "hono";
import { hasPermission, resolveAdminRole } from "../lib/admin/rbac";
import { getAdminIdentity } from "./admin-auth";

/**
 * RBAC 权限中间件：
 * - 从 `x-admin-role` 读取角色（缺省回退 owner，兼容现有调用）
 * - 校验是否具备指定 permission
 */
export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    const identity = getAdminIdentity(c);
    const role = resolveAdminRole(identity.roleKey || c.req.header("x-admin-role"));
    if (!(await hasPermission(role, permission))) {
      return c.json(
        {
          error: "权限不足",
          role,
          required: permission,
        },
        403,
      );
    }
    await next();
  };
}
