import type {
  AgentLedgerOutboxItem,
  AlertmanagerSyncHistoryItem,
  OAuthAlertRuleVersionSummaryItem,
} from "../lib/client";

export function buildRollbackOAuthAlertRuleVersionConfirmationMessage(
  item: OAuthAlertRuleVersionSummaryItem,
): string {
  const versionLabel = item.version?.trim() || `#${item.id}`;
  return `确认将 OAuth 告警规则回滚到版本 ${versionLabel}（ID: ${item.id}）吗？当前 active 版本会被替换。`;
}

export function buildRollbackAlertmanagerSyncHistoryConfirmationMessage(
  item: AlertmanagerSyncHistoryItem,
): string {
  const historyId = item.id?.trim() || "(unknown)";
  const timeLabel = item.ts?.trim() || "未知时间";
  return `确认按同步记录 ${historyId}（${timeLabel}）回滚 Alertmanager 配置吗？当前线上配置会被覆盖。`;
}

export function buildReplayAgentLedgerOutboxConfirmationMessage(
  item: Pick<AgentLedgerOutboxItem, "id" | "traceId" | "provider" | "deliveryState">,
): string {
  const traceLabel = item.traceId?.trim() || "(no-trace)";
  const providerLabel = item.provider?.trim() || "unknown";
  const stateLabel = item.deliveryState?.trim() || "unknown";
  return `确认重放 outbox #${item.id} 吗？traceId=${traceLabel}，provider=${providerLabel}，当前状态=${stateLabel}。`;
}

export function buildReplayAgentLedgerOutboxBatchConfirmationMessage(
  items: Array<Pick<AgentLedgerOutboxItem, "id" | "traceId">>,
): string {
  const count = items.length;
  const sample = items
    .slice(0, 3)
    .map((item) => `#${item.id}${item.traceId ? `(${item.traceId})` : ""}`)
    .join("、");
  const sampleSuffix = count > 3 ? " 等" : "";
  return `确认批量重放 ${count} 条 outbox 记录吗？样例：${sample}${sampleSuffix}。`;
}

export function buildEvaluateOAuthAlertsConfirmationMessage(provider?: string): string {
  const normalizedProvider = provider?.trim() || "";
  return normalizedProvider
    ? `确认立即执行 OAuth 告警手动评估吗？本次仅针对 provider=${normalizedProvider}。`
    : "确认立即执行 OAuth 告警手动评估吗？本次会按当前全局配置评估所有 provider。";
}

export function buildCreateOAuthAlertRuleVersionConfirmationMessage(
  payload: Record<string, unknown>,
): string {
  const version = typeof payload.version === "string" ? payload.version.trim() : "";
  const activate = payload.activate === true;
  const rulesCount = Array.isArray(payload.rules) ? payload.rules.length : 0;
  return `确认创建规则版本 ${version || "(unnamed)"} 吗？规则数=${rulesCount}，创建后${activate ? "会立即激活" : "不会自动激活"}。`;
}

export function buildTriggerAlertmanagerSyncConfirmationMessage(version?: number | string): string {
  const versionLabel =
    version === undefined || version === null || `${version}`.trim() === ""
      ? "unknown"
      : String(version).trim();
  return `确认执行 Alertmanager 同步吗？当前配置版本=${versionLabel}，执行后会触发 reload/ready 链路。`;
}

export function buildSaveOAuthAlertConfigConfirmationMessage(): string {
  return "确认保存 OAuth 告警配置吗？新的阈值、静默窗口和投递抑制会立即生效。";
}

export function buildSaveAlertmanagerConfigConfirmationMessage(version?: number | string): string {
  const versionLabel =
    version === undefined || version === null || `${version}`.trim() === ""
      ? "unknown"
      : String(version).trim();
  return `确认保存 Alertmanager 配置吗？当前版本=${versionLabel}，保存后待同步配置会被覆盖。`;
}

export function buildSaveRoutePoliciesConfirmationMessage(defaultPolicy?: string): string {
  const policyLabel = defaultPolicy?.trim() || "unknown";
  return `确认保存路由策略吗？默认选路策略将更新为 ${policyLabel}。`;
}

export function buildSaveCapabilityMapConfirmationMessage(providerCount: number): string {
  return `确认保存能力图谱吗？将写入 ${Math.max(0, providerCount)} 个 provider 的能力声明。`;
}

export function buildSaveModelAliasConfirmationMessage(aliasCount: number): string {
  return `确认保存模型别名规则吗？本次将写入 ${Math.max(0, aliasCount)} 条别名映射。`;
}

export function buildSaveExcludedModelsConfirmationMessage(modelCount: number): string {
  return `确认保存禁用模型列表吗？本次将写入 ${Math.max(0, modelCount)} 条禁用模型规则。`;
}
