import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { oauthCallbackStore } from "../src/lib/auth/oauth-callback-store";
import enterprise from "../src/routes/enterprise";

function createAdminApp() {
  const app = new Hono();
  app.route("/api/admin", enterprise);
  return app;
}

function ownerHeaders(extra?: Record<string, string>) {
  return {
    "x-admin-user": "owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    ...(extra || {}),
  };
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;

describe("OAuth 回调事件管理接口", () => {
  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;

    const nowIso = new Date().toISOString();
    await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
    await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS enterprise.admin_roles (
          key text PRIMARY KEY,
          name text NOT NULL,
          permissions text NOT NULL,
          builtin integer NOT NULL DEFAULT 0,
          created_at text NOT NULL,
          updated_at text NOT NULL
        )
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS core.oauth_callbacks (
          id serial PRIMARY KEY,
          provider text NOT NULL,
          state text,
          code text,
          error text,
          source text NOT NULL,
          status text NOT NULL,
          raw text,
          trace_id text,
          created_at text NOT NULL
        )
      `),
    );
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
    await db.execute(sql.raw("DELETE FROM core.oauth_callbacks"));
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
        VALUES (
          'owner',
          '所有者',
          '["admin.dashboard.read","admin.users.manage","admin.org.read","admin.org.manage","admin.rbac.manage","admin.tenants.manage","admin.oauth.manage","admin.billing.manage","admin.audit.read","admin.audit.write"]',
          1,
          '${nowIso}',
          '${nowIso}'
        )
      `),
    );

    oauthCallbackStore.clearMemoryForTest();

    await oauthCallbackStore.append({
      provider: "claude",
      state: "callback-admin-state-1",
      code: "code-1",
      source: "aggregate",
      status: "success",
      traceId: "trace-callback-route-1",
    });
    await Bun.sleep(2);
    await oauthCallbackStore.append({
      provider: "claude",
      state: "callback-admin-state-1-extra",
      error: "callback error",
      source: "aggregate",
      status: "failure",
      traceId: "trace-callback-route-2",
    });
    await Bun.sleep(2);
    await oauthCallbackStore.append({
      provider: "gemini",
      state: "callback-admin-state-2",
      error: "manual callback error",
      source: "manual",
      status: "failure",
      traceId: "trace-callback-route-3",
    });
  });

  afterAll(async () => {
    await db.execute(sql.raw("DELETE FROM core.oauth_callbacks"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("GET /api/admin/oauth/callback-events 应支持 provider/status/source/traceId 组合过滤", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/callback-events?page=1&pageSize=10&provider=gemini&status=failure&source=manual&traceId=trace-callback-route-3",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.total).toBe(1);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.provider).toBe("gemini");
    expect(payload.data[0]?.status).toBe("failure");
    expect(payload.data[0]?.source).toBe("manual");
    expect(payload.data[0]?.traceId).toBe("trace-callback-route-3");
  });

  it("GET /api/admin/oauth/callback-events/:state 应按精确 state 点查，不应混入前缀匹配记录", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/oauth/callback-events/callback-admin-state-1?pageSize=50", {
        headers: ownerHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.total).toBe(1);
    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(50);
    expect(payload.totalPages).toBe(1);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.state).toBe("callback-admin-state-1");
    expect(payload.data[0]?.traceId).toBe("trace-callback-route-1");
  });

  it("GET /api/admin/oauth/callback-events 时间范围非法时应返回 400", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/callback-events?from=2026-03-06T10:00:00.000Z&to=2026-03-05T10:00:00.000Z",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("from");
  });

  it("GET /api/admin/oauth/callback-events/export 应返回 CSV", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/callback-events/export?provider=claude&status=success&limit=50",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") || "").toContain("text/csv");
    expect(response.headers.get("content-disposition") || "").toContain("oauth-callback-events-");
    const text = await response.text();
    expect(text.startsWith("\uFEFFid,provider,state,code,error,source,status,traceId,createdAt,raw\n")).toBe(true);
    expect(text).toContain("callback-admin-state-1");
    expect(text).not.toContain("callback-admin-state-1-extra");
  });
});
