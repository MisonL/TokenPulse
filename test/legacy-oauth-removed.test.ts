import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import credentials from "../src/routes/credentials";

const app = new Hono();
app.route("/api/credentials", credentials);

describe("旧 OAuth 路由移除", () => {
  it("旧路由应返回 404（不再保留 410 兼容层）", async () => {
    const res = await app.fetch(
      new Request("http://local/api/credentials/auth/qwen/start", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(404);
  });
});
