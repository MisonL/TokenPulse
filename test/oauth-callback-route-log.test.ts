import { describe, expect, it } from "bun:test";
import oauth from "../src/routes/oauth";
import { oauthCallbackStore } from "../src/lib/auth/oauth-callback-store";

describe("OAuth 统一回调日志", () => {
  it("会话不存在时应写入失败日志", async () => {
    oauthCallbackStore.clearMemoryForTest();

    const state = `missing-${Date.now()}`;
    const response = await oauth.fetch(
      new Request("http://localhost/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "claude",
          state,
          code: "dummy-code",
        }),
      }),
    );

    expect(response.status).toBe(404);

    const events = await oauthCallbackStore.listByState(state);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.provider).toBe("claude");
    expect(events[0]?.status).toBe("failure");
    expect(events[0]?.source).toBe("aggregate");
  });

  it("应兼容 redirect_url 中 code#state 格式并记录对应 state", async () => {
    oauthCallbackStore.clearMemoryForTest();

    const state = `hash-${Date.now()}`;
    const response = await oauth.fetch(
      new Request("http://localhost/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "claude",
          redirect_url: `http://localhost/callback?code=dummy-code#${state}`,
        }),
      }),
    );

    expect(response.status).toBe(404);

    const events = await oauthCallbackStore.listByState(state);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.provider).toBe("claude");
    expect(events[0]?.status).toBe("failure");
  });

  it("应兼容 code 字段携带 #state 并记录对应 state", async () => {
    oauthCallbackStore.clearMemoryForTest();

    const state = `fragment-${Date.now()}`;
    const response = await oauth.fetch(
      new Request("http://localhost/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "claude",
          code: `dummy-code#${state}`,
        }),
      }),
    );

    expect(response.status).toBe(404);

    const events = await oauthCallbackStore.listByState(state);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.provider).toBe("claude");
    expect(events[0]?.status).toBe("failure");
  });
});
