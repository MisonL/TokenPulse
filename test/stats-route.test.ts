import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import stats from "../src/routes/stats";
import { db } from "../src/db";
import { getCache } from "../src/lib/cache";

async function ensureStatsTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.credentials (
        id text PRIMARY KEY,
        provider text NOT NULL,
        account_id text NOT NULL DEFAULT 'default',
        email text,
        access_token text,
        refresh_token text,
        expires_at bigint,
        metadata text,
        status text DEFAULT 'active',
        attributes text,
        next_refresh_after bigint,
        device_profile text,
        consecutive_failures integer NOT NULL DEFAULT 0,
        last_failure_at bigint,
        last_failure_reason text,
        last_refresh text,
        created_at text,
        updated_at text
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.request_logs (
        id serial PRIMARY KEY,
        timestamp text NOT NULL,
        provider text,
        method text,
        path text,
        status integer,
        latency_ms integer,
        prompt_tokens integer,
        completion_tokens integer,
        model text,
        trace_id text,
        account_id text
      )
    `),
  );
}

describe("统计路由", () => {
  beforeAll(async () => {
    await ensureStatsTables();
  });

  beforeEach(async () => {
    getCache().clear();
    await db.execute(sql.raw("DELETE FROM core.request_logs"));
    await db.execute(sql.raw("DELETE FROM core.credentials"));
  });

  it("应在 PostgreSQL execute 结果下正常返回统计数据", async () => {
    const now = new Date().toISOString();
    await db.execute(
      sql.raw(`
        INSERT INTO core.credentials (id, provider, account_id, status, created_at, updated_at)
        VALUES ('cred-1', 'claude', 'default', 'active', '${now}', '${now}')
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO core.request_logs (timestamp, provider, method, path, status, latency_ms, prompt_tokens, completion_tokens, model, trace_id, account_id)
        VALUES ('${now}', 'claude', 'POST', '/v1/chat/completions', 200, 123, 10, 20, 'claude-sonnet-4-5', 'trace-1', 'default')
      `),
    );

    const response = await stats.fetch(new Request("http://localhost/"));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.total_requests).toBe(1);
    expect(payload.active_providers).toBe(1);
    expect(payload.tokens.total).toBe(30);
    expect(Array.isArray(payload.traffic_history)).toBeTrue();
    expect(payload.traffic_history.length).toBe(12);
  });
});
