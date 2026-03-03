import { describe, expect, it } from "bun:test";
import {
  parseManualCallbackUrl,
  parseOAuthCallback,
} from "../src/lib/auth/oauth-callback";

describe("OAuth 回调解析", () => {
  it("应解析标准 code/state 参数", () => {
    const parsed = parseOAuthCallback("auth-code", "state-1");
    expect(parsed.code).toBe("auth-code");
    expect(parsed.state).toBe("state-1");
  });

  it("应兼容 code#state 回调格式", () => {
    const parsed = parseOAuthCallback("auth-code#state-2");
    expect(parsed.code).toBe("auth-code");
    expect(parsed.state).toBe("state-2");
  });

  it("手动回调应从 hash 中恢复 state", () => {
    const url = new URL("http://localhost/callback?code=test-code#manual-state");
    const parsed = parseManualCallbackUrl(url);
    expect(parsed.code).toBe("test-code");
    expect(parsed.state).toBe("manual-state");
  });
});
