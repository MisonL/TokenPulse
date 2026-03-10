import { Hono } from "hono";
import crypto from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  adminUsers,
  organizations,
  projects,
  orgMembers,
  orgMemberProjects,
} from "../db/schema";
import { advancedOnly } from "../middleware/advanced";
import {
  getAdminIdentity,
  requireAdminIdentity,
  resolveAdminIdentity,
} from "../middleware/admin-auth";
import { requirePermission } from "../middleware/rbac";
import { writeAuditEvent } from "../lib/admin/audit";
import { getRequestTraceId } from "../middleware/request-context";

const org = new Hono();

function normalizeId(input: string): string {
  return input.trim().toLowerCase();
}

function resolveClientIp(
  forwardedFor?: string,
  cfConnectingIp?: string,
): string | undefined {
  if (cfConnectingIp) return cfConnectingIp;
  if (!forwardedFor) return undefined;
  return forwardedFor.split(",")[0]?.trim();
}

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

function extractErrorCode(error: unknown): string {
  const candidate = error as
    | { code?: unknown; cause?: { code?: unknown } }
    | undefined;
  const raw = candidate?.code ?? candidate?.cause?.code;
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") return String(raw);
  return "";
}

function extractErrorMessage(error: unknown): string {
  const candidate = error as
    | { message?: unknown; cause?: { message?: unknown } }
    | undefined;
  const raw = candidate?.message ?? candidate?.cause?.message;
  if (typeof raw === "string") return raw;
  return String(raw || "");
}

function isUniqueConflict(error: unknown, signatures: string[]): boolean {
  const code = extractErrorCode(error);
  if (code === "23505") return true;
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return true;
  }

  const message = extractErrorMessage(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("duplicate key value violates unique constraint")) {
    return true;
  }
  if (normalized.includes("unique constraint failed")) {
    return true;
  }

  return signatures.some((item) => normalized.includes(item.toLowerCase()));
}

async function writeFailureAuditEvent(
  c: Parameters<typeof getAdminIdentity>[0],
  payload: Omit<Parameters<typeof writeAuditEvent>[0], "result">,
) {
  const context = getAuditRequestContext(c);
  await writeAuditEvent({
    ...payload,
    actor: payload.actor || context.actor,
    traceId: payload.traceId || context.traceId,
    ip: payload.ip || context.ip,
    userAgent: payload.userAgent || context.userAgent,
    result: "failure",
  });
}

async function getOrganizationById(id: string) {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return rows[0] || null;
}

async function getProjectById(id: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return rows[0] || null;
}

async function getOrgMemberById(id: string) {
  const rows = await db
    .select()
    .from(orgMembers)
    .where(eq(orgMembers.id, id))
    .limit(1);
  return rows[0] || null;
}

async function getOrgMemberProjectById(id: number) {
  const rows = await db
    .select()
    .from(orgMemberProjects)
    .where(eq(orgMemberProjects.id, id))
    .limit(1);
  return rows[0] || null;
}

async function adminUserExists(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.id, userId))
    .limit(1);
  return rows.length > 0;
}

function isDisabledStatus(value: unknown): boolean {
  return String(value || "").trim().toLowerCase() === "disabled";
}

const statusSchema = z.enum(["active", "disabled"]);
const memberRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);

const organizationListQuerySchema = z.object({
  status: statusSchema.optional(),
});

const organizationCreateSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
});

const organizationUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
});

const projectListQuerySchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  status: statusSchema.optional(),
});

const projectCreateSchema = z.object({
  id: z.string().trim().min(1).optional(),
  organizationId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
});

const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
});

const memberListQuerySchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  status: statusSchema.optional(),
});

const memberCreateSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    organizationId: z.string().trim().min(1),
    userId: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    displayName: z.string().trim().min(1).optional(),
    role: memberRoleSchema.optional(),
    status: statusSchema.optional(),
  })
  .refine((value) => Boolean(value.userId || value.email), {
    message: "userId 或 email 至少提供一个",
    path: ["userId"],
  });

const memberUpdateSchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  displayName: z.string().trim().min(1).optional(),
  role: memberRoleSchema.optional(),
  status: statusSchema.optional(),
});

const memberProjectBindingListQuerySchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  memberId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
});

const memberProjectBindingCreateSchema = z.object({
  organizationId: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
});

const memberBatchCreateSchema = z.object({
  items: z.array(z.unknown()).min(1, "items 至少包含一个元素"),
});

const memberProjectBindingBatchCreateSchema = z.object({
  items: z
    .array(z.unknown())
    .min(1, "items 至少包含一个元素"),
});

org.use("*", advancedOnly);
org.use("*", resolveAdminIdentity);
org.use("*", requireAdminIdentity);
org.use("*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  const requiredPermission =
    method === "GET" || method === "HEAD"
      ? "admin.org.read"
      : "admin.org.manage";
  return requirePermission(requiredPermission)(c, next);
});

