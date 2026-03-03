import { Hono } from "hono";
import crypto from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { setCookie, deleteCookie } from "hono/cookie";
import { advancedOnly } from "../middleware/advanced";
import { getEditionFeatures } from "../lib/edition";
import { queryAuditEvents, writeAuditEvent } from "../lib/admin/audit";
import { RBAC_PERMISSIONS, listRoleItems } from "../lib/admin/rbac";
import { requirePermission } from "../middleware/rbac";
import {
  getAdminIdentity,
  requireAdminIdentity,
  resolveAdminIdentity,
} from "../middleware/admin-auth";
import { getRequestTraceId } from "../middleware/request-context";
import { config } from "../config";
import { db } from "../db";
import {
  adminRoles,
  adminSessions,
  adminUserRoles,
  adminUserTenants,
  adminUsers,
  settings,
  tenants,
} from "../db/schema";
import { loginAdmin, revokeAdminSession } from "../lib/admin/auth";
import {
  deleteQuotaPolicy,
  listQuotaPolicies,
  listQuotaUsage,
  saveQuotaPolicy,
} from "../lib/admin/quota";
import { invalidateModelGovernanceCache } from "../lib/model-governance";
import {
  getOAuthSelectionConfig,
  updateOAuthSelectionConfig,
} from "../lib/oauth-selection-policy";

const enterprise = new Hono();

const ADMIN_MODEL_ALIAS_KEY = "oauth_model_alias";
const ADMIN_EXCLUDED_MODELS_KEY = "oauth_excluded_models";

enterprise.get("/features", (c) => {
  return c.json(getEditionFeatures());
});

enterprise.use("*", advancedOnly);
enterprise.use("*", resolveAdminIdentity);

enterprise.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "tokenpulse-enterprise",
    edition: "advanced",
  });
});

const adminLoginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  tenantId: z.string().trim().min(1).optional(),
});

enterprise.post(
  "/auth/login",
  zValidator("json", adminLoginSchema),
  async (c) => {
    try {
      const payload = c.req.valid("json");
      const result = await loginAdmin(
        payload.username,
        payload.password,
        payload.tenantId,
        resolveClientIp(c.req.header("x-forwarded-for"), c.req.header("cf-connecting-ip")),
        c.req.header("user-agent") || undefined,
      );

      if (!result) {
        return c.json({ success: false, error: "用户名或密码错误" }, 400);
      }

      const secure = process.env.NODE_ENV === "production";
      const maxAge = config.admin.sessionTtlHours * 60 * 60;
      setCookie(c, config.admin.sessionCookieName, result.sessionId, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure,
        maxAge,
      });

      await writeAuditEvent({
        actor: result.user.username,
        action: "admin.auth.login",
        resource: "admin.session",
        resourceId: result.sessionId,
        result: "success",
        traceId: getRequestTraceId(c),
        details: {
          roleKey: result.roleKey,
          tenantId: result.tenantId,
        },
        ip: resolveClientIp(c.req.header("x-forwarded-for"), c.req.header("cf-connecting-ip")),
        userAgent: c.req.header("user-agent") || undefined,
      });

      return c.json({
        success: true,
        data: {
          user: result.user,
          roleKey: result.roleKey,
          tenantId: result.tenantId,
          expiresAt: result.expiresAt,
        },
      });
    } catch (error: any) {
      return c.json({ error: "管理员登录失败", details: error?.message }, 500);
    }
  },
);

enterprise.post("/auth/logout", async (c) => {
  try {
    const identity = getAdminIdentity(c);
    if (identity.sessionId) {
      await revokeAdminSession(identity.sessionId);
    }

    deleteCookie(c, config.admin.sessionCookieName, {
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });

    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: "退出登录失败", details: error?.message }, 500);
  }
});

enterprise.get("/auth/me", async (c) => {
  const identity = getAdminIdentity(c);
  if (!identity.authenticated) {
    return c.json({
      authenticated: false,
      source: identity.source,
    });
  }
  return c.json({
    authenticated: identity.authenticated,
    source: identity.source,
    userId: identity.userId,
    username: identity.username,
    roleKey: identity.roleKey,
    tenantId: identity.tenantId,
  });
});

enterprise.use("*", requireAdminIdentity);

enterprise.get(
  "/rbac/permissions",
  requirePermission("admin.dashboard.read"),
  (c) => {
    return c.json({
      data: RBAC_PERMISSIONS,
    });
  },
);

enterprise.get(
  "/rbac/roles",
  requirePermission("admin.dashboard.read"),
  async (c) => {
    const roles = await listRoleItems();
    return c.json({ data: roles });
  },
);

const createRoleSchema = z.object({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  permissions: z.array(z.string().trim().min(1)).default([]),
});

