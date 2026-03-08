import type {
  AgentLedgerDeliveryAttemptItem,
  AgentLedgerDeliveryAttemptQueryResult,
  AgentLedgerDeliveryAttemptSource,
  AgentLedgerDeliveryAttemptSummary,
  AgentLedgerDeliveryState,
  AgentLedgerOutboxHealth,
  AgentLedgerOutboxItem,
  AgentLedgerOutboxQueryResult,
  AgentLedgerOutboxReadiness,
  AgentLedgerOutboxReadinessStatus,
  AgentLedgerOutboxSummary,
  AgentLedgerReplayAuditItem,
  AgentLedgerReplayAuditQueryResult,
  AgentLedgerReplayAuditResult,
  AgentLedgerReplayAuditSummary,
  AgentLedgerReplayBatchItem,
  AgentLedgerReplayBatchResult,
  AgentLedgerReplayTriggerSource,
  AgentLedgerRuntimeStatus,
  AgentLedgerTraceDrilldownResult,
  AgentLedgerTraceDrilldownSummary,
  AuditEventItem,
} from "../lib/client";

export const AGENTLEDGER_OUTBOX_READINESS_STATUS_META: Record<
  AgentLedgerOutboxReadinessStatus,
  {
    label: string;
    className: string;
  }
> = {
  disabled: {
    label: "disabled",
    className: "bg-gray-200 text-gray-700",
  },
  ready: {
    label: "ready",
    className: "bg-emerald-100 text-emerald-800",
  },
  degraded: {
    label: "degraded",
    className: "bg-amber-100 text-amber-800",
  },
  blocking: {
    label: "blocking",
    className: "bg-red-100 text-red-800",
  },
};

const AGENTLEDGER_OUTBOX_REASON_LABELS: Record<string, string> = {
  delivery_not_configured: "未配置 AgentLedger webhook 目标或共享密钥",
  replay_required_backlog: "存在 replay_required 积压，需要人工介入",
  pending_backlog_stale: "pending 积压超过阻断阈值",
  retryable_backlog_stale: "retryable_failure 积压超过阻断阈值",
  retryable_backlog: "存在可重试积压，当前处于降级状态",
  worker_cycle_missing: "worker 尚未产生日志心跳，需确认调度器是否已启动",
  worker_cycle_stale: "worker 心跳已过期，需检查调度器或进程是否停摆",
  health_query_failed: "健康检查查询失败",
};

const toText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const toTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toText(item).trim()).filter(Boolean);
};

const extractListData = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const root = toObject(value);
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.items)) return root.items;
  const nestedData = toObject(root.data);
  if (Array.isArray(nestedData.items)) return nestedData.items;
  return [];
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  const normalized = toText(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
};

const normalizeOptionalTimestamp = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getAgentLedgerOutboxReasonLabel = (reason: string) =>
  AGENTLEDGER_OUTBOX_REASON_LABELS[reason] || reason;

