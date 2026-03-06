import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  clearApiSecret,
  getApiSecret,
  loginWithApiSecret,
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
  const storage = new MemoryStorage();

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    storage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it("set/get/clear 应维护本地 API secret", () => {
    expect(getApiSecret()).toBe("");

    setApiSecret("tokenpulse-secret");
    expect(getApiSecret()).toBe("tokenpulse-secret");

    clearApiSecret();
    expect(getApiSecret()).toBe("");
  });

  it("verifyApiSecret 成功时应通过，不落本地存储", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as typeof fetch;

    await verifyApiSecret("tokenpulse-secret");

    expect(getApiSecret()).toBe("");
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
});
