import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config";
import { enterpriseProxyMiddleware } from "../src/middleware/enterprise-proxy";

function createTestApp() {
  const app = new Hono();
  app.use("/api/admin/*", enterpriseProxyMiddleware);
  app.get("/api/admin/features", (c) => c.json({ success: true }));
  app.get("/api/admin/audit/events", (c) => c.json({ success: true }));
  app.post("/api/admin/users", (c) => c.json({ success: true }));
  return app;
}

describe("enterpriseProxyMiddleware 高级版关闭语义", () => {
  it("测试前置：默认应处于标准版（ENABLE_ADVANCED=false）", () => {
    expect(config.enableAdvanced).toBe(false);
  });

  it("GET /api/admin/features 在标准版应继续可访问", async () => {
    const app = createTestApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/features"),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
  });

  it("GET /api/admin/* 读接口在标准版应返回 503 + ADVANCED_DISABLED_READONLY", async () => {
    const app = createTestApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/audit/events"),
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.code).toBe("ADVANCED_DISABLED_READONLY");
    expect(payload.error).toBe("高级版能力未启用");
    expect(payload.details).toContain("ENABLE_ADVANCED=true");
  });

  it("POST /api/admin/* 写接口在标准版应返回 404", async () => {
    const app = createTestApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "demo" }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("HEAD /api/admin/* 在标准版应按读接口语义返回 503", async () => {
    const app = createTestApp();
    const response = await app.fetch(
      new Request("http://localhost/api/admin/audit/events", {
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(503);
  });
});
