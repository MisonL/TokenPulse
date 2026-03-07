import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  clearApiSecret,
  consumeLoginRedirect,
  downloadWithApiSecret,
  fetchWithApiSecret,
  getApiSecret,
  loginWithApiSecret,
  requestJsonWithApiSecret,
  setApiSecret,
  verifyApiSecret,
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
