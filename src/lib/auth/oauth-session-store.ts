import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { oauthSessionEvents, oauthSessions } from "../../db/schema";
import { parseIsoDateTime, type TimeRangeQuery } from "../time-range";
import { validateOAuthState } from "./oauth-state";

export type OAuthSessionStatus = "pending" | "completed" | "error";
export type OAuthFlowType =
  | "auth_code"
  | "device_code"
  | "manual_key"
  | "service_account";

export type OAuthSessionPhase =
  | "pending"
  | "waiting_callback"
  | "waiting_device"
  | "exchanging"
  | "completed"
  | "error";

export interface OAuthSessionRecord {
  provider: string;
  flowType: OAuthFlowType;
  verifier?: string;
  phase: OAuthSessionPhase;
  status: OAuthSessionStatus;
  error?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  expiresAt: number;
}

export interface OAuthSessionRegisterOptions {
  flowType?: OAuthFlowType;
  phase?: OAuthSessionPhase;
}

export type OAuthSessionEventType =
  | "register"
  | "set_phase"
  | "complete"
  | "mark_error";

export interface OAuthSessionEventRecord {
  id?: number;
  state: string;
  provider: string;
  flowType: OAuthFlowType;
  phase: OAuthSessionPhase;
  status: OAuthSessionStatus;
  eventType: OAuthSessionEventType;
  error?: string;
  createdAt: number;
}

export interface OAuthSessionEventQuery extends TimeRangeQuery {
  page?: number;
  pageSize?: number;
  state?: string;
  provider?: string;
  flowType?: OAuthFlowType;
  phase?: OAuthSessionPhase;
  status?: OAuthSessionStatus;
  eventType?: OAuthSessionEventType;
}

export interface OAuthSessionEventQueryResult {
  data: OAuthSessionEventRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 2_000;
const DEFAULT_PURGE_INTERVAL_MS = 60_000;
const DEFAULT_EVENT_MEMORY_LIMIT = 500;

export interface OAuthSessionPersistence {
  upsert(state: string, record: OAuthSessionRecord): Promise<void>;
  findByState(state: string): Promise<OAuthSessionRecord | null>;
  deleteByState(state: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
  appendEvent?(event: OAuthSessionEventRecord): Promise<void>;
  listEvents?(query: OAuthSessionEventQuery): Promise<OAuthSessionEventQueryResult>;
}

interface OAuthSessionCacheEntry {
  record: OAuthSessionRecord;
  cachedAt: number;
}

export interface OAuthSessionStoreOptions {
  cacheTtlMs?: number;
  purgeIntervalMs?: number;
  eventMemoryLimit?: number;
  persistence?: OAuthSessionPersistence;
}

function normalizeText(input?: string, max = 256): string | undefined {
  const value = (input || "").trim();
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function normalizePage(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
}

function normalizePageSize(value: number | undefined, fallback = 20): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(value as number)));
}

function toCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!raw) return "";
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function normalizeStatus(value?: string): OAuthSessionStatus {
  if (value === "completed") return "completed";
  if (value === "error") return "error";
  return "pending";
}

function normalizeFlowType(value?: string): OAuthFlowType {
  if (value === "device_code") return "device_code";
  if (value === "manual_key") return "manual_key";
  if (value === "service_account") return "service_account";
  return "auth_code";
}

function normalizePhase(value?: string, fallback: OAuthSessionPhase = "pending"): OAuthSessionPhase {
  switch (value) {
    case "waiting_callback":
    case "waiting_device":
    case "exchanging":
    case "completed":
    case "error":
      return value;
    case "pending":
      return "pending";
    default:
      return fallback;
  }
}

function buildFallbackPhase(
  status: OAuthSessionStatus,
  flowType: OAuthFlowType,
): OAuthSessionPhase {
  if (status === "completed") return "completed";
  if (status === "error") return "error";
  return flowType === "device_code" ? "waiting_device" : "waiting_callback";
}

