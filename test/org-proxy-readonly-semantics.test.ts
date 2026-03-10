import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config";
import { enterpriseProxyMiddleware } from "../src/middleware/enterprise-proxy";

function createOrgProxyApp() {
  const app = new Hono();
  app.use("/api/org/*", enterpriseProxyMiddleware);
  app.all("/api/org/*", (c) => c.text("unexpected"));
  return app;
}

describe("组织域 enterpriseProxyMiddleware 只读降级语义", () => {
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

  it("ENABLE_ADVANCED=false 时读接口返回 503 + ADVANCED_DISABLED_READONLY，写接口返回 404", async () => {
    config.enableAdvanced = false;

    const app = createOrgProxyApp();
    const readRes = await app.fetch(
      new Request("http://local/api/org/organizations"),
    );

    expect(readRes.status).toBe(503);
    const readJson = (await readRes.json()) as { code?: string; error?: string };
    expect(readJson.error).toBe("高级版能力未启用");
    expect(readJson.code).toBe("ADVANCED_DISABLED_READONLY");

    const writeRes = await app.fetch(
      new Request("http://local/api/org/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "demo" }),
      }),
    );
    expect(writeRes.status).toBe(404);
  });

  it("enterprise 不可达时读接口返回 503 + ENTERPRISE_BACKEND_UNREACHABLE，写接口返回 404", async () => {
    config.enableAdvanced = true;
    config.enterprise.baseUrl = "http://enterprise.local";
    config.enterprise.internalSharedKey = "shared-key";

    const calls: Array<{ url: string; method: string; headers: Headers }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({
        url,
        method: (init?.method || "GET").toUpperCase(),
        headers: new Headers(init?.headers),
      });
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;

    const app = createOrgProxyApp();
    const readRes = await app.fetch(
      new Request("http://local/api/org/organizations?status=active", {
        headers: {
          "x-admin-user": "release-bot",
        },
      }),
    );

    expect(readRes.status).toBe(503);
    const readJson = (await readRes.json()) as { code?: string; error?: string };
    expect(readJson.error).toBe("企业后端不可用");
    expect(readJson.code).toBe("ENTERPRISE_BACKEND_UNREACHABLE");

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.url).toBe(
      "http://enterprise.local/api/org/organizations?status=active",
    );
    expect(calls[0]?.headers.get("x-tokenpulse-internal-key")).toBe("shared-key");

    const writeRes = await app.fetch(
      new Request("http://local/api/org/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "demo" }),
      }),
    );
    expect(writeRes.status).toBe(404);
  });
});