export const normalizeAgentLedgerOutboxItem = (value: unknown): AgentLedgerOutboxItem | null => {
  const row = toObject(value);
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const statusText = toText(row.status).trim().toLowerCase();
  const deliveryStateText = toText(row.deliveryState).trim().toLowerCase();
  const status = (
    ["success", "failure", "blocked", "timeout"] as const
  ).includes(statusText as AgentLedgerRuntimeStatus)
    ? (statusText as AgentLedgerRuntimeStatus)
    : "failure";
  const deliveryState = (
    ["pending", "delivered", "retryable_failure", "replay_required"] as const
  ).includes(deliveryStateText as AgentLedgerDeliveryState)
    ? (deliveryStateText as AgentLedgerDeliveryState)
    : "pending";

  return {
    id,
    traceId: toText(row.traceId).trim(),
    tenantId: toText(row.tenantId).trim(),
    projectId: toText(row.projectId).trim() || null,
    provider: toText(row.provider).trim(),
    model: toText(row.model).trim(),
    resolvedModel: toText(row.resolvedModel).trim(),
    routePolicy: toText(row.routePolicy).trim(),
    accountId: toText(row.accountId).trim() || null,
    status,
    startedAt: toText(row.startedAt).trim(),
    finishedAt: toText(row.finishedAt).trim() || null,
    errorCode: toText(row.errorCode).trim() || null,
    cost: toText(row.cost).trim() || null,
    idempotencyKey: toText(row.idempotencyKey).trim(),
    specVersion: toText(row.specVersion).trim(),
    keyId: toText(row.keyId).trim(),
    targetUrl: toText(row.targetUrl).trim(),
    payloadJson: toText(row.payloadJson),
    payloadHash: toText(row.payloadHash).trim(),
    headersJson: toText(row.headersJson) || "{}",
    deliveryState,
    attemptCount: Math.max(0, Math.floor(Number(row.attemptCount) || 0)),
    lastHttpStatus: normalizeOptionalTimestamp(row.lastHttpStatus),
    lastErrorClass: toText(row.lastErrorClass).trim() || null,
    lastErrorMessage: toText(row.lastErrorMessage).trim() || null,
    firstFailedAt: normalizeOptionalTimestamp(row.firstFailedAt),
    lastFailedAt: normalizeOptionalTimestamp(row.lastFailedAt),
    nextRetryAt: normalizeOptionalTimestamp(row.nextRetryAt),
    deliveredAt: normalizeOptionalTimestamp(row.deliveredAt),
    createdAt: normalizeOptionalTimestamp(row.createdAt) || Date.now(),
    updatedAt: normalizeOptionalTimestamp(row.updatedAt) || Date.now(),
  };
};

export const normalizeAgentLedgerOutboxQueryResult = (
  value: unknown,
): AgentLedgerOutboxQueryResult => {
  const root = toObject(value);
  const data = extractListData(value)
    .map((item) => normalizeAgentLedgerOutboxItem(item))
    .filter((item): item is AgentLedgerOutboxItem => Boolean(item));
  const page = Math.max(1, Math.floor(Number(root.page) || 1));
  const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || data.length || 10));
  const total = Math.max(data.length, Math.floor(Number(root.total) || data.length));
  const totalPages = Math.max(
    1,
    Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)),
  );
  return {
    data,
    page,
    pageSize,
    total,
    totalPages,
  };
};

export const normalizeAgentLedgerOutboxSummary = (
  value: unknown,
): AgentLedgerOutboxSummary => {
  const root = toObject(value);
  const nestedData = toObject(root.data);
  const source = Object.keys(nestedData).length > 0 ? nestedData : root;
  const byDeliveryStateSource = toObject(source.byDeliveryState);
  const byStatusSource = toObject(source.byStatus);
  const byDeliveryState: Record<AgentLedgerDeliveryState, number> = {
    pending: 0,
    delivered: 0,
    retryable_failure: 0,
    replay_required: 0,
  };
  const byStatus: Record<AgentLedgerRuntimeStatus, number> = {
    success: 0,
    failure: 0,
    blocked: 0,
    timeout: 0,
  };

  for (const key of Object.keys(byDeliveryState) as AgentLedgerDeliveryState[]) {
    byDeliveryState[key] = Math.max(0, Math.floor(Number(byDeliveryStateSource[key]) || 0));
  }
  for (const key of Object.keys(byStatus) as AgentLedgerRuntimeStatus[]) {
    byStatus[key] = Math.max(0, Math.floor(Number(byStatusSource[key]) || 0));
  }

  return {
    total: Math.max(0, Math.floor(Number(source.total) || 0)),
    byDeliveryState,
    byStatus,
  };
};

