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

function csvHeader() {
  return "\uFEFFid,state,provider,flowType,phase,status,eventType,error,createdAt,createdAtMs";
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
    await Bun.sleep(2);

    await oauthSessionStore.register("state-route-3", "qwen", undefined, {
      flowType: "device_code",
    });
    await Bun.sleep(2);
    await oauthSessionStore.markError("state-route-3", "qwen device error");
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

  it("GET /api/admin/oauth/session-events/export 在空结果时应返回仅表头 CSV", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events/export?state=state-not-found&limit=50",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") || "").toContain("text/csv");
    const text = await response.text();
    expect(text).toBe(csvHeader());
  });

  it("GET /api/admin/oauth/session-events 应支持 from/to 时间窗精确过滤", async () => {
    const app = createAdminApp();

    const seedResponse = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events?state=state-route-1&page=1&pageSize=20",
        {
          headers: ownerHeaders(),
        },
      ),
    );
    expect(seedResponse.status).toBe(200);
    const seedPayload = (await seedResponse.json()) as {
      data: Array<{ eventType: string; createdAt: number }>;
    };

    const registerEvent = seedPayload.data.find((item) => item.eventType === "register");
    expect(registerEvent).toBeDefined();
    const registerAt = registerEvent!.createdAt;
    const from = new Date(registerAt).toISOString();
    const to = new Date(registerAt).toISOString();

    const windowResponse = await app.fetch(
      new Request(
        `http://localhost/api/admin/oauth/session-events?state=state-route-1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=1&pageSize=20`,
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(windowResponse.status).toBe(200);
    const windowPayload = await windowResponse.json();
    expect(windowPayload.total).toBe(1);
    expect(windowPayload.data[0]?.eventType).toBe("register");
    expect(windowPayload.data[0]?.createdAt).toBe(registerAt);
  });

  it("GET /api/admin/oauth/session-events 应支持多过滤组合", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events?page=1&pageSize=10&state=state-route-3&provider=qwen&flowType=device_code&phase=error&status=error&eventType=mark_error",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.total).toBe(1);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.state).toBe("state-route-3");
    expect(payload.data[0]?.provider).toBe("qwen");
    expect(payload.data[0]?.flowType).toBe("device_code");
    expect(payload.data[0]?.phase).toBe("error");
    expect(payload.data[0]?.status).toBe("error");
    expect(payload.data[0]?.eventType).toBe("mark_error");
  });

  it("GET /api/admin/oauth/session-events/:state 与 ?state 查询结果应一致", async () => {
    const app = createAdminApp();

    const byStateResponse = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events/state-route-2?page=1&pageSize=50&provider=gemini",
        {
          headers: ownerHeaders(),
        },
      ),
    );
    const byQueryResponse = await app.fetch(
      new Request(
        "http://localhost/api/admin/oauth/session-events?page=1&pageSize=50&state=state-route-2&provider=gemini",
        {
          headers: ownerHeaders(),
        },
      ),
    );

    expect(byStateResponse.status).toBe(200);
    expect(byQueryResponse.status).toBe(200);

    const byStatePayload = await byStateResponse.json();
    const byQueryPayload = await byQueryResponse.json();

    expect(byStatePayload.total).toBeGreaterThan(0);
    expect(byStatePayload.total).toBe(byQueryPayload.total);

    const normalize = (rows: Array<Record<string, unknown>>) =>
      rows.map((item) => ({
        id: item.id,
        state: item.state,
        provider: item.provider,
        flowType: item.flowType,
        phase: item.phase,
        status: item.status,
        eventType: item.eventType,
        error: item.error,
        createdAt: item.createdAt,
      }));

    expect(normalize(byStatePayload.data)).toEqual(normalize(byQueryPayload.data));
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
    expect(text.startsWith(`${csvHeader()}\n`)).toBe(true);
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