org.get("/overview", async (c) => {
  const [
    orgAll,
    orgActive,
    projectAll,
    projectActive,
    memberAll,
    memberActive,
    bindingAll,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(organizations),
    db
      .select({ count: sql<number>`count(*)` })
      .from(organizations)
      .where(eq(organizations.status, "active")),
    db.select({ count: sql<number>`count(*)` }).from(projects),
    db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(eq(projects.status, "active")),
    db.select({ count: sql<number>`count(*)` }).from(orgMembers),
    db
      .select({ count: sql<number>`count(*)` })
      .from(orgMembers)
      .where(eq(orgMembers.status, "active")),
    db.select({ count: sql<number>`count(*)` }).from(orgMemberProjects),
  ]);

  const organizationsTotal = Number(orgAll[0]?.count || 0);
  const organizationsActive = Number(orgActive[0]?.count || 0);
  const projectsTotal = Number(projectAll[0]?.count || 0);
  const projectsActive = Number(projectActive[0]?.count || 0);
  const membersTotal = Number(memberAll[0]?.count || 0);
  const membersActive = Number(memberActive[0]?.count || 0);
  const bindingsTotal = Number(bindingAll[0]?.count || 0);

  return c.json({
    data: {
      organizations: {
        total: organizationsTotal,
        active: organizationsActive,
        disabled: Math.max(0, organizationsTotal - organizationsActive),
      },
      projects: {
        total: projectsTotal,
        active: projectsActive,
        disabled: Math.max(0, projectsTotal - projectsActive),
      },
      members: {
        total: membersTotal,
        active: membersActive,
        disabled: Math.max(0, membersTotal - membersActive),
      },
      bindings: {
        total: bindingsTotal,
      },
    },
  });
});

org.get(
  "/organizations",
  zValidator("query", organizationListQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const filters: SQL[] = [];
    if (query.status) {
      filters.push(eq(organizations.status, query.status));
    }

    const baseQuery = db
      .select()
      .from(organizations)
      .orderBy(desc(organizations.updatedAt));
    const rows =
      filters.length > 0
        ? await baseQuery.where(and(...filters)!)
        : await baseQuery;
    return c.json({ data: rows });
  },
);

