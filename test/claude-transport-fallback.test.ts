import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AuthConfig } from "../src/lib/auth/oauth-client";
import { config } from "../src/config";
import { db } from "../src/db";
import { sql } from "drizzle-orm";

const fetchWithRetryMock = mock(async (..._args: unknown[]) => new Response("not mocked", { status: 500 }));
const getValidTokenMock = mock(async (..._args: unknown[]) => null as any);
const clearFailureByCredentialIdMock = mock(async (..._args: unknown[]) => {});
const markFailureByCredentialIdMock = mock(async (..._args: unknown[]) => {});
const getOAuthSelectionConfigMock = mock(async () => ({
  defaultPolicy: "round_robin",
  allowHeaderOverride: false,
  allowHeaderAccountOverride: false,
  failureCooldownSec: 0,
  maxRetryOnAccountFailure: 0,
}));
const defaultRouteExecutionPolicy = {
  emitRouteHeaders: true,
  retryStatusCodes: [401, 403, 429, 500, 502, 503, 504],
  claudeFallbackStatusCodes: [401, 403, 408, 409, 425, 429, 500, 502, 503, 504],
};
const routeExecutionPolicyState = {
  ...defaultRouteExecutionPolicy,
};
const getRouteExecutionPolicyMock = mock(async () => ({
  ...routeExecutionPolicyState,
}));

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

mock.module("../src/lib/http", () => ({
  fetchWithRetry: fetchWithRetryMock,
  HTTPError: class HTTPError extends Error {
    status: number;
    headers: Headers;
    body: string;

    constructor(status: number, body: string, headers?: Headers) {
      super(`HTTPError:${status}`);
      this.status = status;
      this.headers = headers || new Headers();
      this.body = body;
    }
  },
}));

mock.module("../src/lib/auth/token_manager", () => ({
  TokenManager: {
    getValidToken: getValidTokenMock,
    clearFailureByCredentialId: clearFailureByCredentialIdMock,
    markFailureByCredentialId: markFailureByCredentialIdMock,
  },
}));

mock.module("../src/lib/oauth-selection-policy", () => ({
  getOAuthSelectionConfig: getOAuthSelectionConfigMock,
}));

mock.module("../src/lib/routing/route-policy", () => ({
  getRouteExecutionPolicy: getRouteExecutionPolicyMock,
  resolveClaudeBridgeFallbackReason: (
    status: number,
    bodyText: string,
    policy = routeExecutionPolicyState,
  ) => {
    if (!Number.isFinite(status)) return "not_eligible";
    if (policy.claudeFallbackStatusCodes.includes(status)) {
      return "status_code";
    }
    if (parseCloudflareSignals(bodyText)) {
      return "cloudflare_signal";
    }
    return "not_eligible";
  },
  shouldFallbackClaudeByBridge: (
    status: number,
    bodyText: string,
    policy = routeExecutionPolicyState,
  ) => {
    if (!Number.isFinite(status)) return false;
    return (
      policy.claudeFallbackStatusCodes.includes(status) ||
      parseCloudflareSignals(bodyText)
    );
  },
  shouldRetryWithAnotherAccount: (
    status: number,
    policy = routeExecutionPolicyState,
  ) => {
    if (!Number.isFinite(status)) return false;
    return policy.retryStatusCodes.includes(status);
  },
}));

async function loadBaseProvider() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`../src/lib/providers/base?test=${cacheBust}`);
}

function buildClaudeAuthConfig(): AuthConfig {
  return {
    providerId: "claude",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    authUrl: "https://example.test/oauth/authorize",
    tokenUrl: "https://example.test/oauth/token",
    redirectUri: "http://localhost/callback",
    scopes: [],
  };
}

