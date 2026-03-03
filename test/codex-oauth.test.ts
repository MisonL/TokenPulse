import { describe, it, expect } from "bun:test";
import { generateCodexAuthUrl } from "../src/lib/auth/codex";
import { config } from "../src/config";

describe("Codex OAuth", () => {
  it("应生成包含关键参数的授权链接", () => {
    const url = generateCodexAuthUrl();
    const encodedRedirect = encodeURIComponent(
      `${config.baseUrl}/api/codex/callback`,
    );

    expect(url).toContain("https://auth.openai.com/oauth/authorize");
    expect(url).toContain(`client_id=${config.oauth.codexClientId}`);
    expect(url).toContain("response_type=code");
    expect(url).toContain(`redirect_uri=${encodedRedirect}`);
    expect(url).toContain("scope=openid");
    expect(url).toContain("code_challenge=");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("prompt=login");
    expect(url).toContain("id_token_add_organizations=true");
    expect(url).toContain("codex_cli_simplified_flow=true");
  });
});
