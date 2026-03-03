import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { oauthCallbacks } from "../../db/schema";

export type OAuthCallbackSource = "aggregate" | "manual";
export type OAuthCallbackStatus = "success" | "failure";

export interface OAuthCallbackEventInput {
  provider: string;
  state?: string | null;
  code?: string | null;
  error?: string | null;
  source: OAuthCallbackSource;
  status: OAuthCallbackStatus;
  raw?: unknown;
  traceId?: string | null;
}

export interface OAuthCallbackEvent {
  id?: number;
  provider: string;
  state?: string | null;
  code?: string | null;
  error?: string | null;
  source: OAuthCallbackSource;
  status: OAuthCallbackStatus;
  raw?: string | null;
  traceId?: string | null;
  createdAt: string;
}

export interface OAuthCallbackQuery {
  page?: number;
  pageSize?: number;
  provider?: string;
  status?: OAuthCallbackStatus;
  source?: OAuthCallbackSource;
  state?: string;
  traceId?: string;
  from?: string;
  to?: string;
}

export interface OAuthCallbackQueryResult {
  data: OAuthCallbackEvent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const MAX_RAW_LENGTH = 8_000;

function normalizeText(input: string | null | undefined, max = 512): string | null {
  const value = (input || "").trim();
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeRaw(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const toText =
    typeof input === "string"
      ? input
      : (() => {
          try {
            return JSON.stringify(input);
          } catch {
            return "[unserializable]";
          }
        })();
  if (!toText) return null;
  return toText.length > MAX_RAW_LENGTH ? toText.slice(0, MAX_RAW_LENGTH) : toText;
}

function normalizePage(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
}

function normalizePageSize(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(value as number)));
}

export class OAuthCallbackStore {
  private memory: OAuthCallbackEvent[] = [];
  private readonly memoryLimit: number;

  constructor(memoryLimit = 200) {
    this.memoryLimit = memoryLimit > 0 ? memoryLimit : 200;
  }

  async append(input: OAuthCallbackEventInput): Promise<OAuthCallbackEvent> {
    const event: OAuthCallbackEvent = {
      provider: normalizeText(input.provider, 64) || "unknown",
      state: normalizeText(input.state, 256),
      code: normalizeText(input.code, 2048),
      error: normalizeText(input.error, 512),
      source: input.source,
      status: input.status,
      raw: normalizeRaw(input.raw),
      traceId: normalizeText(input.traceId, 128),
      createdAt: new Date().toISOString(),
    };

    this.memory.unshift(event);
    if (this.memory.length > this.memoryLimit) {
      this.memory.length = this.memoryLimit;
    }

    try {
      await db.insert(oauthCallbacks).values({
        provider: event.provider,
        state: event.state,
        code: event.code,
        error: event.error,
        source: event.source,
        status: event.status,
        raw: event.raw,
        traceId: event.traceId,
        createdAt: event.createdAt,
      });
    } catch {
      // 迁移未执行时回退到内存，不阻断主流程。
    }

    return event;
  }

  async listByState(state: string, limit = 20): Promise<OAuthCallbackEvent[]> {
    const normalizedState = normalizeText(state, 256);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20;
    if (!normalizedState) return [];

    try {
      const rows = await db
        .select()
        .from(oauthCallbacks)
        .where(eq(oauthCallbacks.state, normalizedState))
        .orderBy(desc(oauthCallbacks.createdAt))
        .limit(safeLimit);
      if (rows.length > 0) {
        return rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          state: row.state,
          code: row.code,
          error: row.error,
          source: row.source as OAuthCallbackSource,
          status: row.status as OAuthCallbackStatus,
          raw: row.raw,
          traceId: row.traceId,
          createdAt: row.createdAt,
        }));
      }
    } catch {
      // ignore
    }

    return this.memory
      .filter((item) => item.state === normalizedState)
      .slice(0, safeLimit)
      .map((item) => ({ ...item }));
  }

  async list(query: OAuthCallbackQuery = {}): Promise<OAuthCallbackQueryResult> {
    const page = normalizePage(query.page, 1);
    const pageSize = normalizePageSize(query.pageSize, 20);
    const offset = (page - 1) * pageSize;

    const provider = normalizeText(query.provider, 64);
    const status = normalizeText(query.status, 16) as OAuthCallbackStatus | null;
    const source = normalizeText(query.source, 16) as OAuthCallbackSource | null;
    const state = normalizeText(query.state, 256);
    const traceId = normalizeText(query.traceId, 128);
    const from = normalizeText(query.from, 64);
    const to = normalizeText(query.to, 64);

    const filters = [];
    if (provider) filters.push(eq(oauthCallbacks.provider, provider));
    if (status) filters.push(eq(oauthCallbacks.status, status));
    if (source) filters.push(eq(oauthCallbacks.source, source));
    if (state) filters.push(like(oauthCallbacks.state, `%${state}%`));
    if (traceId) filters.push(eq(oauthCallbacks.traceId, traceId));
    if (from) filters.push(gte(oauthCallbacks.createdAt, from));
    if (to) filters.push(lte(oauthCallbacks.createdAt, to));

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    try {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(oauthCallbacks)
        .where(whereClause);

      const total = Number(countRow?.count || 0);
      const rows = await db
        .select()
        .from(oauthCallbacks)
        .where(whereClause)
        .orderBy(desc(oauthCallbacks.createdAt))
        .limit(pageSize)
        .offset(offset);

      return {
        data: rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          state: row.state,
          code: row.code,
          error: row.error,
          source: row.source as OAuthCallbackSource,
          status: row.status as OAuthCallbackStatus,
          raw: row.raw,
          traceId: row.traceId,
          createdAt: row.createdAt,
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    } catch {
      // 数据表不可用时回退到内存过滤。
      let list = [...this.memory];
      if (provider) list = list.filter((item) => item.provider === provider);
      if (status) list = list.filter((item) => item.status === status);
      if (source) list = list.filter((item) => item.source === source);
      if (state) list = list.filter((item) => (item.state || "").includes(state));
      if (traceId) list = list.filter((item) => item.traceId === traceId);
      if (from) list = list.filter((item) => item.createdAt >= from);
      if (to) list = list.filter((item) => item.createdAt <= to);

      const total = list.length;
      const paged = list.slice(offset, offset + pageSize).map((item) => ({ ...item }));
      return {
        data: paged,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }
  }

  clearMemoryForTest() {
    this.memory = [];
  }
}

export const oauthCallbackStore = new OAuthCallbackStore();
