import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { legacyOAuthDeprecationMiddleware } from "../src/middleware/legacy-oauth";

const app = new Hono();
app.use("/api/credentials/auth/*", legacyOAuthDeprecationMiddleware);
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("authorization");
  if (auth === "Bearer test-token") {
    await next();
    return;
  }
  return c.json({ error: "unauthorized" }, 401);
});
app.post("/api/credentials/auth/aistudio/save", (c) => c.json({ success: true }));

describe("旧 OAuth 路由移除", () => {
  it("未鉴权访问旧路由应直接返回 410（不再触发 401）", async () => {
    const res = await app.fetch(
      new Request("http://local/api/credentials/auth/qwen/start", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(410);
  });

  it("已鉴权访问旧路由也应返回 410", async () => {
    const res = await app.fetch(
      new Request("http://local/api/credentials/auth/qwen/start", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
        },
      }),
    );
    expect(res.status).toBe(410);
  });

  it("手动保存入口应保持可用（不被 410 拦截）", async () => {
    const res = await app.fetch(
      new Request("http://local/api/credentials/auth/aistudio/save", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
        },
      }),
    );
    expect(res.status).toBe(200);
  });
});
