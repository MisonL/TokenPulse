import { and, desc, eq, gte, like, lte, or, sql, type SQL } from "drizzle-orm";
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
  resourceId?: string;
  result?: "success" | "failure";
  keyword?: string;
  traceId?: string;
  policyId?: string;
  from?: string;
  to?: string;
}

interface AuditEventCsvRow {
  id: number;
  createdAt: string;
  actor: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  result: string;
  traceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | string | null;
}

function normalizePage(value: number | undefined, fallback: number): number {
  if (!value || Number.isNaN(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizePageSize(value: number | undefined): number {
  const parsed = normalizePage(value, 20);
  return Math.min(parsed, 100);
}

function parseTime(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
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
  if (query.resourceId) filters.push(eq(auditEvents.resourceId, query.resourceId));
  if (query.result) filters.push(eq(auditEvents.result, query.result));
  if (query.traceId) filters.push(eq(auditEvents.traceId, query.traceId));
  const fromMs = parseTime(query.from);
  if (fromMs !== null) {
    filters.push(gte(auditEvents.createdAt, new Date(fromMs).toISOString()));
  }
  const toMs = parseTime(query.to);
  if (toMs !== null) {
    filters.push(lte(auditEvents.createdAt, new Date(toMs).toISOString()));
  }
  if (query.policyId) {
    const keyword = `%${query.policyId}%`;
    filters.push(
      or(
        eq(auditEvents.resourceId, query.policyId),
        like(auditEvents.details, keyword),
      )!,
    );
  }
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

function toCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!raw) return "";
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function normalizeCsvDetails(
  details?: Record<string, unknown> | string | null,
): string {
  if (!details) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export function buildAuditEventsCsv(rows: AuditEventCsvRow[]): string {
  const headers = [
    "id",
    "createdAt",
    "actor",
    "action",
    "resource",
    "resourceId",
    "result",
    "traceId",
    "ip",
    "userAgent",
    "details",
  ];
  const lines: string[] = [headers.join(",")];

  for (const row of rows) {
    const values = [
      row.id,
      row.createdAt,
      row.actor,
      row.action,
      row.resource,
      row.resourceId ?? "",
      row.result,
      row.traceId ?? "",
      row.ip ?? "",
      row.userAgent ?? "",
      normalizeCsvDetails(row.details),
    ];
    lines.push(values.map((value) => toCsvCell(value)).join(","));
  }

  // 增加 UTF-8 BOM，提升 Excel 打开中文内容的兼容性。
  return `\uFEFF${lines.join("\n")}`;
}
