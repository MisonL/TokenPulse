import { describe, expect, it } from "bun:test";
import { OAuthSessionStore } from "../src/lib/auth/oauth-session-store";

describe("OAuth 会话仓库", () => {
  it("应注册并校验 pending 会话", async () => {
    const store = new OAuthSessionStore(60_000);
    await store.register("state-a", "claude", "verifier-a");

    expect(await store.isPending("state-a", "claude")).toBe(true);
    expect(await store.isPending("state-a", "gemini")).toBe(false);

    const record = await store.get("state-a");
    expect(record?.verifier).toBe("verifier-a");
  });

  it("完成会话后应不可再用", async () => {
    const store = new OAuthSessionStore(60_000);
    await store.register("state-b", "codex");
    await store.complete("state-b");
    expect(await store.isPending("state-b", "codex")).toBe(false);
  });

  it("标记错误后应变为非 pending", async () => {
    const store = new OAuthSessionStore(60_000);
    await store.register("state-c", "claude");
    await store.markError("state-c", "token exchange failed");
    expect(await store.isPending("state-c", "claude")).toBe(false);
    expect((await store.get("state-c"))?.status).toBe("error");
  });
});
