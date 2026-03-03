import { describe, expect, it } from "bun:test";
import oauth from "../src/routes/oauth";
import { oauthSessionStore } from "../src/lib/auth/oauth-session-store";

function buildState(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("OAuth 统一轮询路由", () => {
  it("auth_code 会话应返回 pending/completed/error 状态", async () => {
    const pendingState = buildState("claude-pending");
    await oauthSessionStore.register(pendingState, "claude", "verifier", {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const pendingResp = await oauth.fetch(
      new Request("http://localhost/claude/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: pendingState }),
      }),
    );
    expect(pendingResp.status).toBe(200);
    const pendingData = await pendingResp.json();
    expect(pendingData.status).toBe("pending");
    expect(pendingData.phase).toBe("waiting_callback");
    expect(pendingData.pending).toBe(true);

    await oauthSessionStore.complete(pendingState);
    const completedResp = await oauth.fetch(
      new Request("http://localhost/claude/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: pendingState }),
      }),
    );
    expect(completedResp.status).toBe(200);
    const completedData = await completedResp.json();
    expect(completedData.status).toBe("completed");
    expect(completedData.success).toBe(true);

    const errorState = buildState("claude-error");
    await oauthSessionStore.register(errorState, "claude", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });
    await oauthSessionStore.markError(errorState, "token exchange failed");

    const errorResp = await oauth.fetch(
      new Request("http://localhost/claude/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: errorState }),
      }),
    );
    expect(errorResp.status).toBe(200);
    const errorData = await errorResp.json();
    expect(errorData.status).toBe("error");
    expect(errorData.error).toBe("token exchange failed");
  });

  it("provider 与 state 不匹配时应返回 400", async () => {
    const state = buildState("provider-mismatch");
    await oauthSessionStore.register(state, "claude", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const response = await oauth.fetch(
      new Request("http://localhost/codex/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("qwen 会话完成后可仅通过 state 轮询成功", async () => {
    const state = buildState("qwen-complete");
    await oauthSessionStore.register(state, "qwen", "verifier", {
      flowType: "device_code",
      phase: "waiting_device",
    });
    await oauthSessionStore.complete(state);

    const response = await oauth.fetch(
      new Request("http://localhost/qwen/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("completed");
    expect(data.success).toBe(true);
  });

  it("qwen pending 会话缺少设备参数时应返回 400", async () => {
    const state = buildState("qwen-pending");
    await oauthSessionStore.register(state, "qwen", "verifier", {
      flowType: "device_code",
      phase: "waiting_device",
    });

    const response = await oauth.fetch(
      new Request("http://localhost/qwen/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(String(data.error || "")).toContain("deviceCode/codeVerifier");
  });

  it("copilot 会话完成后可仅通过 state 轮询成功", async () => {
    const state = buildState("copilot-complete");
    await oauthSessionStore.register(state, "copilot", undefined, {
      flowType: "device_code",
      phase: "waiting_device",
    });
    await oauthSessionStore.complete(state);

    const response = await oauth.fetch(
      new Request("http://localhost/copilot/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("completed");
    expect(data.success).toBe(true);
  });
});
