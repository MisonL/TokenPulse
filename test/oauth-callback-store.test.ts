import { beforeEach, describe, expect, it } from "bun:test";
import { OAuthCallbackStore } from "../src/lib/auth/oauth-callback-store";

describe("OAuth 回调事件仓库", () => {
  let store: OAuthCallbackStore;

  beforeEach(() => {
    store = new OAuthCallbackStore(10);
    store.clearMemoryForTest();
  });

  it("应记录成功回调并可按 state 查询", async () => {
    await store.append({
      provider: "claude",
      state: "state-success",
      code: "code-1",
      source: "aggregate",
      status: "success",
      raw: { from: "test" },
    });

    const events = await store.listByState("state-success");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.provider).toBe("claude");
    expect(events[0]?.status).toBe("success");
    expect(events[0]?.source).toBe("aggregate");
  });

  it("应记录失败回调并保留错误信息", async () => {
    await store.append({
      provider: "codex",
      state: "state-failed",
      error: "授权会话不存在或已过期",
      source: "manual",
      status: "failure",
      raw: { reason: "missing-session" },
    });

    const events = await store.listByState("state-failed");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.provider).toBe("codex");
    expect(events[0]?.status).toBe("failure");
    expect(events[0]?.error).toContain("授权会话不存在");
  });

  it("应支持按 provider/status 分页查询", async () => {
    await store.append({
      provider: "claude",
      state: "q-1",
      source: "aggregate",
      status: "success",
    });
    await store.append({
      provider: "claude",
      state: "q-2",
      source: "manual",
      status: "failure",
    });
    await store.append({
      provider: "codex",
      state: "q-3",
      source: "aggregate",
      status: "success",
    });

    const result = await store.list({
      provider: "claude",
      status: "failure",
      page: 1,
      pageSize: 10,
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]?.provider).toBe("claude");
    expect(result.data[0]?.status).toBe("failure");
  });
});
