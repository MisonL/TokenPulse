import { Hono } from "hono";
import crypto from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { setCookie, deleteCookie } from "hono/cookie";
import { advancedOnly } from "../middleware/advanced";
import { getEditionFeatures } from "../lib/edition";
import {
  buildAuditEventsCsv,
  queryAuditEvents,
  writeAuditEvent,
} from "../lib/admin/audit";
import {
  RBAC_PERMISSIONS,
  RBAC_ROLES,
  listRoleItems,
  resolveAdminRole,
} from "../lib/admin/rbac";
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
  oauthAlertDeliveries,
  oauthAlertEvents,
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
import {
  invalidateModelGovernanceCache,
  parseAliasRules,
  parseExcludedRules,
} from "../lib/model-governance";
import {
  getOAuthSelectionConfig,
  updateOAuthSelectionConfig,
} from "../lib/oauth-selection-policy";
import {
  buildOAuthCallbackEventsCsv,
  oauthCallbackStore,
} from "../lib/auth/oauth-callback-store";
import {
  buildOAuthSessionEventsCsv,
  queryOAuthSessionEvents,
} from "../lib/auth/oauth-session-store";
import {
  getCapabilityMap,
  updateCapabilityMap,
} from "../lib/routing/capability-map";
import { validateCapabilityRuntimeHealth } from "../lib/oauth/runtime-adapters";
import {
  getRouteExecutionPolicy,
  updateRouteExecutionPolicy,
} from "../lib/routing/route-policy";
import {
  CLAUDE_FALLBACK_REASONS,
  CLAUDE_FALLBACK_TIMESERIES_STEPS,
  listClaudeFallbackEvents,
  summarizeClaudeFallbackEvents,
  summarizeClaudeFallbackTimeseries,
} from "../lib/observability/claude-fallback-events";
import {
  optionalIsoDateTimeSchema,
  parseIsoDateTime,
  validateTimeRange,
} from "../lib/time-range";
import {
  buildOAuthAlertDeliveryControl,
  evaluateOAuthSessionAlerts,
  getOAuthAlertConfig,
  queryOAuthAlertEvents,
  resolveOAuthAlertIncidentId,
  updateOAuthAlertConfig,
} from "../lib/observability/oauth-session-alerts";
import {
  deliverOAuthAlertEvent,
  listOAuthAlertDeliveries,
} from "../lib/observability/alert-delivery";
import {
  alertmanagerControlLastSuccessTimestampGauge,
  alertmanagerControlOperationDuration,
  alertmanagerControlOperationsCounter,
  oauthAlertCompatRouteCounter,
} from "../lib/metrics";
import {
  activateOAuthAlertRuleVersion,
  createOAuthAlertRuleVersion,
  getActiveOAuthAlertRuleVersion,
  listOAuthAlertRuleVersions,
  OAuthAlertRuleVersionConflictError,
  oauthAlertRuleVersionCreateSchema,
  oauthAlertRuleVersionListQuerySchema,
} from "../lib/observability/oauth-alert-rules";
import {
  ALERTMANAGER_SYNC_IN_PROGRESS_CODE,
  AlertmanagerLockConflictError,
  type AlertmanagerControlConfig,
  AlertmanagerSyncError,
  listAlertmanagerControlHistoryPage,
  maskAlertmanagerWebhookUrls,
  readAlertmanagerControlConfig,
  rollbackAlertmanagerControlConfigByHistoryId,
  syncAlertmanagerControlConfig,
  updateAlertmanagerControlConfig,
} from "../lib/observability/alertmanager-control";
import {
  AGENTLEDGER_DELIVERY_ATTEMPT_SOURCES,
  AGENTLEDGER_DELIVERY_STATES,
  AGENTLEDGER_REPLAY_RESULTS,
  AGENTLEDGER_REPLAY_TRIGGER_SOURCES,
  AGENTLEDGER_RUNTIME_STATUSES,
  buildAgentLedgerOutboxCsv,
  listAgentLedgerDeliveryAttempts,
  getAgentLedgerOutboxHealth,
  getAgentLedgerOutboxReadiness,
  listAgentLedgerOutbox,
  listAgentLedgerReplayAudits,
  replayAgentLedgerOutboxItem,
  replayAgentLedgerOutboxItemsBatch,
  summarizeAgentLedgerDeliveryAttempts,
  summarizeAgentLedgerOutbox,
  summarizeAgentLedgerReplayAudits,
} from "../lib/agentledger/runtime-events";
import { getAgentLedgerTraceDrilldown } from "../lib/agentledger/trace-drilldown";

const enterprise = new Hono();
const CLOCK_HHMM_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OAUTH_ALERT_INCIDENT_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;
const OAUTH_ALERT_LEGACY_INCIDENT_ID_PATTERN = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:\d+$/;
const OAUTH_ALERT_DELIVERY_LEGACY_INCIDENT_ID_PATTERN = /^legacy:(\d+)$/;
const OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX = "incident:legacy:delivery:";
const OAUTH_ALERT_COMPAT_DEPRECATED_SINCE = "2026-03-01";
const OAUTH_ALERT_COMPATIBILITY_WINDOW_END = "2026-06-30";
const OAUTH_ALERT_COMPAT_CRITICAL_AFTER = "2026-07-01";
const OAUTH_ALERT_COMPAT_SUNSET_HEADER = "Wed, 01 Jul 2026 00:00:00 GMT";
const OAUTH_ALERT_COMPAT_GONE_CODE = "oauth_alert_compat_route_sunset";

const ADMIN_MODEL_ALIAS_KEY = "oauth_model_alias";
const ADMIN_EXCLUDED_MODELS_KEY = "oauth_excluded_models";

function getAuditRequestContext(c: Parameters<typeof getAdminIdentity>[0]) {
  const identity = getAdminIdentity(c);
  return {
    actor: identity.username || c.req.header("x-admin-user") || "api-secret",
    traceId: getRequestTraceId(c),
    ip: resolveClientIp(
      c.req.header("x-forwarded-for"),
      c.req.header("cf-connecting-ip"),
    ),
    userAgent: c.req.header("user-agent") || undefined,
  };
}

function getCurrentAdminRole(c: Parameters<typeof getAdminIdentity>[0]) {
  const identity = getAdminIdentity(c);
  return resolveAdminRole(identity.roleKey || c.req.header("x-admin-role"));
}

async function writeSuccessAdminAuditEvent(
  c: Parameters<typeof getAdminIdentity>[0],
  event: {
    action: string;
    resource: string;
    resourceId?: string;
    details?: Record<string, unknown> | string;
  },
) {
  const context = getAuditRequestContext(c);
  await writeAuditEvent({
    actor: context.actor,
    action: event.action,
    resource: event.resource,
    resourceId: event.resourceId,
    result: "success",
    traceId: context.traceId,
    details: event.details,
    ip: context.ip,
    userAgent: context.userAgent,
  });
  return context;
}

function summarizeJsonPayload(payload: unknown) {
  if (Array.isArray(payload)) {
    return {
      payloadType: "array",
      itemCount: payload.length,
    };
  }
  if (payload && typeof payload === "object") {
    const keys = Object.keys(payload as Record<string, unknown>).sort();
    return {
      payloadType: "object",
      keyCount: keys.length,
      keys,
    };
  }
  if (payload === null) {
    return {
      payloadType: "null",
    };
  }
  return {
    payloadType: typeof payload,
  };
}

type AlertmanagerControlOperation = "config_update" | "sync" | "rollback";
type AlertmanagerControlOutcome =
  | "success"
  | "validation_error"
  | "bad_request"
  | "conflict"
  | "not_found"
  | "sync_error"
  | "internal_error";

function observeAlertmanagerControlOperation(
  operation: AlertmanagerControlOperation,
  outcome: AlertmanagerControlOutcome,
  startedAtMs: number,
) {
  alertmanagerControlOperationsCounter.labels(operation, outcome).inc();
  alertmanagerControlOperationDuration
    .labels(operation, outcome)
    .observe(Math.max(Date.now() - startedAtMs, 0) / 1000);
  if (
    outcome === "success" &&
    (operation === "sync" || operation === "rollback")
  ) {
    alertmanagerControlLastSuccessTimestampGauge
      .labels(operation)
      .set(Date.now() / 1000);
  }
}

function summarizeAliasAuditDetails(payload: unknown) {
  const summary = summarizeJsonPayload(payload);
  const aliasRules = parseAliasRules(payload);
  const providers = new Set(
    Object.keys(aliasRules).map((key) => (key.includes(":") ? key.split(":")[0] : "global")),
  );
  return {
    ...summary,
    aliasCount: Object.keys(aliasRules).length,
    providerCount: providers.size,
  };
}

function summarizeExcludedModelsAuditDetails(payload: unknown) {
  const summary = summarizeJsonPayload(payload);
  const excludedRules = parseExcludedRules(payload);
  const providers = new Set(
    Array.from(excludedRules).map((item) => (item.includes(":") ? item.split(":")[0] : "global")),
  );
  return {
    ...summary,
    excludedModelCount: excludedRules.size,
    providerCount: providers.size,
  };
}

function requireAdminRoles(allowedRoles: string[]) {
  const normalizedAllowed = new Set(allowedRoles.map((item) => item.trim().toLowerCase()));
  return async (c: any, next: any) => {
    const role = getCurrentAdminRole(c);
    if (!normalizedAllowed.has(role)) {
      return c.json(
        {
          error: "权限不足",
          role,
          requiredRoles: [...normalizedAllowed],
        },
        403,
      );
    }
    await next();
  };
}

function buildTimeRangeErrorResponse(
  from?: string,
  to?: string,
): { error: string } | null {
  const result = validateTimeRange({ from, to });
  if (result.ok) return null;
  return { error: result.error };
}

enterprise.get("/features", (c) => {
  return c.json(getEditionFeatures());
});

