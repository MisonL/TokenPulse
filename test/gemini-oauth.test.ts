import { describe, it, expect } from "bun:test";
import { generateGeminiAuthUrl } from "../src/lib/auth/gemini";
import { config } from "../src/config";

describe("Gemini OAuth", () => {
  it("应生成包含关键参数的授权链接", () => {
    const url = generateGeminiAuthUrl();
    const encodedRedirect = encodeURIComponent(
      `${config.baseUrl}/api/gemini/oauth2callback`,
    );

    expect(url).toContain("https://accounts.google.com/o/oauth2/auth");
    expect(url).toContain(`client_id=${config.gemini.clientId}`);
    expect(url).toContain(`redirect_uri=${encodedRedirect}`);
    expect(url).toContain("response_type=code");
    expect(url).toContain("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=");
  });

  it("client_secret 必须来自环境配置（允许为空，由部署时注入）", () => {
    expect(typeof config.gemini.clientSecret).toBe("string");
  });
});
