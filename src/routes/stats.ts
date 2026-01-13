import { Hono } from 'hono';

const stats = new Hono();

import { db } from '../db';
import { credentials, requestLogs } from '../db/schema';
import { count, avg, desc, sql, gte } from 'drizzle-orm';
import { getCache } from '../lib/cache';

const cache = getCache();

stats.get('/', async (c) => {
    // Try to get from cache first
    const cached = await cache.get('stats');
    if (cached) {
        return c.json(cached);
    }
    // 1. Active Providers
    const creds = await db.select().from(credentials);
    const active_providers = creds.length;

    // 2. Total Requests & Avg Latency (Overall)
    const logStats = await db.select({
        count: count(),
        avgLatency: avg(requestLogs.latencyMs)
    }).from(requestLogs);
    
    const total_requests = logStats[0]?.count || 0;
    const avg_latency_ms = Math.round(Number(logStats[0]?.avgLatency) || 0);

    // 3. Traffic History (Last 12 Minutes)
    // We want 12 data points.
    // Query last 12 minutes grouped by minute.
    const now = new Date();
    const historyMap = new Map<string, number>();
    
    // Initialize map with last 12 minutes (including current)
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 60000);
        const key = d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
        historyMap.set(key, 0);
    }
    
    // Query DB for counts in this range
    // Note: Drizzle raw SQL is easiest here for Date string manipulation in SQLite
    const rangeStart = new Date(now.getTime() - 12 * 60000).toISOString();
    
    const results = await db.all(
        sql`SELECT substr(timestamp, 1, 16) as bucket, count(*) as count 
            FROM request_logs 
            WHERE timestamp >= ${rangeStart} 
            GROUP BY bucket`
    );

    // Fill Map
    for (const r of results as unknown as { bucket: string; count: number }[]) {
       if (historyMap.has(String(r.bucket))) {
           historyMap.set(String(r.bucket), Number(r.count));
       }
    }

    const traffic_history = Array.from(historyMap.values());

    // Calculate uptime_percentage based on successful requests (status 200-299)
    const successRate = await db.select({
        success: count(sql`CASE WHEN status >= 200 AND status < 300 THEN 1 END`)
    }).from(requestLogs);
    
    const uptime_percentage = (successRate[0]?.success !== undefined && successRate[0].success > 0)
        ? Math.round((successRate[0].success / total_requests) * 100 * 100) / 100 
        : 100;

    const result = {
        active_providers,
        total_requests,
        avg_latency_ms,
        uptime_percentage,
        traffic_history
    };

    // Cache for 5 seconds
    await cache.set('stats', result, 5000);

    return c.json(result);
});

export default stats;