enterprise.post(
  "/rbac/roles",
  requirePermission("admin.rbac.manage"),
  zValidator("json", createRoleSchema),
  async (c) => {
    const payload = c.req.valid("json");
    const nowIso = new Date().toISOString();

    await db
      .insert(adminRoles)
      .values({
        key: payload.key.trim().toLowerCase(),
        name: payload.name,
        permissions: JSON.stringify(payload.permissions),
        builtin: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: adminRoles.key,
        set: {
          name: payload.name,
          permissions: JSON.stringify(payload.permissions),
          updatedAt: nowIso,
        },
      });

    return c.json({ success: true });
  },
);

const updateRoleSchema = z.object({
  name: z.string().trim().min(1).optional(),
  permissions: z.array(z.string().trim().min(1)).optional(),
});

enterprise.put(
  "/rbac/roles/:key",
  requirePermission("admin.rbac.manage"),
  zValidator("json", updateRoleSchema),
  async (c) => {
    const key = c.req.param("key").trim().toLowerCase();
    const payload = c.req.valid("json");
    const setPayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (payload.name) setPayload.name = payload.name;
    if (payload.permissions) {
      setPayload.permissions = JSON.stringify(payload.permissions);
    }

    await db.update(adminRoles).set(setPayload).where(eq(adminRoles.key, key));
    return c.json({ success: true });
  },
);

enterprise.delete(
  "/rbac/roles/:key",
  requirePermission("admin.rbac.manage"),
  async (c) => {
    const key = c.req.param("key").trim().toLowerCase();
    if (["owner", "auditor", "operator"].includes(key)) {
      return c.json({ error: "内置角色不允许删除" }, 400);
    }

    await db.delete(adminRoles).where(eq(adminRoles.key, key));
    await db.delete(adminUserRoles).where(eq(adminUserRoles.roleKey, key));
    return c.json({ success: true });
  },
);

enterprise.get(
  "/tenants",
  requirePermission("admin.tenants.manage"),
  async (c) => {
    const rows = await db.select().from(tenants).orderBy(desc(tenants.updatedAt));
    return c.json({ data: rows });
  },
);

const tenantSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  status: z.enum(["active", "disabled"]).optional(),
});

enterprise.post(
  "/tenants",
  requirePermission("admin.tenants.manage"),
  zValidator("json", tenantSchema),
  async (c) => {
    const payload = c.req.valid("json");
    const nowIso = new Date().toISOString();
    const id = (payload.id || crypto.randomUUID()).trim().toLowerCase();

    await db
      .insert(tenants)
      .values({
        id,
        name: payload.name,
        status: payload.status || "active",
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: tenants.id,
        set: {
          name: payload.name,
          status: payload.status || "active",
          updatedAt: nowIso,
        },
      });

    return c.json({ success: true, id });
  },
);

const tenantUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

enterprise.put(
  "/tenants/:id",
  requirePermission("admin.tenants.manage"),
  zValidator("json", tenantUpdateSchema),
  async (c) => {
    const id = c.req.param("id").trim().toLowerCase();
    const payload = c.req.valid("json");

    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (payload.name) updatePayload.name = payload.name;
    if (payload.status) updatePayload.status = payload.status;

    await db.update(tenants).set(updatePayload).where(eq(tenants.id, id));
    return c.json({ success: true });
  },
);

enterprise.delete(
  "/tenants/:id",
  requirePermission("admin.tenants.manage"),
  async (c) => {
    const id = c.req.param("id").trim().toLowerCase();
    if (id === "default") {
      return c.json({ error: "默认租户不可删除" }, 400);
    }

    await db.delete(tenants).where(eq(tenants.id, id));
    await db.delete(adminUserTenants).where(eq(adminUserTenants.tenantId, id));
    await db.delete(adminUserRoles).where(eq(adminUserRoles.tenantId, id));
    return c.json({ success: true });
  },
);

const createUserSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(8),
  displayName: z.string().trim().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  roleKey: z.string().trim().min(1).default("operator"),
  tenantId: z.string().trim().min(1).default("default"),
});

enterprise.get(
  "/users",
  requirePermission("admin.users.manage"),
  async (c) => {
    const users = await db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt));
    const roleBindings = await db.select().from(adminUserRoles);

    const roleMap = new Map<string, Array<{ roleKey: string; tenantId?: string | null }>>();
    for (const item of roleBindings) {
      const list = roleMap.get(item.userId) || [];
      list.push({ roleKey: item.roleKey, tenantId: item.tenantId });
      roleMap.set(item.userId, list);
    }

    return c.json({
      data: users.map((user) => ({
        ...user,
        passwordHash: undefined,
        roles: roleMap.get(user.id) || [],
      })),
    });
  },
);

