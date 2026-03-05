import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { HTTPError } from "../src/lib/http";
import { BaseProvider } from "../src/lib/providers/base";
import { updateRouteExecutionPolicy } from "../src/lib/routing/route-policy";
import { requestContextMiddleware } from "../src/middleware/request-context";

async function ensureCoreSettingsTable() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.settings (
        key text PRIMARY KEY,
        value text NOT NULL,
        description text,
        updated_at text
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.system_logs (
        id serial PRIMARY KEY,
        timestamp text NOT NULL,
        level text NOT NULL,
        source text NOT NULL,
        message text NOT NULL
      )
    `),
  );
}

class CatchTestProvider extends BaseProvider {
  protected providerId = "catch-test";
  protected authConfig = {
    providerId: "catch-test",
    clientId: "test",
    clientSecret: "test",
    authUrl: "https://example.com/auth",
    tokenUrl: "https://example.com/token",
    redirectUri: "https://example.com/callback",
    scopes: [],
  };
  protected endpoint = "https://example.com/v1/chat/completions";

  constructor(mode: "generic" | "http") {
    super();
    if (mode === "http") {
      this.requestPipeline.push({
        name: "throw-http",
        transform: async () => {
          const headers = new Headers({
            "content-type": "application/json",
            "retry-after": "7",
          });
          throw new HTTPError(
            429,
            "Too Many Requests",
            JSON.stringify({ error: "rate limited" }),
            headers,
          );
        },
      });
    }
    this.init();
  }

  protected async getCustomHeaders(): Promise<Record<string, string>> {
    return {};
  }

  protected async transformResponse(response: Response): Promise<Response> {
    return response;
  }
}

describe("BaseProvider catch 分支路由头输出", () => {
  beforeAll(async () => {
    await ensureCoreSettingsTable();
  });

  afterAll(async () => {
    // 避免影响其他测试文件：恢复默认行为（输出路由头）。
    await updateRouteExecutionPolicy({ emitRouteHeaders: true });
  });

  it("generic 异常时应携带 traceId 并输出路由头（emitRouteHeaders=true）", async () => {
    await updateRouteExecutionPolicy({ emitRouteHeaders: true });

    const provider = new CatchTestProvider("generic");
    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.route("/api/p", provider.router);

    const traceId = "trace-catch-001";
    const response = await app.fetch(
      new Request("http://localhost/api/p/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": traceId,
        },
        // 空 body 会导致 c.req.json() 抛错，进入 catch 分支
        body: "",
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    expect(response.headers.get("x-tokenpulse-provider")).toBe("catch-test");
    expect(response.headers.get("x-tokenpulse-fallback")).toBe("none");
    const payload = (await response.json()) as Record<string, unknown>;
    expect(String(payload.error || "")).toContain("JSON");
    expect(payload.traceId).toBe(traceId);
  });

  it("HTTPError 异常时应遵循 emitRouteHeaders=false（不输出路由决策头）", async () => {
    await updateRouteExecutionPolicy({ emitRouteHeaders: false });

    const provider = new CatchTestProvider("http");
    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.route("/api/p", provider.router);

    const traceId = "trace-catch-002";
    const response = await app.fetch(
      new Request("http://localhost/api/p/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": traceId,
        },
        body: JSON.stringify({ messages: [] }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    // emitRouteHeaders=false 时不应输出路由决策头
    expect(response.headers.get("x-tokenpulse-provider")).toBe(null);
    expect(response.headers.get("x-tokenpulse-fallback")).toBe(null);
    // 仍应保持全局 requestContextMiddleware 的 X-Request-Id 行为
    expect(response.headers.get("x-request-id")).toBe(traceId);

    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("rate limited");
    expect(payload.traceId).toBe(traceId);
  });
});
