import { describe, expect, it } from "bun:test";
import {
  appendFallbackMode,
  extractRouteDecisionHeaders,
  withRouteDecisionHeaders,
} from "../src/lib/routing/route-decision";

describe("路由决策头工具", () => {
  it("应写入并提取统一路由头", async () => {
    const base = new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
    const wrapped = withRouteDecisionHeaders(base, {
      provider: "claude",
      routePolicy: "round_robin",
      selectedAccountId: "acc-1",
      fallback: "bridge",
      traceId: "trace-123",
    });

    expect(wrapped.headers.get("x-tokenpulse-provider")).toBe("claude");
    expect(wrapped.headers.get("x-tokenpulse-route-policy")).toBe("round_robin");
    expect(wrapped.headers.get("x-tokenpulse-account-id")).toBe("acc-1");
    expect(wrapped.headers.get("x-tokenpulse-fallback")).toBe("bridge");
    expect(wrapped.headers.get("x-request-id")).toBe("trace-123");

    const extracted = extractRouteDecisionHeaders(wrapped.headers);
    expect(extracted.provider).toBe("claude");
    expect(extracted.routePolicy).toBe("round_robin");
    expect(extracted.selectedAccountId).toBe("acc-1");
    expect(extracted.fallback).toBe("bridge");
    expect(extracted.traceId).toBe("trace-123");
  });

  it("应合并多个回退模式", () => {
    const first = appendFallbackMode("none", "api_key");
    expect(first).toBe("api_key");
    const second = appendFallbackMode(first, "bridge");
    expect(second).toContain("api_key");
    expect(second).toContain("bridge");
  });
});
