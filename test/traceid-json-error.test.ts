import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import settings from "../src/routes/settings";
import { requestContextMiddleware } from "../src/middleware/request-context";

describe("traceIdJsonErrorMiddleware", () => {
  it("应为 /api/* 的 JSON 错误响应注入 traceId，并与 X-Request-Id 一致", async () => {
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
});

