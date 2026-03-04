import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";

export const ROUTE_EXECUTION_POLICY_KEY = "oauth_route_policies";
const CACHE_TTL_MS = 10_000;

export interface RouteExecutionPolicy {
  emitRouteHeaders: boolean;
  retryStatusCodes: number[];
  claudeFallbackStatusCodes: number[];
}

export type ClaudeBridgeFallbackReason =
  | "status_code"
  | "cloudflare_signal"
  | "not_eligible";

const DEFAULT_ROUTE_EXECUTION_POLICY: RouteExecutionPolicy = {
  emitRouteHeaders: true,
  retryStatusCodes: [401, 403, 429, 500, 502, 503, 504],
  claudeFallbackStatusCodes: [401, 403, 408, 409, 425, 429, 500, 502, 503, 504],
};

let cacheValue: RouteExecutionPolicy | null = null;
let cacheExpiresAt = 0;

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function normalizeStatusCodeList(
  value: unknown,
  fallback: number[],
): number[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 100 && item <= 599)
    .map((item) => Number(item));
  if (normalized.length === 0) {
    return [...fallback];
  }
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

function mergeRouteExecutionPolicy(
  raw: Partial<RouteExecutionPolicy> | Record<string, unknown>,
): RouteExecutionPolicy {
  return {
    emitRouteHeaders: normalizeBoolean(
      raw.emitRouteHeaders,
      DEFAULT_ROUTE_EXECUTION_POLICY.emitRouteHeaders,
    ),
    retryStatusCodes: normalizeStatusCodeList(
      raw.retryStatusCodes,
      DEFAULT_ROUTE_EXECUTION_POLICY.retryStatusCodes,
    ),
    claudeFallbackStatusCodes: normalizeStatusCodeList(
      raw.claudeFallbackStatusCodes,
      DEFAULT_ROUTE_EXECUTION_POLICY.claudeFallbackStatusCodes,
    ),
  };
}

function parseCloudflareSignals(bodyText: string): boolean {
  const text = (bodyText || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("cloudflare") ||
    text.includes("cf-ray") ||
    text.includes("attention required") ||
    text.includes("just a moment") ||
    text.includes("captcha") ||
    text.includes("tls") ||
    text.includes("handshake")
  );
}

export function resolveClaudeBridgeFallbackReason(
  status: number,
  bodyText: string,
  policy: RouteExecutionPolicy,
): ClaudeBridgeFallbackReason {
  if (!Number.isFinite(status)) return "not_eligible";
  if (policy.claudeFallbackStatusCodes.includes(status)) {
    return "status_code";
  }
  if (parseCloudflareSignals(bodyText)) {
    return "cloudflare_signal";
  }
  return "not_eligible";
}

export async function getRouteExecutionPolicy(): Promise<RouteExecutionPolicy> {
  const now = Date.now();
  if (cacheValue && cacheExpiresAt > now) {
    return cacheValue;
  }

  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, ROUTE_EXECUTION_POLICY_KEY))
      .limit(1);
    const row = rows[0];
    if (!row) {
      cacheValue = DEFAULT_ROUTE_EXECUTION_POLICY;
      cacheExpiresAt = now + CACHE_TTL_MS;
      return cacheValue;
    }
    const parsed = JSON.parse(row.value || "{}") as Record<string, unknown>;
    cacheValue = mergeRouteExecutionPolicy(parsed);
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cacheValue;
  } catch {
    cacheValue = DEFAULT_ROUTE_EXECUTION_POLICY;
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cacheValue;
  }
}

export async function updateRouteExecutionPolicy(
  patch: Partial<RouteExecutionPolicy>,
): Promise<RouteExecutionPolicy> {
  const current = await getRouteExecutionPolicy();
  const merged = mergeRouteExecutionPolicy({
    ...current,
    ...patch,
  });

  const nowIso = new Date().toISOString();
  await db
    .insert(settings)
    .values({
      key: ROUTE_EXECUTION_POLICY_KEY,
      value: JSON.stringify(merged),
      description: "网关路由执行策略",
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
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return merged;
}

export function shouldRetryWithAnotherAccount(
  status: number,
  policy: RouteExecutionPolicy,
): boolean {
  if (!Number.isFinite(status)) return false;
  return policy.retryStatusCodes.includes(status);
}

export function shouldFallbackClaudeByBridge(
  status: number,
  bodyText: string,
  policy: RouteExecutionPolicy,
): boolean {
  return resolveClaudeBridgeFallbackReason(status, bodyText, policy) !== "not_eligible";
}
