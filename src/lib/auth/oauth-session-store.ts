import { and, eq, lte } from "drizzle-orm";
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

export class OAuthSessionStore {
  private readonly ttlMs: number;
  private readonly sessions = new Map<string, OAuthSessionRecord>();

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
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

    await this.purgeExpired(now);
    this.sessions.set(state, record);

    try {
      await db
        .insert(oauthSessions)
        .values({
          state,
          provider,
          flowType: record.flowType,
          verifier: verifier || null,
          phase: record.phase,
          status: record.status,
          error: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          expiresAt: record.expiresAt,
        })
        .onConflictDoUpdate({
          target: oauthSessions.state,
          set: {
            provider,
            flowType: record.flowType,
            verifier: verifier || null,
            phase: record.phase,
            status: "pending",
            error: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            expiresAt: record.expiresAt,
          },
        });
    } catch {
      // 迁移未执行时降级为内存会话，不影响认证流程。
    }

    return record;
  }

  async get(state: string): Promise<OAuthSessionRecord | null> {
    const check = validateOAuthState(state);
    if (!check.ok) return null;
    state = check.normalized;
    const now = Date.now();
    await this.purgeExpired(now);
    const cached = this.sessions.get(state);
    if (cached) return cached;

    try {
      const rows = await db
        .select()
        .from(oauthSessions)
        .where(eq(oauthSessions.state, state))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.expiresAt <= now) {
        await db
          .delete(oauthSessions)
          .where(eq(oauthSessions.state, state));
        return null;
      }

      const status = normalizeStatus(row.status || undefined);
      const flowType = normalizeFlowType((row as any).flowType || undefined);
      const fallbackPhase =
        status === "completed"
          ? "completed"
          : status === "error"
            ? "error"
            : flowType === "device_code"
              ? "waiting_device"
              : "waiting_callback";
      const phase = normalizePhase((row as any).phase || undefined, fallbackPhase);
      const record: OAuthSessionRecord = {
        provider: row.provider,
        flowType,
        verifier: row.verifier || undefined,
        phase,
        status,
        error: row.error || undefined,
        lastError: (row as any).lastError || undefined,
        createdAt: row.createdAt,
        updatedAt: (row as any).updatedAt || row.createdAt,
        completedAt: (row as any).completedAt || undefined,
        expiresAt: row.expiresAt,
      };
      this.sessions.set(state, record);
      return record;
    } catch {
      return null;
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
    this.sessions.set(state, record);

    try {
      await db
        .update(oauthSessions)
        .set({
          phase,
          updatedAt: now,
        })
        .where(eq(oauthSessions.state, state));
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
    this.sessions.set(state, record);

    try {
      await db
        .update(oauthSessions)
        .set({
          status: "completed",
          phase: "completed",
          error: null,
          lastError: null,
          updatedAt: now,
          completedAt: now,
          expiresAt: record.expiresAt,
        })
        .where(eq(oauthSessions.state, state));
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
    this.sessions.set(state, record);

    try {
      await db
        .update(oauthSessions)
        .set({
          status: "error",
          phase: "error",
          error: message,
          lastError: message,
          updatedAt: now,
          completedAt: null,
          expiresAt: record.expiresAt,
        })
        .where(
          and(
            eq(oauthSessions.state, state),
            eq(oauthSessions.provider, record.provider),
          ),
        );
    } catch {
      // ignore
    }
  }

  async getProviderByState(state: string): Promise<string | null> {
    const record = await this.get(state);
    return record?.provider || null;
  }

  private async purgeExpired(now: number): Promise<void> {
    for (const [state, record] of this.sessions.entries()) {
      if (record.expiresAt <= now) {
        this.sessions.delete(state);
      }
    }
    try {
      await db
        .delete(oauthSessions)
        .where(lte(oauthSessions.expiresAt, now));
    } catch {
      // ignore
    }
  }
}

export const oauthSessionStore = new OAuthSessionStore();

