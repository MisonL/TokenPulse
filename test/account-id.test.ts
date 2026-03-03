import { describe, expect, it } from "bun:test";
import { resolveAccountId } from "../src/lib/auth/account-id";

describe("账号 ID 解析", () => {
  it("应优先使用显式 accountId 并净化格式", () => {
    const result = resolveAccountId({
      provider: "claude",
      accountId: "  Team/Owner@Example.Com  ",
    });
    expect(result).toBe("team-owner@example.com");
  });

  it("未提供 accountId 时应回退到邮箱", () => {
    const result = resolveAccountId({
      provider: "gemini",
      email: "Dev.User+test@Example.com",
    });
    expect(result).toBe("dev.user-test@example.com");
  });

  it("无可用标识时应回退 default", () => {
    const result = resolveAccountId({
      provider: "qwen",
      metadata: {},
    });
    expect(result).toBe("default");
  });
});
