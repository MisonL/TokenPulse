import { describe, expect, it } from "bun:test";
import {
  appendClaudeFallbackEvent,
  listClaudeFallbackEvents,
  summarizeClaudeFallbackEvents,
} from "../src/lib/observability/claude-fallback-events";

describe("Claude 回退事件", () => {
  it("应记录并可按 mode/phase 查询", () => {
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "attempt",
      reason: "bridge_status_code",
      traceId: "trace-bridge-1",
      accountId: "acc-a",
      status: 502,
    });
    appendClaudeFallbackEvent({
      mode: "api_key",
      phase: "success",
      reason: "api_key_bearer_rejected",
      traceId: "trace-api-1",
      accountId: "acc-b",
      status: 200,
    });

    const bridgeOnly = listClaudeFallbackEvents({
      mode: "bridge",
      page: 1,
      pageSize: 20,
    });
    expect(bridgeOnly.total).toBeGreaterThan(0);
    expect(bridgeOnly.data.some((item) => item.mode === "bridge")).toBe(true);

    const successOnly = listClaudeFallbackEvents({
      phase: "success",
      page: 1,
      pageSize: 20,
    });
    expect(successOnly.total).toBeGreaterThan(0);
    expect(successOnly.data.some((item) => item.phase === "success")).toBe(true);

    const reasonOnly = listClaudeFallbackEvents({
      reason: "bridge_status_code",
      page: 1,
      pageSize: 20,
    });
    expect(reasonOnly.total).toBeGreaterThan(0);
    expect(reasonOnly.data.some((item) => item.reason === "bridge_status_code")).toBe(
      true,
    );
  });

  it("应返回聚合统计并支持按 traceId 过滤", () => {
    const traceId = "trace-summary-only";
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "failure",
      reason: "bridge_http_error",
      traceId,
      status: 502,
    });
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "failure",
      reason: "bridge_http_error",
      traceId,
      status: 503,
    });
    appendClaudeFallbackEvent({
      mode: "api_key",
      phase: "success",
      reason: "api_key_bearer_rejected",
      traceId,
      status: 200,
    });

    const summary = summarizeClaudeFallbackEvents({ traceId });
    expect(summary.total).toBe(3);
    expect(summary.byMode.bridge).toBe(2);
    expect(summary.byMode.api_key).toBe(1);
    expect(summary.byPhase.failure).toBe(2);
    expect(summary.byPhase.success).toBe(1);
    expect(summary.byReason.bridge_http_error).toBe(2);
    expect(summary.byReason.api_key_bearer_rejected).toBe(1);
  });
});
