import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  clearApiSecret,
  consumeLoginRedirect,
  downloadWithApiSecret,
  enterpriseAdminClient,
  fetchWithApiSecret,
  getApiSecret,
  loginWithApiSecret,
  oauthAlertCenterClient,
  orgDomainClient,
  requestJsonWithApiSecret,
  setApiSecret,
  verifyApiSecret,
  verifyStoredApiSecret,
} from "../frontend/src/lib/client";

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key) || null : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

describe("frontend client secret 生命周期", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;
  const localStorageMemory = new MemoryStorage();
  const sessionStorageMemory = new MemoryStorage();

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMemory,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: sessionStorageMemory,
    });
    localStorageMemory.clear();
    sessionStorageMemory.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("set/get/clear 应维护本地 API secret", () => {
    expect(getApiSecret()).toBe("");

    setApiSecret("  tokenpulse-secret  ");
    expect(getApiSecret()).toBe("tokenpulse-secret");

    clearApiSecret();
    expect(getApiSecret()).toBe("");
  });

  it("verifyApiSecret 成功时应通过，不落本地存储", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    await verifyApiSecret("tokenpulse-secret");

    expect(getApiSecret()).toBe("");
  });

  it("verifyApiSecret 在 404 时应提示后端尚未提供探针", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    await expect(verifyApiSecret("tokenpulse-secret")).rejects.toThrow(
      "后端尚未提供 /api/auth/verify-secret 探针",
    );
  });

  it("loginWithApiSecret 成功时应先校验再保存 trim 后的 secret", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push(headers.get("Authorization") || "");
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await loginWithApiSecret("  tokenpulse-secret  ");

    expect(calls).toEqual(["Bearer tokenpulse-secret"]);
    expect(getApiSecret()).toBe("tokenpulse-secret");
  });

  it("loginWithApiSecret 失败时应清理残留 secret 并透传错误", async () => {
    setApiSecret("stale-secret");
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: "接口密钥校验失败（401）",
            traceId: "trace-frontend-client-401",
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(loginWithApiSecret("bad-secret")).rejects.toThrow("接口密钥校验失败（401）");
    expect(getApiSecret()).toBe("");
  });

  it("verifyStoredApiSecret 成功时应保留当前 secret", async () => {
    setApiSecret("tokenpulse-secret");
    globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    await expect(
      verifyStoredApiSecret({
        redirectTarget: "/enterprise?tab=oauth#incidents",
      }),
    ).resolves.toBe(true);

    expect(getApiSecret()).toBe("tokenpulse-secret");
    expect(globalThis.sessionStorage.getItem("tokenpulse_login_redirect")).toBeNull();
  });

  it("verifyStoredApiSecret 失败时应清理 secret 并保留指定回跳地址", async () => {
    setApiSecret("stale-secret");
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: "接口密钥校验失败（401）",
            traceId: "trace-frontend-client-preflight-401",
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(
      verifyStoredApiSecret({
        redirectTarget: "/enterprise?tab=oauth#incidents",
      }),
    ).resolves.toBe(false);

    expect(getApiSecret()).toBe("");
    expect(globalThis.sessionStorage.getItem("tokenpulse_login_redirect")).toBe(
      "/enterprise?tab=oauth#incidents",
    );
  });

  it("verifyStoredApiSecret 在登录页失效时不应清空既有回跳地址", async () => {
    setApiSecret("stale-secret");
    globalThis.sessionStorage.setItem("tokenpulse_login_redirect", "/settings?tab=api");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "/login",
          pathname: "/login",
          search: "",
          hash: "",
        },
      },
    });
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: "接口密钥校验失败（401）",
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(verifyStoredApiSecret()).resolves.toBe(false);

    expect(getApiSecret()).toBe("");
    expect(globalThis.sessionStorage.getItem("tokenpulse_login_redirect")).toBe(
      "/settings?tab=api",
    );
  });

  it("requestJsonWithApiSecret 应透传鉴权头并返回 JSON", async () => {
    setApiSecret("  tokenpulse-secret  ");
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer tokenpulse-secret");
      expect(init?.credentials).toBe("include");
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    const payload = await requestJsonWithApiSecret<{ data: { ok: boolean } }>("/api/org/overview");
    expect(payload).toEqual({ data: { ok: true } });
  });

  it("requestJsonWithApiSecret 失败时应抛出带状态码的错误", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: "组织域接口不可用", traceId: "trace-org-404" }), {
          status: 404,
          headers: {
            "content-type": "application/json",
            "x-request-id": "trace-org-404",
          },
        }),
    ) as unknown as typeof fetch;

    try {
      await requestJsonWithApiSecret("/api/org/overview");
      throw new Error("expected requestJsonWithApiSecret to throw");
    } catch (error) {
      const typed = error as Error & { status?: number; traceId?: string };
      expect(typed.message).toBe("组织域接口不可用");
      expect(typed.status).toBe(404);
      expect(typed.traceId).toBe("trace-org-404");
    }
  });

  it("enterpriseAdminClient 模型治理 helper 应命中稳定接口路径", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      const body =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      calls.push({
        url,
        method,
        body,
      });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await enterpriseAdminClient.getModelAlias();
    await enterpriseAdminClient.updateModelAlias({
      claude: {
        sonnet: "claude-3-7-sonnet",
      },
    });
    await enterpriseAdminClient.getExcludedModels();
    await enterpriseAdminClient.updateExcludedModels(["claude:legacy-model"]);
    await enterpriseAdminClient.updateRoutePolicies({
      selection: {
        defaultPolicy: "latest_valid",
        allowHeaderOverride: false,
        allowHeaderAccountOverride: true,
        failureCooldownSec: 30,
        maxRetryOnAccountFailure: 2,
      },
      execution: {
        emitRouteHeaders: true,
        retryStatusCodes: [429, 503],
        claudeFallbackStatusCodes: [409, 429, 503],
      },
    });
    await enterpriseAdminClient.updateCapabilityMap({
      claude: {
        provider: "claude",
        flows: ["auth_code"],
        supportsChat: true,
        supportsModelList: true,
        supportsStream: true,
        supportsManualCallback: false,
      },
    });

    expect(
      calls.map((call) => ({
        url: call.url,
        method: call.method,
      })),
    ).toEqual([
      { url: "/api/admin/oauth/model-alias", method: "GET" },
      { url: "/api/admin/oauth/model-alias", method: "PUT" },
      { url: "/api/admin/oauth/excluded-models", method: "GET" },
      { url: "/api/admin/oauth/excluded-models", method: "PUT" },
      { url: "/api/admin/oauth/route-policies", method: "PUT" },
      { url: "/api/admin/oauth/capability-map", method: "PUT" },
    ]);
    expect(JSON.parse(calls[1]?.body || "{}")).toEqual({
      claude: {
        sonnet: "claude-3-7-sonnet",
      },
    });
    expect(JSON.parse(calls[3]?.body || "[]")).toEqual(["claude:legacy-model"]);
    expect(JSON.parse(calls[4]?.body || "{}")).toEqual({
      selection: {
        defaultPolicy: "latest_valid",
        allowHeaderOverride: false,
        allowHeaderAccountOverride: true,
        failureCooldownSec: 30,
        maxRetryOnAccountFailure: 2,
      },
      execution: {
        emitRouteHeaders: true,
        retryStatusCodes: [429, 503],
        claudeFallbackStatusCodes: [409, 429, 503],
      },
    });
    expect(JSON.parse(calls[5]?.body || "{}")).toEqual({
      claude: {
        provider: "claude",
        flows: ["auth_code"],
        supportsChat: true,
        supportsModelList: true,
        supportsStream: true,
        supportsManualCallback: false,
      },
    });
  });

  it("enterpriseAdminClient 管理员认证与用户租户 helper 应命中稳定接口路径", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await enterpriseAdminClient.login({
      username: "admin",
      password: "secret",
    });
    await enterpriseAdminClient.logout();
    await enterpriseAdminClient.createAuditEvent({
      action: "admin.audit.write",
      resource: "enterprise-panel",
      result: "success",
      details: {
        source: "enterprise-ui",
        type: "manual-check",
      },
    });
    await enterpriseAdminClient.createUser({
      username: "ops-user",
      password: "Password123!",
      roleKey: "operator",
      tenantId: "default",
      status: "active",
    });
    await enterpriseAdminClient.updateUser("user-a", {
      roleBindings: [
        { roleKey: "admin", tenantId: "tenant-a" },
        { roleKey: "auditor", tenantId: "tenant-b" },
      ],
      tenantIds: ["tenant-a", "tenant-b"],
      status: "disabled",
      password: "NextPassword123!",
    });
    await enterpriseAdminClient.deleteUser("user-a");
    await enterpriseAdminClient.createTenant({
      name: "租户 A",
      status: "active",
    });
    await enterpriseAdminClient.deleteTenant("tenant-a");

    expect(calls.map((call) => ({ url: call.url, method: call.method }))).toEqual([
      { url: "/api/admin/auth/login", method: "POST" },
      { url: "/api/admin/auth/logout", method: "POST" },
      { url: "/api/admin/audit/events", method: "POST" },
      { url: "/api/admin/users", method: "POST" },
      { url: "/api/admin/users/user-a", method: "PUT" },
      { url: "/api/admin/users/user-a", method: "DELETE" },
      { url: "/api/admin/tenants", method: "POST" },
      { url: "/api/admin/tenants/tenant-a", method: "DELETE" },
    ]);
    expect(JSON.parse(calls[0]?.body || "{}")).toEqual({
      username: "admin",
      password: "secret",
    });
    expect(JSON.parse(calls[2]?.body || "{}")).toEqual({
      action: "admin.audit.write",
      resource: "enterprise-panel",
      result: "success",
      details: {
        source: "enterprise-ui",
        type: "manual-check",
      },
    });
    expect(JSON.parse(calls[3]?.body || "{}")).toEqual({
      username: "ops-user",
      password: "Password123!",
      roleKey: "operator",
      tenantId: "default",
      status: "active",
    });
    expect(JSON.parse(calls[4]?.body || "{}")).toEqual({
      roleBindings: [
        { roleKey: "admin", tenantId: "tenant-a" },
        { roleKey: "auditor", tenantId: "tenant-b" },
      ],
      tenantIds: ["tenant-a", "tenant-b"],
      status: "disabled",
      password: "NextPassword123!",
    });
    expect(JSON.parse(calls[6]?.body || "{}")).toEqual({
      name: "租户 A",
      status: "active",
    });
  });

  it("enterpriseAdminClient.loginResult/logoutResult 应返回结构化成功结果并命中认证路径", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url === "/api/admin/auth/login") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              user: { id: "admin-user-1", username: "admin" },
              roleKey: "owner",
              tenantId: "default",
              expiresAt: "2026-03-08T08:00:00.000Z",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": "trace-login-result-ok",
            },
          },
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "trace-logout-result-ok",
        },
      });
    }) as unknown as typeof fetch;

    const loginResult = await enterpriseAdminClient.loginResult({
      username: "admin",
      password: "secret",
    });
    const logoutResult = await enterpriseAdminClient.logoutResult();

    expect(loginResult.ok).toBe(true);
    expect(loginResult.status).toBe(200);
    expect(loginResult.traceId).toBe("trace-login-result-ok");
    expect(loginResult.error).toBeUndefined();
    expect(loginResult.data).toEqual({
      user: { id: "admin-user-1", username: "admin" },
      roleKey: "owner",
      tenantId: "default",
      expiresAt: "2026-03-08T08:00:00.000Z",
    });
    expect(loginResult.payload).toEqual({
      success: true,
      data: {
        user: { id: "admin-user-1", username: "admin" },
        roleKey: "owner",
        tenantId: "default",
        expiresAt: "2026-03-08T08:00:00.000Z",
      },
    });

    expect(logoutResult.ok).toBe(true);
    expect(logoutResult.status).toBe(200);
    expect(logoutResult.traceId).toBe("trace-logout-result-ok");
    expect(logoutResult.error).toBeUndefined();
    expect(logoutResult.data).toEqual({ success: true });
    expect(logoutResult.payload).toEqual({ success: true });

    expect(calls).toEqual([
      {
        url: "/api/admin/auth/login",
        method: "POST",
        body: JSON.stringify({
          username: "admin",
          password: "secret",
        }),
      },
      {
        url: "/api/admin/auth/logout",
        method: "POST",
        body: undefined,
      },
    ]);
  });

  it("enterpriseAdminClient.loginResult/logoutResult 失败时应返回结构化错误语义", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url === "/api/admin/auth/login") {
        return new Response(
          JSON.stringify({
            success: false,
            error: "用户名或密码错误",
            traceId: "trace-login-result-failed",
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      return new Response(
        JSON.stringify({
          error: "退出登录失败",
          traceId: "trace-logout-result-failed",
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch;

    const loginResult = await enterpriseAdminClient.loginResult({
      username: "admin",
      password: "bad-secret",
    });
    const logoutResult = await enterpriseAdminClient.logoutResult();

    expect(loginResult.ok).toBe(false);
    expect(loginResult.status).toBe(400);
    expect(loginResult.traceId).toBe("trace-login-result-failed");
    expect(loginResult.error).toBe("用户名或密码错误");
    expect(loginResult.data).toEqual({
      success: false,
      error: "用户名或密码错误",
      traceId: "trace-login-result-failed",
    });

    expect(logoutResult.ok).toBe(false);
    expect(logoutResult.status).toBe(500);
    expect(logoutResult.traceId).toBe("trace-logout-result-failed");
    expect(logoutResult.error).toBe("退出登录失败");
    expect(logoutResult.data).toEqual({
      error: "退出登录失败",
      traceId: "trace-logout-result-failed",
    });

    expect(calls.map((call) => ({ url: call.url, method: call.method }))).toEqual([
      { url: "/api/admin/auth/login", method: "POST" },
      { url: "/api/admin/auth/logout", method: "POST" },
    ]);
  });

  it("enterpriseAdminClient.updateUser 仅更新 status/password 时不应强塞 legacy 绑定字段", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await enterpriseAdminClient.updateUser("user-status-only", {
      status: "disabled",
      password: "NextPassword123!",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: "/api/admin/users/user-status-only",
      method: "PUT",
      body: JSON.stringify({
        status: "disabled",
        password: "NextPassword123!",
      }),
    });
  });

  it("enterpriseAdminClient.updateUser 应保留 legacy roleKey/tenantId 兼容回归", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await enterpriseAdminClient.updateUser("user-legacy", {
      roleKey: "admin",
      tenantId: "tenant-a",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: "/api/admin/users/user-legacy",
      method: "PUT",
      body: JSON.stringify({
        roleKey: "admin",
        tenantId: "tenant-a",
      }),
    });
  });

  it("enterpriseAdminClient.updateUser 仅更新 displayName 时不应夹带绑定字段", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await enterpriseAdminClient.updateUser("user-display-name-only", {
      displayName: "用户展示名",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: "/api/admin/users/user-display-name-only",
      method: "PUT",
      body: JSON.stringify({
        displayName: "用户展示名",
      }),
    });
  });

  it("enterpriseAdminClient 配额策略写操作 helper 应命中稳定接口路径", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await enterpriseAdminClient.listPolicies();
    await enterpriseAdminClient.createPolicy({
      name: "租户策略",
      scopeType: "tenant",
      scopeValue: "tenant-a",
      requestsPerMinute: 120,
      enabled: true,
    });
    await enterpriseAdminClient.updatePolicy("policy-a", {
      tokensPerMinute: 60000,
      tokensPerDay: 240000,
      enabled: false,
    });
    await enterpriseAdminClient.deletePolicy("policy-a");

    expect(calls.map((call) => ({ url: call.url, method: call.method }))).toEqual([
      { url: "/api/admin/billing/policies", method: "GET" },
      { url: "/api/admin/billing/policies", method: "POST" },
      { url: "/api/admin/billing/policies/policy-a", method: "PUT" },
      { url: "/api/admin/billing/policies/policy-a", method: "DELETE" },
    ]);
    expect(JSON.parse(calls[1]?.body || "{}")).toEqual({
      name: "租户策略",
      scopeType: "tenant",
      scopeValue: "tenant-a",
      requestsPerMinute: 120,
      enabled: true,
    });
    expect(JSON.parse(calls[2]?.body || "{}")).toEqual({
      tokensPerMinute: 60000,
      tokensPerDay: 240000,
      enabled: false,
    });
  });

  it("enterpriseAdminClient 结构化 mutation helper 应返回 traceId 与错误语义", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url === "/api/admin/users") {
        return new Response(
          JSON.stringify({
            success: true,
            traceId: "trace-user-create-001",
            data: { id: "user-a" },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      return new Response(
        JSON.stringify({
          error: "策略冲突",
          traceId: "trace-policy-update-001",
        }),
        {
          status: 409,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch;

    const createResult = await enterpriseAdminClient.createUserResult({
      username: "ops-user",
      password: "Password123!",
      roleKey: "operator",
      tenantId: "default",
      status: "active",
    });
    const updateResult = await enterpriseAdminClient.updatePolicyResult("policy-a", {
      enabled: false,
    });

    expect(createResult.ok).toBe(true);
    expect(createResult.traceId).toBe("trace-user-create-001");
    expect(createResult.data).toEqual({ id: "user-a" });
    expect(updateResult.ok).toBe(false);
    expect(updateResult.status).toBe(409);
    expect(updateResult.error).toBe("策略冲突");
    expect(updateResult.traceId).toBe("trace-policy-update-001");
    expect(calls.map((call) => ({ url: call.url, method: call.method }))).toEqual([
      { url: "/api/admin/users", method: "POST" },
      { url: "/api/admin/billing/policies/policy-a", method: "PUT" },
    ]);
  });

  it("oauthAlertCenterClient 结构化 mutation helper 应保留 payload 与 traceId", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(
        JSON.stringify({
          success: true,
          traceId: "trace-oauth-center-001",
          data: {
            triggered: true,
            message: "评估完成：触发告警",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch;

    const result = await oauthAlertCenterClient.evaluateResult({
      provider: "claude",
    });

    expect(result.ok).toBe(true);
    expect(result.traceId).toBe("trace-oauth-center-001");
    expect(result.data).toEqual({
      triggered: true,
      message: "评估完成：触发告警",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/api/admin/observability/oauth-alerts/evaluate",
      method: "POST",
    });
    expect(JSON.parse(calls[0]?.body || "{}")).toEqual({
      provider: "claude",
    });
  });

  it("结构化 query helper 应返回 data、status 与 traceId", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      calls.push({ url, method });

      if (url === "/api/admin/observability/oauth-alerts/config") {
        return new Response(
          JSON.stringify({
            success: true,
            traceId: "trace-oauth-config-001",
            data: { enabled: true, minDeliverySeverity: "warning" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "/api/admin/users") {
        return new Response(
          JSON.stringify({
            success: true,
            traceId: "trace-users-001",
            data: [{ id: "user-a", username: "ops-user", status: "active", roles: [] }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          error: "trace not found",
          traceId: "trace-agentledger-trace-001",
        }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const sessionResult = await enterpriseAdminClient.getAdminSessionResult();
    const configResult = await oauthAlertCenterClient.getConfigResult();
    const usersResult = await enterpriseAdminClient.listUsersResult();
    const traceResult = await enterpriseAdminClient.getAgentLedgerTraceResult("trace-a");

    expect(sessionResult.ok).toBe(false);
    expect(sessionResult.status).toBe(404);
    expect(sessionResult.error).toBe("trace not found");
    expect(sessionResult.traceId).toBe("trace-agentledger-trace-001");
    expect(configResult.ok).toBe(true);
    expect(configResult.traceId).toBe("trace-oauth-config-001");
    expect(configResult.data).toEqual({
      enabled: true,
      minDeliverySeverity: "warning",
    });
    expect(usersResult.ok).toBe(true);
    expect(usersResult.traceId).toBe("trace-users-001");
    expect(usersResult.data).toEqual([
      { id: "user-a", username: "ops-user", status: "active", roles: [] },
    ]);
    expect(traceResult.ok).toBe(false);
    expect(traceResult.status).toBe(404);
    expect(traceResult.error).toBe("trace not found");
    expect(traceResult.traceId).toBe("trace-agentledger-trace-001");
    expect(calls.map((call) => ({ url: call.url, method: call.method }))).toEqual([
      { url: "/api/admin/auth/me", method: "GET" },
      { url: "/api/admin/observability/oauth-alerts/config", method: "GET" },
      { url: "/api/admin/users", method: "GET" },
      { url: "/api/admin/observability/agentledger-traces/trace-a", method: "GET" },
    ]);
  });

  it("第二批结构化 query helper 应覆盖 AgentLedger、Claude fallback 与 bootstrap 基础数据", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      calls.push({ url, method });

      if (url === "/api/admin/observability/agentledger-outbox/readiness") {
        return new Response(
          JSON.stringify({
            error: "delivery_not_configured",
            traceId: "trace-readiness-001",
            data: {
              ready: false,
              status: "blocking",
              blockingReasons: ["delivery_not_configured"],
              degradedReasons: [],
            },
          }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("/api/admin/observability/claude-fallbacks/summary")) {
        return new Response(
          JSON.stringify({
            success: true,
            traceId: "trace-fallback-summary-001",
            data: {
              total: 3,
              byMode: { api_key: 1, bridge: 2 },
              byPhase: { attempt: 1, success: 1, failure: 1, skipped: 0 },
              byReason: { unknown: 1 },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "/api/admin/rbac/roles") {
        return new Response(
          JSON.stringify({
            success: true,
            traceId: "trace-roles-001",
            data: [{ key: "owner", name: "Owner", permissions: ["*"] }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "/api/admin/billing/quotas") {
        return new Response(
          JSON.stringify({
            success: true,
            traceId: "trace-quotas-001",
            data: {
              mode: "enforced",
              message: "ok",
              limits: { requestsPerMinute: 60, tokensPerDay: 1000 },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          traceId: "trace-generic-001",
          data: { total: 1, data: [] },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const readinessResult = await enterpriseAdminClient.getAgentLedgerOutboxReadinessResult();
    const fallbackSummaryResult = await enterpriseAdminClient.getClaudeFallbackSummaryResult();
    const rolesResult = await enterpriseAdminClient.listRolesResult();
    const quotasResult = await enterpriseAdminClient.getBillingQuotasResult();

    expect(readinessResult.ok).toBe(false);
    expect(readinessResult.status).toBe(503);
    expect(readinessResult.traceId).toBe("trace-readiness-001");
    expect(readinessResult.data).toEqual({
      ready: false,
      status: "blocking",
      blockingReasons: ["delivery_not_configured"],
      degradedReasons: [],
    });
    expect(fallbackSummaryResult.ok).toBe(true);
    expect(fallbackSummaryResult.traceId).toBe("trace-fallback-summary-001");
    expect(fallbackSummaryResult.data).toEqual({
      total: 3,
      byMode: { api_key: 1, bridge: 2 },
      byPhase: { attempt: 1, success: 1, failure: 1, skipped: 0 },
      byReason: { unknown: 1 },
    });
    expect(rolesResult.ok).toBe(true);
    expect(rolesResult.data).toEqual([{ key: "owner", name: "Owner", permissions: ["*"] }]);
    expect(quotasResult.ok).toBe(true);
    expect(quotasResult.data).toEqual({
      mode: "enforced",
      message: "ok",
      limits: { requestsPerMinute: 60, tokensPerDay: 1000 },
    });
  });

  it("orgDomainClient 应命中稳定接口路径并补齐成员管理 helper", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await orgDomainClient.getOverview();
    await orgDomainClient.listOrganizations({ status: "active" });
    await orgDomainClient.listProjects({ organizationId: "org-a", status: "active" });
    await orgDomainClient.listMembers({ organizationId: "org-a", status: "active" });
    await orgDomainClient.listMemberProjectBindings({
      organizationId: "org-a",
      memberId: "member-a",
      projectId: "project-a",
    });
    await orgDomainClient.createOrganization({ name: "组织 A" });
    await orgDomainClient.updateOrganization("org-a", { status: "disabled" });
    await orgDomainClient.deleteOrganization("org-a");
    await orgDomainClient.createProject({
      name: "项目 A",
      organizationId: "org-a",
    });
    await orgDomainClient.updateProject("project-a", { status: "disabled" });
    await orgDomainClient.deleteProject("project-a");
    await orgDomainClient.createMember({
      organizationId: "org-a",
      userId: "user-a",
      displayName: "用户 A",
    });
    await orgDomainClient.updateMember("member-a", {
      organizationId: "org-b",
    });
    await orgDomainClient.deleteMember("member-a");
    await orgDomainClient.createMemberProjectBindingsBatch([
      {
        organizationId: "org-b",
        memberId: "member-a",
        projectId: "project-b",
      },
      {
        organizationId: "org-b",
        memberId: "member-a",
        projectId: "project-c",
      },
    ]);
    await orgDomainClient.deleteMemberProjectBinding("42");

    expect(calls).toHaveLength(16);
    expect(calls[0]).toMatchObject({ url: "/api/org/overview", method: "GET" });
    const organizationsUrl = new URL(calls[1]?.url || "", "https://tokenpulse.local");
    expect(organizationsUrl.pathname).toBe("/api/org/organizations");
    expect(organizationsUrl.searchParams.get("status")).toBe("active");

    const projectsUrl = new URL(calls[2]?.url || "", "https://tokenpulse.local");
    expect(projectsUrl.pathname).toBe("/api/org/projects");
    expect(projectsUrl.searchParams.get("organizationId")).toBe("org-a");
    expect(projectsUrl.searchParams.get("status")).toBe("active");

    const membersUrl = new URL(calls[3]?.url || "", "https://tokenpulse.local");
    expect(membersUrl.pathname).toBe("/api/org/members");
    expect(membersUrl.searchParams.get("organizationId")).toBe("org-a");
    expect(membersUrl.searchParams.get("status")).toBe("active");

    const bindingListUrl = new URL(calls[4]?.url || "", "https://tokenpulse.local");
    expect(bindingListUrl.pathname).toBe("/api/org/member-project-bindings");
    expect(bindingListUrl.searchParams.get("organizationId")).toBe("org-a");
    expect(bindingListUrl.searchParams.get("memberId")).toBe("member-a");
    expect(bindingListUrl.searchParams.get("projectId")).toBe("project-a");

    expect(calls[5]).toMatchObject({ url: "/api/org/organizations", method: "POST" });
    expect(JSON.parse(calls[5]?.body || "{}")).toEqual({ name: "组织 A" });
    expect(calls[6]).toMatchObject({ url: "/api/org/organizations/org-a", method: "PUT" });
    expect(JSON.parse(calls[6]?.body || "{}")).toEqual({ status: "disabled" });
    expect(calls[7]).toMatchObject({ url: "/api/org/organizations/org-a", method: "DELETE" });
    expect(calls[8]).toMatchObject({ url: "/api/org/projects", method: "POST" });
    expect(JSON.parse(calls[8]?.body || "{}")).toEqual({
      name: "项目 A",
      organizationId: "org-a",
    });
    expect(calls[9]).toMatchObject({ url: "/api/org/projects/project-a", method: "PUT" });
    expect(JSON.parse(calls[9]?.body || "{}")).toEqual({ status: "disabled" });
    expect(calls[10]).toMatchObject({ url: "/api/org/projects/project-a", method: "DELETE" });
    expect(calls[11]).toMatchObject({ url: "/api/org/members", method: "POST" });
    expect(JSON.parse(calls[11]?.body || "{}")).toEqual({
      organizationId: "org-a",
      userId: "user-a",
      displayName: "用户 A",
    });
    expect(calls[12]).toMatchObject({ url: "/api/org/members/member-a", method: "PUT" });
    expect(JSON.parse(calls[12]?.body || "{}")).toEqual({
      organizationId: "org-b",
    });
    expect(calls[13]).toMatchObject({ url: "/api/org/members/member-a", method: "DELETE" });
    expect(calls[14]).toMatchObject({
      url: "/api/org/member-project-bindings/batch",
      method: "POST",
    });
    expect(JSON.parse(calls[14]?.body || "{}")).toEqual({
      items: [
        {
          organizationId: "org-b",
          memberId: "member-a",
          projectId: "project-b",
        },
        {
          organizationId: "org-b",
          memberId: "member-a",
          projectId: "project-c",
        },
      ],
    });
    expect(calls[15]).toMatchObject({
      url: "/api/org/member-project-bindings/42",
      method: "DELETE",
    });
  });

  it("enterpriseAdminClient AgentLedger helper 应命中稳定接口路径", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (input instanceof Request ? input.method : "GET");
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as unknown as typeof fetch;

    await enterpriseAdminClient.listAgentLedgerOutbox({
      page: 2,
      pageSize: 25,
      deliveryState: "replay_required",
      status: "failure",
      provider: "claude",
      tenantId: "default",
      projectId: "project-alpha",
      traceId: "trace-agentledger-1",
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-03-02T00:00:00.000Z",
    });
    await enterpriseAdminClient.getAgentLedgerOutboxSummary({
      deliveryState: "retryable_failure",
      status: "timeout",
      provider: "gemini",
      tenantId: "tenant-a",
      projectId: "project-beta",
      traceId: "trace-agentledger-2",
      from: "2026-03-03T00:00:00.000Z",
      to: "2026-03-04T00:00:00.000Z",
    });
    await enterpriseAdminClient.replayAgentLedgerOutboxItem(42);
    await enterpriseAdminClient.getAgentLedgerOutboxHealth();
    await enterpriseAdminClient.getAgentLedgerOutboxReadiness();
    await enterpriseAdminClient.listAgentLedgerDeliveryAttempts({
      page: 4,
      pageSize: 12,
      outboxId: 77,
      traceId: "trace-attempt-1",
      source: "manual_replay",
      result: "permanent_failure",
      httpStatus: 502,
      errorClass: "request_error",
      from: "2026-03-05T12:00:00.000Z",
      to: "2026-03-06T12:00:00.000Z",
    });
    await enterpriseAdminClient.getAgentLedgerDeliveryAttemptSummary({
      outboxId: 78,
      traceId: "trace-attempt-2",
      source: "worker",
      result: "retryable_failure",
      httpStatus: 429,
      errorClass: "http_429",
      from: "2026-03-07T12:00:00.000Z",
      to: "2026-03-08T12:00:00.000Z",
    });
    await enterpriseAdminClient.replayAgentLedgerOutboxBatch([1, 2, 3]);
    await enterpriseAdminClient.listAgentLedgerReplayAudits({
      page: 3,
      pageSize: 15,
      outboxId: 88,
      traceId: "trace-audit-1",
      operatorId: "admin-user",
      result: "retryable_failure",
      triggerSource: "batch_manual",
      from: "2026-03-05T00:00:00.000Z",
      to: "2026-03-06T00:00:00.000Z",
    });
    await enterpriseAdminClient.getAgentLedgerReplayAuditSummary({
      outboxId: 99,
      traceId: "trace-audit-2",
      operatorId: "ops-user",
      result: "delivered",
      triggerSource: "manual",
      from: "2026-03-07T00:00:00.000Z",
      to: "2026-03-08T00:00:00.000Z",
    });
    await enterpriseAdminClient.getAgentLedgerTrace("trace-drilldown-1");

    expect(calls).toHaveLength(11);

    const listUrl = new URL(calls[0]?.url || "", "https://tokenpulse.local");
    expect(listUrl.pathname).toBe("/api/admin/observability/agentledger-outbox");
    expect(listUrl.searchParams.get("page")).toBe("2");
    expect(listUrl.searchParams.get("pageSize")).toBe("25");
    expect(listUrl.searchParams.get("deliveryState")).toBe("replay_required");
    expect(listUrl.searchParams.get("status")).toBe("failure");
    expect(listUrl.searchParams.get("provider")).toBe("claude");
    expect(listUrl.searchParams.get("tenantId")).toBe("default");
    expect(listUrl.searchParams.get("projectId")).toBe("project-alpha");
    expect(listUrl.searchParams.get("traceId")).toBe("trace-agentledger-1");
    expect(listUrl.searchParams.get("from")).toBe("2026-03-01T00:00:00.000Z");
    expect(listUrl.searchParams.get("to")).toBe("2026-03-02T00:00:00.000Z");
    expect(calls[0]?.method).toBe("GET");

    const summaryUrl = new URL(calls[1]?.url || "", "https://tokenpulse.local");
    expect(summaryUrl.pathname).toBe("/api/admin/observability/agentledger-outbox/summary");
    expect(summaryUrl.searchParams.get("deliveryState")).toBe("retryable_failure");
    expect(summaryUrl.searchParams.get("status")).toBe("timeout");
    expect(summaryUrl.searchParams.get("provider")).toBe("gemini");
    expect(summaryUrl.searchParams.get("tenantId")).toBe("tenant-a");
    expect(summaryUrl.searchParams.get("projectId")).toBe("project-beta");
    expect(summaryUrl.searchParams.get("traceId")).toBe("trace-agentledger-2");
    expect(summaryUrl.searchParams.get("from")).toBe("2026-03-03T00:00:00.000Z");
    expect(summaryUrl.searchParams.get("to")).toBe("2026-03-04T00:00:00.000Z");
    expect(calls[1]?.method).toBe("GET");

    const replayUrl = new URL(calls[2]?.url || "", "https://tokenpulse.local");
    expect(replayUrl.pathname).toBe("/api/admin/observability/agentledger-outbox/42/replay");
    expect(calls[2]?.method).toBe("POST");

    const healthUrl = new URL(calls[3]?.url || "", "https://tokenpulse.local");
    expect(healthUrl.pathname).toBe("/api/admin/observability/agentledger-outbox/health");
    expect(calls[3]?.method).toBe("GET");

    const readinessUrl = new URL(calls[4]?.url || "", "https://tokenpulse.local");
    expect(readinessUrl.pathname).toBe("/api/admin/observability/agentledger-outbox/readiness");
    expect(calls[4]?.method).toBe("GET");

    const deliveryAttemptListUrl = new URL(calls[5]?.url || "", "https://tokenpulse.local");
    expect(deliveryAttemptListUrl.pathname).toBe(
      "/api/admin/observability/agentledger-delivery-attempts",
    );
    expect(deliveryAttemptListUrl.searchParams.get("page")).toBe("4");
    expect(deliveryAttemptListUrl.searchParams.get("pageSize")).toBe("12");
    expect(deliveryAttemptListUrl.searchParams.get("outboxId")).toBe("77");
    expect(deliveryAttemptListUrl.searchParams.get("traceId")).toBe("trace-attempt-1");
    expect(deliveryAttemptListUrl.searchParams.get("source")).toBe("manual_replay");
    expect(deliveryAttemptListUrl.searchParams.get("result")).toBe("permanent_failure");
    expect(deliveryAttemptListUrl.searchParams.get("httpStatus")).toBe("502");
    expect(deliveryAttemptListUrl.searchParams.get("errorClass")).toBe("request_error");
    expect(deliveryAttemptListUrl.searchParams.get("from")).toBe("2026-03-05T12:00:00.000Z");
    expect(deliveryAttemptListUrl.searchParams.get("to")).toBe("2026-03-06T12:00:00.000Z");
    expect(calls[5]?.method).toBe("GET");

    const deliveryAttemptSummaryUrl = new URL(calls[6]?.url || "", "https://tokenpulse.local");
    expect(deliveryAttemptSummaryUrl.pathname).toBe(
      "/api/admin/observability/agentledger-delivery-attempts/summary",
    );
    expect(deliveryAttemptSummaryUrl.searchParams.get("outboxId")).toBe("78");
    expect(deliveryAttemptSummaryUrl.searchParams.get("traceId")).toBe("trace-attempt-2");
    expect(deliveryAttemptSummaryUrl.searchParams.get("source")).toBe("worker");
    expect(deliveryAttemptSummaryUrl.searchParams.get("result")).toBe("retryable_failure");
    expect(deliveryAttemptSummaryUrl.searchParams.get("httpStatus")).toBe("429");
    expect(deliveryAttemptSummaryUrl.searchParams.get("errorClass")).toBe("http_429");
    expect(deliveryAttemptSummaryUrl.searchParams.get("from")).toBe("2026-03-07T12:00:00.000Z");
    expect(deliveryAttemptSummaryUrl.searchParams.get("to")).toBe("2026-03-08T12:00:00.000Z");
    expect(calls[6]?.method).toBe("GET");

    const replayBatchUrl = new URL(calls[7]?.url || "", "https://tokenpulse.local");
    expect(replayBatchUrl.pathname).toBe("/api/admin/observability/agentledger-outbox/replay-batch");
    expect(calls[7]?.method).toBe("POST");
    expect(JSON.parse(calls[7]?.body || "{}")).toEqual({
      ids: [1, 2, 3],
    });

    const replayAuditListUrl = new URL(calls[8]?.url || "", "https://tokenpulse.local");
    expect(replayAuditListUrl.pathname).toBe("/api/admin/observability/agentledger-replay-audits");
    expect(replayAuditListUrl.searchParams.get("page")).toBe("3");
    expect(replayAuditListUrl.searchParams.get("pageSize")).toBe("15");
    expect(replayAuditListUrl.searchParams.get("outboxId")).toBe("88");
    expect(replayAuditListUrl.searchParams.get("traceId")).toBe("trace-audit-1");
    expect(replayAuditListUrl.searchParams.get("operatorId")).toBe("admin-user");
    expect(replayAuditListUrl.searchParams.get("result")).toBe("retryable_failure");
    expect(replayAuditListUrl.searchParams.get("triggerSource")).toBe("batch_manual");
    expect(replayAuditListUrl.searchParams.get("from")).toBe("2026-03-05T00:00:00.000Z");
    expect(replayAuditListUrl.searchParams.get("to")).toBe("2026-03-06T00:00:00.000Z");
    expect(calls[8]?.method).toBe("GET");

    const replayAuditSummaryUrl = new URL(calls[9]?.url || "", "https://tokenpulse.local");
    expect(replayAuditSummaryUrl.pathname).toBe(
      "/api/admin/observability/agentledger-replay-audits/summary",
    );
    expect(replayAuditSummaryUrl.searchParams.get("outboxId")).toBe("99");
    expect(replayAuditSummaryUrl.searchParams.get("traceId")).toBe("trace-audit-2");
    expect(replayAuditSummaryUrl.searchParams.get("operatorId")).toBe("ops-user");
    expect(replayAuditSummaryUrl.searchParams.get("result")).toBe("delivered");
    expect(replayAuditSummaryUrl.searchParams.get("triggerSource")).toBe("manual");
    expect(replayAuditSummaryUrl.searchParams.get("from")).toBe("2026-03-07T00:00:00.000Z");
    expect(replayAuditSummaryUrl.searchParams.get("to")).toBe("2026-03-08T00:00:00.000Z");
    expect(calls[9]?.method).toBe("GET");

    const traceDrilldownUrl = new URL(calls[10]?.url || "", "https://tokenpulse.local");
    expect(traceDrilldownUrl.pathname).toBe(
      "/api/admin/observability/agentledger-traces/trace-drilldown-1",
    );
    expect(calls[10]?.method).toBe("GET");

    const exportUrl = new URL(
      enterpriseAdminClient.buildAgentLedgerOutboxExportPath({
        deliveryState: "pending",
        status: "blocked",
        provider: "claude",
        tenantId: "tenant-export",
        projectId: "project-export",
        traceId: "trace-agentledger-export",
        from: "2026-03-05T00:00:00.000Z",
        to: "2026-03-06T00:00:00.000Z",
        limit: 2000,
      }),
      "https://tokenpulse.local",
    );
    expect(exportUrl.pathname).toBe("/api/admin/observability/agentledger-outbox/export");
    expect(exportUrl.searchParams.get("deliveryState")).toBe("pending");
    expect(exportUrl.searchParams.get("status")).toBe("blocked");
    expect(exportUrl.searchParams.get("provider")).toBe("claude");
    expect(exportUrl.searchParams.get("tenantId")).toBe("tenant-export");
    expect(exportUrl.searchParams.get("projectId")).toBe("project-export");
    expect(exportUrl.searchParams.get("traceId")).toBe("trace-agentledger-export");
    expect(exportUrl.searchParams.get("from")).toBe("2026-03-05T00:00:00.000Z");
    expect(exportUrl.searchParams.get("to")).toBe("2026-03-06T00:00:00.000Z");
    expect(exportUrl.searchParams.get("limit")).toBe("2000");
  });

  it("enterpriseAdminClient billing usage export path 应包含筛选参数", () => {
    const exportUrl = new URL(
      enterpriseAdminClient.buildBillingUsageExportPath({
        policyId: "policy-1",
        bucketType: "day",
        provider: "claude",
        model: "claude-3-opus",
        tenantId: "tenant-a",
        projectId: "project-a",
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-02T00:00:00.000Z",
        limit: 2000,
      }),
      "https://tokenpulse.local",
    );
    expect(exportUrl.pathname).toBe("/api/admin/billing/usage/export");
    expect(exportUrl.searchParams.get("policyId")).toBe("policy-1");
    expect(exportUrl.searchParams.get("bucketType")).toBe("day");
    expect(exportUrl.searchParams.get("provider")).toBe("claude");
    expect(exportUrl.searchParams.get("model")).toBe("claude-3-opus");
    expect(exportUrl.searchParams.get("tenantId")).toBe("tenant-a");
    expect(exportUrl.searchParams.get("projectId")).toBe("project-a");
    expect(exportUrl.searchParams.get("from")).toBe("2026-03-01T00:00:00.000Z");
    expect(exportUrl.searchParams.get("to")).toBe("2026-03-02T00:00:00.000Z");
    expect(exportUrl.searchParams.get("limit")).toBe("2000");
  });

  it("downloadWithApiSecret 应尊重 Content-Disposition 文件名", async () => {
    setApiSecret("tokenpulse-secret");
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer tokenpulse-secret");
      return new Response("id,name\n1,TokenPulse\n", {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="audit-export.csv"',
          "content-type": "text/csv",
        },
      });
    }) as unknown as typeof fetch;

    const result = await downloadWithApiSecret("/api/admin/audit/export?limit=1", {
      method: "GET",
    });
    expect(result.filename).toBe("audit-export.csv");
    expect(await result.blob.text()).toContain("TokenPulse");
  });

  it("consumeLoginRedirect 应返回并清空已保存的回跳路径", () => {
    globalThis.sessionStorage.setItem(
      "tokenpulse_login_redirect",
      "/enterprise?tab=members#role-editor",
    );

    expect(consumeLoginRedirect()).toBe("/enterprise?tab=members#role-editor");
    expect(globalThis.sessionStorage.getItem("tokenpulse_login_redirect")).toBeNull();
  });

  it("fetchWithApiSecret 在 401 时应清理 secret 并保存当前页面用于重新登录回跳", async () => {
    setApiSecret("tokenpulse-secret");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "/enterprise?tab=members#role-editor",
          pathname: "/enterprise",
          search: "?tab=members",
          hash: "#role-editor",
        },
      },
    });
    globalThis.fetch = mock(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;

    await fetchWithApiSecret("/api/org/overview");

    expect(getApiSecret()).toBe("");
    expect(globalThis.sessionStorage.getItem("tokenpulse_login_redirect")).toBe(
      "/enterprise?tab=members#role-editor",
    );
    expect(globalThis.window.location.href).toBe("/login");
  });

  it("fetchWithApiSecret 在登录页 401 时不应保存 /login 作为回跳目标", async () => {
    setApiSecret("tokenpulse-secret");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "/login",
          pathname: "/login",
          search: "",
          hash: "",
        },
      },
    });
    globalThis.fetch = mock(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;

    await fetchWithApiSecret("/api/org/overview");

    expect(getApiSecret()).toBe("");
    expect(globalThis.sessionStorage.getItem("tokenpulse_login_redirect")).toBeNull();
    expect(globalThis.window.location.href).toBe("/login");
  });
});
