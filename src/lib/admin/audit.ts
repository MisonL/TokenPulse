import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { auditEvents } from "../../db/schema";

export interface AuditEventPayload {
  actor?: string;
  action: string;
  resource: string;
  resourceId?: string;
  result?: "success" | "failure";
  details?: Record<string, unknown> | string;
  ip?: string;
  userAgent?: string;
  traceId?: string;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  resource?: string;
  result?: "success" | "failure";
  keyword?: string;
  traceId?: string;
}

function normalizePage(value: number | undefined, fallback: number): number {
  if (!value || Number.isNaN(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizePageSize(value: number | undefined): number {
  const parsed = normalizePage(value, 20);
  return Math.min(parsed, 100);
}

export async function writeAuditEvent(payload: AuditEventPayload) {
  const details =
    typeof payload.details === "string"
      ? payload.details
      : payload.details
        ? JSON.stringify(payload.details)
        : null;

  try {
    await db.insert(auditEvents).values({
      actor: payload.actor || "api-secret",
      action: payload.action,
      resource: payload.resource,
      resourceId: payload.resourceId || null,
      result: payload.result || "success",
      details,
      ip: payload.ip || null,
      userAgent: payload.userAgent || null,
      traceId: payload.traceId || null,
    });
  } catch (error) {
    // 审计不应影响主流程，迁移未执行或数据库异常时降级为告警日志
    console.warn("[Audit] 写入审计事件失败：", error);
  }
}

export async function queryAuditEvents(query: AuditQuery) {
  const page = normalizePage(query.page, 1);
  const pageSize = normalizePageSize(query.pageSize);
  const offset = (page - 1) * pageSize;

  const filters: SQL[] = [];
  if (query.action) filters.push(eq(auditEvents.action, query.action));
  if (query.resource) filters.push(eq(auditEvents.resource, query.resource));
  if (query.result) filters.push(eq(auditEvents.result, query.result));
  if (query.traceId) filters.push(eq(auditEvents.traceId, query.traceId));
  if (query.keyword) {
    const keyword = `%${query.keyword}%`;
    filters.push(
      or(
        like(auditEvents.actor, keyword),
        like(auditEvents.action, keyword),
        like(auditEvents.resource, keyword),
        like(auditEvents.details, keyword),
      )!,
    );
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const baseDataQuery = db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.id))
    .limit(pageSize)
    .offset(offset);
  const rows = whereClause
    ? await baseDataQuery.where(whereClause)
    : await baseDataQuery;

  const baseCountQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(auditEvents);
  const countRows = whereClause
    ? await baseCountQuery.where(whereClause)
    : await baseCountQuery;
  const total = countRows[0]?.count || 0;

  return {
    data: rows.map((row) => ({
      ...row,
      details: row.details ? safeParseJson(row.details) : null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function safeParseJson(raw: string): Record<string, unknown> | string {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
}