enterprise.post(
  "/users",
  requirePermission("admin.users.manage"),
  zValidator("json", createUserSchema),
  async (c) => {
    const payload = c.req.valid("json");
    const nowIso = new Date().toISOString();
    const userId = crypto.randomUUID();

    const passwordHash = await Bun.password.hash(payload.password, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 2,
    });

    await db.insert(adminUsers).values({
      id: userId,
      username: payload.username.trim().toLowerCase(),
      passwordHash,
      displayName: payload.displayName || null,
      status: payload.status || "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await db
      .insert(adminUserRoles)
      .values({
        userId,
        roleKey: payload.roleKey.trim().toLowerCase(),
        tenantId: payload.tenantId,
        createdAt: nowIso,
      })
      .onConflictDoNothing();

    await db
      .insert(adminUserTenants)
      .values({
        userId,
        tenantId: payload.tenantId,
        createdAt: nowIso,
      })
      .onConflictDoNothing();

    return c.json({ success: true, id: userId });
  },
);

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  password: z.string().min(8).optional(),
  roleKey: z.string().trim().min(1).optional(),
  tenantId: z.string().trim().min(1).optional(),
});

enterprise.put(
  "/users/:id",
  requirePermission("admin.users.manage"),
  zValidator("json", updateUserSchema),
  async (c) => {
    const userId = c.req.param("id").trim();
    const payload = c.req.valid("json");

    const userSet: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (payload.displayName) userSet.displayName = payload.displayName;
    if (payload.status) userSet.status = payload.status;
    if (payload.password) {
      userSet.passwordHash = await Bun.password.hash(payload.password, {
        algorithm: "argon2id",
        memoryCost: 65536,
        timeCost: 2,
      });
    }

    await db.update(adminUsers).set(userSet).where(eq(adminUsers.id, userId));

    if (payload.roleKey || payload.tenantId) {
      const roleKey = (payload.roleKey || "operator").trim().toLowerCase();
      const tenantId = payload.tenantId || "default";

      await db.delete(adminUserRoles).where(eq(adminUserRoles.userId, userId));
      await db
        .insert(adminUserRoles)
        .values({
          userId,
          roleKey,
          tenantId,
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing();

      await db
        .insert(adminUserTenants)
        .values({
          userId,
          tenantId,
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing();
    }

    return c.json({ success: true });
  },
);

enterprise.delete(
  "/users/:id",
  requirePermission("admin.users.manage"),
  async (c) => {
    const userId = c.req.param("id").trim();

    await db.delete(adminSessions).where(eq(adminSessions.userId, userId));
    await db.delete(adminUserRoles).where(eq(adminUserRoles.userId, userId));
    await db.delete(adminUserTenants).where(eq(adminUserTenants.userId, userId));
    await db.delete(adminUsers).where(eq(adminUsers.id, userId));

    return c.json({ success: true });
  },
);

const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  action: z.string().trim().min(1).optional(),
  resource: z.string().trim().min(1).optional(),
  result: z.enum(["success", "failure"]).optional(),
  keyword: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
});

enterprise.get(
  "/audit/events",
  requirePermission("admin.audit.read"),
  zValidator("query", auditQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const result = await queryAuditEvents(query);
      return c.json(result);
    } catch (error: any) {
      return c.json(
        { error: "审计事件查询失败，请先执行数据库迁移。", details: error?.message },
        500,
      );
    }
  },
);

const auditCreateSchema = z.object({
  action: z.string().trim().min(1),
  resource: z.string().trim().min(1),
  resourceId: z.string().trim().min(1).optional(),
  result: z.enum(["success", "failure"]).optional(),
  details: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

enterprise.post(
  "/audit/events",
  requirePermission("admin.audit.write"),
  zValidator("json", auditCreateSchema),
  async (c) => {
    try {
      const payload = c.req.valid("json");
      const identity = getAdminIdentity(c);
      const ip = resolveClientIp(
        c.req.header("x-forwarded-for"),
        c.req.header("cf-connecting-ip"),
      );
      const userAgent = c.req.header("user-agent") || undefined;
      const actor = identity.username || c.req.header("x-admin-user") || "api-secret";

      await writeAuditEvent({
        actor,
        action: payload.action,
        resource: payload.resource,
        resourceId: payload.resourceId,
        result: payload.result,
        traceId: getRequestTraceId(c),
        details: payload.details,
        ip,
        userAgent,
      });

      return c.json({ success: true });
    } catch (error: any) {
      return c.json(
        { error: "写入审计事件失败。", details: error?.message },
        500,
      );
    }
  },
);

enterprise.get(
  "/billing/quotas",
  requirePermission("admin.billing.manage"),
  async (c) => {
    const policies = await listQuotaPolicies();
    return c.json({
      data: {
        mode: "advanced",
        message: "配额策略已启用，可通过策略接口按租户/角色/用户精细控制。",
        limits: {
          requestsPerMinute: 0,
          tokensPerDay: 0,
        },
        policies: policies.length,
      },
    });
  },
);

enterprise.get(
  "/billing/policies",
  requirePermission("admin.billing.manage"),
  async (c) => {
    const policies = await listQuotaPolicies();
    return c.json({ data: policies });
  },
);

const quotaPolicySchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  scopeType: z.enum(["global", "tenant", "role", "user"]),
  scopeValue: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  modelPattern: z.string().trim().optional(),
  requestsPerMinute: z.coerce.number().int().nonnegative().optional(),
  tokensPerMinute: z.coerce.number().int().nonnegative().optional(),
  tokensPerDay: z.coerce.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
});

enterprise.post(
  "/billing/policies",
  requirePermission("admin.billing.manage"),
  zValidator("json", quotaPolicySchema),
  async (c) => {
    const payload = c.req.valid("json");
    const policy = await saveQuotaPolicy(payload);
    return c.json({ success: true, data: policy });
  },
);

enterprise.put(
  "/billing/policies/:id",
  requirePermission("admin.billing.manage"),
  zValidator("json", quotaPolicySchema.partial()),
  async (c) => {
    const id = c.req.param("id");
    const payload = c.req.valid("json");

    const currentList = await listQuotaPolicies();
    const current = currentList.find((item) => item.id === id);
    if (!current) {
      return c.json({ error: "策略不存在" }, 404);
    }

    const merged = {
      ...current,
      ...payload,
      id,
    };

    const saved = await saveQuotaPolicy(merged);
    return c.json({ success: true, data: saved });
  },
);

enterprise.delete(
  "/billing/policies/:id",
  requirePermission("admin.billing.manage"),
  async (c) => {
    const id = c.req.param("id");
    await deleteQuotaPolicy(id);
    return c.json({ success: true });
  },
);

enterprise.get(
  "/billing/usage",
  requirePermission("admin.billing.manage"),
  async (c) => {
    const policyId = c.req.query("policyId") || undefined;
    const bucketTypeRaw = c.req.query("bucketType");
    const bucketType =
      bucketTypeRaw === "minute" || bucketTypeRaw === "day"
        ? bucketTypeRaw
        : undefined;
    const limitRaw = Number.parseInt(c.req.query("limit") || "100", 10);
    const usage = await listQuotaUsage({
      policyId,
      bucketType,
      limit: Number.isFinite(limitRaw) ? limitRaw : 100,
    });
    return c.json({ data: usage });
  },
);

const selectionPolicySchema = z.object({
  defaultPolicy: z
    .enum(["round_robin", "latest_valid", "sticky_user"])
    .optional(),
  allowHeaderOverride: z.boolean().optional(),
  allowHeaderAccountOverride: z.boolean().optional(),
  failureCooldownSec: z.coerce.number().int().nonnegative().optional(),
  maxRetryOnAccountFailure: z.coerce.number().int().nonnegative().optional(),
});

enterprise.get(
  "/oauth/selection-policy",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const data = await getOAuthSelectionConfig();
    return c.json({ data });
  },
);

