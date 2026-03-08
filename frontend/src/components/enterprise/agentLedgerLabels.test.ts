import { describe, expect, it } from "bun:test";
import {
  formatAgentLedgerDeliveryAttemptSource,
  formatAgentLedgerDeliveryConfiguredState,
  formatAgentLedgerDeliveryState,
  formatAgentLedgerEnabledState,
  formatAgentLedgerNeedsReplay,
  formatAgentLedgerReadinessStatus,
  formatAgentLedgerReadyState,
  formatAgentLedgerReplayResult,
  formatAgentLedgerReplayTriggerSource,
  formatAgentLedgerRuntimeStatus,
  formatAgentLedgerTraceState,
} from "./agentLedgerLabels";

describe("agentLedgerLabels", () => {
  it("应将核心状态码格式化为中文标签并可附带 code", () => {
    expect(formatAgentLedgerRuntimeStatus("success")).toBe("成功");
    expect(formatAgentLedgerRuntimeStatus("blocked", true)).toBe("已阻断（blocked）");
    expect(formatAgentLedgerDeliveryState("retryable_failure", true)).toBe(
      "待重试（retryable_failure）",
    );
    expect(formatAgentLedgerReadinessStatus("degraded", true)).toBe("降级（degraded）");
    expect(formatAgentLedgerTraceState("replay_required", true)).toBe(
      "需人工回放（replay_required）",
    );
  });

  it("应格式化 replay 与 delivery 的来源/结果标签", () => {
    expect(formatAgentLedgerReplayResult("delivered")).toBe("已送达");
    expect(formatAgentLedgerReplayTriggerSource("batch_manual", true)).toBe(
      "批量人工回放（batch_manual）",
    );
    expect(formatAgentLedgerDeliveryAttemptSource("manual_replay", true)).toBe(
      "人工回放（manual_replay）",
    );
  });

  it("应格式化布尔状态文案", () => {
    expect(formatAgentLedgerReadyState(true)).toBe("已就绪");
    expect(formatAgentLedgerEnabledState(false)).toBe("未启用");
    expect(formatAgentLedgerDeliveryConfiguredState(true)).toBe("投递已配置");
    expect(formatAgentLedgerNeedsReplay(false)).toBe("不需要");
  });
});
