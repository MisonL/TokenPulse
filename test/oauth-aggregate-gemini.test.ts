import { describe, expect, it } from "bun:test";
import oauth from "../src/routes/oauth";
import { oauthSessionStore } from "../src/lib/auth/oauth-session-store";

function buildState(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("OAuth 聚合回调（Gemini）", () => {
  it("应支持无 cookie 的手动聚合回调并进入令牌交换阶段", async () => {
    const state = buildState("gemini-aggregate");
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
      return new Response("unmocked", { status: 500 });
    }) as typeof globalThis.fetch;

    try {
      const response = await oauth.fetch(
        new Request("http://localhost/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "gemini",
            code: "dummy-code",
            state,
          }),
        }),
      );

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.success).toBe(false);
      expect(payload.provider).toBe("gemini");
      expect(String(payload.error || "")).toContain("令牌交换失败");

      const session = await oauthSessionStore.get(state);
      expect(session?.status).toBe("error");
      expect(session?.phase).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
