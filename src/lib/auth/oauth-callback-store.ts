import { desc, eq } from "drizzle-orm";
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

  clearMemoryForTest() {
    this.memory = [];
  }
}

export const oauthCallbackStore = new OAuthCallbackStore();