export const normalizeAgentLedgerOutboxHealth = (
  value: unknown,
): AgentLedgerOutboxHealth => {
  const root = toObject(value);
  const nestedData = toObject(root.data);
  const source = Object.keys(nestedData).length > 0 ? nestedData : root;
  const backlogSource = toObject(source.backlog);
  const backlog = {
    pending: Math.max(0, Math.floor(Number(backlogSource.pending) || 0)),
    delivered: Math.max(0, Math.floor(Number(backlogSource.delivered) || 0)),
    retryable_failure: Math.max(0, Math.floor(Number(backlogSource.retryable_failure) || 0)),
    replay_required: Math.max(0, Math.floor(Number(backlogSource.replay_required) || 0)),
    total: Math.max(0, Math.floor(Number(backlogSource.total) || 0)),
  };
  const computedTotal =
    backlog.pending +
    backlog.delivered +
    backlog.retryable_failure +
    backlog.replay_required;

  return {
    enabled: source.enabled === true,
    deliveryConfigured: source.deliveryConfigured === true,
    workerPollIntervalMs: Math.max(0, Math.floor(Number(source.workerPollIntervalMs) || 0)),
    requestTimeoutMs: Math.max(0, Math.floor(Number(source.requestTimeoutMs) || 0)),
    maxAttempts: Math.max(0, Math.floor(Number(source.maxAttempts) || 0)),
    retryScheduleSec: Array.isArray(source.retryScheduleSec)
      ? source.retryScheduleSec
          .map((item) => Math.max(0, Math.floor(Number(item) || 0)))
          .filter((item) => Number.isFinite(item))
      : [],
    backlog: {
      ...backlog,
      total: backlog.total > 0 ? backlog.total : computedTotal,
    },
    openBacklogTotal: Math.max(0, Math.floor(Number(source.openBacklogTotal) || 0)),
    oldestOpenBacklogAgeSec: Math.max(0, Math.floor(Number(source.oldestOpenBacklogAgeSec) || 0)),
    latestReplayRequiredAt: normalizeOptionalTimestamp(source.latestReplayRequiredAt),
    lastCycleAt: normalizeOptionalTimestamp(source.lastCycleAt),
    lastSuccessAt: normalizeOptionalTimestamp(source.lastSuccessAt),
  };
};

export const normalizeAgentLedgerOutboxReadiness = (
  value: unknown,
): AgentLedgerOutboxReadiness | null => {
  const root = toObject(value);
  const nestedData = toObject(root.data);
  const source = Object.keys(nestedData).length > 0 ? nestedData : root;
  const rawStatus = toText(source.status).trim().toLowerCase();
  const status = (
    ["disabled", "ready", "degraded", "blocking"] as const
  ).includes(rawStatus as AgentLedgerOutboxReadinessStatus)
    ? (rawStatus as AgentLedgerOutboxReadinessStatus)
    : null;
  const blockingReasons = toTextArray(source.blockingReasons);
  const degradedReasons = toTextArray(source.degradedReasons);
  const checkedAt = normalizeOptionalTimestamp(source.checkedAt);
  const rawErrorMessage = toText(source.errorMessage).trim() || null;
  const healthSource = source.health;
  const hasHealth =
    healthSource !== null &&
    healthSource !== undefined &&
    !Array.isArray(healthSource) &&
    typeof healthSource === "object";
  const rawReady = typeof source.ready === "boolean" ? source.ready : null;

  if (
    rawReady === null &&
    status === null &&
    checkedAt === null &&
    blockingReasons.length === 0 &&
    degradedReasons.length === 0 &&
    !rawErrorMessage &&
    !hasHealth
  ) {
    return null;
  }

  const normalizedStatus =
    status ||
    (blockingReasons.length > 0 || rawReady === false
      ? "blocking"
      : degradedReasons.length > 0
        ? "degraded"
        : "ready");

  const ready =
    rawReady !== null
      ? rawReady
      : normalizedStatus === "blocking"
        ? false
        : true;

  return {
    ready,
    status: normalizedStatus,
    checkedAt: checkedAt || Date.now(),
    blockingReasons,
    degradedReasons,
    errorMessage: rawErrorMessage,
    health: hasHealth ? normalizeAgentLedgerOutboxHealth(healthSource) : null,
  };
};

