import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { app as coreApp } from "../apps/core/src/index";
import { app as enterpriseApp } from "../apps/enterprise/src/index";
import { config } from "../src/config";
import { db } from "../src/db";
import { VERIFY_SECRET_PATH } from "../src/routes/auth";

describe("双服务切换入口回归", () => {
  const originalEnableAdvanced = config.enableAdvanced;
  const originalEnterpriseBaseUrl = config.enterprise.baseUrl;
  const originalEnterpriseSharedKey = config.enterprise.internalSharedKey;
  const originalAgentLedgerEnabled = config.agentLedger.enabled;
  const originalAgentLedgerConsoleUrl = config.agentLedger.consoleUrl;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS core.system_logs (
          id serial PRIMARY KEY,
          timestamp text NOT NULL,
          level text NOT NULL,
          source text NOT NULL,
          message text NOT NULL
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
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS core.settings (
          key text PRIMARY KEY,
          value text NOT NULL,
          description text,
          updated_at text
        )
      `),
    );
  });

  afterEach(() => {
    config.enableAdvanced = originalEnableAdvanced;
    config.enterprise.baseUrl = originalEnterpriseBaseUrl;
    config.enterprise.internalSharedKey = originalEnterpriseSharedKey;
    config.agentLedger.enabled = originalAgentLedgerEnabled;
    config.agentLedger.consoleUrl = originalAgentLedgerConsoleUrl;
    globalThis.fetch = originalFetch;
  });

  it("core 应暴露 /api/auth/verify-secret 并复用严格认证", async () => {
    const response = await coreApp.fetch(
      new Request(`http://localhost${VERIFY_SECRET_PATH}`, {
        headers: {
          Authorization: `Bearer ${config.apiSecret}`,
          "x-request-id": "trace-core-verify-secret-success-001",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("core 的 /api/auth/verify-secret 在认证失败时应保持 401 JSON + traceId", async () => {
    const traceId = "trace-core-verify-secret-failed-001";
    const response = await coreApp.fetch(
      new Request(`http://localhost${VERIFY_SECRET_PATH}`, {
        headers: {
          Authorization: "Bearer invalid-secret",
          "x-request-id": traceId,
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json() as {
      error?: string;
      traceId?: string;
    };
    expect(payload.error).toBe("未授权：缺少认证信息或认证无效");
    expect(payload.traceId).toBe(traceId);
  });

  it("core 的 /api/admin/features 应保持前端可直连", async () => {
    config.enableAdvanced = false;
    config.agentLedger.enabled = true;
    config.agentLedger.consoleUrl = "https://agentledger.example.test";

    const response = await coreApp.fetch(new Request("http://localhost/api/admin/features"));

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      edition?: string;
      features?: { enterprise?: boolean };
      enterpriseBackend?: { configured?: boolean; reachable?: boolean };
      agentLedger?: { enabled?: boolean; consoleUrl?: string };
    };
    expect(payload.edition).toBe("standard");
    expect(payload.features?.enterprise).toBe(false);
    expect(payload.enterpriseBackend?.reachable).toBe(false);
    expect(payload.agentLedger?.enabled).toBe(true);
    expect(payload.agentLedger?.consoleUrl).toBe("https://agentledger.example.test");
  });

  it("core 应通过代理将 /api/admin/* 转发到 enterprise", async () => {
    config.enableAdvanced = true;
    config.enterprise.baseUrl = "http://enterprise.local";
    config.enterprise.internalSharedKey = "shared-key";

    const calls: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({ success: true, source: "enterprise" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as typeof globalThis.fetch;

    const response = await coreApp.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: {
          Authorization: `Bearer ${config.apiSecret}`,
          "x-admin-user": "release-owner",
          "x-admin-role": "owner",
          "x-request-id": "trace-core-admin-proxy-001",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, source: "enterprise" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://enterprise.local/api/admin/observability/oauth-alerts/config");
    expect(calls[0]?.headers.get("x-tokenpulse-internal-key")).toBe("shared-key");
    expect(calls[0]?.headers.get("x-tokenpulse-forwarded-by")).toBe("core");
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${config.apiSecret}`);
    expect(response.headers.get("x-tokenpulse-admin-proxy")).toBe("core");
    expect(response.headers.get("x-tokenpulse-enterprise-proxy")).toBe("core");
  });

  it("core 应将 /api/admin/auth/* 作为白名单代理到 enterprise", async () => {
    config.enableAdvanced = true;
    config.enterprise.baseUrl = "http://enterprise.local";
    config.enterprise.internalSharedKey = "shared-key";

    const calls: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as typeof globalThis.fetch;

    const response = await coreApp.fetch(
      new Request("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "trace-core-admin-auth-proxy-001",
        },
        body: JSON.stringify({
          username: "demo",
          password: "secret",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://enterprise.local/api/admin/auth/login");
    expect(calls[0]?.headers.get("x-tokenpulse-internal-key")).toBe("shared-key");
  });

  it("enterprise 在配置共享密钥后应只接受来自 core 的 /api/admin/* 请求", async () => {
    config.enterprise.internalSharedKey = "shared-key";

    const denied = await enterpriseApp.fetch(
      new Request("http://localhost/api/admin/features"),
    );
    expect(denied.status).toBe(403);
    const deniedPayload = await denied.json() as {
      error?: string;
      traceId?: string;
    };
    expect(deniedPayload.error).toBe("enterprise 内部鉴权失败");
    expect(deniedPayload.traceId).toBeTruthy();

    const allowed = await enterpriseApp.fetch(
      new Request("http://localhost/api/admin/features", {
        headers: {
          "x-tokenpulse-internal-key": "shared-key",
        },
      }),
    );
    expect(allowed.status).toBe(200);
  });
});