enterprise.use("*", advancedOnly);
enterprise.use("/oauth/alerts/*", handleOAuthAlertCompatRequest);
enterprise.use("/oauth/alertmanager/*", handleOAuthAlertCompatRequest);
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
    const roleKey = payload.key.trim().toLowerCase();

    const inserted = await db
      .insert(adminRoles)
      .values({
        key: roleKey,
        name: payload.name,
        permissions: JSON.stringify(payload.permissions),
        builtin: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing()
      .returning({ key: adminRoles.key });
    if (inserted.length === 0) {
      return c.json({ error: "角色已存在" }, 409);
    }

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.role.create",
      resource: "admin.role",
      resourceId: roleKey,
      result: "success",
      traceId: context.traceId,
      details: {
        key: roleKey,
        name: payload.name,
        permissions: payload.permissions,
      },
      ip: context.ip,
      userAgent: context.userAgent,
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
    if (["owner", "auditor", "operator"].includes(key)) {
      return c.json({ error: "内置角色不允许更新" }, 400);
    }
    const payload = c.req.valid("json");
    const setPayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (payload.name) setPayload.name = payload.name;
    if (payload.permissions) {
      setPayload.permissions = JSON.stringify(payload.permissions);
    }

    const updated = await db
      .update(adminRoles)
      .set(setPayload)
      .where(eq(adminRoles.key, key))
      .returning({ key: adminRoles.key });
    if (updated.length === 0) {
      return c.json({ error: "角色不存在" }, 404);
    }

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.role.update",
      resource: "admin.role",
      resourceId: key,
      result: "success",
      traceId: context.traceId,
      details: {
        updatedFields: Object.keys(payload),
        next: {
          name: payload.name,
          permissions: payload.permissions,
        },
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

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

    const deleted = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(adminRoles)
        .where(eq(adminRoles.key, key))
        .returning({ key: adminRoles.key });
      if (rows.length === 0) {
        return null;
      }

      await tx.delete(adminUserRoles).where(eq(adminUserRoles.roleKey, key));
      const revokedSessions = await tx
        .delete(adminSessions)
        .where(eq(adminSessions.roleKey, key))
        .returning({ id: adminSessions.id });

      return {
        revokedSessionCount: revokedSessions.length,
      };
    });
    if (!deleted) {
      return c.json({ error: "角色不存在" }, 404);
    }

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.role.delete",
      resource: "admin.role",
      resourceId: key,
      result: "success",
      traceId: context.traceId,
      details: {
        key,
        revokedSessionCount: deleted.revokedSessionCount,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

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

    if (id === "default") {
      return c.json({ error: "租户已存在" }, 409);
    }

    const inserted = await db
      .insert(tenants)
      .values({
        id,
        name: payload.name,
        status: payload.status || "active",
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing()
      .returning({ id: tenants.id });
    if (inserted.length === 0) {
      return c.json({ error: "租户已存在" }, 409);
    }

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.tenant.create",
      resource: "tenant",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        id,
        name: payload.name,
        status: payload.status || "active",
      },
      ip: context.ip,
      userAgent: context.userAgent,
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
    if (id === "default" && payload.status === "disabled") {
      return c.json({ error: "默认租户不可禁用" }, 400);
    }

    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (payload.name) updatePayload.name = payload.name;
    if (payload.status) updatePayload.status = payload.status;

    const updated = await db
      .update(tenants)
      .set(updatePayload)
      .where(eq(tenants.id, id))
      .returning({ id: tenants.id });
    if (updated.length === 0) {
      return c.json({ error: "租户不存在" }, 404);
    }

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.tenant.update",
      resource: "tenant",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        updatedFields: Object.keys(payload),
        next: {
          name: payload.name,
          status: payload.status,
        },
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

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

    const deleted = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(tenants)
        .where(eq(tenants.id, id))
        .returning({ id: tenants.id });
      if (rows.length === 0) {
        return null;
      }

      await tx.delete(adminUserTenants).where(eq(adminUserTenants.tenantId, id));
      await tx.delete(adminUserRoles).where(eq(adminUserRoles.tenantId, id));
      const revokedSessions = await tx
        .delete(adminSessions)
        .where(eq(adminSessions.tenantId, id))
        .returning({ id: adminSessions.id });

      return {
        revokedSessionCount: revokedSessions.length,
      };
    });
    if (!deleted) {
      return c.json({ error: "租户不存在" }, 404);
    }

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.tenant.delete",
      resource: "tenant",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        id,
        revokedSessionCount: deleted.revokedSessionCount,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

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

function normalizeTenantId(value: string) {
  return value.trim().toLowerCase();
}

async function collectMissingRoles(roleKeys: string[]): Promise<string[]> {
  const normalized = Array.from(
    new Set(roleKeys.map((item) => item.trim().toLowerCase()).filter(Boolean)),
  );
  if (normalized.length === 0) return [];

  const existing = new Set(RBAC_ROLES.map((item) => item.key));
  try {
    const rows = await db
      .select({ key: adminRoles.key })
      .from(adminRoles)
      .where(inArray(adminRoles.key, normalized));
    for (const row of rows) {
      existing.add(row.key);
    }
  } catch {
    // 忽略数据库异常，使用内置角色兜底。
  }
  return normalized.filter((item) => !existing.has(item));
}

async function collectMissingTenants(tenantIds: string[]): Promise<string[]> {
  const normalized = Array.from(
    new Set(tenantIds.map((item) => normalizeTenantId(item)).filter(Boolean)),
  );
  if (normalized.length === 0) return [];

  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(inArray(tenants.id, normalized));
  const existing = new Set(rows.map((item) => item.id));
  return normalized.filter((item) => !existing.has(item));
}

async function collectMissingUsers(usernames: string[]): Promise<string[]> {
  const normalized = Array.from(
    new Set(usernames.map((item) => item.trim()).filter(Boolean)),
  );
  if (normalized.length === 0) return [];

  const rows = await db
    .select({ username: adminUsers.username })
    .from(adminUsers)
    .where(inArray(adminUsers.username, normalized));
  const existing = new Set(rows.map((item) => item.username));
  return normalized.filter((item) => !existing.has(item));
}

async function getAdminUserById(userId: string) {
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, userId))
    .limit(1);
  return rows[0] || null;
}

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
    const roleKey = payload.roleKey.trim().toLowerCase();
    const tenantId = normalizeTenantId(payload.tenantId);

    const [missingRoles, missingTenants] = await Promise.all([
      collectMissingRoles([roleKey]),
      collectMissingTenants([tenantId]),
    ]);
    if (missingRoles.length > 0) {
      return c.json(
        { error: `角色不存在: ${missingRoles.join(", ")}` },
        404,
      );
    }
    if (missingTenants.length > 0) {
      return c.json(
        { error: `租户不存在: ${missingTenants.join(", ")}` },
        404,
      );
    }

    const passwordHash = await Bun.password.hash(payload.password, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 2,
    });

    try {
      await db.insert(adminUsers).values({
        id: userId,
        username: payload.username.trim().toLowerCase(),
        passwordHash,
        displayName: payload.displayName || null,
        status: payload.status || "active",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } catch (error: any) {
      const message = String(error?.message || "");
      const causeMessage = String(error?.cause?.message || "");
      const constraint = String(error?.cause?.constraint || error?.constraint || "");
      if (
        constraint === "admin_users_username_unique_idx" ||
        message.includes("admin_users_username_unique_idx") ||
        causeMessage.includes("admin_users_username_unique_idx") ||
        message.includes("UNIQUE constraint failed: admin_users.username") ||
        causeMessage.includes("UNIQUE constraint failed: admin_users.username")
      ) {
        return c.json({ error: "用户名已存在" }, 409);
      }
      throw error;
    }

    await db
      .insert(adminUserRoles)
      .values({
        userId,
        roleKey,
        tenantId,
        createdAt: nowIso,
      })
      .onConflictDoNothing();

    await db
      .insert(adminUserTenants)
      .values({
        userId,
        tenantId,
        createdAt: nowIso,
      })
      .onConflictDoNothing();

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.user.create",
      resource: "admin.user",
      resourceId: userId,
      result: "success",
      traceId: context.traceId,
      details: {
        username: payload.username.trim().toLowerCase(),
        roleKey,
        tenantId,
        status: payload.status || "active",
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, id: userId, traceId: context.traceId });
  },
);

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  password: z.string().min(8).optional(),
  roleKey: z.string().trim().min(1).optional(),
  tenantId: z.string().trim().min(1).optional(),
  roleBindings: z
    .array(
      z.object({
        roleKey: z.string().trim().min(1),
        tenantId: z.string().trim().min(1).optional(),
      }),
    )
    .optional(),
  tenantIds: z.array(z.string().trim().min(1)).optional(),
});

enterprise.put(
  "/users/:id",
  requirePermission("admin.users.manage"),
  zValidator("json", updateUserSchema),
  async (c) => {
    const userId = c.req.param("id").trim();
    const payload = c.req.valid("json");
    const traceId = getRequestTraceId(c);
    const currentUser = await getAdminUserById(userId);
    if (!currentUser) {
      return c.json({ error: "用户不存在", traceId }, 404);
    }

    if (Array.isArray(payload.roleBindings) && payload.roleBindings.length === 0) {
      return c.json({ error: "roleBindings 至少需要一个绑定项", traceId }, 400);
    }
    if (Array.isArray(payload.tenantIds) && payload.tenantIds.length === 0) {
      return c.json({ error: "tenantIds 至少需要一个租户", traceId }, 400);
    }

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

    const hasRoleBindingPayload =
      Array.isArray(payload.roleBindings) ||
      Boolean(payload.roleKey) ||
      Boolean(payload.tenantId);
    const hasTenantBindingPayload =
      Array.isArray(payload.tenantIds) || hasRoleBindingPayload;
    const nowIso = new Date().toISOString();
    const existingRoleBindings = await db
      .select()
      .from(adminUserRoles)
      .where(eq(adminUserRoles.userId, userId));
    const existingTenantBindings = await db
      .select()
      .from(adminUserTenants)
      .where(eq(adminUserTenants.userId, userId));

    const nextRoleBindings =
      hasRoleBindingPayload
        ? Array.isArray(payload.roleBindings) && payload.roleBindings.length > 0
          ? payload.roleBindings.map((item) => ({
              roleKey: item.roleKey.trim().toLowerCase(),
              tenantId: normalizeTenantId(item.tenantId || "default"),
            }))
          : [
              {
                roleKey: (payload.roleKey || "operator").trim().toLowerCase(),
                tenantId: normalizeTenantId(payload.tenantId || "default"),
              },
            ]
        : [];
    const effectiveRoleBindings =
      hasRoleBindingPayload
        ? nextRoleBindings
        : existingRoleBindings.map((item) => ({
            roleKey: item.roleKey.trim().toLowerCase(),
            tenantId: normalizeTenantId(item.tenantId || "default"),
          }));
    if (effectiveRoleBindings.length === 0) {
      return c.json({ error: "用户至少需要一个角色绑定", traceId }, 400);
    }

    const roleBindingKeyCounts = new Map<string, number>();
    for (const binding of effectiveRoleBindings) {
      const key = `${binding.roleKey}@@${(binding.tenantId || "default").trim()}`;
      roleBindingKeyCounts.set(key, (roleBindingKeyCounts.get(key) || 0) + 1);
    }
    const duplicateRoleBindingKeys = Array.from(roleBindingKeyCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key);
    if (duplicateRoleBindingKeys.length > 0) {
      return c.json(
        { error: `roleBindings 存在重复绑定: ${duplicateRoleBindingKeys.join(", ")}`, traceId },
        409,
      );
    }

    const tenantIds =
      hasTenantBindingPayload
        ? Array.isArray(payload.tenantIds) && payload.tenantIds.length > 0
          ? payload.tenantIds.map((item) => normalizeTenantId(item))
          : nextRoleBindings.length > 0
            ? nextRoleBindings.map((item) => item.tenantId || "default")
            : [normalizeTenantId(payload.tenantId || "default")]
        : [];
    const uniqueTenantIds = Array.from(
      new Set(tenantIds.map((item) => normalizeTenantId(item)).filter(Boolean)),
    );
    const effectiveTenantIds =
      hasTenantBindingPayload
        ? uniqueTenantIds
        : Array.from(
            new Set(
              existingTenantBindings
                .map((item) => normalizeTenantId(item.tenantId))
                .filter(Boolean),
            ),
          );
    if (effectiveTenantIds.length === 0) {
      return c.json({ error: "用户至少需要一个租户绑定", traceId }, 400);
    }

    const [missingRoles, missingTenants] = await Promise.all([
      effectiveRoleBindings.length > 0
        ? collectMissingRoles(effectiveRoleBindings.map((item) => item.roleKey))
        : Promise.resolve([]),
      effectiveTenantIds.length > 0
        ? collectMissingTenants(effectiveTenantIds)
        : Promise.resolve([]),
    ]);
    if (missingRoles.length > 0) {
      return c.json(
        { error: `角色不存在: ${missingRoles.join(", ")}`, traceId },
        404,
      );
    }
    if (missingTenants.length > 0) {
      return c.json(
        { error: `租户不存在: ${missingTenants.join(", ")}`, traceId },
        404,
      );
    }
    const danglingRoleTenants = Array.from(
      new Set(
        effectiveRoleBindings
          .map((item) => normalizeTenantId(item.tenantId || "default"))
          .filter((tenantId) => !effectiveTenantIds.includes(tenantId)),
      ),
    );
    if (danglingRoleTenants.length > 0) {
      return c.json(
        { error: `角色绑定租户不在 tenantIds 中: ${danglingRoleTenants.join(", ")}`, traceId },
        409,
      );
    }

    await db.update(adminUsers).set(userSet).where(eq(adminUsers.id, userId));

    let revokedSessionCount = 0;

    if (hasRoleBindingPayload) {
      await db.delete(adminUserRoles).where(eq(adminUserRoles.userId, userId));
      for (const binding of nextRoleBindings) {
        await db
          .insert(adminUserRoles)
          .values({
            userId,
            roleKey: binding.roleKey,
            tenantId: binding.tenantId,
            createdAt: nowIso,
          })
          .onConflictDoNothing();
      }
    }

    if (hasTenantBindingPayload) {
      await db.delete(adminUserTenants).where(eq(adminUserTenants.userId, userId));
      for (const tenantId of effectiveTenantIds) {
        await db
          .insert(adminUserTenants)
          .values({
            userId,
            tenantId,
            createdAt: nowIso,
          })
          .onConflictDoNothing();
      }
    }

    if (hasRoleBindingPayload || hasTenantBindingPayload) {
      const revokedSessions = await db
        .delete(adminSessions)
        .where(eq(adminSessions.userId, userId))
        .returning({ id: adminSessions.id });
      revokedSessionCount = revokedSessions.length;
    }

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.user.update",
      resource: "admin.user",
      resourceId: userId,
      result: "success",
      traceId: context.traceId,
      details: {
        username: currentUser.username,
        updatedFields: Object.keys(payload),
        roleBindingsChanged: hasRoleBindingPayload,
        tenantBindingsChanged: hasTenantBindingPayload,
        revokedSessionCount,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, traceId: context.traceId });
  },
);

