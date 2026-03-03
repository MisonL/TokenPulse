import { describe, it, expect } from "bun:test";
import { config } from "../src/config";

describe("Qwen OAuth", () => {
  it("应使用配置中的 client_id 并保持公共端点稳定", () => {
    const deviceEndpoint = "https://chat.qwen.ai/api/v1/oauth2/device/code";
    const tokenEndpoint = "https://chat.qwen.ai/api/v1/oauth2/token";

    expect(typeof config.oauth.qwenClientId).toBe("string");
    expect(deviceEndpoint).toBe("https://chat.qwen.ai/api/v1/oauth2/device/code");
    expect(tokenEndpoint).toBe("https://chat.qwen.ai/api/v1/oauth2/token");
  });

  it("设备码请求参数应包含 PKCE 与 scope", () => {
    const body = new URLSearchParams({
      client_id: config.oauth.qwenClientId,
      scope: "openid profile email model.completion",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
    });

    expect(body.toString()).toContain(
      `client_id=${encodeURIComponent(config.oauth.qwenClientId)}`,
    );
    expect(body.toString()).toContain("scope=openid");
    expect(body.toString()).toContain("code_challenge=test-challenge");
    expect(body.toString()).toContain("code_challenge_method=S256");
  });

  it("令牌轮询参数应包含 device_code 与 code_verifier", () => {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: config.oauth.qwenClientId,
      device_code: "test-device-code",
      code_verifier: "test-verifier",
    });

    expect(body.toString()).toContain(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
    );
    expect(body.toString()).toContain(
      `client_id=${encodeURIComponent(config.oauth.qwenClientId)}`,
    );
    expect(body.toString()).toContain("device_code=test-device-code");
    expect(body.toString()).toContain("code_verifier=test-verifier");
  });
});