org.post(
  "/organizations",
  zValidator("json", organizationCreateSchema),
  async (c) => {
    let requestedId = "";
    let requestedName = "";
    let requestedStatus = "active";
    try {
      const payload = c.req.valid("json");
      requestedName = payload.name.trim();
      requestedStatus = payload.status || "active";
      const nowIso = new Date().toISOString();
      const id = normalizeId(payload.id || crypto.randomUUID());
      if (!id) return c.json({ error: "组织 ID 无效" }, 400);
      requestedId = id;

      await db.insert(organizations).values({
        id,
        name: requestedName,
        description: payload.description?.trim() || null,
        status: requestedStatus,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      const context = getAuditRequestContext(c);
      await writeAuditEvent({
        actor: context.actor,
        action: "org.organization.create",
        resource: "organization",
        resourceId: id,
        result: "success",
        traceId: context.traceId,
        details: {
          name: requestedName,
          status: requestedStatus,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return c.json({ success: true, id, traceId: context.traceId });
    } catch (error: any) {
      if (
        isUniqueConflict(error, [
          "organizations_pkey",
          "organizations_name_unique_idx",
          "UNIQUE constraint failed: organizations.id",
          "UNIQUE constraint failed: organizations.name",
        ])
      ) {
        await writeFailureAuditEvent(c, {
          action: "org.organization.create",
          resource: "organization",
          resourceId: requestedId || undefined,
          traceId: getRequestTraceId(c),
          details: {
            id: requestedId || null,
            name: requestedName || null,
            status: requestedStatus || null,
            reason: "CONFLICT",
          },
        });
        return c.json({ error: "组织 ID 或名称已存在" }, 409);
      }
      return c.json({ error: "创建组织失败", details: error?.message }, 500);
    }
  },
);

org.put(
  "/organizations/:id",
  zValidator("json", organizationUpdateSchema),
  async (c) => {
    const id = normalizeId(c.req.param("id") || "");
    let existingStatus = "";
    let updatedFields: string[] = [];
    try {
      if (!id) return c.json({ error: "组织 ID 无效" }, 400);
      const payload = c.req.valid("json");

      const existing = await getOrganizationById(id);
      if (!existing) {
        return c.json({ error: "组织不存在" }, 404);
      }
      existingStatus = existing.status;
      updatedFields = Object.keys(payload);

      const setPayload: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (payload.name !== undefined) {
        setPayload.name = payload.name.trim();
      }
      if (payload.description !== undefined) {
        setPayload.description = payload.description.trim() || null;
      }
      if (payload.status !== undefined) {
        setPayload.status = payload.status;
      }
      if (Object.keys(setPayload).length === 1) {
        return c.json({ error: "缺少可更新字段" }, 400);
      }

      await db.update(organizations).set(setPayload).where(eq(organizations.id, id));

      const context = getAuditRequestContext(c);
      await writeAuditEvent({
        actor: context.actor,
        action: "org.organization.update",
        resource: "organization",
        resourceId: id,
        result: "success",
        traceId: context.traceId,
        details: {
          updatedFields,
          previousStatus: existingStatus,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return c.json({ success: true, traceId: context.traceId });
    } catch (error: any) {
      if (
        isUniqueConflict(error, [
          "organizations_name_unique_idx",
          "UNIQUE constraint failed: organizations.name",
        ])
      ) {
        await writeFailureAuditEvent(c, {
          action: "org.organization.update",
          resource: "organization",
          resourceId: id || undefined,
          traceId: getRequestTraceId(c),
          details: {
            updatedFields,
            previousStatus: existingStatus || null,
            reason: "CONFLICT",
          },
        });
        return c.json({ error: "组织名称已存在" }, 409);
      }
      return c.json({ error: "更新组织失败", details: error?.message }, 500);
    }
  },
);

org.delete("/organizations/:id", async (c) => {
  try {
    const id = normalizeId(c.req.param("id") || "");
    if (!id) return c.json({ error: "组织 ID 无效" }, 400);

    const existing = await getOrganizationById(id);
    if (!existing) {
      return c.json({ error: "组织不存在" }, 404);
    }

    await db
      .delete(orgMemberProjects)
      .where(eq(orgMemberProjects.organizationId, id));
    await db.delete(projects).where(eq(projects.organizationId, id));
    await db.delete(orgMembers).where(eq(orgMembers.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "org.organization.delete",
      resource: "organization",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        name: existing.name,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, traceId: context.traceId });
  } catch (error: any) {
    return c.json({ error: "删除组织失败", details: error?.message }, 500);
  }
});

org.get("/projects", zValidator("query", projectListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const filters: SQL[] = [];
  if (query.organizationId) {
    filters.push(eq(projects.organizationId, normalizeId(query.organizationId)));
  }
  if (query.status) {
    filters.push(eq(projects.status, query.status));
  }

  const baseQuery = db.select().from(projects).orderBy(desc(projects.updatedAt));
  const rows =
    filters.length > 0
      ? await baseQuery.where(and(...filters)!)
      : await baseQuery;
  return c.json({ data: rows });
});

org.post(
  "/projects",
  zValidator("json", projectCreateSchema),
  async (c) => {
    let requestedId = "";
    let requestedOrgId = "";
    let requestedName = "";
    let requestedStatus = "active";
    try {
      const payload = c.req.valid("json");
      const organizationId = normalizeId(payload.organizationId);
      requestedOrgId = organizationId;
      requestedName = payload.name.trim();
      requestedStatus = payload.status || "active";
      const organization = await getOrganizationById(organizationId);
      if (!organization) {
        return c.json({ error: "组织不存在" }, 404);
      }
      if (isDisabledStatus(organization.status)) {
        requestedId = payload.id ? normalizeId(payload.id) : "";
        await writeFailureAuditEvent(c, {
          action: "org.project.create",
          resource: "project",
          resourceId: requestedId || undefined,
          traceId: getRequestTraceId(c),
          details: {
            organizationId,
            name: requestedName || null,
            status: requestedStatus || null,
            reason: "ORGANIZATION_DISABLED",
          },
        });
        return c.json({ error: "组织已禁用，禁止新增项目" }, 409);
      }

      const id = normalizeId(payload.id || crypto.randomUUID());
      if (!id) return c.json({ error: "项目 ID 无效" }, 400);
      requestedId = id;
      const nowIso = new Date().toISOString();

      await db.insert(projects).values({
        id,
        organizationId,
        name: requestedName,
        description: payload.description?.trim() || null,
        status: requestedStatus,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      const context = getAuditRequestContext(c);
      await writeAuditEvent({
        actor: context.actor,
        action: "org.project.create",
        resource: "project",
        resourceId: id,
        result: "success",
        traceId: context.traceId,
        details: {
          organizationId,
          name: requestedName,
          status: requestedStatus,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return c.json({ success: true, id, traceId: context.traceId });
    } catch (error: any) {
      if (
        isUniqueConflict(error, [
          "projects_pkey",
          "projects_org_name_unique_idx",
          "UNIQUE constraint failed: projects.id",
          "UNIQUE constraint failed: projects.organization_id, projects.name",
        ])
      ) {
        await writeFailureAuditEvent(c, {
          action: "org.project.create",
          resource: "project",
          resourceId: requestedId || undefined,
          traceId: getRequestTraceId(c),
          details: {
            organizationId: requestedOrgId || null,
            name: requestedName || null,
            status: requestedStatus || null,
            reason: "CONFLICT",
          },
        });
        return c.json({ error: "项目 ID 或组织内项目名称已存在" }, 409);
      }
      return c.json({ error: "创建项目失败", details: error?.message }, 500);
    }
  },
);

org.put(
  "/projects/:id",
  zValidator("json", projectUpdateSchema),
  async (c) => {
    const id = normalizeId(c.req.param("id") || "");
    let organizationId = "";
    let updatedFields: string[] = [];
    try {
      if (!id) return c.json({ error: "项目 ID 无效" }, 400);
      const payload = c.req.valid("json");

      const existing = await getProjectById(id);
      if (!existing) {
        return c.json({ error: "项目不存在" }, 404);
      }
      organizationId = existing.organizationId;
      updatedFields = Object.keys(payload);

      const organization = await getOrganizationById(existing.organizationId);
      if (!organization) {
        return c.json({ error: "组织不存在" }, 404);
      }
      if (isDisabledStatus(organization.status)) {
        await writeFailureAuditEvent(c, {
          action: "org.project.update",
          resource: "project",
          resourceId: id,
          traceId: getRequestTraceId(c),
          details: {
            organizationId: existing.organizationId,
            updatedFields,
            reason: "ORGANIZATION_DISABLED",
          },
        });
        return c.json({ error: "组织已禁用，禁止更新项目" }, 409);
      }

      const setPayload: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (payload.name !== undefined) {
        setPayload.name = payload.name.trim();
      }
      if (payload.description !== undefined) {
        setPayload.description = payload.description.trim() || null;
      }
      if (payload.status !== undefined) {
        setPayload.status = payload.status;
      }
      if (Object.keys(setPayload).length === 1) {
        return c.json({ error: "缺少可更新字段" }, 400);
      }

      await db.update(projects).set(setPayload).where(eq(projects.id, id));

      const context = getAuditRequestContext(c);
      await writeAuditEvent({
        actor: context.actor,
        action: "org.project.update",
        resource: "project",
        resourceId: id,
        result: "success",
        traceId: context.traceId,
        details: {
          organizationId,
          updatedFields,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return c.json({ success: true, traceId: context.traceId });
    } catch (error: any) {
      if (
        isUniqueConflict(error, [
          "projects_org_name_unique_idx",
          "UNIQUE constraint failed: projects.organization_id, projects.name",
        ])
      ) {
        await writeFailureAuditEvent(c, {
          action: "org.project.update",
          resource: "project",
          resourceId: id || undefined,
          traceId: getRequestTraceId(c),
          details: {
            organizationId: organizationId || null,
            updatedFields,
            reason: "CONFLICT",
          },
        });
        return c.json({ error: "组织内项目名称已存在" }, 409);
      }
      return c.json({ error: "更新项目失败", details: error?.message }, 500);
    }
  },
);

org.delete("/projects/:id", async (c) => {
  try {
    const id = normalizeId(c.req.param("id") || "");
    if (!id) return c.json({ error: "项目 ID 无效" }, 400);

    const existing = await getProjectById(id);
    if (!existing) {
      return c.json({ error: "项目不存在" }, 404);
    }

    const organization = await getOrganizationById(existing.organizationId);
    if (!organization) {
      return c.json({ error: "组织不存在" }, 404);
    }
    if (isDisabledStatus(organization.status)) {
      await writeFailureAuditEvent(c, {
        action: "org.project.delete",
        resource: "project",
        resourceId: id,
        traceId: getRequestTraceId(c),
        details: {
          organizationId: existing.organizationId,
          name: existing.name,
          reason: "ORGANIZATION_DISABLED",
        },
      });
      return c.json({ error: "组织已禁用，禁止删除项目" }, 409);
    }

    await db.delete(orgMemberProjects).where(eq(orgMemberProjects.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "org.project.delete",
      resource: "project",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        organizationId: existing.organizationId,
        name: existing.name,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, traceId: context.traceId });
  } catch (error: any) {
    return c.json({ error: "删除项目失败", details: error?.message }, 500);
  }
});

org.get("/members", zValidator("query", memberListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const filters: SQL[] = [];
  if (query.organizationId) {
    filters.push(eq(orgMembers.organizationId, normalizeId(query.organizationId)));
  }
  if (query.userId) {
    filters.push(eq(orgMembers.userId, normalizeId(query.userId)));
  }
  if (query.status) {
    filters.push(eq(orgMembers.status, query.status));
  }

  const baseQuery = db.select().from(orgMembers).orderBy(desc(orgMembers.updatedAt));
  const rows =
    filters.length > 0
      ? await baseQuery.where(and(...filters)!)
      : await baseQuery;
  return c.json({ data: rows });
});

org.post(
  "/members",
  zValidator("json", memberCreateSchema),
  async (c) => {
    let requestedId = "";
    let requestedOrgId = "";
    let requestedUserId: string | null = null;
    let requestedEmail: string | null = null;
    let requestedRole = "member";
    let requestedStatus = "active";
    try {
      const payload = c.req.valid("json");
      const organizationId = normalizeId(payload.organizationId);
      requestedOrgId = organizationId;
      requestedUserId = payload.userId ? normalizeId(payload.userId) : null;
      requestedEmail = payload.email?.trim().toLowerCase() || null;
      requestedRole = payload.role || "member";
      requestedStatus = payload.status || "active";
      const organization = await getOrganizationById(organizationId);
      if (!organization) {
        return c.json({ error: "组织不存在" }, 404);
      }
      if (isDisabledStatus(organization.status)) {
        requestedId = payload.id ? normalizeId(payload.id) : "";
        await writeFailureAuditEvent(c, {
          action: "org.member.create",
          resource: "org_member",
          resourceId: requestedId || undefined,
          traceId: getRequestTraceId(c),
          details: {
            organizationId,
            userId: requestedUserId,
            email: requestedEmail,
            role: requestedRole,
            status: requestedStatus,
            reason: "ORGANIZATION_DISABLED",
          },
        });
        return c.json({ error: "组织已禁用，禁止新增成员" }, 409);
      }

      const normalizedUserId = requestedUserId ? requestedUserId : undefined;
      if (normalizedUserId && !(await adminUserExists(normalizedUserId))) {
        return c.json({ error: "userId 对应的管理员不存在" }, 404);
      }

      const id = normalizeId(payload.id || crypto.randomUUID());
      if (!id) return c.json({ error: "成员 ID 无效" }, 400);
      requestedId = id;
      const nowIso = new Date().toISOString();

      await db.insert(orgMembers).values({
        id,
        organizationId,
        userId: normalizedUserId || null,
        email: requestedEmail,
        displayName: payload.displayName?.trim() || null,
        role: requestedRole,
        status: requestedStatus,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      const context = getAuditRequestContext(c);
      await writeAuditEvent({
        actor: context.actor,
        action: "org.member.create",
        resource: "org_member",
        resourceId: id,
        result: "success",
        traceId: context.traceId,
        details: {
          organizationId,
          userId: normalizedUserId || null,
          email: requestedEmail,
          role: requestedRole,
          status: requestedStatus,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return c.json({ success: true, id, traceId: context.traceId });
    } catch (error: any) {
      if (
        isUniqueConflict(error, [
          "org_members_pkey",
          "org_members_org_user_unique_idx",
          "UNIQUE constraint failed: org_members.id",
          "UNIQUE constraint failed: org_members.organization_id, org_members.user_id",
        ])
      ) {
        await writeFailureAuditEvent(c, {
          action: "org.member.create",
          resource: "org_member",
          resourceId: requestedId || undefined,
          traceId: getRequestTraceId(c),
          details: {
            organizationId: requestedOrgId || null,
            userId: requestedUserId,
            email: requestedEmail,
            role: requestedRole,
            status: requestedStatus,
            reason: "CONFLICT",
          },
        });
        return c.json({ error: "成员 ID 或组织内 userId 绑定已存在" }, 409);
      }
      return c.json({ error: "创建成员失败", details: error?.message }, 500);
    }
  },
);

org.post(
  "/members/batch",
  zValidator("json", memberBatchCreateSchema),
  async (c) => {
    const payload = c.req.valid("json");
    const context = getAuditRequestContext(c);
    const nowIso = new Date().toISOString();
    const successes: Array<{ index: number; id: string }> = [];
    const errors: Array<{ index: number; code: string; error: string }> = [];

    for (const [index, item] of payload.items.entries()) {
      const parsed = memberCreateSchema.safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        errors.push({
          index,
          code: "VALIDATION_FAILED",
          error: issue?.message || "请求体校验失败",
        });
        continue;
      }

      const memberPayload = parsed.data;
      try {
        const organizationId = normalizeId(memberPayload.organizationId);
        const organization = await getOrganizationById(organizationId);
        if (!organization) {
          errors.push({
            index,
            code: "ORGANIZATION_NOT_FOUND",
            error: "组织不存在",
          });
          continue;
        }
        if (isDisabledStatus(organization.status)) {
          errors.push({
            index,
            code: "ORGANIZATION_DISABLED",
            error: "组织已禁用，禁止新增成员",
          });
          continue;
        }

        const normalizedUserId = memberPayload.userId
          ? normalizeId(memberPayload.userId)
          : undefined;
        if (normalizedUserId && !(await adminUserExists(normalizedUserId))) {
          errors.push({
            index,
            code: "ADMIN_USER_NOT_FOUND",
            error: "userId 对应的管理员不存在",
          });
          continue;
        }

        const id = normalizeId(memberPayload.id || crypto.randomUUID());
        if (!id) {
          errors.push({
            index,
            code: "INVALID_MEMBER_ID",
            error: "成员 ID 无效",
          });
          continue;
        }

        await db.insert(orgMembers).values({
          id,
          organizationId,
          userId: normalizedUserId || null,
          email: memberPayload.email?.trim().toLowerCase() || null,
          displayName: memberPayload.displayName?.trim() || null,
          role: memberPayload.role || "member",
          status: memberPayload.status || "active",
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        successes.push({ index, id });
      } catch (error: any) {
        if (
          isUniqueConflict(error, [
            "org_members_pkey",
            "org_members_org_user_unique_idx",
            "UNIQUE constraint failed: org_members.id",
            "UNIQUE constraint failed: org_members.organization_id, org_members.user_id",
          ])
        ) {
          errors.push({
            index,
            code: "CONFLICT",
            error: "成员 ID 或组织内 userId 绑定已存在",
          });
          continue;
        }

        errors.push({
          index,
          code: "INTERNAL_ERROR",
          error: String(error?.message || "创建成员失败"),
        });
      }
    }

    await writeAuditEvent({
      actor: context.actor,
      action: "org.member.batch_create",
      resource: "org_member_batch",
      result: errors.length > 0 ? "failure" : "success",
      traceId: context.traceId,
      details: {
        requested: payload.items.length,
        successCount: successes.length,
        errorCount: errors.length,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({
      success: errors.length === 0,
      data: {
        requested: payload.items.length,
        successCount: successes.length,
        errorCount: errors.length,
        successes,
        errors,
      },
      traceId: context.traceId,
    });
  },
);

org.put(
  "/members/:id",
  zValidator("json", memberUpdateSchema),
  async (c) => {
    const id = normalizeId(c.req.param("id") || "");
    let existingOrganizationId = "";
    let updatedFields: string[] = [];
    try {
      if (!id) return c.json({ error: "成员 ID 无效" }, 400);
      const payload = c.req.valid("json");

      const existing = await getOrgMemberById(id);
      if (!existing) {
        return c.json({ error: "成员不存在" }, 404);
      }
      existingOrganizationId = existing.organizationId;
      updatedFields = Object.keys(payload);

      const existingOrganization = await getOrganizationById(existing.organizationId);
      if (!existingOrganization) {
        return c.json({ error: "组织不存在" }, 404);
      }
      if (isDisabledStatus(existingOrganization.status)) {
        await writeFailureAuditEvent(c, {
          action: "org.member.update",
          resource: "org_member",
          resourceId: id,
          traceId: getRequestTraceId(c),
          details: {
            organizationId: existing.organizationId,
            updatedFields,
            reason: "ORGANIZATION_DISABLED",
          },
        });
        return c.json({ error: "组织已禁用，禁止更新成员" }, 409);
      }

      const normalizedUserId = payload.userId ? normalizeId(payload.userId) : undefined;
      if (normalizedUserId && !(await adminUserExists(normalizedUserId))) {
        return c.json({ error: "userId 对应的管理员不存在" }, 404);
      }
      const normalizedOrganizationId = payload.organizationId
        ? normalizeId(payload.organizationId)
        : undefined;
      if (normalizedOrganizationId) {
        const organization = await getOrganizationById(normalizedOrganizationId);
        if (!organization) {
          return c.json({ error: "组织不存在" }, 404);
        }
        if (isDisabledStatus(organization.status)) {
          await writeFailureAuditEvent(c, {
            action: "org.member.update",
            resource: "org_member",
            resourceId: id,
            traceId: getRequestTraceId(c),
            details: {
              organizationId: normalizedOrganizationId,
              previousOrganizationId: existing.organizationId,
              updatedFields,
              reason: "TARGET_ORGANIZATION_DISABLED",
            },
          });
          return c.json({ error: "目标组织已禁用" }, 409);
        }
      }

      const setPayload: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (payload.organizationId !== undefined) {
        setPayload.organizationId = normalizedOrganizationId;
      }
      if (payload.userId !== undefined) {
        setPayload.userId = normalizedUserId || null;
      }
      if (payload.email !== undefined) {
        setPayload.email = payload.email.trim().toLowerCase() || null;
      }
      if (payload.displayName !== undefined) {
        setPayload.displayName = payload.displayName.trim() || null;
      }
      if (payload.role !== undefined) {
        setPayload.role = payload.role;
      }
      if (payload.status !== undefined) {
        setPayload.status = payload.status;
      }
      if (Object.keys(setPayload).length === 1) {
        return c.json({ error: "缺少可更新字段" }, 400);
      }

      await db.update(orgMembers).set(setPayload).where(eq(orgMembers.id, id));

      const context = getAuditRequestContext(c);
      await writeAuditEvent({
        actor: context.actor,
        action: "org.member.update",
        resource: "org_member",
        resourceId: id,
        result: "success",
        traceId: context.traceId,
        details: {
          organizationId: normalizedOrganizationId || existing.organizationId,
          previousOrganizationId: existing.organizationId,
          updatedFields,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return c.json({ success: true, traceId: context.traceId });
    } catch (error: any) {
      if (
        isUniqueConflict(error, [
          "org_members_org_user_unique_idx",
          "UNIQUE constraint failed: org_members.organization_id, org_members.user_id",
        ])
      ) {
        await writeFailureAuditEvent(c, {
          action: "org.member.update",
          resource: "org_member",
          resourceId: id || undefined,
          traceId: getRequestTraceId(c),
          details: {
            organizationId: existingOrganizationId || null,
            updatedFields,
            reason: "CONFLICT",
          },
        });
        return c.json({ error: "组织内 userId 绑定已存在" }, 409);
      }
      return c.json({ error: "更新成员失败", details: error?.message }, 500);
    }
  },
);

org.delete("/members/:id", async (c) => {
  try {
    const id = normalizeId(c.req.param("id") || "");
    if (!id) return c.json({ error: "成员 ID 无效" }, 400);

    const existing = await getOrgMemberById(id);
    if (!existing) {
      return c.json({ error: "成员不存在" }, 404);
    }

    const organization = await getOrganizationById(existing.organizationId);
    if (!organization) {
      return c.json({ error: "组织不存在" }, 404);
    }
    if (isDisabledStatus(organization.status)) {
      await writeFailureAuditEvent(c, {
        action: "org.member.delete",
        resource: "org_member",
        resourceId: id,
        traceId: getRequestTraceId(c),
        details: {
          organizationId: existing.organizationId,
          userId: existing.userId || null,
          email: existing.email || null,
          reason: "ORGANIZATION_DISABLED",
        },
      });
      return c.json({ error: "组织已禁用，禁止删除成员" }, 409);
    }

    await db.delete(orgMemberProjects).where(eq(orgMemberProjects.memberId, id));
    await db.delete(orgMembers).where(eq(orgMembers.id, id));

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "org.member.delete",
      resource: "org_member",
      resourceId: id,
      result: "success",
      traceId: context.traceId,
      details: {
        organizationId: existing.organizationId,
        userId: existing.userId || null,
        email: existing.email || null,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, traceId: context.traceId });
  } catch (error: any) {
    return c.json({ error: "删除成员失败", details: error?.message }, 500);
  }
});

org.get(
  "/member-project-bindings",
  zValidator("query", memberProjectBindingListQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const filters: SQL[] = [];
    if (query.organizationId) {
      filters.push(
        eq(orgMemberProjects.organizationId, normalizeId(query.organizationId)),
      );
    }
    if (query.memberId) {
      filters.push(eq(orgMemberProjects.memberId, normalizeId(query.memberId)));
    }
    if (query.projectId) {
      filters.push(eq(orgMemberProjects.projectId, normalizeId(query.projectId)));
    }

    const baseQuery = db
      .select()
      .from(orgMemberProjects)
      .orderBy(desc(orgMemberProjects.id));
    const rows =
      filters.length > 0
        ? await baseQuery.where(and(...filters)!)
        : await baseQuery;
    return c.json({ data: rows });
  },
);

org.post(
  "/member-project-bindings",
  zValidator("json", memberProjectBindingCreateSchema),
  async (c) => {
    let organizationId = "";
    let memberId = "";
    let projectId = "";
    try {
      const payload = c.req.valid("json");
      organizationId = normalizeId(payload.organizationId);
      memberId = normalizeId(payload.memberId);
      projectId = normalizeId(payload.projectId);

      const organization = await getOrganizationById(organizationId);
      if (!organization) {
        return c.json({ error: "组织不存在" }, 404);
      }
      if (isDisabledStatus(organization.status)) {
        await writeFailureAuditEvent(c, {
          action: "org.member_project_binding.create",
          resource: "org_member_project",
          resourceId: `${memberId}:${projectId}`,
          traceId: getRequestTraceId(c),
          details: {
            organizationId,
            memberId,
            projectId,
            reason: "ORGANIZATION_DISABLED",
          },
        });
        return c.json({ error: "组织已禁用，禁止新增成员项目绑定" }, 409);
      }

      const member = await getOrgMemberById(memberId);
      if (!member || member.organizationId !== organizationId) {
        return c.json({ error: "成员不存在或不属于该组织" }, 404);
      }

      const project = await getProjectById(projectId);
      if (!project || project.organizationId !== organizationId) {
        return c.json({ error: "项目不存在或不属于该组织" }, 404);
      }
      if (isDisabledStatus(project.status)) {
        await writeFailureAuditEvent(c, {
          action: "org.member_project_binding.create",
          resource: "org_member_project",
          resourceId: `${memberId}:${projectId}`,
          traceId: getRequestTraceId(c),
          details: {
            organizationId,
            memberId,
            projectId,
            reason: "PROJECT_DISABLED",
          },
        });
        return c.json({ error: "项目已禁用，禁止新增成员项目绑定" }, 409);
      }

      await db.insert(orgMemberProjects).values({
        organizationId,
        memberId,
        projectId,
        createdAt: new Date().toISOString(),
      });

      const context = getAuditRequestContext(c);
      await writeAuditEvent({
        actor: context.actor,
        action: "org.member_project_binding.create",
        resource: "org_member_project",
        resourceId: `${memberId}:${projectId}`,
        result: "success",
        traceId: context.traceId,
        details: {
          organizationId,
          memberId,
          projectId,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return c.json({ success: true, traceId: context.traceId });
    } catch (error: any) {
      if (
        isUniqueConflict(error, [
          "org_member_projects_unique_idx",
          "UNIQUE constraint failed: org_member_projects.member_id, org_member_projects.project_id",
        ])
      ) {
        await writeFailureAuditEvent(c, {
          action: "org.member_project_binding.create",
          resource: "org_member_project",
          resourceId: `${memberId}:${projectId}`,
          traceId: getRequestTraceId(c),
          details: {
            organizationId: organizationId || null,
            memberId: memberId || null,
            projectId: projectId || null,
            reason: "CONFLICT",
          },
        });
        return c.json({ error: "成员与项目绑定已存在" }, 409);
      }
      return c.json({ error: "创建成员项目绑定失败", details: error?.message }, 500);
    }
  },
);

org.post(
  "/member-project-bindings/batch",
  zValidator("json", memberProjectBindingBatchCreateSchema),
  async (c) => {
    const payload = c.req.valid("json");
    const context = getAuditRequestContext(c);
    const nowIso = new Date().toISOString();
    const successes: Array<{ index: number; memberId: string; projectId: string }> = [];
    const errors: Array<{ index: number; code: string; error: string }> = [];

    for (const [index, item] of payload.items.entries()) {
      const parsed = memberProjectBindingCreateSchema.safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        errors.push({
          index,
          code: "VALIDATION_FAILED",
          error: issue?.message || "请求体校验失败",
        });
        continue;
      }

      const bindingPayload = parsed.data;
      try {
        const organizationId = normalizeId(bindingPayload.organizationId);
        const memberId = normalizeId(bindingPayload.memberId);
        const projectId = normalizeId(bindingPayload.projectId);

        const organization = await getOrganizationById(organizationId);
        if (!organization) {
          errors.push({
            index,
            code: "ORGANIZATION_NOT_FOUND",
            error: "组织不存在",
          });
          continue;
        }
        if (isDisabledStatus(organization.status)) {
          errors.push({
            index,
            code: "ORGANIZATION_DISABLED",
            error: "组织已禁用，禁止新增成员项目绑定",
          });
          continue;
        }

        const member = await getOrgMemberById(memberId);
        if (!member || member.organizationId !== organizationId) {
          errors.push({
            index,
            code: "MEMBER_NOT_FOUND",
            error: "成员不存在或不属于该组织",
          });
          continue;
        }

        const project = await getProjectById(projectId);
        if (!project || project.organizationId !== organizationId) {
          errors.push({
            index,
            code: "PROJECT_NOT_FOUND",
            error: "项目不存在或不属于该组织",
          });
          continue;
        }
        if (isDisabledStatus(project.status)) {
          errors.push({
            index,
            code: "PROJECT_DISABLED",
            error: "项目已禁用，禁止新增成员项目绑定",
          });
          continue;
        }

        await db.insert(orgMemberProjects).values({
          organizationId,
          memberId,
          projectId,
          createdAt: nowIso,
        });

        successes.push({ index, memberId, projectId });
      } catch (error: any) {
        if (
          isUniqueConflict(error, [
            "org_member_projects_unique_idx",
            "UNIQUE constraint failed: org_member_projects.member_id, org_member_projects.project_id",
          ])
        ) {
          errors.push({
            index,
            code: "CONFLICT",
            error: "成员与项目绑定已存在",
          });
          continue;
        }

        errors.push({
          index,
          code: "INTERNAL_ERROR",
          error: String(error?.message || "创建成员项目绑定失败"),
        });
      }
    }

    await writeAuditEvent({
      actor: context.actor,
      action: "org.member_project_binding.batch_create",
      resource: "org_member_project_batch",
      result: errors.length > 0 ? "failure" : "success",
      traceId: context.traceId,
      details: {
        requested: payload.items.length,
        successCount: successes.length,
        errorCount: errors.length,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({
      success: errors.length === 0,
      data: {
        requested: payload.items.length,
        successCount: successes.length,
        errorCount: errors.length,
        successes,
        errors,
      },
      traceId: context.traceId,
    });
  },
);

org.delete("/member-project-bindings/:id", async (c) => {
  try {
    const id = Number.parseInt((c.req.param("id") || "").trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: "绑定 ID 无效" }, 400);
    }

    const existing = await getOrgMemberProjectById(id);
    if (!existing) {
      return c.json({ error: "绑定关系不存在" }, 404);
    }

    const organization = await getOrganizationById(existing.organizationId);
    if (!organization) {
      return c.json({ error: "组织不存在" }, 404);
    }
    if (isDisabledStatus(organization.status)) {
      await writeFailureAuditEvent(c, {
        action: "org.member_project_binding.delete",
        resource: "org_member_project",
        resourceId: String(id),
        traceId: getRequestTraceId(c),
        details: {
          organizationId: existing.organizationId,
          memberId: existing.memberId,
          projectId: existing.projectId,
          reason: "ORGANIZATION_DISABLED",
        },
      });
      return c.json({ error: "组织已禁用，禁止删除成员项目绑定" }, 409);
    }

    await db.delete(orgMemberProjects).where(eq(orgMemberProjects.id, id));

    const context = getAuditRequestContext(c);
    await writeAuditEvent({
      actor: context.actor,
      action: "org.member_project_binding.delete",
      resource: "org_member_project",
      resourceId: String(id),
      result: "success",
      traceId: context.traceId,
      details: {
        organizationId: existing.organizationId,
        memberId: existing.memberId,
        projectId: existing.projectId,
      },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return c.json({ success: true, traceId: context.traceId });
  } catch (error: any) {
    return c.json({ error: "删除成员项目绑定失败", details: error?.message }, 500);
  }
});

export default org;
