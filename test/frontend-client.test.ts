import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  clearApiSecret,
  consumeLoginRedirect,
  downloadWithApiSecret,
  enterpriseAdminClient,
  fetchWithApiSecret,
  getApiSecret,
  loginWithApiSecret,
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
    globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as typeof fetch;

    await verifyApiSecret("tokenpulse-secret");

    expect(getApiSecret()).toBe("");
  });

  it("verifyApiSecret 在 404 时应提示后端尚未提供探针", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as typeof fetch;

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
    }) as typeof fetch;

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
    ) as typeof fetch;

    await expect(loginWithApiSecret("bad-secret")).rejects.toThrow("接口密钥校验失败（401）");
    expect(getApiSecret()).toBe("");
  });

  it("verifyStoredApiSecret 成功时应保留当前 secret", async () => {
    setApiSecret("tokenpulse-secret");
    globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as typeof fetch;

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
    ) as typeof fetch;

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
    ) as typeof fetch;

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
    }) as typeof fetch;

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
    ) as typeof fetch;

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
    }) as typeof fetch;

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

  it("enterpriseAdminClient AgentLedger helper 应命中稳定接口路径", async () => {
    setApiSecret("tokenpulse-secret");
    const calls: Array<{ url: string; method: string }> = [];
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
      calls.push({ url, method });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }) as typeof fetch;

    await enterpriseAdminClient.listAgentLedgerOutbox({
      page: 2,
      pageSize: 25,
      deliveryState: "replay_required",
      status: "failure",
      provider: "claude",
      tenantId: "default",
      traceId: "trace-agentledger-1",
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-03-02T00:00:00.000Z",
    });
    await enterpriseAdminClient.getAgentLedgerOutboxSummary({
      deliveryState: "retryable_failure",
      status: "timeout",
      provider: "gemini",
      tenantId: "tenant-a",
      traceId: "trace-agentledger-2",
      from: "2026-03-03T00:00:00.000Z",
      to: "2026-03-04T00:00:00.000Z",
    });
    await enterpriseAdminClient.replayAgentLedgerOutboxItem(42);

    expect(calls).toHaveLength(3);

    const listUrl = new URL(calls[0]?.url || "", "https://tokenpulse.local");
    expect(listUrl.pathname).toBe("/api/admin/observability/agentledger-outbox");
    expect(listUrl.searchParams.get("page")).toBe("2");
    expect(listUrl.searchParams.get("pageSize")).toBe("25");
    expect(listUrl.searchParams.get("deliveryState")).toBe("replay_required");
    expect(listUrl.searchParams.get("status")).toBe("failure");
    expect(listUrl.searchParams.get("provider")).toBe("claude");
    expect(listUrl.searchParams.get("tenantId")).toBe("default");
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
    expect(summaryUrl.searchParams.get("traceId")).toBe("trace-agentledger-2");
    expect(summaryUrl.searchParams.get("from")).toBe("2026-03-03T00:00:00.000Z");
    expect(summaryUrl.searchParams.get("to")).toBe("2026-03-04T00:00:00.000Z");
    expect(calls[1]?.method).toBe("GET");

    const replayUrl = new URL(calls[2]?.url || "", "https://tokenpulse.local");
    expect(replayUrl.pathname).toBe("/api/admin/observability/agentledger-outbox/42/replay");
    expect(calls[2]?.method).toBe("POST");

    const exportUrl = new URL(
      enterpriseAdminClient.buildAgentLedgerOutboxExportPath({
        deliveryState: "pending",
        status: "blocked",
        provider: "claude",
        tenantId: "tenant-export",
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
    expect(exportUrl.searchParams.get("traceId")).toBe("trace-agentledger-export");
    expect(exportUrl.searchParams.get("from")).toBe("2026-03-05T00:00:00.000Z");
    expect(exportUrl.searchParams.get("to")).toBe("2026-03-06T00:00:00.000Z");
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
    }) as typeof fetch;

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
    globalThis.fetch = mock(async () => new Response(null, { status: 401 })) as typeof fetch;

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
    globalThis.fetch = mock(async () => new Response(null, { status: 401 })) as typeof fetch;

    await fetchWithApiSecret("/api/org/overview");

    expect(getApiSecret()).toBe("");
    expect(globalThis.sessionStorage.getItem("tokenpulse_login_redirect")).toBeNull();
    expect(globalThis.window.location.href).toBe("/login");
  });
});
