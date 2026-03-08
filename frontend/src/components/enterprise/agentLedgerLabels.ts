import type {
  AgentLedgerDeliveryAttemptSource,
  AgentLedgerDeliveryState,
  AgentLedgerOutboxReadinessStatus,
  AgentLedgerReplayAuditResult,
  AgentLedgerReplayTriggerSource,
  AgentLedgerRuntimeStatus,
  AgentLedgerTraceCurrentState,
} from "../../lib/client";

function normalizeCode(value?: string | null): string {
  return String(value || "").trim();
}

function formatLabel(label: string, code: string, includeCode: boolean): string {
  if (!includeCode || !code || label === code) {
    return label;
  }
  return `${label}（${code}）`;
}

export function formatAgentLedgerRuntimeStatus(
  status?: AgentLedgerRuntimeStatus | string | null,
  includeCode = false,
): string {
  const code = normalizeCode(status);
  const labelMap: Record<AgentLedgerRuntimeStatus, string> = {
    success: "成功",
    failure: "失败",
    blocked: "已阻断",
    timeout: "超时",
  };
  const label =
    labelMap[code as AgentLedgerRuntimeStatus] || code || "未知";
  return formatLabel(label, code, includeCode);
}

export function formatAgentLedgerDeliveryState(
  state?: AgentLedgerDeliveryState | string | null,
  includeCode = false,
): string {
  const code = normalizeCode(state);
  const labelMap: Record<AgentLedgerDeliveryState, string> = {
    pending: "待投递",
    delivered: "已投递",
    retryable_failure: "待重试",
    replay_required: "需人工回放",
  };
  const label =
    labelMap[code as AgentLedgerDeliveryState] || code || "未知";
  return formatLabel(label, code, includeCode);
}

export function formatAgentLedgerReplayResult(
  result?: AgentLedgerReplayAuditResult | string | null,
  includeCode = false,
): string {
  const code = normalizeCode(result);
  const labelMap: Record<AgentLedgerReplayAuditResult, string> = {
    delivered: "已送达",
    retryable_failure: "可重试失败",
    permanent_failure: "永久失败",
  };
  const label =
    labelMap[code as AgentLedgerReplayAuditResult] || code || "未知";
  return formatLabel(label, code, includeCode);
}

export function formatAgentLedgerDeliveryAttemptSource(
  source?: AgentLedgerDeliveryAttemptSource | string | null,
  includeCode = false,
): string {
  const code = normalizeCode(source);
  const labelMap: Record<AgentLedgerDeliveryAttemptSource, string> = {
    worker: "Worker 自动投递",
    manual_replay: "人工回放",
    batch_replay: "批量人工回放",
  };
  const label =
    labelMap[code as AgentLedgerDeliveryAttemptSource] || code || "未知";
  return formatLabel(label, code, includeCode);
}

export function formatAgentLedgerReplayTriggerSource(
  source?: AgentLedgerReplayTriggerSource | string | null,
  includeCode = false,
): string {
  const code = normalizeCode(source);
  const labelMap: Record<AgentLedgerReplayTriggerSource, string> = {
    manual: "人工回放",
    batch_manual: "批量人工回放",
  };
  const label =
    labelMap[code as AgentLedgerReplayTriggerSource] || code || "未知";
  return formatLabel(label, code, includeCode);
}

export function formatAgentLedgerReadinessStatus(
  status?: AgentLedgerOutboxReadinessStatus | string | null,
  includeCode = false,
): string {
  const code = normalizeCode(status);
  const labelMap: Record<AgentLedgerOutboxReadinessStatus, string> = {
    disabled: "已停用",
    ready: "就绪",
    degraded: "降级",
    blocking: "阻断",
  };
  const label =
    labelMap[code as AgentLedgerOutboxReadinessStatus] || code || "未知";
  return formatLabel(label, code, includeCode);
}

export function formatAgentLedgerTraceState(
  state?: AgentLedgerTraceCurrentState | string | null,
  includeCode = false,
): string {
  const code = normalizeCode(state);
  const labelMap: Record<AgentLedgerTraceCurrentState, string> = {
    delivered: "已投递",
    retryable_failure: "待重试",
    replay_required: "需人工回放",
    blocked: "已阻断",
    timeout: "超时",
    pending: "待投递",
    unknown: "未知",
  };
  const label =
    labelMap[code as AgentLedgerTraceCurrentState] || code || "未知";
  return formatLabel(label, code, includeCode);
}

export function formatAgentLedgerAvailability(available: boolean): string {
  return available ? "接口可用" : "接口未开放";
}

export function formatAgentLedgerReadyState(ready: boolean): string {
  return ready ? "已就绪" : "未就绪";
}

export function formatAgentLedgerEnabledState(enabled: boolean): string {
  return enabled ? "已启用" : "未启用";
}

export function formatAgentLedgerDeliveryConfiguredState(configured: boolean): string {
  return configured ? "投递已配置" : "投递未配置";
}

export function formatAgentLedgerNeedsReplay(needsReplay: boolean): string {
  return needsReplay ? "需要" : "不需要";
}
