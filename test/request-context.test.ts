import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  getRequestTraceId,
  getRequestedAccountId,
  requestContextMiddleware,
  setSelectedAccountId,
  getSelectedAccountId,
} from "../src/middleware/request-context";

describe("请求上下文中间件", () => {
  it("应生成 traceId 并回写响应头", async () => {
    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.get("/", (c) => {
      setSelectedAccountId(c, "user@example.com");
      return c.json({
        traceId: getRequestTraceId(c),
        selectedAccountId: getSelectedAccountId(c),
      });
    });

    const res = await app.fetch(new Request("http://local/"));
    expect(res.status).toBe(200);
    const requestId = res.headers.get("x-request-id");
    expect(Boolean(requestId)).toBe(true);
    const payload = await res.json();
    expect(payload.traceId).toBe(requestId);
    expect(payload.selectedAccountId).toBe("user@example.com");
  });

  it("应优先使用上游请求头 traceId 与 accountId", async () => {
    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.get("/", (c) => {
      return c.json({
        traceId: getRequestTraceId(c),
        requestedAccountId: getRequestedAccountId(c),
      });
    });

    const res = await app.fetch(
      new Request("http://local/", {
        headers: {
          "x-request-id": "trace-fixed-123",
          "x-tokenpulse-account-id": "Team/User@Example.Com",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("trace-fixed-123");
    const payload = await res.json();
    expect(payload.traceId).toBe("trace-fixed-123");
    expect(payload.requestedAccountId).toBe("team-user@example.com");
  });
});

