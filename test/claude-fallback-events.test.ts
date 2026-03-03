import { describe, expect, it } from "bun:test";
import {
  appendClaudeFallbackEvent,
  listClaudeFallbackEvents,
} from "../src/lib/observability/claude-fallback-events";

describe("Claude 回退事件", () => {
  it("应记录并可按 mode/phase 查询", () => {
    appendClaudeFallbackEvent({
      mode: "bridge",
      phase: "attempt",
      traceId: "trace-bridge-1",
      accountId: "acc-a",
      status: 502,
    });
    appendClaudeFallbackEvent({
      mode: "api_key",
      phase: "success",
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
  });
});