enterprise.delete(
  "/users/:id",
  requirePermission("admin.users.manage"),
  async (c) => {
    const userId = c.req.param("id").trim();
    const currentUser = await getAdminUserById(userId);
    if (!currentUser) {
      return c.json({ error: "用户不存在" }, 404);
    }

    await db.delete(adminSessions).where(eq(adminSessions.userId, userId));
    await db.delete(adminUserRoles).where(eq(adminUserRoles.userId, userId));
    await db.delete(adminUserTenants).where(eq(adminUserTenants.userId, userId));
    await db.delete(adminUsers).where(eq(adminUsers.id, userId));

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.user.delete",
      resource: "admin.user",
      resourceId: userId,
      result: "success",
      traceId: context.traceId,
      details: {
        username: currentUser.username,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, traceId: context.traceId });
  },
);

const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  action: z.string().trim().min(1).optional(),
  resource: z.string().trim().min(1).optional(),
  resourceId: z.string().trim().min(1).optional(),
  result: z.enum(["success", "failure"]).optional(),
  keyword: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  policyId: z.string().trim().min(1).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});

const auditExportQuerySchema = auditQuerySchema
  .omit({
    page: true,
    pageSize: true,
  })
  .extend({
    limit: z.coerce.number().int().positive().max(5000).optional(),
  });

