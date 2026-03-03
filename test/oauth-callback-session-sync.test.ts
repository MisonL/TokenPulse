import { describe, expect, it } from "bun:test";
import geminiRouter from "../src/lib/providers/gemini";
import { iflowProvider } from "../src/lib/providers/iflow";
import { antigravityProvider } from "../src/lib/providers/antigravity";
import { oauthSessionStore } from "../src/lib/auth/oauth-session-store";

function buildState(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("OAuth 回调会话状态同步", () => {
  it("iflow 回调成功后应写入 completed 状态", async () => {
    const state = buildState("iflow-sync");
    await oauthSessionStore.register(state, "iflow", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const provider = iflowProvider as any;
    const originalExchange = provider.oauthService.exchangeCodeForToken;
    const originalFinalize = provider.finalizeAuth;

    provider.oauthService.exchangeCodeForToken = async () => ({
      access_token: "iflow-access",
      refresh_token: "iflow-refresh",
      expires_in: 3600,
    });
    provider.finalizeAuth = async () =>
      new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });

    try {
      const response = await iflowProvider.router.fetch(
        new Request(`http://localhost/callback?code=dummy-code&state=${state}`, {
          method: "GET",
          headers: {
            Cookie: `iflow_oauth_state=${state}`,
          },
        }),
      );

      expect(response.status).toBe(200);
      const session = await oauthSessionStore.get(state);
      expect(session?.status).toBe("completed");
      expect(session?.phase).toBe("completed");
    } finally {
      provider.oauthService.exchangeCodeForToken = originalExchange;
      provider.finalizeAuth = originalFinalize;
    }
  });

  it("gemini 令牌交换失败后应写入 error 状态", async () => {
    const state = buildState("gemini-error");
    await oauthSessionStore.register(state, "gemini", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response("token failed", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response("not mocked", { status: 500 });
    }) as typeof globalThis.fetch;

    try {
      const response = await geminiRouter.fetch(
        new Request(`http://localhost/oauth2callback?code=dummy-code&state=${state}`, {
          method: "GET",
          headers: {
            Cookie: `gemini_oauth_state=${state}`,
          },
        }),
      );

      expect(response.status).toBe(400);
      const session = await oauthSessionStore.get(state);
      expect(session?.status).toBe("error");
      expect(session?.phase).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("antigravity 回调缺少 cookie state 时应返回 403", async () => {
    const state = buildState("antigravity-csrf");
    await oauthSessionStore.register(state, "antigravity", undefined, {
      flowType: "auth_code",
      phase: "waiting_callback",
    });
    const response = await antigravityProvider.router.fetch(
      new Request(`http://localhost/callback?code=dummy-code&state=${state}`, {
        method: "GET",
      }),
    );
    expect(response.status).toBe(403);
    const session = await oauthSessionStore.get(state);
    expect(session?.status).toBe("pending");
  });
});