function fromPersistedRow(
  row: typeof oauthSessions.$inferSelect,
): OAuthSessionRecord {
  const status = normalizeStatus(row.status || undefined);
  const flowType = normalizeFlowType(row.flowType || undefined);
  const phase = normalizePhase(
    row.phase || undefined,
    buildFallbackPhase(status, flowType),
  );
  return {
    provider: row.provider,
    flowType,
    verifier: row.verifier || undefined,
    phase,
    status,
    error: row.error || undefined,
    lastError: row.lastError || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
    completedAt: row.completedAt || undefined,
    expiresAt: row.expiresAt,
  };
}

function fromSessionEventRow(
  row: typeof oauthSessionEvents.$inferSelect,
): OAuthSessionEventRecord {
  return {
    id: row.id,
    state: row.state,
    provider: row.provider,
    flowType: normalizeFlowType(row.flowType || undefined),
    phase: normalizePhase(row.phase || undefined),
    status: normalizeStatus(row.status || undefined),
    eventType: (normalizeText(row.eventType, 32) || "register") as OAuthSessionEventType,
    error: row.error || undefined,
    createdAt: row.createdAt,
  };
}

class DbOAuthSessionPersistence implements OAuthSessionPersistence {
  async upsert(state: string, record: OAuthSessionRecord): Promise<void> {
    await db
      .insert(oauthSessions)
      .values({
        state,
        provider: record.provider,
        flowType: record.flowType,
        verifier: record.verifier || null,
        phase: record.phase,
        status: record.status,
        error: record.error || null,
        lastError: record.lastError || null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        completedAt: record.completedAt || null,
        expiresAt: record.expiresAt,
      })
      .onConflictDoUpdate({
        target: oauthSessions.state,
        set: {
          provider: record.provider,
          flowType: record.flowType,
          verifier: record.verifier || null,
          phase: record.phase,
          status: record.status,
          error: record.error || null,
          lastError: record.lastError || null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          completedAt: record.completedAt || null,
          expiresAt: record.expiresAt,
        },
      });
  }

  async findByState(state: string): Promise<OAuthSessionRecord | null> {
    const rows = await db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.state, state))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return fromPersistedRow(row);
  }

  async deleteByState(state: string): Promise<void> {
    await db.delete(oauthSessions).where(eq(oauthSessions.state, state));
  }

  async deleteExpired(now: number): Promise<void> {
    await db
      .delete(oauthSessions)
      .where(lte(oauthSessions.expiresAt, now));
  }

  async appendEvent(event: OAuthSessionEventRecord): Promise<void> {
    await db.insert(oauthSessionEvents).values({
      state: event.state,
      provider: event.provider,
      flowType: event.flowType,
      phase: event.phase,
      status: event.status,
      eventType: event.eventType,
      error: event.error || null,
      createdAt: event.createdAt,
    });
  }

  async listEvents(query: OAuthSessionEventQuery): Promise<OAuthSessionEventQueryResult> {
    const page = normalizePage(query.page, 1);
    const pageSize = normalizePageSize(query.pageSize, 20);
    const offset = (page - 1) * pageSize;

    const state = normalizeText(query.state, 128);
    const provider = normalizeText(query.provider, 64);
    const flowType = normalizeFlowType(query.flowType);
    const phase = normalizePhase(query.phase, "pending");
    const status = normalizeStatus(query.status);
    const eventType = normalizeText(query.eventType, 32) as OAuthSessionEventType | undefined;
    const fromMs = parseIsoDateTime(query.from);
    const toMs = parseIsoDateTime(query.to);

    const filters = [];
    if (state) filters.push(eq(oauthSessionEvents.state, state));
    if (provider) filters.push(eq(oauthSessionEvents.provider, provider));
    if (query.flowType) filters.push(eq(oauthSessionEvents.flowType, flowType));
    if (query.phase) filters.push(eq(oauthSessionEvents.phase, phase));
    if (query.status) filters.push(eq(oauthSessionEvents.status, status));
    if (eventType) filters.push(eq(oauthSessionEvents.eventType, eventType));
    if (fromMs !== null) filters.push(gte(oauthSessionEvents.createdAt, fromMs));
    if (toMs !== null) filters.push(lte(oauthSessionEvents.createdAt, toMs));

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(oauthSessionEvents)
      .where(whereClause);
    const total = Number(countRow?.count || 0);

    const rows = await db
      .select()
      .from(oauthSessionEvents)
      .where(whereClause)
      .orderBy(desc(oauthSessionEvents.createdAt), desc(oauthSessionEvents.id))
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows.map(fromSessionEventRow),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}

