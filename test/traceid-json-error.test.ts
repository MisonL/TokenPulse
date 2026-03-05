import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import settings from "../src/routes/settings";
import { requestContextMiddleware } from "../src/middleware/request-context";

describe("requestContextMiddleware traceId 注入", () => {
  it("应为 JSON 错误响应注入 traceId，并与 X-Request-Id 一致", async () => {
    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.route("/api/settings", settings);

    const traceId = "trace-json-error-001";
    const response = await app.fetch(
      new Request("http://localhost/api/settings", {
        method: "GET",
        headers: {
          "X-Request-Id": traceId,
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(String(payload.error || "")).toContain("未授权");
    expect(payload.traceId).toBe(traceId);
  });

  it("未传 X-Request-Id 时应自动生成 traceId，并保证 header/body 一致", async () => {
    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.get("/api/boom", (c) => c.json({ error: "boom" }, 500));

    const response = await app.fetch(
      new Request("http://localhost/api/boom", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(500);
    const headerTraceId = (response.headers.get("x-request-id") || "").trim();
    expect(headerTraceId.length).toBeGreaterThan(0);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("boom");
    expect(payload.traceId).toBe(headerTraceId);
  });

  it("当错误响应 body 非对象 JSON 时应包装并注入 traceId", async () => {
    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.get("/api/array-error", (c) => c.json(["oops"], 400));

    const traceId = "trace-json-error-array-001";
    const response = await app.fetch(
      new Request("http://localhost/api/array-error", {
        method: "GET",
        headers: {
          "X-Request-Id": traceId,
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.traceId).toBe(traceId);
    expect(payload.error).toEqual(["oops"]);
  });
});