describe("Claude 传输降级链路", () => {
  const originalClaudeTransport = { ...config.claudeTransport };

  beforeAll(async () => {
    // 触发降级日志时会写入 core.system_logs；测试库未迁移时会报错，这里补齐最小表结构。
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
  });

  beforeEach(() => {
    fetchWithRetryMock.mockReset();
    getValidTokenMock.mockReset();
    clearFailureByCredentialIdMock.mockReset();
    markFailureByCredentialIdMock.mockReset();
    getOAuthSelectionConfigMock.mockReset();
    getRouteExecutionPolicyMock.mockReset();
    config.claudeTransport = { ...originalClaudeTransport };
    Object.assign(routeExecutionPolicyState, defaultRouteExecutionPolicy);

    getOAuthSelectionConfigMock.mockImplementation(async () => ({
      defaultPolicy: "round_robin",
      allowHeaderOverride: false,
      allowHeaderAccountOverride: false,
      failureCooldownSec: 0,
      maxRetryOnAccountFailure: 0,
    }));
    getRouteExecutionPolicyMock.mockImplementation(async () => ({
      ...routeExecutionPolicyState,
    }));
  });

  it("Bearer 401/403 时应自动用 attributes.api_key 以 x-api-key 重试一次，并移除 Authorization", async () => {
    const { BaseProvider } = await loadBaseProvider();

    class ClaudeProviderForTest extends BaseProvider {
      protected providerId = "claude";
      protected authConfig = buildClaudeAuthConfig();
      protected endpoint = "https://claude-upstream.test/v1/messages";

      constructor() {
        super();
        this.init();
      }

      protected async getCustomHeaders(): Promise<Record<string, string>> {
        return {
          Authorization: "Bearer test-access-token",
          "Content-Type": "application/json",
        };
      }

      protected async transformResponse(response: Response): Promise<Response> {
        return response;
      }
    }

    getValidTokenMock.mockImplementation(async () => ({
      id: "cred-1",
      accountId: "acc-1",
      accessToken: "test-access-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {
        attributes: {
          api_key: "fallback-api-key-1",
        },
      },
    }));

    fetchWithRetryMock
      .mockImplementationOnce(async () => new Response("unauthorized", { status: 401 }))
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );

    const provider = new ClaudeProviderForTest();
    const response = await provider.router.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-test",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tokenpulse-fallback")).toBe("api_key");

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    const firstCall = fetchWithRetryMock.mock.calls[0] as unknown[] | undefined;
    const secondCall = fetchWithRetryMock.mock.calls[1] as unknown[] | undefined;

    expect(firstCall?.[0]).toBe("https://claude-upstream.test/v1/messages");
    expect((firstCall?.[1] as any)?.headers?.Authorization).toBe(
      "Bearer test-access-token",
    );
    expect((firstCall?.[1] as any)?.headers?.["x-api-key"]).toBeUndefined();

    expect(secondCall?.[0]).toBe("https://claude-upstream.test/v1/messages");
    expect((secondCall?.[1] as any)?.headers?.["x-api-key"]).toBe(
      "fallback-api-key-1",
    );
    expect((secondCall?.[1] as any)?.headers?.Authorization).toBeUndefined();
    expect((secondCall?.[1] as any)?.headers?.authorization).toBeUndefined();

    expect(clearFailureByCredentialIdMock).toHaveBeenCalledTimes(1);
    expect(clearFailureByCredentialIdMock.mock.calls[0]?.[0]).toBe("cred-1");
    expect(markFailureByCredentialIdMock).toHaveBeenCalledTimes(0);
  });

  it("strict 模式遇到可降级 status 时应调用 bridge 端点并透传 bridge key", async () => {
    const { BaseProvider } = await loadBaseProvider();

    class ClaudeProviderForTest extends BaseProvider {
      protected providerId = "claude";
      protected authConfig = buildClaudeAuthConfig();
      protected endpoint = "https://claude-upstream.test/v1/messages";

      constructor() {
        super();
        this.init();
      }

      protected async getCustomHeaders(): Promise<Record<string, string>> {
        return {
          Authorization: "Bearer test-access-token",
          "Content-Type": "application/json",
        };
      }

      protected async transformResponse(response: Response): Promise<Response> {
        return response;
      }
    }

    config.claudeTransport.tlsMode = "strict";
    config.claudeTransport.bridgeUrl = "http://bridge.local/";
    config.claudeTransport.bridgeSharedKey = "shared-key-1";

    getValidTokenMock.mockImplementation(async () => ({
      id: "cred-2",
      accountId: "acc-2",
      accessToken: "test-access-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {},
    }));

    fetchWithRetryMock
      .mockImplementationOnce(async () => new Response("bad gateway", { status: 502 }))
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ ok: "bridge" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );

    const provider = new ClaudeProviderForTest();
    const response = await provider.router.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-test",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tokenpulse-fallback")).toBe("bridge");

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    const bridgeCall = fetchWithRetryMock.mock.calls[1] as unknown[] | undefined;
    expect(bridgeCall?.[0]).toBe("http://bridge.local/v1/messages?beta=true");
    expect((bridgeCall?.[1] as any)?.headers?.["X-TokenPulse-Claude-Fallback"]).toBe(
      "bridge",
    );
    expect((bridgeCall?.[1] as any)?.headers?.["x-tokenpulse-bridge-key"]).toBe(
      "shared-key-1",
    );

    expect(clearFailureByCredentialIdMock).toHaveBeenCalledTimes(1);
    expect(clearFailureByCredentialIdMock.mock.calls[0]?.[0]).toBe("cred-2");
    expect(markFailureByCredentialIdMock).toHaveBeenCalledTimes(0);
  });

  it("strict 模式遇到 Cloudflare 信号时应调用 bridge 端点", async () => {
    const { BaseProvider } = await loadBaseProvider();

    class ClaudeProviderForTest extends BaseProvider {
      protected providerId = "claude";
      protected authConfig = buildClaudeAuthConfig();
      protected endpoint = "https://claude-upstream.test/v1/messages";

      constructor() {
        super();
        this.init();
      }

      protected async getCustomHeaders(): Promise<Record<string, string>> {
        return {
          Authorization: "Bearer test-access-token",
          "Content-Type": "application/json",
        };
      }

      protected async transformResponse(response: Response): Promise<Response> {
        return response;
      }
    }

    config.claudeTransport.tlsMode = "strict";
    config.claudeTransport.bridgeUrl = "http://bridge.local";
    config.claudeTransport.bridgeSharedKey = "";

    getValidTokenMock.mockImplementation(async () => ({
      id: "cred-3",
      accountId: "acc-3",
      accessToken: "test-access-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {},
    }));

    fetchWithRetryMock
      .mockImplementationOnce(
        async () =>
          new Response("Attention required | Cloudflare", {
            status: 404,
          }),
      )
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ ok: "bridge" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );

    const provider = new ClaudeProviderForTest();
    const response = await provider.router.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-test",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tokenpulse-fallback")).toBe("bridge");

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    const bridgeCall = fetchWithRetryMock.mock.calls[1] as unknown[] | undefined;
    expect(bridgeCall?.[0]).toBe("http://bridge.local/v1/messages?beta=true");
    expect((bridgeCall?.[1] as any)?.headers?.["X-TokenPulse-Claude-Fallback"]).toBe(
      "bridge",
    );
    expect((bridgeCall?.[1] as any)?.headers?.["x-tokenpulse-bridge-key"]).toBe(
      undefined,
    );
  });

  it("bridge 熔断器开启时应跳过 bridge 降级重试（不再发起 bridge 请求）", async () => {
    const { BaseProvider } = await loadBaseProvider();

    class ClaudeProviderForTest extends BaseProvider {
      protected providerId = "claude";
      protected authConfig = buildClaudeAuthConfig();
      protected endpoint = "https://claude-upstream.test/v1/messages";

      constructor() {
        super();
        this.init();
      }

      protected async getCustomHeaders(): Promise<Record<string, string>> {
        return {
          Authorization: "Bearer test-access-token",
          "Content-Type": "application/json",
        };
      }

      protected async transformResponse(response: Response): Promise<Response> {
        return response;
      }
    }

    config.claudeTransport.tlsMode = "strict";
    config.claudeTransport.bridgeUrl = "http://bridge.local";
    config.claudeTransport.bridgeCircuitThreshold = 1;
    config.claudeTransport.bridgeCircuitCooldownSec = 60;

    getValidTokenMock.mockImplementation(async () => ({
      id: "cred-4",
      accountId: "acc-4",
      accessToken: "test-access-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: {},
    }));

    const provider = new ClaudeProviderForTest();
    fetchWithRetryMock.mockImplementation(async (url: unknown) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/v1/messages?beta=true")) {
        return new Response("bridge down", { status: 502 });
      }
      return new Response("upstream down", { status: 502 });
    });

    const buildRequest = () =>
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-test",
          messages: [{ role: "user", content: "hi" }],
        }),
      });

    const firstResponse = await provider.router.fetch(buildRequest());
    expect(firstResponse.status).toBe(502);
    expect(fetchWithRetryMock.mock.calls.some((call) => call[0] === "http://bridge.local/v1/messages?beta=true")).toBe(true);

    const callsAfterFirst = fetchWithRetryMock.mock.calls.length;
    const secondResponse = await provider.router.fetch(buildRequest());
    expect(secondResponse.status).toBe(502);
    expect(fetchWithRetryMock.mock.calls.length).toBe(callsAfterFirst + 1);

    const lastCall = fetchWithRetryMock.mock.calls[fetchWithRetryMock.mock.calls.length - 1] as unknown[] | undefined;
    expect(lastCall?.[0]).toBe("https://claude-upstream.test/v1/messages");
  });
});