export class OAuthSessionStore {
  private readonly ttlMs: number;
  private readonly cacheTtlMs: number;
  private readonly purgeIntervalMs: number;
  private readonly eventMemoryLimit: number;
  private readonly sessions = new Map<string, OAuthSessionCacheEntry>();
  private sessionEvents: OAuthSessionEventRecord[] = [];
  private readonly persistence: OAuthSessionPersistence;
  private lastPurgeAt = 0;

  constructor(
    ttlMs = DEFAULT_TTL_MS,
    options: OAuthSessionStoreOptions = {},
  ) {
    this.ttlMs = ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
    this.cacheTtlMs =
      (options.cacheTtlMs || DEFAULT_CACHE_TTL_MS) > 0
        ? (options.cacheTtlMs || DEFAULT_CACHE_TTL_MS)
        : DEFAULT_CACHE_TTL_MS;
    this.purgeIntervalMs =
      (options.purgeIntervalMs || DEFAULT_PURGE_INTERVAL_MS) > 0
        ? (options.purgeIntervalMs || DEFAULT_PURGE_INTERVAL_MS)
        : DEFAULT_PURGE_INTERVAL_MS;
    this.eventMemoryLimit =
      (options.eventMemoryLimit || DEFAULT_EVENT_MEMORY_LIMIT) > 0
        ? (options.eventMemoryLimit || DEFAULT_EVENT_MEMORY_LIMIT)
        : DEFAULT_EVENT_MEMORY_LIMIT;
    this.persistence = options.persistence || new DbOAuthSessionPersistence();
  }

  private cloneRecord(record: OAuthSessionRecord): OAuthSessionRecord {
    return { ...record };
  }

  private setCache(state: string, record: OAuthSessionRecord, now = Date.now()) {
    this.sessions.set(state, {
      record: this.cloneRecord(record),
      cachedAt: now,
    });
  }

  private pushEventToMemory(event: OAuthSessionEventRecord) {
    this.sessionEvents.unshift({ ...event });
    if (this.sessionEvents.length > this.eventMemoryLimit) {
      this.sessionEvents.length = this.eventMemoryLimit;
    }
  }

  private async appendEvent(
    state: string,
    record: OAuthSessionRecord,
    eventType: OAuthSessionEventType,
    now: number,
  ) {
    const event: OAuthSessionEventRecord = {
      state,
      provider: record.provider,
      flowType: record.flowType,
      phase: record.phase,
      status: record.status,
      eventType,
      error: record.error,
      createdAt: now,
    };
    this.pushEventToMemory(event);

    if (!this.persistence.appendEvent) return;
    try {
      await this.persistence.appendEvent(event);
    } catch {
      // 事件落库失败时保留内存副本，不阻断认证主流程。
    }
  }

  private getFreshCache(state: string, now: number): OAuthSessionRecord | null {
    const entry = this.sessions.get(state);
    if (!entry) return null;
    if (entry.record.expiresAt <= now) {
      this.sessions.delete(state);
      return null;
    }
    if (now - entry.cachedAt > this.cacheTtlMs) {
      return null;
    }
    return this.cloneRecord(entry.record);
  }

