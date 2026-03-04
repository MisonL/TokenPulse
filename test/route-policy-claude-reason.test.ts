import { describe, expect, it } from "bun:test";
import {
  resolveClaudeBridgeFallbackReason,
  shouldFallbackClaudeByBridge,
  type RouteExecutionPolicy,
} from "../src/lib/routing/route-policy";

const policy: RouteExecutionPolicy = {
  emitRouteHeaders: true,
  retryStatusCodes: [401, 403, 429, 500, 502, 503, 504],
  claudeFallbackStatusCodes: [401, 403, 429, 500, 502, 503, 504],
};

describe("Claude bridge 回退原因解析", () => {
  it("命中状态码策略时应返回 status_code", () => {
    const reason = resolveClaudeBridgeFallbackReason(502, "", policy);
    expect(reason).toBe("status_code");
    expect(shouldFallbackClaudeByBridge(502, "", policy)).toBe(true);
  });

  it("命中 Cloudflare 特征时应返回 cloudflare_signal", () => {
    const reason = resolveClaudeBridgeFallbackReason(
      530,
      "Attention Required! | Cloudflare",
      policy,
    );
    expect(reason).toBe("cloudflare_signal");
    expect(
      shouldFallbackClaudeByBridge(530, "Attention Required! | Cloudflare", policy),
    ).toBe(true);
  });

  it("未命中任何条件时应返回 not_eligible", () => {
    const reason = resolveClaudeBridgeFallbackReason(418, "teapot", policy);
    expect(reason).toBe("not_eligible");
    expect(shouldFallbackClaudeByBridge(418, "teapot", policy)).toBe(false);
  });
});
