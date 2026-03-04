import { describe, expect, it } from "bun:test";
import oauth from "../src/routes/oauth";
import { oauthSessionStore } from "../src/lib/auth/oauth-session-store";
import {
  getProviderRuntimeAdapter,
  overrideProviderRuntimeAdapterForTest,
} from "../src/lib/oauth/runtime-adapters";

function buildState(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("OAuth 路由跨 provider 关键边界", () => {
  it("GET /session/:state 非法 state 应返回 oauth_invalid_state", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/session/invalid%20state"),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_invalid_state");
    expect(typeof payload.traceId).toBe("string");
  });

  it("GET /session/:state 会话不存在时应返回 exists=false", async () => {
    const state = buildState("session-missing");
    const response = await oauth.fetch(
      new Request(`http://localhost/session/${state}`),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload).toEqual({ exists: false });
  });

  it("GET /session/:state 会话存在时应返回标准会话负载", async () => {
    const state = buildState("session-found");
    await oauthSessionStore.register(state, "claude", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const response = await oauth.fetch(
      new Request(`http://localhost/session/${state}`),
    );
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.exists).toBe(true);
    expect(payload.state).toBe(state);
    expect(payload.provider).toBe("claude");
    expect(payload.flow).toBe("auth_code");
    expect(payload.status).toBe("pending");
    expect(payload.phase).toBe("waiting_callback");
    expect(payload.pending).toBe(true);
    expect(payload.success).toBe(false);
  });

  it("POST /openai/start 应归一化到 codex 并写入对应会话", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/openai/start", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.provider).toBe("codex");
    expect(payload.flow).toBe("auth_code");
    expect(typeof payload.state).toBe("string");
    expect(payload.state.length).toBeGreaterThan(0);

    const sessionResponse = await oauth.fetch(
      new Request(`http://localhost/session/${payload.state}`),
    );
    expect(sessionResponse.status).toBe(200);
    const sessionPayload = await sessionResponse.json();
    expect(sessionPayload.provider).toBe("codex");
    expect(sessionPayload.flow).toBe("auth_code");
  });

  it("POST /openai/poll 应可轮询 codex 的 auth_code 会话", async () => {
    const state = buildState("poll-openai-alias");
    await oauthSessionStore.register(state, "codex", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const response = await oauth.fetch(
      new Request("http://localhost/openai/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.state).toBe(state);
    expect(payload.provider).toBe("codex");
    expect(payload.flow).toBe("auth_code");
    expect(payload.status).toBe("pending");
    expect(payload.pending).toBe(true);
  });

  it("POST /claude/poll state 不存在时应返回 oauth_session_not_found", async () => {
    const state = buildState("session-not-found");
    const response = await oauth.fetch(
      new Request("http://localhost/claude/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_session_not_found");
    expect(payload.state).toBe(state);
  });

  it("POST /aistudio/poll 应返回 oauth_provider_poll_not_supported", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/aistudio/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_provider_poll_not_supported");
    expect(typeof payload.traceId).toBe("string");
  });

  it("GET /openai/callback 应重定向到 codex 回调入口", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/openai/callback?code=dummy-code&state=dummy-state"),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location") || "";
    expect(location).toContain("/api/codex/callback");
    expect(location).toContain("code=dummy-code");
    expect(location).toContain("state=dummy-state");
  });

  it("GET /qwen/callback 在无回调入口时应返回 oauth_callback_not_required", async () => {
    const adapter = getProviderRuntimeAdapter("qwen");
    expect(adapter).toBeTruthy();
    const restore = overrideProviderRuntimeAdapterForTest("qwen", {
      ...adapter!,
      callbackRedirectPath: undefined,
    });

    try {
      const response = await oauth.fetch(
        new Request("http://localhost/qwen/callback?code=dummy-code&state=dummy-state"),
      );
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.code).toBe("oauth_callback_not_required");
      expect(payload.stage).toBe("callback");
    } finally {
      restore();
    }
  });

  it("POST /qwen/callback/manual 应返回 oauth_manual_callback_disabled", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/qwen/callback/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "http://localhost/callback?code=dummy-code&state=dummy-state",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_manual_callback_disabled");
    expect(typeof payload.traceId).toBe("string");
  });

  it("POST /unknown/callback/manual 应返回 oauth_provider_capability_missing", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/unknown/callback/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "http://localhost/callback?code=dummy-code&state=dummy-state",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_provider_capability_missing");
    expect(typeof payload.traceId).toBe("string");
  });

  it("POST /gemini/callback/manual 缺少 code/state 时应返回 oauth_manual_callback_missing_code_state", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/gemini/callback/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "http://localhost/oauth2callback?error=access_denied",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_manual_callback_missing_code_state");
    expect(typeof payload.traceId).toBe("string");
  });

  it("POST /claude/callback/manual 运行时关闭 manual callback 时应返回 oauth_manual_callback_runtime_disabled", async () => {
    const adapter = getProviderRuntimeAdapter("claude");
    expect(adapter).toBeTruthy();
    const restore = overrideProviderRuntimeAdapterForTest("claude", {
      ...adapter!,
      supportsManualCallback: false,
    });

    try {
      const response = await oauth.fetch(
        new Request("http://localhost/claude/callback/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: "http://localhost/callback?code=dummy-code&state=dummy-state",
          }),
        }),
      );

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.code).toBe("oauth_manual_callback_runtime_disabled");
    } finally {
      restore();
    }
  });

  it("POST /claude/callback/manual 运行时缺少 callback router 时应返回 oauth_manual_callback_unsupported", async () => {
    const adapter = getProviderRuntimeAdapter("claude");
    expect(adapter).toBeTruthy();
    const restore = overrideProviderRuntimeAdapterForTest("claude", {
      ...adapter!,
      supportsManualCallback: true,
      callbackRouter: undefined,
    });

    try {
      const response = await oauth.fetch(
        new Request("http://localhost/claude/callback/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: "http://localhost/callback?code=dummy-code&state=dummy-state",
          }),
        }),
      );

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.code).toBe("oauth_manual_callback_unsupported");
    } finally {
      restore();
    }
  });

  it("POST /claude/callback/manual 使用其他 provider state 应返回 delegate_failed", async () => {
    const state = buildState("manual-provider-mismatch");
    await oauthSessionStore.register(state, "codex", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const response = await oauth.fetch(
      new Request("http://localhost/claude/callback/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `http://localhost/callback?code=dummy-code&state=${state}`,
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_manual_callback_delegate_failed");
    expect(payload.provider).toBe("claude");
    expect(payload.state).toBe(state);
    expect(String(payload.details || "")).toContain("授权会话不存在或已过期");
  });

  it("POST /callback redirect_url 非法时应返回 oauth_callback_invalid_redirect_url", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude",
          redirect_url: "http://",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_callback_invalid_redirect_url");
    expect(typeof payload.traceId).toBe("string");
  });

  it("POST /callback 未传 provider 时应回退 session.provider 并返回 provider_not_supported", async () => {
    const state = buildState("callback-provider-fallback");
    await oauthSessionStore.register(state, "aistudio", undefined, {
      flowType: "manual_key",
      phase: "pending",
    });

    const response = await oauth.fetch(
      new Request("http://localhost/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          code: "dummy-code",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("oauth_callback_provider_not_supported");
    expect(String(payload.error || "")).toContain("aistudio");
    expect(typeof payload.traceId).toBe("string");
  });
});
