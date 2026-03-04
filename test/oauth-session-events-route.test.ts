import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { oauthSessionStore } from "../src/lib/auth/oauth-session-store";
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

describe("OAuth 会话事件管理接口", () => {
  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;

    const nowIso = new Date().toISOString();
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
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
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

    oauthSessionStore.clearMemoryForTest();
    await oauthSessionStore.register("state-route-1", "claude");
    await Bun.sleep(2);
    await oauthSessionStore.setPhase("state-route-1", "exchanging");
    await Bun.sleep(2);

    await oauthSessionStore.register("state-route-2", "gemini");
    await Bun.sleep(2);
    await oauthSessionStore.markError("state-route-2", "route test error");
  });

  afterAll(async () => {
    await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("GET /api/admin/oauth/session-events 应支持分页和基础过滤", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events?page=1&pageSize=5&provider=claude&eventType=register",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(5);
    expect(payload.total).toBeGreaterThan(0);
    expect(Array.isArray(payload.data)).toBe(true);
    for (const item of payload.data as Array<Record<string, unknown>>) {
      expect(item.provider).toBe("claude");
      expect(item.eventType).toBe("register");
    }
  });

  it("GET /api/admin/oauth/session-events/:state 应按 state 聚合查询", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/oauth/session-events/state-route-2", {
        headers: ownerHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.total).toBeGreaterThan(0);
    for (const item of payload.data as Array<Record<string, unknown>>) {
      expect(item.state).toBe("state-route-2");
    }
  });

  it("GET /api/admin/oauth/session-events/export 应返回 CSV", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events/export?provider=claude&eventType=register&limit=50",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") || "").toContain("text/csv");
    const contentDisposition = response.headers.get("content-disposition") || "";
    expect(contentDisposition).toContain("oauth-session-events-");
    const text = await response.text();
    expect(text.startsWith("\uFEFFid,state,provider,flowType,phase,status,eventType,error,createdAt,createdAtMs\n")).toBe(
      true,
    );
    expect(text).toContain(",claude,");
  });

  it("时间范围非法时应返回 400", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events?from=2026-03-05T00:00:00.000Z&to=2026-03-04T00:00:00.000Z",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain("from");
  });
});