  private getFallbackCache(state: string, now: number): OAuthSessionRecord | null {
    const entry = this.sessions.get(state);
    if (!entry) return null;
    if (entry.record.expiresAt <= now) {
      this.sessions.delete(state);
      return null;
    }
    return this.cloneRecord(entry.record);
  }

  private purgeExpiredCache(now: number): void {
    for (const [state, entry] of this.sessions.entries()) {
      if (entry.record.expiresAt <= now) {
        this.sessions.delete(state);
      }
    }
  }

  private async maybePurgeExpired(now: number): Promise<void> {
    if (now - this.lastPurgeAt < this.purgeIntervalMs) return;
    this.lastPurgeAt = now;
    await this.persistence.deleteExpired(now);
  }

  async register(
    state: string,
    provider: string,
    verifier?: string,
    options?: OAuthSessionRegisterOptions,
  ): Promise<OAuthSessionRecord | null> {
    const check = validateOAuthState(state);
    if (!check.ok || !provider) return null;
    state = check.normalized;
    const now = Date.now();
    const flowType = options?.flowType || "auth_code";
    const phase =
      options?.phase ||
      (flowType === "device_code" ? "waiting_device" : "waiting_callback");

    const record: OAuthSessionRecord = {
      provider,
      flowType,
      verifier,
      phase,
      status: "pending",
      error: undefined,
      lastError: undefined,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
      expiresAt: now + this.ttlMs,
    };

    this.purgeExpiredCache(now);
    this.setCache(state, record, now);
    await this.appendEvent(state, record, "register", now);

    try {
      await this.persistence.upsert(state, record);
      await this.maybePurgeExpired(now);
    } catch {
      // 迁移未执行时降级为内存会话，不影响认证流程。
    }

    return this.cloneRecord(record);
  }

  async get(state: string): Promise<OAuthSessionRecord | null> {
    const check = validateOAuthState(state);
    if (!check.ok) return null;
    state = check.normalized;
    const now = Date.now();
    this.purgeExpiredCache(now);
    const freshCache = this.getFreshCache(state, now);
    if (freshCache) return freshCache;
    const fallbackCache = this.getFallbackCache(state, now);

    try {
      await this.maybePurgeExpired(now);
      const persisted = await this.persistence.findByState(state);
      if (!persisted) return fallbackCache;
      if (persisted.expiresAt <= now) {
        this.sessions.delete(state);
        await this.persistence.deleteByState(state);
        return null;
      }
      this.setCache(state, persisted, now);
      return this.cloneRecord(persisted);
    } catch {
      return fallbackCache;
    }
  }

  async isPending(state: string, provider?: string): Promise<boolean> {
    const record = await this.get(state);
    if (!record) return false;
    if (record.status !== "pending") return false;
    if (!provider) return true;
    return record.provider === provider;
  }

  async setPhase(state: string, phase: OAuthSessionPhase): Promise<void> {
    const check = validateOAuthState(state);
    if (!check.ok) return;
    state = check.normalized;
    const now = Date.now();
    const record = await this.get(state);
    if (!record) return;

    record.phase = phase;
    record.updatedAt = now;
    this.setCache(state, record, now);
    await this.appendEvent(state, record, "set_phase", now);

    try {
      await this.persistence.upsert(state, record);
    } catch {
      // ignore
    }
  }

  async complete(state: string): Promise<void> {
    const check = validateOAuthState(state);
    if (!check.ok) return;
    state = check.normalized;
    const now = Date.now();
    const record = await this.get(state);
    if (!record) return;

    record.status = "completed";
    record.phase = "completed";
    record.error = undefined;
    record.lastError = undefined;
    record.updatedAt = now;
    record.completedAt = now;
    // 完成态保留一段可查询窗口，便于 poll/status 读取。
    record.expiresAt = now + this.ttlMs;
    this.setCache(state, record, now);
    await this.appendEvent(state, record, "complete", now);

    try {
      await this.persistence.upsert(state, record);
    } catch {
      // ignore
    }
  }