export const normalizeAgentLedgerDeliveryAttemptItem = (
  value: unknown,
): AgentLedgerDeliveryAttemptItem | null => {
  const row = toObject(value);
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const rawSource = toText(row.source).trim();
  const rawResult = toText(row.result).trim();
  const sourceText = rawSource.toLowerCase();
  const resultText = rawResult.toLowerCase();
  const source = (
    ["worker", "manual_replay", "batch_replay"] as const
  ).includes(sourceText as AgentLedgerDeliveryAttemptSource)
    ? (sourceText as AgentLedgerDeliveryAttemptSource)
    : rawSource || "worker";
  const result = (
    ["delivered", "retryable_failure", "permanent_failure"] as const
  ).includes(resultText as AgentLedgerReplayAuditResult)
    ? (resultText as AgentLedgerReplayAuditResult)
    : rawResult || "permanent_failure";

  return {
    id,
    outboxId: Math.max(0, Math.floor(Number(row.outboxId) || 0)),
    traceId: toText(row.traceId).trim(),
    idempotencyKey: toText(row.idempotencyKey).trim(),
    source,
    attemptNumber: Math.max(0, Math.floor(Number(row.attemptNumber) || 0)),
    result,
    httpStatus: normalizeOptionalTimestamp(row.httpStatus),
    errorClass: toText(row.errorClass).trim() || null,
    errorMessage: toText(row.errorMessage).trim() || null,
    durationMs: normalizeOptionalTimestamp(row.durationMs),
    createdAt: normalizeOptionalTimestamp(row.createdAt) || Date.now(),
  };
};

export const normalizeAgentLedgerDeliveryAttemptQueryResult = (
  value: unknown,
): AgentLedgerDeliveryAttemptQueryResult => {
  const root = toObject(value);
  const data = extractListData(value)
    .map((item) => normalizeAgentLedgerDeliveryAttemptItem(item))
    .filter((item): item is AgentLedgerDeliveryAttemptItem => Boolean(item));
  const page = Math.max(1, Math.floor(Number(root.page) || 1));
  const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || data.length || 10));
  const total = Math.max(data.length, Math.floor(Number(root.total) || data.length));
  const totalPages = Math.max(
    1,
    Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)),
  );
  return {
    data,
    page,
    pageSize,
    total,
    totalPages,
  };
};

export const normalizeAgentLedgerDeliveryAttemptSummary = (
  value: unknown,
): AgentLedgerDeliveryAttemptSummary => {
  const root = toObject(value);
  const nestedData = toObject(root.data);
  const source = Object.keys(nestedData).length > 0 ? nestedData : root;
  const bySourceSource = toObject(source.bySource);
  const byResultSource = toObject(source.byResult);
  const bySource: Record<AgentLedgerDeliveryAttemptSource, number> = {
    worker: 0,
    manual_replay: 0,
    batch_replay: 0,
  };
  const byResult: Record<AgentLedgerReplayAuditResult, number> = {
    delivered: 0,
    retryable_failure: 0,
    permanent_failure: 0,
  };

  for (const key of Object.keys(bySource) as AgentLedgerDeliveryAttemptSource[]) {
    bySource[key] = Math.max(0, Math.floor(Number(bySourceSource[key]) || 0));
  }
  for (const key of Object.keys(byResult) as AgentLedgerReplayAuditResult[]) {
    byResult[key] = Math.max(0, Math.floor(Number(byResultSource[key]) || 0));
  }

  return {
    total: Math.max(0, Math.floor(Number(source.total) || 0)),
    bySource,
    byResult,
  };
};

