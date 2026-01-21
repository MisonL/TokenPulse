import { Hono } from "hono";

const stats = new Hono();

import { db } from "../db";
import { credentials, requestLogs } from "../db/schema";
import { count, avg, desc, sql, gte } from "drizzle-orm";
import { getCache } from "../lib/cache";

const cache = getCache();

stats.get("/", async (c) => {
  // 尝试先从缓存获取
  const cached = await cache.get("stats");
  if (cached) {
    return c.json(cached);
  }
  // 1. 活跃提供商
  const creds = await db.select().from(credentials);
  const active_providers = creds.length;

  // 2. 总请求数 & 平均延迟（整体）
  const logStats = await db
    .select({
      count: count(),
      avgLatency: avg(requestLogs.latencyMs),
      totalPromptTokens: sql`sum(prompt_tokens)`,
      totalCompletionTokens: sql`sum(completion_tokens)`,
    })
    .from(requestLogs);

  const total_requests = logStats[0]?.count || 0;
  const avg_latency_ms = Math.round(Number(logStats[0]?.avgLatency) || 0);
  const total_prompt_tokens = Number(logStats[0]?.totalPromptTokens) || 0;
  const total_completion_tokens =
    Number(logStats[0]?.totalCompletionTokens) || 0;

  // 3. 流量历史（最近 12 分钟）
  // 我们需要 12 个数据点。
  // 查询按分钟分组的最近 12 分钟数据。
  const now = new Date();
  const historyMap = new Map<string, number>();

  // 使用最近 12 分钟（包括当前）初始化 map
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60000);
    const key = d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    historyMap.set(key, 0);
  }

  // 查询该范围内的计数
  // 注意：Drizzle 原生 SQL 在这里处理 SQLite 日期字符串最简单
  const rangeStart = new Date(now.getTime() - 12 * 60000).toISOString();

  const results = await db.all(
    sql`SELECT substr(timestamp, 1, 16) as bucket, count(*) as count 
            FROM request_logs 
            WHERE timestamp >= ${rangeStart} 
            GROUP BY bucket`,
  );

  // 填充 Map
  for (const r of results as unknown as { bucket: string; count: number }[]) {
    if (historyMap.has(String(r.bucket))) {
      historyMap.set(String(r.bucket), Number(r.count));
    }
  }

  const traffic_history = Array.from(historyMap.values());

  // 基于成功请求（状态码 200-299）计算正常运行时间百分比
  const successRate = await db
    .select({
      success: count(sql`CASE WHEN status >= 200 AND status < 300 THEN 1 END`),
    })
    .from(requestLogs);

  const uptime_percentage =
    successRate[0]?.success !== undefined && successRate[0].success > 0
      ? Math.round((successRate[0].success / total_requests) * 100 * 100) / 100
      : 100;

  // 4. 提供商细分
  const providerStats = await db
    .select({
      provider: requestLogs.provider,
      count: count(),
      prompt: sql`sum(prompt_tokens)`,
      completion: sql`sum(completion_tokens)`,
    })
    .from(requestLogs)
    .groupBy(requestLogs.provider);

  const result = {
    active_providers,
    total_requests,
    avg_latency_ms,
    uptime_percentage,
    traffic_history,
    tokens: {
      prompt: total_prompt_tokens,
      completion: total_completion_tokens,
      total: total_prompt_tokens + total_completion_tokens,
    },
    providers: providerStats
      .filter((ps) => ps.provider) // 跳过 null/空值
      .map((ps) => ({
        name: ps.provider as string,
        requests: ps.count,
        tokens: Number(ps.prompt || 0) + Number(ps.completion || 0),
      })),
  };

  // 缓存 5 秒
  await cache.set("stats", result, 5000);

  return c.json(result);
});

export default stats;