enterprise.get(
  "/audit/events",
  requirePermission("admin.audit.read"),
  zValidator("query", auditQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
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

enterprise.get(
  "/audit/export",
  requirePermission("admin.audit.read"),
  zValidator("query", auditExportQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const limit = Math.min(Math.max(query.limit || 1000, 1), 5000);
      const result = await queryAuditEvents({
        ...query,
        page: 1,
        pageSize: limit,
      });
      const csv = buildAuditEventsCsv(result.data);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="audit-events-${timestamp}.csv"`,
      );
      return c.body(csv);
    } catch (error: any) {
      return c.json(
        { error: "审计事件导出失败，请稍后重试。", details: error?.message },
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
      const context = getAuditRequestContext(c);

      await writeAuditEvent({
        actor: context.actor,
        action: payload.action,
        resource: payload.resource,
        resourceId: payload.resourceId,
        result: payload.result,
        traceId: context.traceId,
        details: payload.details,
        ip: context.ip,
        userAgent: context.userAgent,
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

async function validateQuotaPolicyScope(
  scopeType: "global" | "tenant" | "role" | "user",
  scopeValueInput?: string,
): Promise<{
  ok: true;
  scopeValue?: string;
} | {
  ok: false;
  status: 400 | 404;
  error: string;
}> {
  const scopeValue = (scopeValueInput || "").trim();

  if (scopeType === "global") {
    if (scopeValue) {
      return {
        ok: false,
        status: 400,
        error: "scopeType=global 时不允许提供 scopeValue",
      };
    }
    return { ok: true, scopeValue: undefined };
  }

  if (!scopeValue) {
    return {
      ok: false,
      status: 400,
      error: `scopeType=${scopeType} 时必须提供 scopeValue`,
    };
  }

  if (scopeType === "tenant") {
    const tenantId = normalizeTenantId(scopeValue);
    const missingTenants = await collectMissingTenants([tenantId]);
    if (missingTenants.length > 0) {
      return {
        ok: false,
        status: 404,
        error: `租户不存在: ${missingTenants.join(", ")}`,
      };
    }
    return { ok: true, scopeValue: tenantId };
  }

  if (scopeType === "role") {
    const roleKey = scopeValue.toLowerCase();
    const missingRoles = await collectMissingRoles([roleKey]);
    if (missingRoles.length > 0) {
      return {
        ok: false,
        status: 404,
        error: `角色不存在: ${missingRoles.join(", ")}`,
      };
    }
    return { ok: true, scopeValue: roleKey };
  }

  if (scopeType === "user") {
    const missingUsers = await collectMissingUsers([scopeValue]);
    if (missingUsers.length > 0) {
      return {
        ok: false,
        status: 404,
        error: `用户不存在: ${missingUsers.join(", ")}`,
      };
    }
    return { ok: true, scopeValue };
  }

  return { ok: true, scopeValue };
}

enterprise.post(
  "/billing/policies",
  requirePermission("admin.billing.manage"),
  zValidator("json", quotaPolicySchema),
  async (c) => {
    const traceId = getRequestTraceId(c);
    const payload = c.req.valid("json");
    if (payload.id) {
      const currentPolicies = await listQuotaPolicies();
      if (currentPolicies.some((item) => item.id === payload.id)) {
        return c.json({ error: "策略已存在", traceId }, 409);
      }
    }
    const scopeValidation = await validateQuotaPolicyScope(
      payload.scopeType,
      payload.scopeValue,
    );
    if (!scopeValidation.ok) {
      return c.json(
        { error: scopeValidation.error, traceId },
        scopeValidation.status,
      );
    }
    const policy = await saveQuotaPolicy({
      ...payload,
      scopeValue: scopeValidation.scopeValue,
    });
    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.billing.policy.create",
      resource: "billing.policy",
      resourceId: policy.id,
      result: "success",
      traceId: context.traceId,
      details: {
        name: policy.name,
        scopeType: policy.scopeType,
        scopeValue: policy.scopeValue || null,
        provider: policy.provider || null,
        modelPattern: policy.modelPattern || null,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return c.json({ success: true, data: policy, traceId: context.traceId });
  },
);

enterprise.put(
  "/billing/policies/:id",
  requirePermission("admin.billing.manage"),
  zValidator("json", quotaPolicySchema.partial()),
  async (c) => {
    const traceId = getRequestTraceId(c);
    const id = c.req.param("id");
    const payload = c.req.valid("json");

    const currentList = await listQuotaPolicies();
    const current = currentList.find((item) => item.id === id);
    if (!current) {
      return c.json({ error: "策略不存在", traceId }, 404);
    }

    const merged = {
      ...current,
      ...payload,
      id,
    };

    const nextScopeType =
      (payload.scopeType || current.scopeType) as "global" | "tenant" | "role" | "user";
    const hasExplicitScopeValue = payload.scopeValue !== undefined;
    const nextScopeValue =
      hasExplicitScopeValue
        ? payload.scopeValue
        : nextScopeType === "global"
          ? undefined
          : (current.scopeValue || undefined);
    const scopeValidation = await validateQuotaPolicyScope(
      nextScopeType,
      nextScopeValue,
    );
    if (!scopeValidation.ok) {
      return c.json(
        { error: scopeValidation.error, traceId },
        scopeValidation.status,
      );
    }
    merged.scopeType = nextScopeType;
    merged.scopeValue = scopeValidation.scopeValue;

    const saved = await saveQuotaPolicy(merged);
    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.billing.policy.update",
      resource: "billing.policy",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        updatedFields: Object.keys(payload),
        current,
        next: saved,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return c.json({ success: true, data: saved, traceId: context.traceId });
  },
);

enterprise.delete(
  "/billing/policies/:id",
  requirePermission("admin.billing.manage"),
  async (c) => {
    const id = c.req.param("id");
    const context = getAuditRequestContext(c);
    const deleted = await deleteQuotaPolicy(id);
    if (!deleted) {
      return c.json({ error: "策略不存在", traceId: context.traceId }, 404);
    }
    await writeAuditEvent({
      actor: context.actor,
      action: "admin.billing.policy.delete",
      resource: "billing.policy",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        policyId: id,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return c.json({ success: true, traceId: context.traceId });
  },
);

const billingUsageQuerySchema = z.object({
  policyId: z.string().trim().min(1).optional(),
  bucketType: z.enum(["minute", "day"]).optional(),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  tenantId: z.string().trim().min(1).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

enterprise.get(
  "/billing/usage",
  requirePermission("admin.billing.manage"),
  zValidator("query", billingUsageQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) {
      return c.json(rangeError, 400);
    }
    const usage = await listQuotaUsage({
      policyId: query.policyId,
      bucketType: query.bucketType,
      provider: query.provider,
      model: query.model,
      tenantId: query.tenantId,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
      limit: query.limit,
    });
    return c.json(usage);
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

const routeExecutionPolicySchema = z.object({
  emitRouteHeaders: z.boolean().optional(),
  retryStatusCodes: z
    .array(z.coerce.number().int().min(100).max(599))
    .optional(),
  claudeFallbackStatusCodes: z
    .array(z.coerce.number().int().min(100).max(599))
    .optional(),
});

const routePoliciesPatchSchema = z.object({
  selection: selectionPolicySchema.optional(),
  execution: routeExecutionPolicySchema.optional(),
});

const oauthCallbackQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  provider: z.string().trim().min(1).optional(),
  status: z.enum(["success", "failure"]).optional(),
  source: z.enum(["aggregate", "manual"]).optional(),
  state: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});

const oauthCallbackExportQuerySchema = oauthCallbackQuerySchema
  .omit({
    page: true,
    pageSize: true,
  })
  .extend({
    limit: z.coerce.number().int().positive().max(5000).optional(),
  });

const oauthSessionEventsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  state: z.string().trim().min(1).optional(),
  provider: z.string().trim().min(1).optional(),
  flowType: z.enum(["auth_code", "device_code", "manual_key", "service_account"]).optional(),
  phase: z
    .enum(["pending", "waiting_callback", "waiting_device", "exchanging", "completed", "error"])
    .optional(),
  status: z.enum(["pending", "completed", "error"]).optional(),
  eventType: z.enum(["register", "set_phase", "complete", "mark_error"]).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});

const oauthSessionEventsByStateQuerySchema = oauthSessionEventsQuerySchema.omit({
  state: true,
});

const oauthSessionEventsExportQuerySchema = oauthSessionEventsQuerySchema
  .omit({
    page: true,
    pageSize: true,
  })
  .extend({
    limit: z.coerce.number().int().positive().max(5000).optional(),
  });

const claudeFallbackQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  mode: z.enum(["api_key", "bridge"]).optional(),
  phase: z.enum(["attempt", "success", "failure", "skipped"]).optional(),
  reason: z.enum(CLAUDE_FALLBACK_REASONS).optional(),
  traceId: z.string().trim().min(1).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});

const claudeFallbackTimeseriesQuerySchema = claudeFallbackQuerySchema
  .omit({
    page: true,
    pageSize: true,
  })
  .extend({
    step: z.enum(CLAUDE_FALLBACK_TIMESERIES_STEPS).optional(),
  });

enterprise.get(
  "/oauth/session-events",
  requirePermission("admin.oauth.manage"),
  zValidator("query", oauthSessionEventsQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await queryOAuthSessionEvents(query);
      return c.json(result);
    } catch (error: any) {
      return c.json(
        { error: "OAuth 会话事件查询失败，请先执行数据库迁移。", details: error?.message },
        500,
      );
    }
  },
);

enterprise.get(
  "/oauth/session-events/export",
  requirePermission("admin.oauth.manage"),
  zValidator("query", oauthSessionEventsExportQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const limit = Math.min(Math.max(query.limit || 1000, 1), 5000);
      const result = await queryOAuthSessionEvents({
        ...query,
        page: 1,
        pageSize: limit,
      });
      const csv = buildOAuthSessionEventsCsv(result.data);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="oauth-session-events-${timestamp}.csv"`,
      );
      return c.body(csv);
    } catch (error: any) {
      return c.json(
        { error: "OAuth 会话事件导出失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);

enterprise.get(
  "/oauth/session-events/:state",
  requirePermission("admin.oauth.manage"),
  zValidator("query", oauthSessionEventsByStateQuerySchema),
  async (c) => {
    try {
      const state = (c.req.param("state") || "").trim();
      if (!state) return c.json({ error: "缺少 state" }, 400);

      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await queryOAuthSessionEvents({
        ...query,
        state,
      });
      return c.json(result);
    } catch (error: any) {
      return c.json(
        { error: "OAuth 会话事件查询失败，请先执行数据库迁移。", details: error?.message },
        500,
      );
    }
  },
);

enterprise.get(
  "/oauth/callback-events",
  requirePermission("admin.oauth.manage"),
  zValidator("query", oauthCallbackQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) {
      return c.json(rangeError, 400);
    }
    const result = await oauthCallbackStore.list(query);
    return c.json(result);
  },
);

enterprise.get(
  "/oauth/callback-events/export",
  requirePermission("admin.oauth.manage"),
  zValidator("query", oauthCallbackExportQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) {
      return c.json(rangeError, 400);
    }

    const limit = Math.min(Math.max(query.limit || 1000, 1), 5000);
    const result = await oauthCallbackStore.list({
      ...query,
      page: 1,
      pageSize: limit,
    });
    const csv = buildOAuthCallbackEventsCsv(result.data);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="oauth-callback-events-${timestamp}.csv"`,
    );
    return c.body(csv);
  },
);

enterprise.get(
  "/oauth/callback-events/:state",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const state = (c.req.param("state") || "").trim();
    if (!state) return c.json({ error: "缺少 state" }, 400);

    const pageSize = Number.parseInt(c.req.query("pageSize") || "20", 10);
    const safePageSize = Number.isFinite(pageSize) ? Math.max(1, pageSize) : 20;
    const data = await oauthCallbackStore.listByState(state, safePageSize);
    const result = {
      data,
      page: 1,
      pageSize: safePageSize,
      total: data.length,
      totalPages: 1,
    };
    return c.json(result);
  },
);

enterprise.get(
  "/observability/claude-fallbacks",
  requirePermission("admin.oauth.manage"),
  zValidator("query", claudeFallbackQuerySchema),
  (c) => {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) {
      return c.json(rangeError, 400);
    }
    const result = listClaudeFallbackEvents(query);
    return c.json(result);
  },
);

enterprise.get(
  "/observability/claude-fallbacks/summary",
  requirePermission("admin.oauth.manage"),
  zValidator("query", claudeFallbackQuerySchema.partial()),
  (c) => {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) {
      return c.json(rangeError, 400);
    }
    const result = summarizeClaudeFallbackEvents(query);
    return c.json({ data: result });
  },
);

enterprise.get(
  "/observability/claude-fallbacks/timeseries",
  requirePermission("admin.oauth.manage"),
  zValidator("query", claudeFallbackTimeseriesQuerySchema),
  (c) => {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) {
      return c.json(rangeError, 400);
    }
    const result = summarizeClaudeFallbackTimeseries(query);
    return c.json(result);
  },
);

const oauthAlertEngineConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  warningRateThresholdBps: z.coerce.number().int().min(1).max(10000).optional(),
  warningFailureCountThreshold: z.coerce.number().int().min(1).optional(),
  criticalRateThresholdBps: z.coerce.number().int().min(1).max(10000).optional(),
  criticalFailureCountThreshold: z.coerce.number().int().min(1).optional(),
  recoveryRateThresholdBps: z.coerce.number().int().min(0).max(10000).optional(),
  recoveryFailureCountThreshold: z.coerce.number().int().min(0).optional(),
  dedupeWindowSec: z.coerce.number().int().min(0).max(86400).optional(),
  recoveryConsecutiveWindows: z.coerce.number().int().min(1).max(1000).optional(),
  windowSizeSec: z.coerce.number().int().min(60).max(86400).optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z
    .string()
    .trim()
    .regex(CLOCK_HHMM_PATTERN, "quietHoursStart 必须为 HH:mm")
    .optional(),
  quietHoursEnd: z
    .string()
    .trim()
    .regex(CLOCK_HHMM_PATTERN, "quietHoursEnd 必须为 HH:mm")
    .optional(),
  quietHoursTimezone: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => {
        try {
          Intl.DateTimeFormat("zh-CN", { timeZone: value }).format(new Date());
          return true;
        } catch {
          return false;
        }
      },
      "quietHoursTimezone 非法",
    )
    .optional(),
  muteProviders: z.array(z.string().trim().min(1)).max(200).optional(),
  minDeliverySeverity: z.enum(["warning", "critical"]).optional(),
});

const oauthAlertLegacyConfigPatchSchema = z.object({
  evaluationWindowMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  cooldownMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  callbackFailureRateThreshold: z.coerce.number().min(0).max(1).optional(),
  sessionErrorCountThreshold: z.coerce.number().int().min(1).optional(),
  notifyRecovery: z.boolean().optional(),
});

const oauthAlertIncidentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  incidentId: z.string().trim().min(1).max(128).regex(OAUTH_ALERT_INCIDENT_ID_PATTERN).optional(),
  provider: z.string().trim().min(1).optional(),
  phase: z.string().trim().min(1).optional(),
  severity: z.enum(["warning", "critical", "recovery"]).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});

const oauthAlertDeliveryListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  eventId: z.coerce.number().int().positive().optional(),
  incidentId: z.string().trim().min(1).max(128).regex(OAUTH_ALERT_INCIDENT_ID_PATTERN).optional(),
  provider: z.string().trim().min(1).optional(),
  phase: z.string().trim().min(1).optional(),
  severity: z.enum(["warning", "critical", "recovery"]).optional(),
  channel: z.enum(["webhook", "wecom"]).optional(),
  status: z.enum(["success", "failure", "sent", "failed"]).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});

const oauthAlertTestDeliveryBodySchema = z.object({
  eventId: z.coerce.number().int().positive().optional(),
  provider: z.string().trim().min(1).optional(),
  phase: z.string().trim().min(1).optional(),
  severity: z.enum(["warning", "critical", "recovery"]).optional(),
  totalCount: z.coerce.number().int().nonnegative().optional(),
  failureCount: z.coerce.number().int().nonnegative().optional(),
  failureRateBps: z.coerce.number().int().min(0).max(10000).optional(),
  message: z.string().trim().max(1024).optional(),
});

const genericJsonRecordSchema = z.record(z.string(), z.unknown());
const alertmanagerControlConfigSchema = z.object({
  global: genericJsonRecordSchema.optional(),
  route: genericJsonRecordSchema,
  receivers: z.array(genericJsonRecordSchema),
  inhibit_rules: z.array(genericJsonRecordSchema).optional(),
  mute_time_intervals: z.array(genericJsonRecordSchema).optional(),
  time_intervals: z.array(genericJsonRecordSchema).optional(),
  templates: z.array(z.string().trim().min(1)).optional(),
});
const alertmanagerControlConfigUpdateSchema = z
  .object({
    config: alertmanagerControlConfigSchema.optional(),
    comment: z.string().trim().max(200).optional(),
  })
  .passthrough();
const alertmanagerControlSyncBodySchema = z
  .object({
    reason: z.string().trim().max(200).optional(),
    comment: z.string().trim().max(200).optional(),
    config: alertmanagerControlConfigSchema.optional(),
  })
  .passthrough();
const alertmanagerControlHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});
const alertmanagerControlHistoryRollbackBodySchema = z
  .object({
    reason: z.string().trim().max(200).optional(),
    comment: z.string().trim().max(200).optional(),
  })
  .passthrough();
const agentLedgerOutboxQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  deliveryState: z.enum(AGENTLEDGER_DELIVERY_STATES).optional(),
  status: z.enum(AGENTLEDGER_RUNTIME_STATUSES).optional(),
  provider: z.string().trim().min(1).optional(),
  tenantId: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});
const agentLedgerOutboxSummaryQuerySchema = agentLedgerOutboxQuerySchema.omit({
  page: true,
  pageSize: true,
});
const agentLedgerOutboxExportQuerySchema = agentLedgerOutboxSummaryQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});
const agentLedgerReplayAuditQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  outboxId: z.coerce.number().int().positive().optional(),
  traceId: z.string().trim().min(1).optional(),
  operatorId: z.string().trim().min(1).optional(),
  result: z.enum(AGENTLEDGER_REPLAY_RESULTS).optional(),
  triggerSource: z.enum(AGENTLEDGER_REPLAY_TRIGGER_SOURCES).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});
const agentLedgerReplayAuditSummaryQuerySchema = agentLedgerReplayAuditQuerySchema.omit({
  page: true,
  pageSize: true,
});
const agentLedgerDeliveryAttemptQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  outboxId: z.coerce.number().int().positive().optional(),
  traceId: z.string().trim().min(1).optional(),
  source: z.enum(AGENTLEDGER_DELIVERY_ATTEMPT_SOURCES).optional(),
  result: z.enum(AGENTLEDGER_REPLAY_RESULTS).optional(),
  httpStatus: z.coerce.number().int().positive().optional(),
  errorClass: z.string().trim().min(1).optional(),
  from: optionalIsoDateTimeSchema,
  to: optionalIsoDateTimeSchema,
});
const agentLedgerDeliveryAttemptSummaryQuerySchema = agentLedgerDeliveryAttemptQuerySchema.omit({
  page: true,
  pageSize: true,
});
const agentLedgerTraceParamsSchema = z.object({
  traceId: z.string().trim().min(1),
});
const agentLedgerReplayBatchBodySchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(100),
});

function withOAuthAlertLegacyFields(data: Awaited<ReturnType<typeof getOAuthAlertConfig>>) {
  return {
    ...data,
    evaluationWindowMinutes: Math.max(1, Math.round(data.windowSizeSec / 60)),
    cooldownMinutes: Math.max(0, Math.round(data.dedupeWindowSec / 60)),
    callbackFailureRateThreshold: Number((data.warningRateThresholdBps / 10000).toFixed(4)),
    sessionErrorCountThreshold: data.warningFailureCountThreshold,
    notifyRecovery: data.recoveryConsecutiveWindows > 0,
    defaultChannel: config.oauthAlerts.wecomWebhookUrl ? "wecom" : "webhook",
    deliveryEndpoint:
      config.oauthAlerts.webhookUrl || config.oauthAlerts.wecomWebhookUrl || "",
  };
}

function parseQueryMs(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = parseIsoDateTime(value);
  return ms === null ? undefined : ms;
}

function buildOAuthAlertSyntheticIncidentId(params: {
  provider?: string | null;
  phase?: string | null;
  eventId?: number | null;
}) {
  const provider = String(params.provider || "").trim();
  const phase = String(params.phase || "").trim();
  const rawEventId = Number(params.eventId);
  const eventId = Number.isFinite(rawEventId) ? Math.floor(rawEventId) : null;
  if (provider && phase && typeof eventId === "number") {
    return `incident:${provider}:${phase}:${eventId}`;
  }
  if (typeof eventId === "number") {
    return `${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${eventId}`;
  }
  return null;
}

function normalizeOAuthAlertIncidentIdValue(
  incidentId: string | null | undefined,
  fallback?: {
    provider?: string | null;
    phase?: string | null;
    eventId?: number | null;
  },
) {
  const normalized = String(incidentId || "").trim();
  if (!normalized) {
    return buildOAuthAlertSyntheticIncidentId(fallback || {});
  }
  if (normalized.startsWith("incident:")) {
    return normalized;
  }
  if (OAUTH_ALERT_LEGACY_INCIDENT_ID_PATTERN.test(normalized)) {
    return `incident:${normalized}`;
  }
  if (OAUTH_ALERT_DELIVERY_LEGACY_INCIDENT_ID_PATTERN.test(normalized)) {
    return buildOAuthAlertSyntheticIncidentId(fallback || {});
  }
  return normalized;
}

function buildOAuthAlertIncidentIdQueryVariants(incidentId: string) {
  const normalized = incidentId.trim();
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const deliveryLegacyMatch = normalized.match(OAUTH_ALERT_DELIVERY_LEGACY_INCIDENT_ID_PATTERN);
  const syntheticLegacyMatch = normalized.match(/^incident:legacy:delivery:(\d+)$/);
  const incidentMatch = syntheticLegacyMatch
    ? null
    : normalized.match(/^incident:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):(\d+)$/);
  const legacyMatch = OAUTH_ALERT_LEGACY_INCIDENT_ID_PATTERN.test(normalized)
    ? normalized.match(/^([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):(\d+)$/)
    : null;

  if (incidentMatch) {
    const [, provider, phase, eventId] = incidentMatch;
    variants.add(`${provider}:${phase}:${eventId}`);
    variants.add(`legacy:${eventId}`);
    variants.add(`${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${eventId}`);
  }
  if (legacyMatch) {
    const [, provider, phase, eventId] = legacyMatch;
    variants.add(`incident:${provider}:${phase}:${eventId}`);
    variants.add(`legacy:${eventId}`);
    variants.add(`${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${eventId}`);
  }
  if (deliveryLegacyMatch) {
    variants.add(`${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${deliveryLegacyMatch[1]}`);
  }
  if (syntheticLegacyMatch) {
    variants.add(`legacy:${syntheticLegacyMatch[1]}`);
  }

  return [...variants];
}

async function handleGetOAuthAlertConfig(c: any) {
  try {
    const data = await getOAuthAlertConfig();
    return c.json({ data: withOAuthAlertLegacyFields(data) });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警配置读取失败", details: error?.message }, 500);
  }
}

async function handlePutOAuthAlertConfig(c: any) {
  try {
    const raw = await c.req.json().catch(() => ({}));
    const rawObject = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const rawKeys = Object.keys(rawObject);
    const modernKeys = new Set([
      "enabled",
      "warningRateThresholdBps",
      "warningFailureCountThreshold",
      "criticalRateThresholdBps",
      "criticalFailureCountThreshold",
      "recoveryRateThresholdBps",
      "recoveryFailureCountThreshold",
      "dedupeWindowSec",
      "recoveryConsecutiveWindows",
      "windowSizeSec",
      "quietHoursEnabled",
      "quietHoursStart",
      "quietHoursEnd",
      "quietHoursTimezone",
      "muteProviders",
      "minDeliverySeverity",
    ]);
    const legacyKeys = new Set([
      "evaluationWindowMinutes",
      "cooldownMinutes",
      "callbackFailureRateThreshold",
      "sessionErrorCountThreshold",
      "notifyRecovery",
    ]);
    const hasModernKey = rawKeys.some((key) => modernKeys.has(key));
    const hasLegacyKey = rawKeys.some((key) => legacyKeys.has(key));

    const patch: Record<string, unknown> = {};

    const parsedModern = oauthAlertEngineConfigPatchSchema.safeParse(raw);
    if (hasModernKey && parsedModern.success) {
      Object.assign(patch, parsedModern.data);
    }
    if (hasModernKey && !parsedModern.success) {
      return c.json({ error: "OAuth 告警配置参数非法" }, 400);
    }
    const parsedLegacy = oauthAlertLegacyConfigPatchSchema.safeParse(raw);
    if (hasLegacyKey && parsedLegacy.success) {
      const legacy = parsedLegacy.data;
      if (typeof legacy.evaluationWindowMinutes === "number") {
        patch.windowSizeSec = legacy.evaluationWindowMinutes * 60;
      }
      if (typeof legacy.cooldownMinutes === "number") {
        patch.dedupeWindowSec = legacy.cooldownMinutes * 60;
      }
      if (typeof legacy.callbackFailureRateThreshold === "number") {
        patch.warningRateThresholdBps = Math.round(legacy.callbackFailureRateThreshold * 10000);
      }
      if (typeof legacy.sessionErrorCountThreshold === "number") {
        patch.warningFailureCountThreshold = legacy.sessionErrorCountThreshold;
      }
      if (typeof legacy.notifyRecovery === "boolean" && !legacy.notifyRecovery) {
        patch.recoveryConsecutiveWindows = 1;
      }
    }
    if (hasLegacyKey && !parsedLegacy.success) {
      return c.json({ error: "OAuth 告警配置参数非法" }, 400);
    }
    if (rawKeys.length > 0 && !hasModernKey && !hasLegacyKey) {
      return c.json({ error: "OAuth 告警配置参数非法" }, 400);
    }

    const next = await updateOAuthAlertConfig(patch);
    return c.json({ success: true, data: withOAuthAlertLegacyFields(next) });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警配置更新失败", details: error?.message }, 500);
  }
}

async function handleGetOAuthAlertIncidents(c: any) {
  try {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) return c.json(rangeError, 400);

    const result = await queryOAuthAlertEvents({
      page: query.page,
      pageSize: query.pageSize,
      incidentId: query.incidentId,
      provider: query.provider,
      phase: query.phase,
      severity: query.severity,
      from: parseQueryMs(query.from),
      to: parseQueryMs(query.to),
    });
    return c.json({
      ...result,
      data: result.data.map((item) => ({
        ...item,
        incidentId:
          normalizeOAuthAlertIncidentIdValue(item.incidentId, {
            provider: item.provider,
            phase: item.phase,
            eventId: item.id,
          }) || item.incidentId,
      })),
    });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警事件查询失败", details: error?.message }, 500);
  }
}

async function handleGetOAuthAlertDeliveries(c: any) {
  try {
    const query = c.req.valid("query");
    const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
    if (rangeError) return c.json(rangeError, 400);

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.max(1, Math.min(200, query.pageSize || 20));
    const offset = (page - 1) * pageSize;
    const filters = [];

    if (query.eventId) filters.push(eq(oauthAlertDeliveries.eventId, query.eventId));
    if (query.incidentId) {
      const incidentIdVariants = buildOAuthAlertIncidentIdQueryVariants(query.incidentId);
      filters.push(
        inArray(
          oauthAlertDeliveries.incidentId,
          incidentIdVariants.length > 0 ? incidentIdVariants : [query.incidentId],
        ),
      );
    }
    if (query.channel) filters.push(eq(oauthAlertDeliveries.channel, query.channel));
    if (query.status) {
      const normalizedStatus =
        query.status === "sent" ? "success" : query.status === "failed" ? "failure" : query.status;
      filters.push(eq(oauthAlertDeliveries.status, normalizedStatus));
    }
    const fromMs = parseQueryMs(query.from);
    const toMs = parseQueryMs(query.to);
    if (typeof fromMs === "number") filters.push(gte(oauthAlertDeliveries.sentAt, fromMs));
    if (typeof toMs === "number") filters.push(lte(oauthAlertDeliveries.sentAt, toMs));
    if (query.provider) filters.push(eq(oauthAlertEvents.provider, query.provider));
    if (query.phase) filters.push(eq(oauthAlertEvents.phase, query.phase));
    if (query.severity) filters.push(eq(oauthAlertEvents.severity, query.severity));

    const whereClause = filters.length > 0 ? and(...filters) : undefined;
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(oauthAlertDeliveries)
      .leftJoin(oauthAlertEvents, eq(oauthAlertDeliveries.eventId, oauthAlertEvents.id))
      .where(whereClause);
    const total = Number(countRow?.count || 0);

    const rows = await db
      .select({
        id: oauthAlertDeliveries.id,
        eventId: oauthAlertDeliveries.eventId,
        incidentId: oauthAlertDeliveries.incidentId,
        eventIncidentId: oauthAlertEvents.incidentId,
        channel: oauthAlertDeliveries.channel,
        target: oauthAlertDeliveries.target,
        attempt: oauthAlertDeliveries.attempt,
        status: oauthAlertDeliveries.status,
        responseStatus: oauthAlertDeliveries.responseStatus,
        responseBody: oauthAlertDeliveries.responseBody,
        error: oauthAlertDeliveries.error,
        sentAt: oauthAlertDeliveries.sentAt,
        provider: oauthAlertEvents.provider,
        phase: oauthAlertEvents.phase,
        severity: oauthAlertEvents.severity,
      })
      .from(oauthAlertDeliveries)
      .leftJoin(oauthAlertEvents, eq(oauthAlertDeliveries.eventId, oauthAlertEvents.id))
      .where(whereClause)
      .orderBy(desc(oauthAlertDeliveries.sentAt), desc(oauthAlertDeliveries.id))
      .limit(pageSize)
      .offset(offset);

    const normalizedRows = rows.map((row) => {
      const { eventIncidentId, ...rest } = row;
      return {
        ...rest,
        incidentId:
          normalizeOAuthAlertIncidentIdValue(
            normalizeOAuthAlertIncidentIdValue(eventIncidentId, {
              provider: row.provider,
              phase: row.phase,
              eventId: row.eventId,
            }) || row.incidentId,
            {
              provider: row.provider,
              phase: row.phase,
              eventId: row.eventId,
            },
          ) || `${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${row.eventId}`,
      };
    });

    return c.json({
      data: normalizedRows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警投递记录查询失败", details: error?.message }, 500);
  }
}

async function handleEvaluateOAuthAlerts(c: any) {
  try {
    const result = await evaluateOAuthSessionAlerts();
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警评估失败", details: error?.message }, 500);
  }
}

async function handleTestOAuthAlertDelivery(c: any) {
  try {
    const payload = c.req.valid("json");
    if (
      typeof payload.failureCount === "number" &&
      typeof payload.totalCount === "number" &&
      payload.failureCount > payload.totalCount
    ) {
      return c.json({ error: "failureCount 不能大于 totalCount" }, 400);
    }

    let eventRow:
      | {
          id: number;
          incidentId: string;
          provider: string;
          phase: string;
          severity: string;
          totalCount: number;
          failureCount: number;
          failureRateBps: number;
          windowStart: number;
          windowEnd: number;
          message: string | null;
          createdAt: number;
        }
      | null = null;

    if (payload.eventId) {
      const rows = await db
        .select()
        .from(oauthAlertEvents)
        .where(eq(oauthAlertEvents.id, payload.eventId))
        .limit(1);
      eventRow = rows[0] || null;
      if (!eventRow) {
        return c.json({ error: "eventId 不存在" }, 404);
      }
    } else {
      const now = Date.now();
      const totalCount = payload.totalCount ?? 100;
      const failureCount = payload.failureCount ?? 25;
      const failureRateBps =
        payload.failureRateBps ??
        (totalCount > 0 ? Math.floor((failureCount * 10000) / totalCount) : 0);
      const provider = payload.provider || "manual";
      const phase = payload.phase || "error";
      const severity = payload.severity || "warning";
      const incidentId = await resolveOAuthAlertIncidentId({
        provider,
        phase,
        severity,
      });
      const [created] = await db
        .insert(oauthAlertEvents)
        .values({
          incidentId,
          provider,
          phase,
          severity,
          totalCount,
          failureCount,
          failureRateBps,
          windowStart: now - 5 * 60 * 1000,
          windowEnd: now,
          statusBreakdown: JSON.stringify({
            error: failureCount,
            completed: Math.max(0, totalCount - failureCount),
          }),
          dedupeKey: `manual-test:${now}`,
          message: payload.message || "manual delivery test",
          createdAt: now,
        })
        .returning();
      if (!created) {
        return c.json({ error: "创建测试告警事件失败" }, 500);
      }
      eventRow = created;
    }

    const normalizedIncidentId =
      normalizeOAuthAlertIncidentIdValue(eventRow.incidentId, {
        provider: eventRow.provider,
        phase: eventRow.phase,
        eventId: eventRow.id,
      }) || eventRow.incidentId;

    const alertConfig = await getOAuthAlertConfig();
    const summary = await deliverOAuthAlertEvent(
      {
        id: eventRow.id,
        incidentId: normalizedIncidentId,
        provider: eventRow.provider,
        phase: eventRow.phase,
        severity: eventRow.severity as "warning" | "critical" | "recovery",
        totalCount: eventRow.totalCount,
        failureCount: eventRow.failureCount,
        failureRateBps: eventRow.failureRateBps,
        windowStart: eventRow.windowStart,
        windowEnd: eventRow.windowEnd,
        message: eventRow.message,
        createdAt: eventRow.createdAt,
      },
      buildOAuthAlertDeliveryControl(alertConfig),
    );
    const deliveries = await listOAuthAlertDeliveries({
      eventId: eventRow.id,
      limit: 20,
    });
    return c.json({
      success: true,
      data: {
        summary,
        event: {
          ...eventRow,
          incidentId: normalizedIncidentId,
        },
        deliveries: deliveries.map((item) => ({
          ...item,
          incidentId:
            normalizeOAuthAlertIncidentIdValue(item.incidentId, {
              provider: eventRow.provider,
              phase: eventRow.phase,
              eventId: item.eventId,
            }) || `${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${item.eventId}`,
        })),
      },
    });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警测试投递失败", details: error?.message }, 500);
  }
}

function resolveAlertmanagerConfigFromPayload(
  payload: Record<string, unknown>,
) {
  const validateResolvedConfig = (
    value: unknown,
  ): AlertmanagerControlConfig | null => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    const route =
      candidate.route && typeof candidate.route === "object"
        ? (candidate.route as Record<string, unknown>)
        : null;
    if (!route || typeof route.receiver !== "string" || route.receiver.trim().length === 0) {
      return null;
    }
    if (!Array.isArray(candidate.receivers) || candidate.receivers.length === 0) {
      return null;
    }
    const validReceivers = candidate.receivers.every((item) => {
      if (!item || typeof item !== "object") return false;
      const name = (item as Record<string, unknown>).name;
      return typeof name === "string" && name.trim().length > 0;
    });
    if (!validReceivers) {
      return null;
    }
    return candidate as unknown as AlertmanagerControlConfig;
  };

  if (Object.prototype.hasOwnProperty.call(payload, "config")) {
    const candidate = payload.config;
    if (!candidate || typeof candidate !== "object") {
      return {
        provided: true,
        valid: false,
        data: null,
      } as const;
    }
    const parsed = alertmanagerControlConfigSchema.safeParse(candidate);
    return {
      provided: true,
      valid: parsed.success && Boolean(validateResolvedConfig(parsed.data)),
      data: parsed.success ? validateResolvedConfig(parsed.data) : null,
    } as const;
  }

  const hasTopLevelConfig = [
    "global",
    "route",
    "receivers",
    "inhibit_rules",
    "mute_time_intervals",
    "time_intervals",
    "templates",
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));

  const parsed = alertmanagerControlConfigSchema.safeParse(payload);
  return {
    provided: hasTopLevelConfig,
    valid: parsed.success && Boolean(validateResolvedConfig(parsed.data)),
    data: parsed.success ? validateResolvedConfig(parsed.data) : null,
  } as const;
}

async function handleGetOAuthAlertRuleActive(c: any) {
  try {
    const active = await getActiveOAuthAlertRuleVersion();
    return c.json({ data: active });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警规则读取失败", details: error?.message }, 500);
  }
}

async function handleListOAuthAlertRuleVersions(c: any) {
  try {
    const query = c.req.valid("query");
    const result = await listOAuthAlertRuleVersions(query);
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: "OAuth 告警规则版本查询失败", details: error?.message }, 500);
  }
}

async function handleCreateOAuthAlertRuleVersion(c: any) {
  try {
    const payload = c.req.valid("json");
    const context = getAuditRequestContext(c);
    const created = await createOAuthAlertRuleVersion({
      payload,
      actor: context.actor,
    });
    if (!created) {
      return c.json({ error: "创建 OAuth 告警规则版本失败" }, 500);
    }

    await writeAuditEvent({
      actor: context.actor,
      action: "oauth.alert.rules.version.create",
      resource: "oauth.alert.rules.version",
      resourceId: String(created.id),
      result: "success",
      traceId: context.traceId,
      details: {
        version: created.version,
        status: created.status,
        ruleCount: created.rules.length,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, data: created, traceId: context.traceId });
  } catch (error: any) {
    if (error instanceof OAuthAlertRuleVersionConflictError) {
      return c.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        409,
      );
    }
    return c.json({ error: "OAuth 告警规则版本创建失败", details: error?.message }, 500);
  }
}

async function handleRollbackOAuthAlertRuleVersion(c: any) {
  try {
    const rawVersionId = c.req.param("versionId");
    if (!/^[1-9]\d*$/.test(rawVersionId || "")) {
      return c.json({ error: "versionId 非法" }, 400);
    }

    const versionId = Number(rawVersionId);
    if (!Number.isSafeInteger(versionId) || versionId <= 0) {
      return c.json({ error: "versionId 非法" }, 400);
    }

    const context = getAuditRequestContext(c);
    const updated = await activateOAuthAlertRuleVersion(versionId);
    if (!updated) {
      return c.json({ error: "目标规则版本不存在" }, 404);
    }

    await writeAuditEvent({
      actor: context.actor,
      action: "oauth.alert.rules.version.rollback",
      resource: "oauth.alert.rules.version",
      resourceId: String(updated.id),
      result: "success",
      traceId: context.traceId,
      details: {
        version: updated.version,
        status: updated.status,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, data: updated, traceId: context.traceId });
  } catch (error: any) {
    return c.json({ error: "OAuth 告警规则版本回滚失败", details: error?.message }, 500);
  }
}

async function handleGetAlertmanagerControlConfig(c: any) {
  try {
    const data = await readAlertmanagerControlConfig();
    if (!data) {
      return c.json({ data: null });
    }
    return c.json({
      data: {
        ...data,
        config: maskAlertmanagerWebhookUrls(data.config),
      },
    });
  } catch (error: any) {
    return c.json({ error: "Alertmanager 配置读取失败", details: error?.message }, 500);
  }
}

async function handlePutAlertmanagerControlConfig(c: any) {
  const startedAtMs = Date.now();
  try {
    const payload = c.req.valid("json") as Record<string, unknown>;
    const resolved = resolveAlertmanagerConfigFromPayload(payload);
    if (!resolved.valid || !resolved.data) {
      observeAlertmanagerControlOperation(
        "config_update",
        "validation_error",
        startedAtMs,
      );
      return c.json({ error: "Alertmanager 配置参数非法" }, 400);
    }

    const context = getAuditRequestContext(c);
    const updated = await updateAlertmanagerControlConfig(resolved.data, {
      actor: context.actor,
      comment: typeof payload.comment === "string" ? payload.comment : undefined,
    });

    await writeAuditEvent({
      actor: context.actor,
      action: "oauth.alert.alertmanager.config.update",
      resource: "oauth.alert.alertmanager.config",
      resourceId: "active",
      result: "success",
      traceId: context.traceId,
      details: {
        version: updated.version,
        comment: updated.comment || null,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    observeAlertmanagerControlOperation("config_update", "success", startedAtMs);

    return c.json({
      success: true,
      data: {
        ...updated,
        config: maskAlertmanagerWebhookUrls(updated.config),
      },
      traceId: context.traceId,
    });
  } catch (error: any) {
    observeAlertmanagerControlOperation("config_update", "internal_error", startedAtMs);
    return c.json({ error: "Alertmanager 配置更新失败", details: error?.message }, 500);
  }
}

async function handleSyncAlertmanagerControlConfig(c: any) {
  const startedAtMs = Date.now();
  try {
    const payload = c.req.valid("json") as Record<string, unknown>;
    const context = getAuditRequestContext(c);
    const resolved = resolveAlertmanagerConfigFromPayload(payload);

    if (resolved.provided && !resolved.valid) {
      observeAlertmanagerControlOperation("sync", "validation_error", startedAtMs);
      return c.json({ error: "Alertmanager 配置参数非法" }, 400);
    }

    const resolvedConfig =
      resolved.data ||
      (await readAlertmanagerControlConfig())?.config ||
      null;
    if (!resolvedConfig) {
      observeAlertmanagerControlOperation("sync", "bad_request", startedAtMs);
      return c.json({ error: "缺少可同步的 Alertmanager 配置" }, 400);
    }

    const result = await syncAlertmanagerControlConfig(resolvedConfig, {
      actor: context.actor,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
      comment: typeof payload.comment === "string" ? payload.comment : undefined,
    });

    await writeAuditEvent({
      actor: context.actor,
      action: "oauth.alert.alertmanager.sync",
      resource: "oauth.alert.alertmanager.config",
      resourceId: "active",
      result: "success",
      traceId: context.traceId,
      details: {
        outcome: result.history.outcome,
        runtimeFilePath: result.runtimeFilePath,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    observeAlertmanagerControlOperation("sync", "success", startedAtMs);

    return c.json({
      success: true,
      data: {
        ...result,
        maskedConfig: maskAlertmanagerWebhookUrls(result.maskedConfig),
      },
      traceId: context.traceId,
    });
  } catch (error: any) {
    if (error instanceof AlertmanagerLockConflictError) {
      observeAlertmanagerControlOperation("sync", "conflict", startedAtMs);
      return c.json(
        {
          error: error.message,
          code: error.code || ALERTMANAGER_SYNC_IN_PROGRESS_CODE,
        },
        409,
      );
    }
    if (error instanceof AlertmanagerSyncError) {
      observeAlertmanagerControlOperation("sync", "sync_error", startedAtMs);
      return c.json(
        {
          error: error.message,
          rollbackSucceeded: error.rollbackSucceeded,
          rollbackError: error.rollbackError,
        },
        500,
      );
    }
    observeAlertmanagerControlOperation("sync", "internal_error", startedAtMs);
    return c.json({ error: "Alertmanager 同步失败", details: error?.message }, 500);
  }
}

async function handleListAlertmanagerControlHistory(c: any) {
  try {
    const query = c.req.valid("query");
    const result = await listAlertmanagerControlHistoryPage({
      limit: query.limit,
      page: query.page,
      pageSize: query.pageSize,
    });
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: "Alertmanager 同步历史查询失败", details: error?.message }, 500);
  }
}

async function handleRollbackAlertmanagerControlHistory(c: any) {
  const startedAtMs = Date.now();
  try {
    const historyId = String(c.req.param("historyId") || "").trim();
    if (!historyId) {
      observeAlertmanagerControlOperation("rollback", "bad_request", startedAtMs);
      return c.json({ error: "historyId 非法" }, 400);
    }

    const payload = c.req.valid("json");
    const context = getAuditRequestContext(c);
    const result = await rollbackAlertmanagerControlConfigByHistoryId(historyId, {
      actor: context.actor,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
      comment: typeof payload.comment === "string" ? payload.comment : undefined,
    });

    await writeAuditEvent({
      actor: context.actor,
      action: "oauth.alert.alertmanager.rollback",
      resource: "oauth.alert.alertmanager.config",
      resourceId: historyId,
      result: "success",
      traceId: context.traceId,
      details: {
        sourceHistoryId: result.sourceHistoryId,
        runtimeFilePath: result.runtimeFilePath,
        outcome: result.history.outcome,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    observeAlertmanagerControlOperation("rollback", "success", startedAtMs);

    return c.json({
      success: true,
      data: {
        ...result,
        maskedConfig: maskAlertmanagerWebhookUrls(result.maskedConfig),
      },
      traceId: context.traceId,
    });
  } catch (error: any) {
    if (error instanceof AlertmanagerLockConflictError) {
      observeAlertmanagerControlOperation("rollback", "conflict", startedAtMs);
      return c.json(
        {
          error: error.message,
          code: error.code || ALERTMANAGER_SYNC_IN_PROGRESS_CODE,
        },
        409,
      );
    }
    if (error instanceof AlertmanagerSyncError) {
      observeAlertmanagerControlOperation("rollback", "sync_error", startedAtMs);
      return c.json(
        {
          error: error.message,
          rollbackSucceeded: error.rollbackSucceeded,
          rollbackError: error.rollbackError,
        },
        500,
      );
    }
    const message = String(error?.message || "");
    if (
      message.includes("不存在") ||
      message.includes("缺少可回滚配置")
    ) {
      observeAlertmanagerControlOperation("rollback", "not_found", startedAtMs);
      return c.json({ error: message || "目标同步历史不存在" }, 404);
    }
    if (message.includes("historyId 非法")) {
      observeAlertmanagerControlOperation("rollback", "bad_request", startedAtMs);
      return c.json({ error: message }, 400);
    }
    observeAlertmanagerControlOperation("rollback", "internal_error", startedAtMs);
    return c.json({ error: "Alertmanager 同步历史回滚失败", details: error?.message }, 500);
  }
}

function normalizeCompatPath(path: string) {
  if (!path) return "/";
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function getOAuthAlertCompatMode() {
  const normalized = String(process.env.OAUTH_ALERT_COMPAT_MODE || "").trim().toLowerCase();
  return normalized === "enforce" ? "enforce" : "observe";
}

function resolveOAuthAlertCompatRouteKey(path: string) {
  const normalizedPath = normalizeCompatPath(path);
  if (normalizedPath.endsWith("/oauth/alerts/config")) {
    return "oauth_alerts.config";
  }
  if (normalizedPath.endsWith("/oauth/alerts/incidents")) {
    return "oauth_alerts.incidents";
  }
  if (normalizedPath.endsWith("/oauth/alerts/deliveries")) {
    return "oauth_alerts.deliveries";
  }
  if (normalizedPath.endsWith("/oauth/alerts/evaluate")) {
    return "oauth_alerts.evaluate";
  }
  if (normalizedPath.endsWith("/oauth/alerts/test-delivery")) {
    return "oauth_alerts.test_delivery";
  }
  if (normalizedPath.endsWith("/oauth/alerts/rules/active")) {
    return "oauth_alerts.rules_active";
  }
  if (normalizedPath.endsWith("/oauth/alerts/rules/versions")) {
    return "oauth_alerts.rules_versions";
  }
  if (/\/oauth\/alerts\/rules\/versions\/[^/]+\/rollback$/.test(normalizedPath)) {
    return "oauth_alerts.rules_rollback";
  }
  if (normalizedPath.endsWith("/oauth/alertmanager/config")) {
    return "oauth_alertmanager.config";
  }
  if (normalizedPath.endsWith("/oauth/alertmanager/sync")) {
    return "oauth_alertmanager.sync";
  }
  if (normalizedPath.endsWith("/oauth/alertmanager/sync-history")) {
    return "oauth_alertmanager.sync_history";
  }
  if (/\/oauth\/alertmanager\/sync-history\/[^/]+\/rollback$/.test(normalizedPath)) {
    return "oauth_alertmanager.sync_history_rollback";
  }
  return null;
}

function resolveOAuthAlertCompatSuccessorPath(path: string) {
  const normalizedPath = normalizeCompatPath(path);
  if (normalizedPath.startsWith("/api/admin/oauth/alerts")) {
    return normalizedPath.replace(
      "/api/admin/oauth/alerts",
      "/api/admin/observability/oauth-alerts",
    );
  }
  if (normalizedPath.startsWith("/api/admin/oauth/alertmanager")) {
    return normalizedPath.replace(
      "/api/admin/oauth/alertmanager",
      "/api/admin/observability/oauth-alerts/alertmanager",
    );
  }
  return "/api/admin/observability/oauth-alerts";
}

function applyOAuthAlertCompatHeaders(headers: Headers, successorPath: string) {
  headers.set("Deprecation", "true");
  headers.set("Sunset", OAUTH_ALERT_COMPAT_SUNSET_HEADER);
  headers.set("Link", `<${successorPath}>; rel="successor-version"`);
}

function buildOAuthAlertCompatGonePayload(successorPath: string) {
  return {
    error: "OAuth 告警兼容路径已下线",
    code: OAUTH_ALERT_COMPAT_GONE_CODE,
    deprecated: true,
    successorPath,
    deprecatedSince: OAUTH_ALERT_COMPAT_DEPRECATED_SINCE,
    compatibilityWindowEnd: OAUTH_ALERT_COMPATIBILITY_WINDOW_END,
    criticalAfter: OAUTH_ALERT_COMPAT_CRITICAL_AFTER,
    details: `请改用 ${successorPath}`,
  };
}

async function decorateOAuthAlertCompatObserveResponse(c: any, successorPath: string) {
  applyOAuthAlertCompatHeaders(c.res.headers, successorPath);

  const contentType = c.res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return;
  }

  const payload = await c.res.clone().json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }

  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  c.res = new Response(
    JSON.stringify({
      ...(payload as Record<string, unknown>),
      deprecated: true,
      successorPath,
    }),
    {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    },
  );
}

async function handleOAuthAlertCompatRequest(c: any, next: any) {
  const routeKey = resolveOAuthAlertCompatRouteKey(c.req.path);
  if (!routeKey) {
    await next();
    return;
  }

  oauthAlertCompatRouteCounter.labels(c.req.method, routeKey).inc();
  const successorPath = resolveOAuthAlertCompatSuccessorPath(c.req.path);
  if (getOAuthAlertCompatMode() === "enforce") {
    const response = c.json(buildOAuthAlertCompatGonePayload(successorPath), 410);
    applyOAuthAlertCompatHeaders(response.headers, successorPath);
    return response;
  }

  await next();
  await decorateOAuthAlertCompatObserveResponse(c, successorPath);
}

enterprise.get(
  "/observability/oauth-alerts/config",
  requireAdminRoles(["owner", "auditor"]),
  handleGetOAuthAlertConfig,
);
enterprise.put(
  "/observability/oauth-alerts/config",
  requireAdminRoles(["owner"]),
  handlePutOAuthAlertConfig,
);
enterprise.get(
  "/observability/oauth-alerts/incidents",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", oauthAlertIncidentListQuerySchema),
  handleGetOAuthAlertIncidents,
);
enterprise.get(
  "/observability/oauth-alerts/deliveries",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", oauthAlertDeliveryListQuerySchema),
  handleGetOAuthAlertDeliveries,
);
enterprise.post(
  "/observability/oauth-alerts/evaluate",
  requireAdminRoles(["owner"]),
  handleEvaluateOAuthAlerts,
);
enterprise.post(
  "/observability/oauth-alerts/test-delivery",
  requireAdminRoles(["owner"]),
  zValidator("json", oauthAlertTestDeliveryBodySchema),
  handleTestOAuthAlertDelivery,
);
enterprise.get(
  "/observability/oauth-alerts/rules/active",
  requireAdminRoles(["owner", "auditor"]),
  handleGetOAuthAlertRuleActive,
);
enterprise.get(
  "/observability/oauth-alerts/rules/versions",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", oauthAlertRuleVersionListQuerySchema),
  handleListOAuthAlertRuleVersions,
);
enterprise.post(
  "/observability/oauth-alerts/rules/versions",
  requireAdminRoles(["owner"]),
  zValidator("json", oauthAlertRuleVersionCreateSchema),
  handleCreateOAuthAlertRuleVersion,
);
enterprise.post(
  "/observability/oauth-alerts/rules/versions/:versionId/rollback",
  requireAdminRoles(["owner"]),
  handleRollbackOAuthAlertRuleVersion,
);
enterprise.get(
  "/observability/oauth-alerts/alertmanager/config",
  requireAdminRoles(["owner", "auditor"]),
  handleGetAlertmanagerControlConfig,
);
enterprise.put(
  "/observability/oauth-alerts/alertmanager/config",
  requireAdminRoles(["owner"]),
  zValidator("json", alertmanagerControlConfigUpdateSchema),
  handlePutAlertmanagerControlConfig,
);
enterprise.post(
  "/observability/oauth-alerts/alertmanager/sync",
  requireAdminRoles(["owner"]),
  zValidator("json", alertmanagerControlSyncBodySchema),
  handleSyncAlertmanagerControlConfig,
);
enterprise.get(
  "/observability/oauth-alerts/alertmanager/sync-history",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", alertmanagerControlHistoryQuerySchema),
  handleListAlertmanagerControlHistory,
);
enterprise.post(
  "/observability/oauth-alerts/alertmanager/sync-history/:historyId/rollback",
  requireAdminRoles(["owner"]),
  zValidator("json", alertmanagerControlHistoryRollbackBodySchema),
  handleRollbackAlertmanagerControlHistory,
);
enterprise.get(
  "/observability/agentledger-outbox",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", agentLedgerOutboxQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await listAgentLedgerOutbox({
        ...query,
        from: parseIsoDateTime(query.from) ?? undefined,
        to: parseIsoDateTime(query.to) ?? undefined,
      });
      return c.json(result);
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger outbox 查询失败，请先执行数据库迁移。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.get(
  "/observability/agentledger-outbox/summary",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", agentLedgerOutboxSummaryQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await summarizeAgentLedgerOutbox({
        ...query,
        from: parseIsoDateTime(query.from) ?? undefined,
        to: parseIsoDateTime(query.to) ?? undefined,
      });
      return c.json({ data: result });
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger outbox 汇总失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.get(
  "/observability/agentledger-outbox/health",
  requireAdminRoles(["owner", "auditor"]),
  async (c) => {
    try {
      const result = await getAgentLedgerOutboxHealth();
      return c.json({ data: result });
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger outbox 健康摘要加载失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.get(
  "/observability/agentledger-outbox/readiness",
  requireAdminRoles(["owner", "auditor"]),
  async (c) => {
    const result = await getAgentLedgerOutboxReadiness();
    return c.json({ data: result }, result.ready ? 200 : 503);
  },
);
enterprise.get(
  "/observability/agentledger-traces/:traceId",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("param", agentLedgerTraceParamsSchema),
  async (c) => {
    try {
      const params = c.req.valid("param");
      const result = await getAgentLedgerTraceDrilldown(params.traceId);
      if (!result) {
        return c.json({ error: "未找到对应 traceId 的 AgentLedger 联查记录" }, 404);
      }
      return c.json({ data: result });
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger trace 联查失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.get(
  "/observability/agentledger-delivery-attempts",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", agentLedgerDeliveryAttemptQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await listAgentLedgerDeliveryAttempts({
        ...query,
        from: parseIsoDateTime(query.from) ?? undefined,
        to: parseIsoDateTime(query.to) ?? undefined,
      });
      return c.json(result);
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger delivery attempts 查询失败，请先执行数据库迁移。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.get(
  "/observability/agentledger-delivery-attempts/summary",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", agentLedgerDeliveryAttemptSummaryQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await summarizeAgentLedgerDeliveryAttempts({
        ...query,
        from: parseIsoDateTime(query.from) ?? undefined,
        to: parseIsoDateTime(query.to) ?? undefined,
      });
      return c.json({ data: result });
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger delivery attempts 汇总失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.get(
  "/observability/agentledger-outbox/export",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", agentLedgerOutboxExportQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const limit = Math.min(Math.max(query.limit || 1000, 1), 5000);
      const result = await listAgentLedgerOutbox({
        ...query,
        page: 1,
        pageSize: limit,
        from: parseIsoDateTime(query.from) ?? undefined,
        to: parseIsoDateTime(query.to) ?? undefined,
      });
      const csv = buildAgentLedgerOutboxCsv(result.data);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="agentledger-outbox-${timestamp}.csv"`,
      );
      return c.body(csv);
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger outbox 导出失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.post(
  "/observability/agentledger-outbox/replay-batch",
  requireAdminRoles(["owner"]),
  zValidator("json", agentLedgerReplayBatchBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    const rawIds = (body.ids || []).map((id) => Math.floor(Number(id)));
    const ids = Array.from(new Set(rawIds));
    if (ids.length === 0) {
      return c.json({ error: "至少需要一个有效的 outbox id" }, 400);
    }

    const auditContext = getAuditRequestContext(c);
    const identity = getAdminIdentity(c);
    const operatorId = identity.userId || identity.username || auditContext.actor;
    const result = await replayAgentLedgerOutboxItemsBatch({
      ids: rawIds,
      operatorId,
      triggerSource: "batch_manual",
    });
    const traceIds = Array.from(
      new Set(
        result.items
          .map((item) => String(item.traceId || "").trim())
          .filter(Boolean),
      ),
    );
    const hasFailures =
      result.failureCount > 0 ||
      result.notFoundCount > 0 ||
      result.notConfiguredCount > 0;

    await writeAuditEvent({
      actor: auditContext.actor,
      action: "agentledger.outbox.replay_batch",
      resource: "agentledger.runtime.outbox",
      result: hasFailures ? "failure" : "success",
      traceId: auditContext.traceId,
      details: {
        requestedCount: result.requestedCount,
        processedCount: result.processedCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        notFoundCount: result.notFoundCount,
        notConfiguredCount: result.notConfiguredCount,
        traceIds,
      },
      ip: auditContext.ip,
      userAgent: auditContext.userAgent,
    });

    return c.json({
      success: !hasFailures,
      data: result,
      traceId: auditContext.traceId,
    });
  },
);
enterprise.post(
  "/observability/agentledger-outbox/:id/replay",
  requireAdminRoles(["owner"]),
  async (c) => {
    const id = Number.parseInt((c.req.param("id") || "").trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: "无效的 outbox id" }, 400);
    }

    const auditContext = getAuditRequestContext(c);
    const identity = getAdminIdentity(c);
    const operatorId = identity.userId || identity.username || auditContext.actor;
    const result = await replayAgentLedgerOutboxItem({
      id,
      operatorId,
      triggerSource: "manual",
    });

    await writeAuditEvent({
      actor: auditContext.actor,
      action: "agentledger.outbox.replay",
      resource: "agentledger.runtime.outbox",
      resourceId: `${id}`,
      result: result.ok ? "success" : "failure",
      traceId: auditContext.traceId,
      details: {
        replayResult: result.result || null,
        httpStatus: result.httpStatus ?? null,
        errorClass: result.errorClass ?? null,
        outboxId: result.item?.id ?? id,
        eventTraceId: result.item?.traceId || null,
        deliveryState: result.item?.deliveryState || null,
        idempotencyKey: result.item?.idempotencyKey || null,
      },
      ip: auditContext.ip,
      userAgent: auditContext.userAgent,
    });

    if (result.code === "not_found") {
      return c.json({ error: "未找到 AgentLedger outbox 记录" }, 404);
    }
    if (result.code === "not_configured") {
      return c.json(
        { error: "AgentLedger webhook 未配置", details: result.errorMessage, data: result.item },
        409,
      );
    }
    if (!result.ok) {
      return c.json(
        { error: "AgentLedger replay 失败", details: result.errorMessage, data: result.item },
        502,
      );
    }
    return c.json({
      success: true,
      data: result.item,
      traceId: auditContext.traceId,
    });
  },
);
enterprise.get(
  "/observability/agentledger-replay-audits",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", agentLedgerReplayAuditQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await listAgentLedgerReplayAudits({
        ...query,
        from: parseIsoDateTime(query.from) ?? undefined,
        to: parseIsoDateTime(query.to) ?? undefined,
      });
      return c.json(result);
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger replay 审计查询失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);
enterprise.get(
  "/observability/agentledger-replay-audits/summary",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", agentLedgerReplayAuditSummaryQuerySchema),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const rangeError = buildTimeRangeErrorResponse(query.from, query.to);
      if (rangeError) {
        return c.json(rangeError, 400);
      }
      const result = await summarizeAgentLedgerReplayAudits({
        ...query,
        from: parseIsoDateTime(query.from) ?? undefined,
        to: parseIsoDateTime(query.to) ?? undefined,
      });
      return c.json({ data: result });
    } catch (error: any) {
      return c.json(
        { error: "AgentLedger replay 审计汇总失败，请稍后重试。", details: error?.message },
        500,
      );
    }
  },
);

// 兼容前端早期路径：/oauth/alerts/*
enterprise.get(
  "/oauth/alerts/config",
  requireAdminRoles(["owner", "auditor"]),
  handleGetOAuthAlertConfig,
);
enterprise.put(
  "/oauth/alerts/config",
  requireAdminRoles(["owner"]),
  handlePutOAuthAlertConfig,
);
enterprise.get(
  "/oauth/alerts/incidents",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", oauthAlertIncidentListQuerySchema),
  handleGetOAuthAlertIncidents,
);
enterprise.get(
  "/oauth/alerts/deliveries",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", oauthAlertDeliveryListQuerySchema),
  handleGetOAuthAlertDeliveries,
);
enterprise.post(
  "/oauth/alerts/evaluate",
  requireAdminRoles(["owner"]),
  handleEvaluateOAuthAlerts,
);
enterprise.post(
  "/oauth/alerts/test-delivery",
  requireAdminRoles(["owner"]),
  zValidator("json", oauthAlertTestDeliveryBodySchema),
  handleTestOAuthAlertDelivery,
);
enterprise.get(
  "/oauth/alerts/rules/active",
  requireAdminRoles(["owner", "auditor"]),
  handleGetOAuthAlertRuleActive,
);
enterprise.get(
  "/oauth/alerts/rules/versions",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", oauthAlertRuleVersionListQuerySchema),
  handleListOAuthAlertRuleVersions,
);
enterprise.post(
  "/oauth/alerts/rules/versions",
  requireAdminRoles(["owner"]),
  zValidator("json", oauthAlertRuleVersionCreateSchema),
  handleCreateOAuthAlertRuleVersion,
);
enterprise.post(
  "/oauth/alerts/rules/versions/:versionId/rollback",
  requireAdminRoles(["owner"]),
  handleRollbackOAuthAlertRuleVersion,
);
enterprise.get(
  "/oauth/alertmanager/config",
  requireAdminRoles(["owner", "auditor"]),
  handleGetAlertmanagerControlConfig,
);
enterprise.put(
  "/oauth/alertmanager/config",
  requireAdminRoles(["owner"]),
  zValidator("json", alertmanagerControlConfigUpdateSchema),
  handlePutAlertmanagerControlConfig,
);
enterprise.post(
  "/oauth/alertmanager/sync",
  requireAdminRoles(["owner"]),
  zValidator("json", alertmanagerControlSyncBodySchema),
  handleSyncAlertmanagerControlConfig,
);
enterprise.get(
  "/oauth/alertmanager/sync-history",
  requireAdminRoles(["owner", "auditor"]),
  zValidator("query", alertmanagerControlHistoryQuerySchema),
  handleListAlertmanagerControlHistory,
);
enterprise.post(
  "/oauth/alertmanager/sync-history/:historyId/rollback",
  requireAdminRoles(["owner"]),
  zValidator("json", alertmanagerControlHistoryRollbackBodySchema),
  handleRollbackAlertmanagerControlHistory,
);

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
    const context = await writeSuccessAdminAuditEvent(c, {
      action: "oauth.selection.policy.update",
      resource: "oauth.selection.policy",
      resourceId: "active",
      details: {
        updatedFields: Object.keys(payload).sort(),
        config: data,
      },
    });
    return c.json({ success: true, data, traceId: context.traceId });
  },
);

enterprise.get(
  "/oauth/route-policies",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const [selection, execution] = await Promise.all([
      getOAuthSelectionConfig(),
      getRouteExecutionPolicy(),
    ]);
    return c.json({
      data: {
        selection,
        execution,
      },
    });
  },
);

enterprise.put(
  "/oauth/route-policies",
  requirePermission("admin.oauth.manage"),
  zValidator("json", routePoliciesPatchSchema),
  async (c) => {
    const payload = c.req.valid("json");
    const [selection, execution] = await Promise.all([
      payload.selection
        ? updateOAuthSelectionConfig(payload.selection)
        : getOAuthSelectionConfig(),
      payload.execution
        ? updateRouteExecutionPolicy(payload.execution)
        : getRouteExecutionPolicy(),
    ]);
    const context = await writeSuccessAdminAuditEvent(c, {
      action: "oauth.route.policies.update",
      resource: "oauth.route.policies",
      resourceId: "active",
      details: {
        updatedScopes: [
          ...(payload.selection ? ["selection"] : []),
          ...(payload.execution ? ["execution"] : []),
        ],
        selection,
        execution,
      },
    });
    return c.json({
      success: true,
      data: {
        selection,
        execution,
      },
      traceId: context.traceId,
    });
  },
);

enterprise.get(
  "/oauth/capability-map",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const data = await getCapabilityMap();
    const health = validateCapabilityRuntimeHealth(data);
    return c.json({ data, health });
  },
);