export const normalizeAgentLedgerReplayAuditItem = (
  value: unknown,
): AgentLedgerReplayAuditItem | null => {
  const row = toObject(value);
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const rawResult = toText(row.result).trim();
  const rawTriggerSource = toText(row.triggerSource).trim();
  const resultText = rawResult.toLowerCase();
  const triggerSourceText = rawTriggerSource.toLowerCase();
  const result = (
    ["delivered", "retryable_failure", "permanent_failure"] as const
  ).includes(resultText as AgentLedgerReplayAuditResult)
    ? (resultText as AgentLedgerReplayAuditResult)
    : rawResult || "permanent_failure";
  const triggerSource = (
    ["manual", "batch_manual"] as const
  ).includes(triggerSourceText as AgentLedgerReplayTriggerSource)
    ? (triggerSourceText as AgentLedgerReplayTriggerSource)
    : rawTriggerSource || "manual";

  return {
    id,
    outboxId: Math.max(0, Math.floor(Number(row.outboxId) || 0)),
    traceId: toText(row.traceId).trim(),
    idempotencyKey: toText(row.idempotencyKey).trim(),
    operatorId: toText(row.operatorId).trim(),
    triggerSource,
    attemptNumber: Math.max(0, Math.floor(Number(row.attemptNumber) || 0)),
    result,
    httpStatus: normalizeOptionalTimestamp(row.httpStatus),
    errorClass: toText(row.errorClass).trim() || null,
    createdAt: normalizeOptionalTimestamp(row.createdAt) || Date.now(),
  };
};

export const normalizeAgentLedgerReplayAuditQueryResult = (
  value: unknown,
): AgentLedgerReplayAuditQueryResult => {
  const root = toObject(value);
  const data = extractListData(value)
    .map((item) => normalizeAgentLedgerReplayAuditItem(item))
    .filter((item): item is AgentLedgerReplayAuditItem => Boolean(item));
  const page = Math.max(1, Math.floor(Number(root.page) || 1));
  const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || data.length || 10));
  const total = Math.max(data.length, Math.floor(Number(root.total) || data.length));
  const totalPages = Math.max(
    1,
    Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)),
  );
  return {
    data,
    page,
    pageSize,
    total,
    totalPages,
  };
};

export const normalizeAgentLedgerReplayAuditSummary = (
  value: unknown,
): AgentLedgerReplayAuditSummary => {
  const root = toObject(value);
  const nestedData = toObject(root.data);
  const source = Object.keys(nestedData).length > 0 ? nestedData : root;
  const byResultSource = toObject(source.byResult);
  const byResult: Record<AgentLedgerReplayAuditResult, number> = {
    delivered: 0,
    retryable_failure: 0,
    permanent_failure: 0,
  };

  for (const key of Object.keys(byResult) as AgentLedgerReplayAuditResult[]) {
    byResult[key] = Math.max(0, Math.floor(Number(byResultSource[key]) || 0));
  }

  return {
    total: Math.max(0, Math.floor(Number(source.total) || 0)),
    byResult,
  };
};

export const normalizeAgentLedgerReplayBatchResult = (
  value: unknown,
): AgentLedgerReplayBatchResult => {
  const root = toObject(value);
  const nestedData = toObject(root.data);
  const source = Object.keys(nestedData).length > 0 ? nestedData : root;
  const items = Array.isArray(source.items)
    ? source.items.reduce<AgentLedgerReplayBatchItem[]>((acc, item) => {
        const row = toObject(item);
        const id = Math.max(0, Math.floor(Number(row.id) || 0));
        if (id <= 0) return acc;
        const rawResult = toText(row.result).trim();
        const rawDeliveryState = toText(row.deliveryState).trim();

        acc.push({
          id,
          ok: row.ok === true,
          code: (() => {
            const code = toText(row.code).trim().toLowerCase();
            if (code === "not_found" || code === "not_configured") {
              return code;
            }
            return undefined;
          })(),
          result: rawResult || undefined,
          httpStatus: normalizeOptionalTimestamp(row.httpStatus),
          errorClass: toText(row.errorClass).trim() || null,
          errorMessage: toText(row.errorMessage).trim() || null,
          traceId: toText(row.traceId).trim() || null,
          deliveryState: rawDeliveryState || null,
        });
        return acc;
      }, [])
    : [];

  return {
    requestedCount: Math.max(0, Math.floor(Number(source.requestedCount) || 0)),
    processedCount: Math.max(0, Math.floor(Number(source.processedCount) || 0)),
    successCount: Math.max(0, Math.floor(Number(source.successCount) || 0)),
    failureCount: Math.max(0, Math.floor(Number(source.failureCount) || 0)),
    notFoundCount: Math.max(0, Math.floor(Number(source.notFoundCount) || 0)),
    notConfiguredCount: Math.max(0, Math.floor(Number(source.notConfiguredCount) || 0)),
    items,
  };
};

