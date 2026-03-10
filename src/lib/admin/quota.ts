import crypto from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { quotaPolicies, quotaUsageWindows } from "../../db/schema";
import { parseIsoDateTime } from "../time-range";

export type QuotaScopeType = "global" | "tenant" | "project" | "role" | "user";
export const QUOTA_METERING_MODE = "estimate_then_reconcile" as const;
export type QuotaMeteringMode = typeof QUOTA_METERING_MODE;

export interface QuotaPolicyItem {
  id: string;
  name: string;
  scopeType: QuotaScopeType;
  scopeValue?: string;
  provider?: string;
  modelPattern?: string;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaPolicyInput {
  id?: string;
  name: string;
  scopeType: QuotaScopeType;
  scopeValue?: string;
  provider?: string;
  modelPattern?: string;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
  enabled?: boolean;
}

export interface QuotaCheckInput {
  provider: string;
  model: string;
  tenantId?: string;
  projectId?: string;
  roleKey?: string;
  userKey?: string;
  estimatedTokens: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  status?: number;
  reason?: string;
  policyId?: string;
  meteringMode?: QuotaMeteringMode;
  matchedWindows?: QuotaMatchedWindow[];
}

export interface QuotaMatchedWindow {
  policyId: string;
  minuteStart: number;
  dayStart: number;
}

export interface QuotaReconcileInput {
  matchedWindows: QuotaMatchedWindow[];
  estimatedTokens: number;
  actualTokens: number;
}

export interface QuotaMeteringRecord {
  policyId: string;
  estimatedTokens: number;
  actualTokens: number;
  reconciledDelta: number;
}

export interface QuotaUsageItem {
  id: number;
  policyId: string;
  policyName: string | null;
  bucketType: "minute" | "day";
  windowStart: number;
  requestCount: number;
  tokenCount: number;
  estimatedTokenCount: number;
  actualTokenCount: number;
  reconciledDelta: number;
  scopeType: string | null;
  scopeValue: string | null;
  provider: string | null;
  modelPattern: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaUsageQueryInput {
  policyId?: string;
  bucketType?: "minute" | "day";
  provider?: string;
  model?: string;
  tenantId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
}

export interface QuotaUsageQueryResult {
  data: QuotaUsageItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function normalizeScopeType(input: string): QuotaScopeType {
  switch ((input || "").trim().toLowerCase()) {
    case "tenant":
    case "project":
    case "role":
    case "user":
      return input.trim().toLowerCase() as QuotaScopeType;
    default:
      return "global";
  }
}

function toPolicyItem(row: typeof quotaPolicies.$inferSelect): QuotaPolicyItem {
  return {
    id: row.id,
    name: row.name,
    scopeType: normalizeScopeType(row.scopeType),
    scopeValue: row.scopeValue || undefined,
    provider: row.provider || undefined,
    modelPattern: row.modelPattern || undefined,
    requestsPerMinute: row.requestsPerMinute || undefined,
    tokensPerMinute: row.tokensPerMinute || undefined,
    tokensPerDay: row.tokensPerDay || undefined,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeProvider(input?: string): string | undefined {
  const value = (input || "").trim().toLowerCase();
  return value || undefined;
}

function normalizeScopeValue(input?: string): string | undefined {
  const value = (input || "").trim().toLowerCase();
  return value || undefined;
}

function normalizeModelPattern(input?: string): string | undefined {
  const value = (input || "").trim();
  return value || undefined;
}

function matchesModel(model: string, pattern?: string): boolean {
  if (!pattern || pattern === "*") return true;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(model);
}

function matchesScope(policy: QuotaPolicyItem, input: QuotaCheckInput): boolean {
  if (policy.scopeType === "global") return true;
  const value = (policy.scopeValue || "").trim();
  if (!value) return false;
  if (policy.scopeType === "tenant") return (input.tenantId || "") === value;
  if (policy.scopeType === "project") return (input.projectId || "") === value;
  if (policy.scopeType === "role") return (input.roleKey || "") === value;
  if (policy.scopeType === "user") return (input.userKey || "") === value;
  return false;
}

function windowStartMs(now: number, bucket: "minute" | "day"): number {
  if (bucket === "minute") {
    return Math.floor(now / 60_000) * 60_000;
  }
  return Math.floor(now / 86_400_000) * 86_400_000;
}

function parseUsageBucketType(input: string): "minute" | "day" | null {
  if (input === "minute" || input === "day") return input;
  return null;
}

async function getUsage(
  policyId: string,
  bucketType: "minute" | "day",
  windowStart: number,
) {
  const rows = await db
    .select()
    .from(quotaUsageWindows)
    .where(
      and(
        eq(quotaUsageWindows.policyId, policyId),
        eq(quotaUsageWindows.bucketType, bucketType),
        eq(quotaUsageWindows.windowStart, windowStart),
      ),
    )
    .limit(1);
  return rows[0] || null;
}

async function consumeUsage(
  policyId: string,
  bucketType: "minute" | "day",
  windowStart: number,
  reqDelta: number,
  tokenDelta: number,
  options?: {
    estimatedTokenDelta?: number;
    actualTokenDelta?: number;
    reconciledDelta?: number;
    clampTokenCount?: boolean;
  },
) {
  const nowIso = new Date().toISOString();
  const estimatedTokenDelta = options?.estimatedTokenDelta || 0;
  const actualTokenDelta = options?.actualTokenDelta || 0;
  const reconciledDelta = options?.reconciledDelta || 0;
  const insertTokenCount = options?.clampTokenCount
    ? Math.max(tokenDelta, 0)
    : tokenDelta;
  const tokenCountExpr = options?.clampTokenCount
    ? sql<number>`GREATEST(${quotaUsageWindows.tokenCount} + ${tokenDelta}, 0)`
    : sql<number>`${quotaUsageWindows.tokenCount} + ${tokenDelta}`;
  await db
    .insert(quotaUsageWindows)
    .values({
      policyId,
      bucketType,
      windowStart,
      requestCount: reqDelta,
      tokenCount: insertTokenCount,
      estimatedTokenCount: estimatedTokenDelta,
      actualTokenCount: actualTokenDelta,
      reconciledDelta,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: [
        quotaUsageWindows.policyId,
        quotaUsageWindows.bucketType,
        quotaUsageWindows.windowStart,
      ],
      set: {
        requestCount: sql`${quotaUsageWindows.requestCount} + ${reqDelta}`,
        tokenCount: tokenCountExpr,
        estimatedTokenCount: sql`${quotaUsageWindows.estimatedTokenCount} + ${estimatedTokenDelta}`,
        actualTokenCount: sql`${quotaUsageWindows.actualTokenCount} + ${actualTokenDelta}`,
        reconciledDelta: sql`${quotaUsageWindows.reconciledDelta} + ${reconciledDelta}`,
        updatedAt: nowIso,
      },
    });
}

export async function listQuotaPolicies(): Promise<QuotaPolicyItem[]> {
  try {
    const rows = await db
      .select()
      .from(quotaPolicies)
      .orderBy(desc(quotaPolicies.updatedAt));
    return rows.map(toPolicyItem);
  } catch {
    return [];
  }
}

export async function saveQuotaPolicy(input: QuotaPolicyInput): Promise<QuotaPolicyItem> {
  const nowIso = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const record = {
    id,
    name: input.name.trim(),
    scopeType: normalizeScopeType(input.scopeType),
    scopeValue: (input.scopeValue || "").trim() || null,
    provider: normalizeProvider(input.provider) || null,
    modelPattern: normalizeModelPattern(input.modelPattern) || null,
    requestsPerMinute:
      typeof input.requestsPerMinute === "number"
        ? Math.max(0, Math.floor(input.requestsPerMinute))
        : null,
    tokensPerMinute:
      typeof input.tokensPerMinute === "number"
        ? Math.max(0, Math.floor(input.tokensPerMinute))
        : null,
    tokensPerDay:
      typeof input.tokensPerDay === "number"
        ? Math.max(0, Math.floor(input.tokensPerDay))
        : null,
    enabled: input.enabled === false ? 0 : 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await db
    .insert(quotaPolicies)
    .values(record)
    .onConflictDoUpdate({
      target: quotaPolicies.id,
      set: {
        name: record.name,
        scopeType: record.scopeType,
        scopeValue: record.scopeValue,
        provider: record.provider,
        modelPattern: record.modelPattern,
        requestsPerMinute: record.requestsPerMinute,
        tokensPerMinute: record.tokensPerMinute,
        tokensPerDay: record.tokensPerDay,
        enabled: record.enabled,
        updatedAt: nowIso,
      },
    });

  return {
    id,
    name: record.name,
    scopeType: record.scopeType,
    scopeValue: record.scopeValue || undefined,
    provider: record.provider || undefined,
    modelPattern: record.modelPattern || undefined,
    requestsPerMinute: record.requestsPerMinute || undefined,
    tokensPerMinute: record.tokensPerMinute || undefined,
    tokensPerDay: record.tokensPerDay || undefined,
    enabled: record.enabled === 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function deleteQuotaPolicy(policyId: string): Promise<boolean> {
  const deleted = await db
    .delete(quotaPolicies)
    .where(eq(quotaPolicies.id, policyId))
    .returning({ id: quotaPolicies.id });
  if (deleted.length === 0) {
    return false;
  }
  await db.delete(quotaUsageWindows).where(eq(quotaUsageWindows.policyId, policyId));
  return true;
}

export async function listQuotaUsage(
  options: QuotaUsageQueryInput = {},
): Promise<QuotaUsageQueryResult> {
  const page = Math.max(1, Math.floor(options.page || 1));
  const fallbackPageSize = options.limit || 100;
  const pageSize = Math.min(
    Math.max(1, Math.floor(options.pageSize || fallbackPageSize)),
    500,
  );
  const offset = (page - 1) * pageSize;
  const filters = [];
  if (options.policyId) {
    filters.push(eq(quotaUsageWindows.policyId, options.policyId));
  }
  if (options.bucketType) {
    filters.push(eq(quotaUsageWindows.bucketType, options.bucketType));
  }
  const provider = normalizeProvider(options.provider);
  if (provider) {
    filters.push(eq(quotaPolicies.provider, provider));
  }
  const tenantId = normalizeScopeValue(options.tenantId);
  if (tenantId) {
    filters.push(eq(quotaPolicies.scopeType, "tenant"));
    filters.push(eq(quotaPolicies.scopeValue, tenantId));
  }
  const projectId = normalizeScopeValue(options.projectId);
  if (projectId) {
    filters.push(eq(quotaPolicies.scopeType, "project"));
    filters.push(eq(quotaPolicies.scopeValue, projectId));
  }
  const fromMs = parseIsoDateTime(options.from);
  const toMs = parseIsoDateTime(options.to);
  if (fromMs !== null) {
    filters.push(gte(quotaUsageWindows.windowStart, fromMs));
  }
  if (toMs !== null) {
    filters.push(lte(quotaUsageWindows.windowStart, toMs));
  }

  const query = db
    .select({
      usage: quotaUsageWindows,
      policy: quotaPolicies,
    })
    .from(quotaUsageWindows)
    .leftJoin(quotaPolicies, eq(quotaUsageWindows.policyId, quotaPolicies.id))
    .orderBy(desc(quotaUsageWindows.windowStart), desc(quotaUsageWindows.id));

  const rows = filters.length > 0 ? await query.where(and(...filters)) : await query;
  const model = (options.model || "").trim();

  const normalized: QuotaUsageItem[] = rows
    .map(({ usage, policy }) => {
      const bucketType = parseUsageBucketType(usage.bucketType);
      if (!bucketType) return null;
      return {
        ...usage,
        bucketType,
        policyName: policy?.name || null,
        scopeType: policy?.scopeType || null,
        scopeValue: policy?.scopeValue || null,
        provider: policy?.provider || null,
        modelPattern: policy?.modelPattern || null,
        estimatedTokenCount: usage.estimatedTokenCount,
        actualTokenCount: usage.actualTokenCount,
        reconciledDelta: usage.reconciledDelta,
      };
    })
    .filter((item): item is QuotaUsageItem => item !== null)
    .filter((item) => {
      if (!model) return true;
      return matchesModel(model, item.modelPattern || undefined);
    });

  const total = normalized.length;
  const data = normalized.slice(offset, offset + pageSize);
  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function checkAndConsumeQuota(input: QuotaCheckInput): Promise<QuotaCheckResult> {
  let policies: QuotaPolicyItem[] = [];
  try {
    policies = await listQuotaPolicies();
  } catch {
    return { allowed: true };
  }

  const activePolicies = policies.filter((item) => item.enabled);
  if (!activePolicies.length) {
    return { allowed: true, meteringMode: QUOTA_METERING_MODE };
  }

  const now = Date.now();
  const minuteStart = windowStartMs(now, "minute");
  const dayStart = windowStartMs(now, "day");

  const matchedPolicies = activePolicies.filter((policy) => {
    if (policy.provider && policy.provider !== input.provider) return false;
    if (!matchesModel(input.model, policy.modelPattern)) return false;
    return matchesScope(policy, input);
  });

  if (!matchedPolicies.length) {
    return { allowed: true, meteringMode: QUOTA_METERING_MODE };
  }

  const matchedWindows: QuotaMatchedWindow[] = matchedPolicies.map((policy) => ({
    policyId: policy.id,
    minuteStart,
    dayStart,
  }));

  for (const policy of matchedPolicies) {
    const minuteUsage = await getUsage(policy.id, "minute", minuteStart);
    const dayUsage = await getUsage(policy.id, "day", dayStart);

    const currentMinuteRequests = minuteUsage?.requestCount || 0;
    const currentMinuteTokens = minuteUsage?.tokenCount || 0;
    const currentDayTokens = dayUsage?.tokenCount || 0;

    if (
      typeof policy.requestsPerMinute === "number" &&
      currentMinuteRequests + 1 > policy.requestsPerMinute
    ) {
      return {
        allowed: false,
        status: 429,
        reason: `请求超出每分钟限制（策略：${policy.name}）`,
        policyId: policy.id,
        meteringMode: QUOTA_METERING_MODE,
        matchedWindows,
      };
    }

    if (
      typeof policy.tokensPerMinute === "number" &&
      currentMinuteTokens + input.estimatedTokens > policy.tokensPerMinute
    ) {
      return {
        allowed: false,
        status: 429,
        reason: `Token 超出每分钟限制（策略：${policy.name}）`,
        policyId: policy.id,
        meteringMode: QUOTA_METERING_MODE,
        matchedWindows,
      };
    }

    if (
      typeof policy.tokensPerDay === "number" &&
      currentDayTokens + input.estimatedTokens > policy.tokensPerDay
    ) {
      return {
        allowed: false,
        status: 429,
        reason: `Token 超出每日限制（策略：${policy.name}）`,
        policyId: policy.id,
        meteringMode: QUOTA_METERING_MODE,
        matchedWindows,
      };
    }
  }

  for (const policy of matchedPolicies) {
    await consumeUsage(policy.id, "minute", minuteStart, 1, input.estimatedTokens, {
      estimatedTokenDelta: input.estimatedTokens,
    });
    await consumeUsage(policy.id, "day", dayStart, 1, input.estimatedTokens, {
      estimatedTokenDelta: input.estimatedTokens,
    });
  }

  return {
    allowed: true,
    meteringMode: QUOTA_METERING_MODE,
    matchedWindows,
  };
}

export async function reconcileQuotaUsage(
  input: QuotaReconcileInput,
): Promise<QuotaMeteringRecord[]> {
  const estimatedTokens = Math.max(0, Math.floor(input.estimatedTokens));
  const actualTokens = Math.max(0, Math.floor(input.actualTokens));
  const reconciledDelta = actualTokens - estimatedTokens;
  const windows = Array.isArray(input.matchedWindows)
    ? input.matchedWindows.filter(
        (item) =>
          typeof item?.policyId === "string" &&
          item.policyId.trim() &&
          Number.isFinite(item.minuteStart) &&
          Number.isFinite(item.dayStart),
      )
    : [];
  if (windows.length === 0) return [];

  const records: QuotaMeteringRecord[] = [];
  for (const item of windows) {
    const policyId = item.policyId.trim();
    if (!policyId) continue;
    await consumeUsage(policyId, "minute", item.minuteStart, 0, reconciledDelta, {
      actualTokenDelta: actualTokens,
      reconciledDelta,
      clampTokenCount: true,
    });
    await consumeUsage(policyId, "day", item.dayStart, 0, reconciledDelta, {
      actualTokenDelta: actualTokens,
      reconciledDelta,
      clampTokenCount: true,
    });
    records.push({
      policyId,
      estimatedTokens,
      actualTokens,
      reconciledDelta,
    });
  }
  return records;
}
