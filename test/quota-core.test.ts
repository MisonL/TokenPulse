import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { quotaUsageWindows } from "../src/db/schema";

type QuotaModule = typeof import("../src/lib/admin/quota");
let quota: QuotaModule;

async function ensureQuotaTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.quota_policies (
        id text PRIMARY KEY,
        name text NOT NULL,
        scope_type text NOT NULL,
        scope_value text,
        provider text,
        model_pattern text,
        requests_per_minute integer,
        tokens_per_minute integer,
        tokens_per_day integer,
        enabled integer NOT NULL DEFAULT 1,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.quota_usage_windows (
        id serial PRIMARY KEY,
        policy_id text NOT NULL,
        bucket_type text NOT NULL,
        window_start bigint NOT NULL,
        request_count integer NOT NULL DEFAULT 0,
        token_count integer NOT NULL DEFAULT 0,
        estimated_token_count integer NOT NULL DEFAULT 0,
        actual_token_count integer NOT NULL DEFAULT 0,
        reconciled_delta integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        UNIQUE(policy_id, bucket_type, window_start)
      )
    `),
  );
}

function minuteStart(now: number) {
  return Math.floor(now / 60_000) * 60_000;
}

function dayStart(now: number) {
  return Math.floor(now / 86_400_000) * 86_400_000;
}

async function getWindow(
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

describe("quota 核心算法", () => {
  beforeAll(async () => {
    await ensureQuotaTables();
    // 避免被其他测试文件的 mock.module 污染，使用 cache bust 动态导入真实模块。
    const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    quota = (await import(
      `../src/lib/admin/quota?quota-core=${cacheBust}`
    )) as QuotaModule;
  });

  beforeEach(async () => {
    await db.execute(sql.raw("DELETE FROM enterprise.quota_usage_windows"));
    await db.execute(sql.raw("DELETE FROM enterprise.quota_policies"));
  });

  it("checkAndConsumeQuota 应在同一 DB 窗口累计 minute/day 使用", async () => {
    const fixedNow = 1_700_000_000_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await quota.saveQuotaPolicy({
        id: "policy-acc-1",
        name: "acc",
        scopeType: "global",
        provider: "openai",
        modelPattern: "*",
        tokensPerMinute: 10_000,
        tokensPerDay: 100_000,
        enabled: true,
      });

      const input = {
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 10,
      };

      const first = await quota.checkAndConsumeQuota(input);
      expect(first.allowed).toBe(true);
      const second = await quota.checkAndConsumeQuota(input);
      expect(second.allowed).toBe(true);

      const mStart = minuteStart(fixedNow);
      const dStart = dayStart(fixedNow);

      const minuteRow = await getWindow("policy-acc-1", "minute", mStart);
      const dayRow = await getWindow("policy-acc-1", "day", dStart);

      expect(minuteRow?.requestCount).toBe(2);
      expect(minuteRow?.tokenCount).toBe(20);
      expect(minuteRow?.estimatedTokenCount).toBe(20);
      expect(minuteRow?.actualTokenCount).toBe(0);
      expect(minuteRow?.reconciledDelta).toBe(0);

      expect(dayRow?.requestCount).toBe(2);
      expect(dayRow?.tokenCount).toBe(20);
      expect(dayRow?.estimatedTokenCount).toBe(20);
      expect(dayRow?.actualTokenCount).toBe(0);
      expect(dayRow?.reconciledDelta).toBe(0);
    } finally {
      Date.now = originalNow;
    }
  });

  it("checkAndConsumeQuota 应基于窗口累计拒绝超额请求，且拒绝不写入增量", async () => {
    const fixedNow = 1_700_000_111_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await quota.saveQuotaPolicy({
        id: "policy-limit-1",
        name: "limit",
        scopeType: "global",
        provider: "openai",
        modelPattern: "*",
        tokensPerMinute: 10,
        tokensPerDay: 100,
        enabled: true,
      });

      const input = {
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 6,
      };

      const first = await quota.checkAndConsumeQuota(input);
      expect(first.allowed).toBe(true);

      const second = await quota.checkAndConsumeQuota(input);
      expect(second.allowed).toBe(false);
      expect(second.status).toBe(429);
      expect(second.policyId).toBe("policy-limit-1");
      expect(second.reason).toContain("Token 超出每分钟限制");

      const mStart = minuteStart(fixedNow);
      const dStart = dayStart(fixedNow);
      expect(second.matchedWindows?.[0]).toEqual({
        policyId: "policy-limit-1",
        minuteStart: mStart,
        dayStart: dStart,
      });

      const minuteRow = await getWindow("policy-limit-1", "minute", mStart);
      const dayRow = await getWindow("policy-limit-1", "day", dStart);

      expect(minuteRow?.requestCount).toBe(1);
      expect(minuteRow?.tokenCount).toBe(6);
      expect(minuteRow?.estimatedTokenCount).toBe(6);
      expect(minuteRow?.actualTokenCount).toBe(0);
      expect(minuteRow?.reconciledDelta).toBe(0);

      expect(dayRow?.requestCount).toBe(1);
      expect(dayRow?.tokenCount).toBe(6);
      expect(dayRow?.estimatedTokenCount).toBe(6);
      expect(dayRow?.actualTokenCount).toBe(0);
      expect(dayRow?.reconciledDelta).toBe(0);
    } finally {
      Date.now = originalNow;
    }
  });

  it("reconcileQuotaUsage 应在同一窗口累计实际 token 并修正 tokenCount", async () => {
    const fixedNow = 1_700_000_222_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await quota.saveQuotaPolicy({
        id: "policy-reconcile-1",
        name: "reconcile",
        scopeType: "global",
        provider: "openai",
        modelPattern: "*",
        tokensPerMinute: 10_000,
        tokensPerDay: 100_000,
        enabled: true,
      });

      const first = await quota.checkAndConsumeQuota({
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 8,
      });
      expect(first.allowed).toBe(true);
      expect(first.matchedWindows?.[0]?.policyId).toBe("policy-reconcile-1");

      await quota.reconcileQuotaUsage({
        matchedWindows: first.matchedWindows || [],
        estimatedTokens: 8,
        actualTokens: 10,
      });

      const second = await quota.checkAndConsumeQuota({
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 5,
      });
      expect(second.allowed).toBe(true);

      await quota.reconcileQuotaUsage({
        matchedWindows: second.matchedWindows || [],
        estimatedTokens: 5,
        actualTokens: 3,
      });

      const mStart = minuteStart(fixedNow);
      const dStart = dayStart(fixedNow);
      const minuteRow = await getWindow("policy-reconcile-1", "minute", mStart);
      const dayRow = await getWindow("policy-reconcile-1", "day", dStart);

      for (const row of [minuteRow, dayRow]) {
        expect(row?.requestCount).toBe(2);
        expect(row?.tokenCount).toBe(13);
        expect(row?.estimatedTokenCount).toBe(13);
        expect(row?.actualTokenCount).toBe(13);
        expect(row?.reconciledDelta).toBe(0);
      }
    } finally {
      Date.now = originalNow;
    }
  });

  it("reconcileQuotaUsage 应 clamp tokenCount，避免更新后变为负数", async () => {
    const fixedNow = 1_700_000_333_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await quota.saveQuotaPolicy({
        id: "policy-clamp-update",
        name: "clamp-update",
        scopeType: "global",
        provider: "openai",
        modelPattern: "*",
        tokensPerMinute: 10_000,
        tokensPerDay: 100_000,
        enabled: true,
      });

      const checked = await quota.checkAndConsumeQuota({
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 1,
      });
      expect(checked.allowed).toBe(true);

      await quota.reconcileQuotaUsage({
        matchedWindows: checked.matchedWindows || [],
        estimatedTokens: 100,
        actualTokens: 0,
      });

      const mStart = minuteStart(fixedNow);
      const dStart = dayStart(fixedNow);
      const minuteRow = await getWindow("policy-clamp-update", "minute", mStart);
      const dayRow = await getWindow("policy-clamp-update", "day", dStart);

      expect(minuteRow?.tokenCount).toBe(0);
      expect(dayRow?.tokenCount).toBe(0);
    } finally {
      Date.now = originalNow;
    }
  });

  it("reconcileQuotaUsage 在窗口记录不存在时也应 clamp tokenCount（避免插入负数）", async () => {
    const fixedNow = 1_700_000_444_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await quota.saveQuotaPolicy({
        id: "policy-clamp-insert",
        name: "clamp-insert",
        scopeType: "global",
        provider: "openai",
        modelPattern: "*",
        tokensPerMinute: 10_000,
        tokensPerDay: 100_000,
        enabled: true,
      });

      const mStart = minuteStart(fixedNow);
      const dStart = dayStart(fixedNow);

      await quota.reconcileQuotaUsage({
        matchedWindows: [
          {
            policyId: "policy-clamp-insert",
            minuteStart: mStart,
            dayStart: dStart,
          },
        ],
        estimatedTokens: 10,
        actualTokens: 0,
      });

      const minuteRow = await getWindow("policy-clamp-insert", "minute", mStart);
      const dayRow = await getWindow("policy-clamp-insert", "day", dStart);

      for (const row of [minuteRow, dayRow]) {
        expect(row?.requestCount).toBe(0);
        expect(row?.tokenCount).toBe(0);
        expect(row?.estimatedTokenCount).toBe(0);
        expect(row?.actualTokenCount).toBe(0);
        expect(row?.reconciledDelta).toBe(-10);
      }
    } finally {
      Date.now = originalNow;
    }
  });

  it("scopeType=project 应仅在 projectId 匹配时生效", async () => {
    const fixedNow = 1_700_000_555_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await quota.saveQuotaPolicy({
        id: "policy-project-1",
        name: "project-limit",
        scopeType: "project",
        scopeValue: "project-a",
        provider: "openai",
        modelPattern: "*",
        tokensPerMinute: 1,
        tokensPerDay: 100,
        enabled: true,
      });

      const noProject = await quota.checkAndConsumeQuota({
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 1,
      });
      expect(noProject.allowed).toBe(true);
      expect(noProject.matchedWindows?.length || 0).toBe(0);

      const wrongProject = await quota.checkAndConsumeQuota({
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 1,
        projectId: "project-b",
      });
      expect(wrongProject.allowed).toBe(true);
      expect(wrongProject.matchedWindows?.length || 0).toBe(0);

      const first = await quota.checkAndConsumeQuota({
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 1,
        projectId: "project-a",
      });
      expect(first.allowed).toBe(true);
      expect(first.matchedWindows?.[0]?.policyId).toBe("policy-project-1");

      const second = await quota.checkAndConsumeQuota({
        provider: "openai",
        model: "gpt-4o-mini",
        estimatedTokens: 1,
        projectId: "project-a",
      });
      expect(second.allowed).toBe(false);
      expect(second.status).toBe(429);
      expect(second.policyId).toBe("policy-project-1");
      expect(second.reason).toContain("Token 超出每分钟限制");
    } finally {
      Date.now = originalNow;
    }
  });
});