  async markError(state: string, errorMessage: string): Promise<void> {
    const check = validateOAuthState(state);
    if (!check.ok) return;
    state = check.normalized;
    const now = Date.now();
    const record = await this.get(state);
    if (!record) return;

    const message = (errorMessage || "OAuth 认证失败").trim();
    record.status = "error";
    record.phase = "error";
    record.error = message;
    record.lastError = message;
    record.updatedAt = now;
    record.completedAt = undefined;
    record.expiresAt = now + this.ttlMs;
    this.setCache(state, record, now);
    await this.appendEvent(state, record, "mark_error", now);

    try {
      await this.persistence.upsert(state, record);
    } catch {
      // ignore
    }
  }

  async getProviderByState(state: string): Promise<string | null> {
    const record = await this.get(state);
    return record?.provider || null;
  }

  async listEvents(query: OAuthSessionEventQuery = {}): Promise<OAuthSessionEventQueryResult> {
    const page = normalizePage(query.page, 1);
    const pageSize = normalizePageSize(query.pageSize, 20);
    const offset = (page - 1) * pageSize;
    const state = normalizeText(query.state, 128);
    const provider = normalizeText(query.provider, 64);
    const fromMs = parseIsoDateTime(query.from);
    const toMs = parseIsoDateTime(query.to);
    const flowType = query.flowType ? normalizeFlowType(query.flowType) : undefined;
    const phase = query.phase ? normalizePhase(query.phase, "pending") : undefined;
    const status = query.status ? normalizeStatus(query.status) : undefined;
    const eventType = normalizeText(query.eventType, 32) as OAuthSessionEventType | undefined;

    if (this.persistence.listEvents) {
      try {
        return await this.persistence.listEvents({
          ...query,
          page,
          pageSize,
          state,
          provider,
          flowType,
          phase,
          status,
          eventType,
        });
      } catch {
        // 持久层不可用时回退内存查询。
      }
    }

    let list = [...this.sessionEvents];
    if (state) list = list.filter((item) => item.state === state);
    if (provider) list = list.filter((item) => item.provider === provider);
    if (flowType) list = list.filter((item) => item.flowType === flowType);
    if (phase) list = list.filter((item) => item.phase === phase);
    if (status) list = list.filter((item) => item.status === status);
    if (eventType) list = list.filter((item) => item.eventType === eventType);
    if (fromMs !== null) list = list.filter((item) => item.createdAt >= fromMs);
    if (toMs !== null) list = list.filter((item) => item.createdAt <= toMs);

    const total = list.length;
    const data = list.slice(offset, offset + pageSize).map((item) => ({ ...item }));
    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  clearMemoryForTest() {
    this.sessions.clear();
    this.sessionEvents = [];
  }
}

export const oauthSessionStore = new OAuthSessionStore();

export async function queryOAuthSessionEvents(
  query: OAuthSessionEventQuery = {},
): Promise<OAuthSessionEventQueryResult> {
  return oauthSessionStore.listEvents(query);
}

export function buildOAuthSessionEventsCsv(rows: OAuthSessionEventRecord[]): string {
  const headers = [
    "id",
    "state",
    "provider",
    "flowType",
    "phase",
    "status",
    "eventType",
    "error",
    "createdAt",
    "createdAtMs",
  ];
  const lines: string[] = [headers.join(",")];

  for (const row of rows) {
    const values = [
      row.id ?? "",
      row.state,
      row.provider,
      row.flowType,
      row.phase,
      row.status,
      row.eventType,
      row.error || "",
      new Date(row.createdAt).toISOString(),
      row.createdAt,
    ];
    lines.push(values.map((item) => toCsvCell(item)).join(","));
  }

  // 增加 UTF-8 BOM，提升 Excel 打开中文内容的兼容性。
  return `\uFEFF${lines.join("\n")}`;
}