export const buildAgentLedgerTracePageResult = <T,>(data: T[]) => ({
  data,
  page: 1,
  pageSize: Math.max(1, data.length || 1),
  total: data.length,
  totalPages: 1,
});

export const summarizeAgentLedgerTraceOutbox = (
  rows: AgentLedgerOutboxItem[],
): AgentLedgerOutboxSummary => {
  const byDeliveryState: Record<AgentLedgerDeliveryState, number> = {
    pending: 0,
    delivered: 0,
    retryable_failure: 0,
    replay_required: 0,
  };
  const byStatus: Record<AgentLedgerRuntimeStatus, number> = {
    success: 0,
    failure: 0,
    blocked: 0,
    timeout: 0,
  };
  for (const row of rows) {
    if (row.deliveryState in byDeliveryState) {
      byDeliveryState[row.deliveryState as AgentLedgerDeliveryState] += 1;
    }
    if (row.status in byStatus) {
      byStatus[row.status as AgentLedgerRuntimeStatus] += 1;
    }
  }
  return {
    total: rows.length,
    byDeliveryState,
    byStatus,
  };
};

export const summarizeAgentLedgerTraceAttempts = (
  rows: AgentLedgerDeliveryAttemptItem[],
): AgentLedgerDeliveryAttemptSummary => {
  const bySource: Record<AgentLedgerDeliveryAttemptSource, number> = {
    worker: 0,
    manual_replay: 0,
    batch_replay: 0,
  };
  const byResult: Record<AgentLedgerReplayAuditResult, number> = {
    delivered: 0,
    retryable_failure: 0,
    permanent_failure: 0,
  };
  for (const row of rows) {
    if (row.source in bySource) {
      bySource[row.source as AgentLedgerDeliveryAttemptSource] += 1;
    }
    if (row.result in byResult) {
      byResult[row.result as AgentLedgerReplayAuditResult] += 1;
    }
  }
  return {
    total: rows.length,
    bySource,
    byResult,
  };
};

export const summarizeAgentLedgerTraceReplayAudits = (
  rows: AgentLedgerReplayAuditItem[],
): AgentLedgerReplayAuditSummary => {
  const byResult: Record<AgentLedgerReplayAuditResult, number> = {
    delivered: 0,
    retryable_failure: 0,
    permanent_failure: 0,
  };
  for (const row of rows) {
    if (row.result in byResult) {
      byResult[row.result as AgentLedgerReplayAuditResult] += 1;
    }
  }
  return {
    total: rows.length,
    byResult,
  };
};

const normalizeTraceAuditEventItem = (value: unknown): AuditEventItem | null => {
  const row = toObject(value);
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const resultText = toText(row.result).trim().toLowerCase();
  return {
    id,
    actor: toText(row.actor).trim() || "api-secret",
    action: toText(row.action).trim() || "unknown",
    resource: toText(row.resource).trim() || "unknown",
    resourceId: toText(row.resourceId).trim() || null,
    traceId: toText(row.traceId).trim() || null,
    result: resultText === "failure" ? "failure" : "success",
    createdAt: toText(row.createdAt).trim() || new Date().toISOString(),
    details:
      row.details && typeof row.details === "object"
        ? (row.details as Record<string, unknown>)
        : toText(row.details).trim() || null,
  };
};

