import { describe, expect, it } from "bun:test";
import {
  appendClaudeFallbackEvent,
  listClaudeFallbackEvents,
  summarizeClaudeFallbackEvents,
  summarizeClaudeFallbackTimeseries,
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

  it("应按 15m 返回连续时间桶并包含空桶", () => {
    const traceId = `trace-timeseries-buckets-${Date.now()}`;
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "success",
      reason: "bridge_status_code",
      traceId,
      timestamp: "2026-03-01T00:02:00.000Z",
      status: 200,
    });
    appendClaudeFallbackEvent({
      mode: "api_key",
      phase: "failure",
      reason: "api_key_bearer_rejected",
      traceId,
      timestamp: "2026-03-01T00:10:00.000Z",
      status: 401,
    });
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "failure",
      reason: "bridge_http_error",
      traceId,
      timestamp: "2026-03-01T00:32:00.000Z",
      status: 503,
    });

    const result = summarizeClaudeFallbackTimeseries({
      traceId,
      step: "15m",
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-03-01T00:45:00.000Z",
    });

    expect(result.step).toBe("15m");
    expect(result.data.map((item) => item.bucketStart)).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-01T00:15:00.000Z",
      "2026-03-01T00:30:00.000Z",
      "2026-03-01T00:45:00.000Z",
    ]);
    expect(result.data[0]).toEqual({
      bucketStart: "2026-03-01T00:00:00.000Z",
      total: 2,
      success: 1,
      failure: 1,
      bridgeShare: 0.5,
    });
    expect(result.data[1]).toEqual({
      bucketStart: "2026-03-01T00:15:00.000Z",
      total: 0,
      success: 0,
      failure: 0,
      bridgeShare: 0,
    });
    expect(result.data[2]).toEqual({
      bucketStart: "2026-03-01T00:30:00.000Z",
      total: 1,
      success: 0,
      failure: 1,
      bridgeShare: 1,
    });
    expect(result.data[3]).toEqual({
      bucketStart: "2026-03-01T00:45:00.000Z",
      total: 0,
      success: 0,
      failure: 0,
      bridgeShare: 0,
    });
  });

  it("应在 from/to 时间窗内统计并支持不同 step 粒度", () => {
    const traceId = `trace-timeseries-window-${Date.now()}`;
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "failure",
      reason: "bridge_status_code",
      traceId,
      timestamp: "2026-03-01T00:09:59.000Z",
      status: 502,
    });
    appendClaudeFallbackEvent({
      mode: "api_key",
      phase: "success",
      reason: "api_key_bearer_rejected",
      traceId,
      timestamp: "2026-03-01T00:10:00.000Z",
      status: 200,
    });
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "failure",
      reason: "bridge_http_error",
      traceId,
      timestamp: "2026-03-01T00:30:00.000Z",
      status: 503,
    });
    appendClaudeFallbackEvent({
      mode: "api_key",
      phase: "success",
      reason: "api_key_bearer_rejected",
      traceId,
      timestamp: "2026-03-01T00:30:01.000Z",
      status: 200,
    });

    const result15m = summarizeClaudeFallbackTimeseries({
      traceId,
      step: "15m",
      from: "2026-03-01T00:10:00.000Z",
      to: "2026-03-01T00:30:00.000Z",
    });

    expect(result15m.step).toBe("15m");
    expect(result15m.data.map((item) => item.bucketStart)).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-01T00:15:00.000Z",
      "2026-03-01T00:30:00.000Z",
    ]);
    expect(result15m.data.reduce((acc, item) => acc + item.total, 0)).toBe(2);
    expect(result15m.data[0]?.total).toBe(1);
    expect(result15m.data[1]?.total).toBe(0);
    expect(result15m.data[2]?.total).toBe(1);

    const result1h = summarizeClaudeFallbackTimeseries({
      traceId,
      step: "1h",
      from: "2026-03-01T00:10:00.000Z",
      to: "2026-03-01T00:30:00.000Z",
    });

    expect(result1h.step).toBe("1h");
    expect(result1h.data).toHaveLength(1);
    expect(result1h.data[0]?.bucketStart).toBe("2026-03-01T00:00:00.000Z");
    expect(result1h.data[0]?.total).toBe(2);
  });
});
