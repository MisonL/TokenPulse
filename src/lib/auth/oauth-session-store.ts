import { eq, lte } from "drizzle-orm";
import { db } from "../../db";
import { oauthSessions } from "../../db/schema";
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

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 2_000;
const DEFAULT_PURGE_INTERVAL_MS = 60_000;

export interface OAuthSessionPersistence {
  upsert(state: string, record: OAuthSessionRecord): Promise<void>;
  findByState(state: string): Promise<OAuthSessionRecord | null>;
  deleteByState(state: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}

interface OAuthSessionCacheEntry {
  record: OAuthSessionRecord;
  cachedAt: number;
}

export interface OAuthSessionStoreOptions {
  cacheTtlMs?: number;
  purgeIntervalMs?: number;
  persistence?: OAuthSessionPersistence;
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
}

export class OAuthSessionStore {
  private readonly ttlMs: number;
  private readonly cacheTtlMs: number;
  private readonly purgeIntervalMs: number;
  private readonly sessions = new Map<string, OAuthSessionCacheEntry>();
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

  clearMemoryForTest() {
    this.sessions.clear();
  }
}

export const oauthSessionStore = new OAuthSessionStore();
