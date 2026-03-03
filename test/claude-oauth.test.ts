import { describe, it, expect } from "bun:test";
import { generateClaudeAuthUrl } from "../src/lib/auth/claude";
import { config } from "../src/config";

describe("Claude OAuth", () => {
  it("应生成包含关键参数的授权链接", () => {
    const url = generateClaudeAuthUrl();
    const encodedRedirect = encodeURIComponent(
      `${config.baseUrl}/api/claude/callback`,
    );

    expect(url).toContain("https://claude.ai/oauth/authorize");
    expect(url).toContain(`client_id=${config.oauth.claudeClientId}`);
    expect(url).toContain("response_type=code");
    expect(url).toContain(`redirect_uri=${encodedRedirect}`);
    expect(url).toContain("scope=org%3Acreate_api_key");
    expect(url).toContain("code_challenge=");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("state=");
  });

  it("每次请求应生成不同的 state", () => {
    const url1 = generateClaudeAuthUrl();
    const url2 = generateClaudeAuthUrl();

    const state1 = url1.match(/state=([a-f0-9]+)/)?.[1];
    const state2 = url2.match(/state=([a-f0-9]+)/)?.[1];

    expect(state1).toBeDefined();
    expect(state2).toBeDefined();
    expect(state1).not.toBe(state2);
  });
});
