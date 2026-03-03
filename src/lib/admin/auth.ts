import crypto from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  adminRoles,
  adminSessions,
  adminUserRoles,
  adminUserTenants,
  adminUsers,
  tenants,
} from "../../db/schema";
import { config } from "../../config";
import { RBAC_ROLES } from "./rbac";

export interface AdminIdentity {
  authenticated: boolean;
  source: "session" | "header" | "none";
  userId?: string;
  username?: string;
  roleKey?: string;
  tenantId?: string;
  sessionId?: string;
}

interface AdminLoginResult {
  sessionId: string;
  expiresAt: number;
  user: {
    id: string;
    username: string;
    displayName?: string | null;
  };
  roleKey: string;
  tenantId?: string;
}

function nowMs(): number {
  return Date.now();
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function safeJsonStringify(input: unknown): string {
  try {
    return JSON.stringify(input || []);
  } catch {
    return "[]";
  }
}

export async function syncBuiltinRolesToDb() {
  const nowIso = new Date().toISOString();
  for (const role of RBAC_ROLES) {
    try {
      await db
        .insert(adminRoles)
        .values({
          key: role.key,
          name: role.name,
          permissions: safeJsonStringify(role.permissions),
          builtin: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: adminRoles.key,
          set: {
            name: role.name,
            permissions: safeJsonStringify(role.permissions),
            builtin: 1,
            updatedAt: nowIso,
          },
        });
    } catch {
      // ignore
    }
  }
}

async function ensureDefaultTenant() {
  const nowIso = new Date().toISOString();
  try {
    await db
      .insert(tenants)
      .values({
        id: "default",
        name: "默认租户",
        status: "active",
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing();
  } catch {
    // ignore
  }
}

async function ensureBootstrapAdmin() {
  const bootstrapPassword = config.admin.bootstrapPassword.trim();
  if (!bootstrapPassword) return;

  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(adminUsers);
  const count = Number(countRows[0]?.count || 0);
  if (count > 0) return;

  const nowIso = new Date().toISOString();
  const userId = crypto.randomUUID();
  const username = normalizeUsername(config.admin.bootstrapUsername);
  const passwordHash = await Bun.password.hash(bootstrapPassword, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 2,
  });

  await db.insert(adminUsers).values({
    id: userId,
    username,
    passwordHash,
    displayName: "系统管理员",
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await db
    .insert(adminUserRoles)
    .values({
      userId,
      roleKey: "owner",
      tenantId: "default",
      createdAt: nowIso,
    })
    .onConflictDoNothing();

  await db
    .insert(adminUserTenants)
    .values({
      userId,
      tenantId: "default",
      createdAt: nowIso,
    })
    .onConflictDoNothing();
}

export async function ensureAdminBootstrap() {
  try {
    await syncBuiltinRolesToDb();
    await ensureDefaultTenant();
    await ensureBootstrapAdmin();
  } catch (error) {
    console.warn("[Admin] 初始化管理员基础数据失败：", error);
  }
}

async function resolveUserRole(userId: string, tenantId?: string) {
  const allRoles = await db
    .select()
    .from(adminUserRoles)
    .where(eq(adminUserRoles.userId, userId));

  if (!allRoles.length) {
    return {
      roleKey: "owner",
      tenantId: tenantId || "default",
    };
  }

  if (tenantId) {
    const exact = allRoles.find((item) => item.tenantId === tenantId);
    if (exact) {
      return {
        roleKey: exact.roleKey,
        tenantId: exact.tenantId || tenantId,
      };
    }
  }

  const first = allRoles[0]!;
  return {
    roleKey: first.roleKey,
    tenantId: first.tenantId || tenantId || "default",
  };
}

export async function loginAdmin(
  usernameInput: string,
  password: string,
  tenantId?: string,
  ip?: string,
  userAgent?: string,
): Promise<AdminLoginResult | null> {
  const username = normalizeUsername(usernameInput);
  if (!username || !password) return null;

  const rows = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.username, username), eq(adminUsers.status, "active")))
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  const ok = await Bun.password.verify(password, user.passwordHash);
  if (!ok) return null;

  const role = await resolveUserRole(user.id, tenantId);
  const sessionId = crypto.randomUUID();
  const now = nowMs();
  const expiresAt = now + config.admin.sessionTtlHours * 60 * 60 * 1000;

  await db.insert(adminSessions).values({
    id: sessionId,
    userId: user.id,
    roleKey: role.roleKey,
    tenantId: role.tenantId,
    ip: ip || null,
    userAgent: userAgent || null,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });

  return {
    sessionId,
    expiresAt,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
    roleKey: role.roleKey,
    tenantId: role.tenantId,
  };
}

export async function revokeAdminSession(sessionId: string) {
  if (!sessionId) return;
  await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
}

export async function getAdminIdentityBySession(
  sessionId: string,
): Promise<AdminIdentity | null> {
  if (!sessionId) return null;

  const now = nowMs();
  const sessionRows = await db
    .select()
    .from(adminSessions)
    .where(and(eq(adminSessions.id, sessionId), gt(adminSessions.expiresAt, now)))
    .limit(1);
  const session = sessionRows[0];
  if (!session) {
    await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
    return null;
  }

  const userRows = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.id, session.userId), eq(adminUsers.status, "active")))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    await db.delete(adminSessions).where(eq(adminSessions.id, sessionId));
    return null;
  }

  await db
    .update(adminSessions)
    .set({ lastSeenAt: now })
    .where(eq(adminSessions.id, sessionId));

  return {
    authenticated: true,
    source: "session",
    sessionId: session.id,
    userId: user.id,
    username: user.username,
    roleKey: session.roleKey,
    tenantId: session.tenantId || undefined,
  };
}

export function getHeaderAdminIdentity(input: {
  user?: string;
  role?: string;
  tenant?: string;
}): AdminIdentity | null {
  if (!config.admin.trustHeaderAuth || !config.trustProxy) {
    return null;
  }

  const username = (input.user || "").trim();
  if (!username) return null;

  const roleKey = (input.role || "owner").trim().toLowerCase() || "owner";
  const tenantId = (input.tenant || "").trim() || undefined;

  return {
    authenticated: true,
    source: "header",
    username,
    roleKey,
    tenantId,
  };
}