enterprise.put(
  "/oauth/selection-policy",
  requirePermission("admin.oauth.manage"),
  zValidator("json", selectionPolicySchema),
  async (c) => {
    const payload = c.req.valid("json");
    const data = await updateOAuthSelectionConfig(payload);
    return c.json({ success: true, data });
  },
);

enterprise.get(
  "/oauth/model-alias",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const value = await readJsonSetting(ADMIN_MODEL_ALIAS_KEY);
    return c.json({ data: value || {} });
  },
);

enterprise.put(
  "/oauth/model-alias",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    await writeJsonSetting(ADMIN_MODEL_ALIAS_KEY, payload);
    invalidateModelGovernanceCache();
    return c.json({ success: true });
  },
);

enterprise.get(
  "/oauth/excluded-models",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const value = await readJsonSetting(ADMIN_EXCLUDED_MODELS_KEY);
    return c.json({ data: value || {} });
  },
);

enterprise.put(
  "/oauth/excluded-models",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    await writeJsonSetting(ADMIN_EXCLUDED_MODELS_KEY, payload);
    invalidateModelGovernanceCache();
    return c.json({ success: true });
  },
);

async function readJsonSetting(key: string): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeJsonSetting(key: string, value: unknown) {
  const nowIso = new Date().toISOString();
  await db
    .insert(settings)
    .values({
      key,
      value: JSON.stringify(value || {}),
      description: "企业管理配置",
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: JSON.stringify(value || {}),
        updatedAt: nowIso,
      },
    });
}

function resolveClientIp(
  forwardedFor?: string,
  cfConnectingIp?: string,
): string | undefined {
  if (cfConnectingIp) return cfConnectingIp;
  if (!forwardedFor) return undefined;
  return forwardedFor.split(",")[0]?.trim();
}

export default enterprise;
