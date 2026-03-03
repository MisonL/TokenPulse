import { eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db";
import { settings } from "../db/schema";

export const OAUTH_SELECTION_POLICY_KEY = "oauth_selection_policy";

export type TokenSelectionPolicy =
  | "round_robin"
  | "latest_valid"
  | "sticky_user";

export interface OAuthSelectionConfig {
  defaultPolicy: TokenSelectionPolicy;
  allowHeaderOverride: boolean;
  allowHeaderAccountOverride: boolean;
  failureCooldownSec: number;
  maxRetryOnAccountFailure: number;
}

const CACHE_TTL_MS = 10_000;

const DEFAULT_SELECTION_CONFIG: OAuthSelectionConfig = {
  defaultPolicy: config.oauthSelection.defaultPolicy,
  allowHeaderOverride: config.oauthSelection.allowHeaderOverride,
  allowHeaderAccountOverride: config.oauthSelection.allowHeaderAccountOverride,
  failureCooldownSec: config.oauthSelection.failureCooldownSec,
  maxRetryOnAccountFailure: config.oauthSelection.maxRetryOnAccountFailure,
};

let cacheValue: OAuthSelectionConfig | null = null;
let cacheExpireAt = 0;

function normalizePolicy(value: unknown): TokenSelectionPolicy {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "round_robin" ||
    normalized === "latest_valid" ||
    normalized === "sticky_user"
  ) {
    return normalized;
  }
  return DEFAULT_SELECTION_CONFIG.defaultPolicy;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function mergeSelectionConfig(
  raw: Partial<OAuthSelectionConfig> | Record<string, unknown>,
): OAuthSelectionConfig {
  return {
    defaultPolicy: normalizePolicy(raw.defaultPolicy),
    allowHeaderOverride: normalizeBoolean(
      raw.allowHeaderOverride,
      DEFAULT_SELECTION_CONFIG.allowHeaderOverride,
    ),
    allowHeaderAccountOverride: normalizeBoolean(
      raw.allowHeaderAccountOverride,
      DEFAULT_SELECTION_CONFIG.allowHeaderAccountOverride,
    ),
    failureCooldownSec: normalizeNumber(
      raw.failureCooldownSec,
      DEFAULT_SELECTION_CONFIG.failureCooldownSec,
    ),
    maxRetryOnAccountFailure: normalizeNumber(
      raw.maxRetryOnAccountFailure,
      DEFAULT_SELECTION_CONFIG.maxRetryOnAccountFailure,
    ),
  };
}

export async function getOAuthSelectionConfig(): Promise<OAuthSelectionConfig> {
  const now = Date.now();
  if (cacheValue && cacheExpireAt > now) {
    return cacheValue;
  }

  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, OAUTH_SELECTION_POLICY_KEY))
      .limit(1);
    const row = rows[0];
    if (!row) {
      cacheValue = DEFAULT_SELECTION_CONFIG;
      cacheExpireAt = now + CACHE_TTL_MS;
      return cacheValue;
    }

    const parsed = JSON.parse(row.value || "{}") as Record<string, unknown>;
    cacheValue = mergeSelectionConfig(parsed);
    cacheExpireAt = now + CACHE_TTL_MS;
    return cacheValue;
  } catch {
    cacheValue = DEFAULT_SELECTION_CONFIG;
    cacheExpireAt = now + CACHE_TTL_MS;
    return cacheValue;
  }
}

export async function updateOAuthSelectionConfig(
  patch: Partial<OAuthSelectionConfig>,
): Promise<OAuthSelectionConfig> {
  const current = await getOAuthSelectionConfig();
  const merged = mergeSelectionConfig({
    ...current,
    ...patch,
  });

  const nowIso = new Date().toISOString();
  await db
    .insert(settings)
    .values({
      key: OAUTH_SELECTION_POLICY_KEY,
      value: JSON.stringify(merged),
      description: "OAuth 多账号路由策略配置",
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: JSON.stringify(merged),
        updatedAt: nowIso,
      },
    });

  cacheValue = merged;
  cacheExpireAt = Date.now() + CACHE_TTL_MS;
  return merged;
}