const normalizeAgentLedgerTraceDrilldownSummary = (
  value: unknown,
): AgentLedgerTraceDrilldownSummary | null => {
  const row = toObject(value);
  const traceId = toText(row.traceId).trim();
  if (!traceId) return null;
  const state = toText(row.currentState).trim().toLowerCase();
  const currentState = (
    [
      "delivered",
      "retryable_failure",
      "replay_required",
      "blocked",
      "timeout",
      "pending",
      "unknown",
    ] as const
  ).includes(state as AgentLedgerTraceDrilldownSummary["currentState"])
    ? (state as AgentLedgerTraceDrilldownSummary["currentState"])
    : "unknown";
  const normalizeReplayResult = (input: unknown): AgentLedgerReplayAuditResult | null => {
    const text = toText(input).trim().toLowerCase();
    if (
      text === "delivered" ||
      text === "retryable_failure" ||
      text === "permanent_failure"
    ) {
      return text;
    }
    return null;
  };
  return {
    traceId,
    currentState,
    latestAttemptResult: normalizeReplayResult(row.latestAttemptResult),
    latestReplayResult: normalizeReplayResult(row.latestReplayResult),
    needsReplay: toBoolean(row.needsReplay, false),
    lastOperatorId: toText(row.lastOperatorId).trim() || null,
    firstSeenAt: normalizeOptionalTimestamp(row.firstSeenAt),
    lastUpdatedAt: normalizeOptionalTimestamp(row.lastUpdatedAt),
    outboxCount: Math.max(0, Math.floor(Number(row.outboxCount) || 0)),
    deliveryAttemptCount: Math.max(0, Math.floor(Number(row.deliveryAttemptCount) || 0)),
    replayAuditCount: Math.max(0, Math.floor(Number(row.replayAuditCount) || 0)),
    auditEventCount: Math.max(0, Math.floor(Number(row.auditEventCount) || 0)),
  };
};

export const normalizeAgentLedgerTraceDrilldownResult = (
  value: unknown,
): AgentLedgerTraceDrilldownResult | null => {
  const root = toObject(value);
  const data = toObject(root.data);
  const source = Object.keys(data).length > 0 ? data : root;
  const summary = normalizeAgentLedgerTraceDrilldownSummary(source.summary);
  const traceId = summary?.traceId || toText(source.traceId).trim();
  if (!traceId || !summary) return null;

  const outboxRows = extractListData(source.outbox)
    .map((item) => normalizeAgentLedgerOutboxItem(item))
    .filter((item): item is AgentLedgerOutboxItem => Boolean(item));
  const attemptRows = extractListData(source.deliveryAttempts)
    .map((item) => normalizeAgentLedgerDeliveryAttemptItem(item))
    .filter((item): item is AgentLedgerDeliveryAttemptItem => Boolean(item));
  const replayRows = extractListData(source.replayAudits)
    .map((item) => normalizeAgentLedgerReplayAuditItem(item))
    .filter((item): item is AgentLedgerReplayAuditItem => Boolean(item));
  const auditRows = extractListData(source.auditEvents)
    .map((item) => normalizeTraceAuditEventItem(item))
    .filter((item): item is AuditEventItem => Boolean(item));

  return {
    traceId,
    summary,
    outbox: outboxRows,
    deliveryAttempts: attemptRows,
    replayAudits: replayRows,
    auditEvents: auditRows,
    readiness: normalizeAgentLedgerOutboxReadiness(source.readiness),
    health: (() => {
      const healthSource = toObject(source.health);
      return Object.keys(healthSource).length > 0
        ? normalizeAgentLedgerOutboxHealth(healthSource)
        : null;
    })(),
  };
};
