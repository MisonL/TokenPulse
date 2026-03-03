import { and, eq, lte } from "drizzle-orm";
import { db } from "../../db";
import { oauthSessions } from "../../db/schema";
import { validateOAuthState } from "./oauth-state";

export interface OAuthSessionRecord {
  provider: string;
  verifier?: string;
  status: "pending" | "completed" | "error";
  error?: string;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class OAuthSessionStore {
  private readonly ttlMs: number;
  private readonly sessions = new Map<string, OAuthSessionRecord>();

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  }

  async register(state: string, provider: string, verifier?: string) {
    const check = validateOAuthState(state);
    if (!check.ok || !provider) return;
    state = check.normalized;
    const now = Date.now();
    const record: OAuthSessionRecord = {
      provider,
      verifier,
      status: "pending",
      createdAt: now,
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
          verifier: verifier || null,
          status: "pending",
          error: null,
          createdAt: now,
          expiresAt: record.expiresAt,
        })
        .onConflictDoUpdate({
          target: oauthSessions.state,
          set: {
            provider,
            verifier: verifier || null,
            status: "pending",
            error: null,
            createdAt: now,
            expiresAt: record.expiresAt,
          },
        });
    } catch {
      // 迁移未执行时降级为内存会话，不影响认证流程。
    }
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

      const record: OAuthSessionRecord = {
        provider: row.provider,
        verifier: row.verifier || undefined,
        status:
          row.status === "error"
            ? "error"
            : row.status === "completed"
              ? "completed"
              : "pending",
        error: row.error || undefined,
        createdAt: row.createdAt,
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

  async complete(state: string) {
    const check = validateOAuthState(state);
    if (!check.ok) return;
    state = check.normalized;
    this.sessions.delete(state);
    try {
      await db
        .delete(oauthSessions)
        .where(eq(oauthSessions.state, state));
    } catch {
      // ignore
    }
  }

  async markError(state: string, errorMessage: string) {
    const check = validateOAuthState(state);
    if (!check.ok) return;
    state = check.normalized;
    const record = await this.get(state);
    if (!record) return;
    record.status = "error";
    record.error = errorMessage || "OAuth 认证失败";
    record.expiresAt = Date.now() + this.ttlMs;
    this.sessions.set(state, record);

    try {
      await db
        .update(oauthSessions)
        .set({
          status: "error",
          error: record.error,
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

  private async purgeExpired(now: number) {
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
