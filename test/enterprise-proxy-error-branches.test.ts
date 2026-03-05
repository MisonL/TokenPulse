import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config";
import { enterpriseProxyMiddleware } from "../src/middleware/enterprise-proxy";

describe("enterpriseProxyMiddleware 错误分支", () => {
  const originalEnableAdvanced = config.enableAdvanced;
  const originalBaseUrl = config.enterprise.baseUrl;
  const originalSharedKey = config.enterprise.internalSharedKey;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    config.enableAdvanced = originalEnableAdvanced;
    config.enterprise.baseUrl = originalBaseUrl;
    config.enterprise.internalSharedKey = originalSharedKey;
    globalThis.fetch = originalFetch;
  });

  it("enterprise 后端未配置时应返回 503 + ENTERPRISE_BACKEND_UNCONFIGURED", async () => {
    config.enableAdvanced = true;
    config.enterprise.baseUrl = "";

    const app = new Hono();
    app.use("/api/admin/*", enterpriseProxyMiddleware);
    app.get("/api/admin/*", (c) => c.text("unexpected"));

    const res = await app.fetch(new Request("http://local/api/admin/rbac/roles"));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code?: string; error?: string };
    expect(json.error).toBe("企业后端不可用");
    expect(json.code).toBe("ENTERPRISE_BACKEND_UNCONFIGURED");
  });

  it("enterprise baseUrl 非法时应返回 503 + ENTERPRISE_BACKEND_URL_INVALID", async () => {
    config.enableAdvanced = true;
    config.enterprise.baseUrl = "not-a-url";

    const app = new Hono();
    app.use("/api/admin/*", enterpriseProxyMiddleware);
    app.get("/api/admin/*", (c) => c.text("unexpected"));

    const res = await app.fetch(new Request("http://local/api/admin/rbac/roles"));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code?: string; error?: string };
    expect(json.error).toBe("企业后端不可用");
    expect(json.code).toBe("ENTERPRISE_BACKEND_URL_INVALID");
  });

  it("enterprise 不可达时应返回 503 + ENTERPRISE_BACKEND_UNREACHABLE，并透传 internal key", async () => {
    config.enableAdvanced = true;
    config.enterprise.baseUrl = "http://enterprise.local";
    config.enterprise.internalSharedKey = "shared-key";

    const calls: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, headers: new Headers(init?.headers) });
      throw new Error("connect ECONNREFUSED");
    }) as typeof globalThis.fetch;

    const app = new Hono();
    app.use("/api/admin/*", enterpriseProxyMiddleware);
    app.get("/api/admin/*", (c) => c.text("unexpected"));

    const res = await app.fetch(
      new Request("http://local/api/admin/rbac/roles?debug=1", {
        headers: {
          "x-admin-user": "release-bot",
        },
      }),
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code?: string; error?: string; details?: string };
    expect(json.error).toBe("企业后端不可用");
    expect(json.code).toBe("ENTERPRISE_BACKEND_UNREACHABLE");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://enterprise.local/api/admin/rbac/roles?debug=1");
    expect(calls[0]?.headers.get("x-tokenpulse-internal-key")).toBe("shared-key");
  });
});