enterprise.put(
  "/oauth/capability-map",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const payload = await c.req.json().catch(() => ({}));
    const data = await updateCapabilityMap(payload);
    const health = validateCapabilityRuntimeHealth(data);
    const updatedProviders =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? Object.keys(payload as Record<string, unknown>).sort()
        : [];
    const context = await writeSuccessAdminAuditEvent(c, {
      action: "oauth.capability.map.update",
      resource: "oauth.capability.map",
      resourceId: "active",
      details: {
        updatedProviders,
        providerCount: Object.keys(data).length,
        healthOk: health.ok,
        issueCount: health.issueCount,
      },
    });
    return c.json({ success: true, data, health, traceId: context.traceId });
  },
);

enterprise.get(
  "/oauth/capability-health",
  requirePermission("admin.oauth.manage"),
  async (c) => {
    const capabilityMap = await getCapabilityMap();
    const health = validateCapabilityRuntimeHealth(capabilityMap);
    return c.json({ data: health });
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
    const context = await writeSuccessAdminAuditEvent(c, {
      action: "oauth.model.alias.update",
      resource: "oauth.model.alias",
      resourceId: ADMIN_MODEL_ALIAS_KEY,
      details: summarizeAliasAuditDetails(payload),
    });
    return c.json({ success: true, traceId: context.traceId });
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
    const context = await writeSuccessAdminAuditEvent(c, {
      action: "oauth.excluded.models.update",
      resource: "oauth.excluded.models",
      resourceId: ADMIN_EXCLUDED_MODELS_KEY,
      details: summarizeExcludedModelsAuditDetails(payload),
    });
    return c.json({ success: true, traceId: context.traceId });
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
