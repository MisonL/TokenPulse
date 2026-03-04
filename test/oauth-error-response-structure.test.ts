import { describe, expect, it } from "bun:test";
import oauth from "../src/routes/oauth";
import { oauthSessionStore } from "../src/lib/auth/oauth-session-store";

function buildState(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("OAuth 错误响应结构", () => {
  it("未知 provider 的 start 应返回 code + traceId", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/not-exists/start", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_provider_unsupported");
    expect(typeof payload.traceId).toBe("string");
  });

  it("poll 传入非法 state 应返回 oauth_invalid_state", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/claude/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state: "invalid state !",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_invalid_state");
    expect(typeof payload.traceId).toBe("string");
  });

  it("auth_code provider 未提供 state 轮询应返回 oauth_session_flow_mismatch", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/claude/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_session_flow_mismatch");
    expect(typeof payload.traceId).toBe("string");
  });

  it("poll provider 与 state 不匹配时应返回 oauth_provider_state_mismatch", async () => {
    const state = buildState("mismatch");
    await oauthSessionStore.register(state, "claude", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const response = await oauth.fetch(
      new Request("http://localhost/codex/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_provider_state_mismatch");
    expect(typeof payload.traceId).toBe("string");
  });

  it("聚合回调缺少 state 应返回 oauth_callback_missing_state", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "claude",
          code: "dummy-code",
        }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_callback_missing_state");
    expect(typeof payload.traceId).toBe("string");
  });

  it("聚合回调缺少 code 且会话存在时应返回 oauth_callback_missing_code", async () => {
    const state = buildState("missing-code");
    await oauthSessionStore.register(state, "claude", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const response = await oauth.fetch(
      new Request("http://localhost/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "claude",
          state,
        }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_callback_missing_code");
    expect(typeof payload.traceId).toBe("string");
  });
});
