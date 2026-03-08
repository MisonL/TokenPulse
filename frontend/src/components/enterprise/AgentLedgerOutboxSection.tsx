import { Fragment } from "react";
import type {
  AgentLedgerDeliveryAttemptQueryResult,
  AgentLedgerDeliveryAttemptSource,
  AgentLedgerDeliveryAttemptSummary,
  AgentLedgerDeliveryState,
  AgentLedgerOutboxHealth,
  AgentLedgerOutboxItem,
  AgentLedgerOutboxQueryResult,
  AgentLedgerOutboxReadiness,
  AgentLedgerOutboxSummary,
  AgentLedgerReplayAuditResult,
  AgentLedgerRuntimeStatus,
} from "../../lib/client";
import { cn } from "../../lib/utils";
import {
  formatAgentLedgerDeliveryAttemptSource,
  formatAgentLedgerDeliveryConfiguredState,
  formatAgentLedgerDeliveryState,
  formatAgentLedgerEnabledState,
  formatAgentLedgerReadinessStatus,
  formatAgentLedgerReadyState,
  formatAgentLedgerReplayResult,
  formatAgentLedgerRuntimeStatus,
} from "./agentLedgerLabels";
import { SectionErrorBanner, TableFeedbackRow } from "./EnterpriseSectionFeedback";

interface OutboxReadinessMeta {
  label: string;
  className: string;
}

interface AgentLedgerOutboxSectionProps {
  sectionId?: string;
  apiAvailable: boolean;
  sectionError?: string;
  outbox: AgentLedgerOutboxQueryResult | null;
  outboxSummary: AgentLedgerOutboxSummary | null;
  readiness: AgentLedgerOutboxReadiness | null;
  readinessApiAvailable: boolean;
  readinessError?: string;
  readinessMeta: OutboxReadinessMeta | null;
  health: AgentLedgerOutboxHealth | null;
  healthApiAvailable: boolean;
  healthError?: string;
  shouldShowHealthSummary: boolean;
  getReasonLabel: (reason: string) => string;
  formatOptionalDateTime: (value?: number | string | null) => string;
  deliveryStateFilter: "" | AgentLedgerDeliveryState;
  statusFilter: "" | AgentLedgerRuntimeStatus;
  providerFilter: string;
  tenantFilter: string;
  traceFilter: string;
  fromFilter: string;
  toFilter: string;
  onDeliveryStateFilterChange: (value: "" | AgentLedgerDeliveryState) => void;
  onStatusFilterChange: (value: "" | AgentLedgerRuntimeStatus) => void;
  onProviderFilterChange: (value: string) => void;
  onTenantFilterChange: (value: string) => void;
  onTraceFilterChange: (value: string) => void;
  onFromFilterChange: (value: string) => void;
  onToFilterChange: (value: string) => void;
  onApplyFilters: (page?: number) => void;
  onExport: () => void;
  onReplayBatch: () => void;
  batchReplaying: boolean;
  replayingId: number | null;
  selectedIds: number[];
  selectableIds: number[];
  allSelectableChecked: boolean;
  onToggleSelection: (id: number, checked: boolean) => void;
  onToggleAllSelection: (checked: boolean) => void;
  onJumpToAuditTrace: (traceId?: string | null) => void;
  onJumpToReplayAudits: (options: { outboxId?: number | null; traceId?: string | null }) => void;
  onReplayById: (id: number) => void;
  attemptsOpenOutboxId: number | null;
  attempts: AgentLedgerDeliveryAttemptQueryResult | null;
  attemptSummary: AgentLedgerDeliveryAttemptSummary | null;
  attemptApiAvailable: boolean;
  attemptLoading: boolean;
  attemptError?: string;
  onToggleAttemptPanel: (item: AgentLedgerOutboxItem) => void;
  onReloadAttemptPanel: (page?: number) => void;
  onCloseAttemptPanel: () => void;
}

export function AgentLedgerOutboxSection({
  sectionId = "agentledger-outbox-section",
  apiAvailable,
  sectionError,
  outbox,
  outboxSummary,
  readiness,
  readinessApiAvailable,
  readinessError = "",
  readinessMeta,
  health,
  healthApiAvailable,
  healthError = "",
  shouldShowHealthSummary,
  getReasonLabel,
  formatOptionalDateTime,
  deliveryStateFilter,
  statusFilter,
  providerFilter,
  tenantFilter,
  traceFilter,
  fromFilter,
  toFilter,
  onDeliveryStateFilterChange,
  onStatusFilterChange,
  onProviderFilterChange,
  onTenantFilterChange,
  onTraceFilterChange,
  onFromFilterChange,
  onToFilterChange,
  onApplyFilters,
  onExport,
  onReplayBatch,
  batchReplaying,
  replayingId,
  selectedIds,
  selectableIds,
  allSelectableChecked,
  onToggleSelection,
  onToggleAllSelection,
  onJumpToAuditTrace,
  onJumpToReplayAudits,
  onReplayById,
  attemptsOpenOutboxId,
  attempts,
  attemptSummary,
  attemptApiAvailable,
  attemptLoading,
  attemptError = "",
  onToggleAttemptPanel,
  onReloadAttemptPanel,
  onCloseAttemptPanel,
}: AgentLedgerOutboxSectionProps) {
  const currentPage = outbox?.page || 1;
  const totalPages = outbox?.totalPages || 1;
  const attemptsPage = attempts?.page || 1;

  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h3 className="text-2xl font-black uppercase">AgentLedger Outbox</h3>
          <p className="mt-1 text-xs font-bold text-gray-500">
            查看运行时摘要出站投递、健康状态与 replay 补偿执行情况，支持按页勾选后批量 replay。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="b-btn bg-white" onClick={() => onApplyFilters(1)}>
            查询
          </button>
          <button className="b-btn bg-white" onClick={onExport}>
            导出 CSV
          </button>
          <button
            className="b-btn bg-[#FFD500]"
            disabled={!apiAvailable || batchReplaying || replayingId !== null || selectedIds.length === 0}
            onClick={onReplayBatch}
          >
            {batchReplaying
              ? "批量 replay 中..."
              : `批量 replay${selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <label className="text-xs font-bold uppercase text-gray-500">
          deliveryState
          <select
            className="b-input h-10 w-full mt-1"
            value={deliveryStateFilter}
            onChange={(e) => onDeliveryStateFilterChange(e.target.value as "" | AgentLedgerDeliveryState)}
          >
            <option value="">全部</option>
            <option value="pending">{formatAgentLedgerDeliveryState("pending", true)}</option>
            <option value="delivered">{formatAgentLedgerDeliveryState("delivered", true)}</option>
            <option value="retryable_failure">
              {formatAgentLedgerDeliveryState("retryable_failure", true)}
            </option>
            <option value="replay_required">
              {formatAgentLedgerDeliveryState("replay_required", true)}
            </option>
          </select>
        </label>
        <label className="text-xs font-bold uppercase text-gray-500">
          status
          <select
            className="b-input h-10 w-full mt-1"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as "" | AgentLedgerRuntimeStatus)}
          >
            <option value="">全部</option>
            <option value="success">{formatAgentLedgerRuntimeStatus("success", true)}</option>
            <option value="failure">{formatAgentLedgerRuntimeStatus("failure", true)}</option>
            <option value="blocked">{formatAgentLedgerRuntimeStatus("blocked", true)}</option>
            <option value="timeout">{formatAgentLedgerRuntimeStatus("timeout", true)}</option>
          </select>
        </label>
        <label className="text-xs font-bold uppercase text-gray-500">
          provider
          <input
            className="b-input h-10 w-full mt-1"
            value={providerFilter}
            onChange={(e) => onProviderFilterChange(e.target.value)}
            placeholder="claude / gemini..."
          />
        </label>
        <label className="text-xs font-bold uppercase text-gray-500">
          tenantId
          <input
            className="b-input h-10 w-full mt-1"
            value={tenantFilter}
            onChange={(e) => onTenantFilterChange(e.target.value)}
            placeholder="租户 ID"
          />
        </label>
        <label className="text-xs font-bold uppercase text-gray-500">
          traceId
          <input
            className="b-input h-10 w-full mt-1"
            value={traceFilter}
            onChange={(e) => onTraceFilterChange(e.target.value)}
            placeholder="追踪 ID"
          />
        </label>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs font-bold uppercase text-gray-500">
          from
          <input
            type="datetime-local"
            className="b-input h-10 w-full mt-1"
            value={fromFilter}
            onChange={(e) => onFromFilterChange(e.target.value)}
          />
        </label>
        <label className="text-xs font-bold uppercase text-gray-500">
          to
          <input
            type="datetime-local"
            className="b-input h-10 w-full mt-1"
            value={toFilter}
            onChange={(e) => onToFilterChange(e.target.value)}
          />
        </label>
        <div className="flex items-end">
          {!apiAvailable ? (
            <p className="text-xs font-bold text-gray-500">
              当前环境暂未开放 AgentLedger Outbox 查询接口，可稍后重新探测。
            </p>
          ) : (
            <p className="text-xs font-bold text-gray-500">
              当前页可批量选择 {selectableIds.length} 条记录，已选 {selectedIds.length} 条；
              已投递记录不可重复 replay。
            </p>
          )}
        </div>
      </div>

      <SectionErrorBanner
        title="AgentLedger Outbox"
        error={sectionError}
        onRetry={() => onApplyFilters(currentPage)}
        retryLabel="重试当前筛选"
      />

      {shouldShowHealthSummary ? (
        <div className="mb-4 border-2 border-black bg-[#FFF8CC] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase text-gray-600">Health</p>
              <p className="text-sm font-black uppercase">AgentLedger Outbox 健康摘要</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
              {readinessMeta ? (
                <span className={cn("inline-flex border border-black px-2 py-1", readinessMeta.className)}>
                  {readinessMeta.label}
                </span>
              ) : null}
              {readiness ? (
                <span
                  className={cn(
                    "inline-flex border border-black px-2 py-1",
                    readiness.ready ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800",
                  )}
                  title={readiness.status}
                >
                  {formatAgentLedgerReadyState(readiness.ready)}
                </span>
              ) : null}
              {health ? (
                <>
                  <span
                    className={cn(
                      "inline-flex border border-black px-2 py-1",
                      health.enabled ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700",
                    )}
                    title={String(health.enabled)}
                  >
                    {formatAgentLedgerEnabledState(health.enabled)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex border border-black px-2 py-1",
                      health.deliveryConfigured
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800",
                    )}
                    title={String(health.deliveryConfigured)}
                  >
                    {formatAgentLedgerDeliveryConfiguredState(health.deliveryConfigured)}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {!readinessApiAvailable ? (
            <p className="mt-3 text-xs font-bold text-gray-500">
              当前环境暂未开放 AgentLedger readiness 接口，已回退到基础健康探针。
            </p>
          ) : null}
          {readinessError ? <p className="mt-3 text-xs font-bold text-red-700">{readinessError}</p> : null}

          {readiness ? (
            <div className="mt-3 space-y-3 border-t border-black/10 pt-3">
              <div className="grid grid-cols-1 gap-3 text-xs font-mono md:grid-cols-4">
                <p>status: {formatAgentLedgerReadinessStatus(readiness.status, true)}</p>
                <p>ready: {formatAgentLedgerReadyState(readiness.ready)}</p>
                <p>checkedAt: {formatOptionalDateTime(readiness.checkedAt)}</p>
                <p>errorMessage: {readiness.errorMessage || "-"}</p>
              </div>
              {readiness.blockingReasons.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase text-red-700">Blocking Reasons</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {readiness.blockingReasons.map((reason) => (
                      <span
                        key={`agentledger-blocking-${reason}`}
                        className="inline-flex items-center gap-1 border border-red-300 bg-red-50 px-2 py-1 font-mono text-red-800"
                      >
                        <code>{reason}</code>
                        <span className="font-bold not-italic">{getReasonLabel(reason)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {readiness.degradedReasons.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase text-amber-700">Degraded Reasons</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {readiness.degradedReasons.map((reason) => (
                      <span
                        key={`agentledger-degraded-${reason}`}
                        className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-amber-800"
                      >
                        <code>{reason}</code>
                        <span className="font-bold not-italic">{getReasonLabel(reason)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!healthApiAvailable ? (
            <p className="mt-3 text-xs font-bold text-gray-500">
              当前环境暂未开放 AgentLedger 健康摘要接口。
            </p>
          ) : healthError ? (
            <p className="mt-3 text-xs font-bold text-red-700">{healthError}</p>
          ) : health ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                <p>openBacklogTotal: {health.openBacklogTotal}</p>
                <p>oldestOpenBacklogAgeSec: {health.oldestOpenBacklogAgeSec}</p>
                <p>lastCycleAt: {formatOptionalDateTime(health.lastCycleAt)}</p>
                <p>lastSuccessAt: {formatOptionalDateTime(health.lastSuccessAt)}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                <p>workerPollIntervalMs: {health.workerPollIntervalMs}</p>
                <p>requestTimeoutMs: {health.requestTimeoutMs}</p>
                <p>maxAttempts: {health.maxAttempts}</p>
                <p>retryScheduleSec: {health.retryScheduleSec.length > 0 ? health.retryScheduleSec.join(", ") : "-"}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs font-mono">
                <p>backlog.total: {health.backlog.total}</p>
                <p>pending: {health.backlog.pending}</p>
                <p>delivered: {health.backlog.delivered}</p>
                <p>retryable_failure: {health.backlog.retryable_failure}</p>
                <p>replay_required: {health.backlog.replay_required}</p>
              </div>
              <p className="text-xs font-mono">
                latestReplayRequiredAt: {formatOptionalDateTime(health.latestReplayRequiredAt)}
              </p>
              {health.enabled && !health.deliveryConfigured ? (
                <p className="text-xs font-bold text-amber-700">
                  当前 outbox 已启用但未完成投递配置，手动 replay 仍可能失败。
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs font-bold text-gray-500">健康摘要暂未返回。</p>
          )}
        </div>
      ) : null}

      {outboxSummary ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="border-2 border-black p-3 bg-[#FFD500]/20">
            <p className="text-[10px] uppercase text-gray-600">记录总数</p>
            <p className="text-2xl font-black">{outboxSummary.total}</p>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">投递状态</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
              {(Object.entries(outboxSummary.byDeliveryState) as Array<[AgentLedgerDeliveryState, number]>).map(
                ([key, value]) => (
                  <p key={key}>
                    {formatAgentLedgerDeliveryState(key, true)}: {value}
                  </p>
                ),
              )}
            </div>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">运行结果</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
              {(Object.entries(outboxSummary.byStatus) as Array<[AgentLedgerRuntimeStatus, number]>).map(
                ([key, value]) => (
                  <p key={key}>
                    {formatAgentLedgerRuntimeStatus(key, true)}: {value}
                  </p>
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-black text-white text-xs uppercase">
            <tr>
              <th className="p-2 w-12">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-black"
                  checked={allSelectableChecked}
                  disabled={selectableIds.length === 0 || !apiAvailable || batchReplaying}
                  onChange={(e) => onToggleAllSelection(e.target.checked)}
                />
              </th>
              <th className="p-2">时间</th>
              <th className="p-2">Provider / Model</th>
              <th className="p-2">租户 / Trace</th>
              <th className="p-2">运行结果</th>
              <th className="p-2">投递状态</th>
              <th className="p-2">尝试</th>
              <th className="p-2">最近错误</th>
              <th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20 text-xs">
            {(outbox?.data || []).map((item) => {
              const attemptsPanelOpen = attemptsOpenOutboxId === item.id;
              const attemptsPanelLoading = attemptsPanelOpen && attemptLoading;
              return (
                <Fragment key={item.id}>
                  <tr>
                    <td className="p-2 align-top">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-black"
                        checked={selectedIds.includes(item.id)}
                        disabled={item.deliveryState === "delivered" || batchReplaying || replayingId === item.id}
                        onChange={(e) => onToggleSelection(item.id, e.target.checked)}
                      />
                    </td>
                    <td className="p-2 font-mono">
                      <p>{formatOptionalDateTime(item.createdAt)}</p>
                      <p className="text-[10px] text-gray-500">开始: {formatOptionalDateTime(item.startedAt)}</p>
                    </td>
                    <td className="p-2">
                      <p className="font-mono">{item.provider || "-"}</p>
                      <p className="font-mono text-[10px] text-gray-500" title={item.model || undefined}>
                        {item.model || "-"}
                      </p>
                      <p
                        className="font-mono text-[10px] text-gray-500"
                        title={item.resolvedModel || undefined}
                      >
                        {item.resolvedModel || "-"}
                      </p>
                    </td>
                    <td className="p-2">
                      <p className="font-mono">{item.tenantId || "-"}</p>
                      {item.traceId ? (
                        <button
                          className="font-mono text-[10px] underline decoration-dotted"
                          onClick={() => onJumpToAuditTrace(item.traceId)}
                          title={`按 traceId=${item.traceId} 查询审计`}
                        >
                          {item.traceId}
                        </button>
                      ) : (
                        <p className="font-mono text-[10px] text-gray-500">-</p>
                      )}
                    </td>
                    <td className="p-2">
                      <span
                        className={cn(
                          "inline-flex border border-black px-2 py-1 text-[10px] font-black uppercase",
                          item.status === "success"
                            ? "bg-emerald-100 text-emerald-800"
                            : item.status === "blocked"
                              ? "bg-orange-100 text-orange-800"
                              : item.status === "timeout"
                                ? "bg-amber-100 text-amber-800"
                            : "bg-[#FFE0E0] text-red-700",
                        )}
                        title={item.status}
                      >
                        {formatAgentLedgerRuntimeStatus(item.status)}
                      </span>
                    </td>
                    <td className="p-2">
                      <span
                        className={cn(
                          "inline-flex border border-black px-2 py-1 text-[10px] font-black uppercase",
                          item.deliveryState === "delivered"
                            ? "bg-emerald-100 text-emerald-800"
                            : item.deliveryState === "pending"
                              ? "bg-[#FFD500]/30 text-black"
                              : "bg-[#FFE0E0] text-red-700",
                        )}
                        title={item.deliveryState}
                      >
                        {formatAgentLedgerDeliveryState(item.deliveryState)}
                      </span>
                      <p className="mt-1 font-mono text-[10px] text-gray-500">
                        nextRetry: {formatOptionalDateTime(item.nextRetryAt)}
                      </p>
                    </td>
                    <td className="p-2 font-mono">
                      <button
                        className="font-mono underline decoration-dotted"
                        disabled={attemptsPanelLoading}
                        onClick={() => onToggleAttemptPanel(item)}
                        title={`查看 outbox #${item.id} 的 delivery attempts`}
                      >
                        {item.attemptCount}
                      </button>
                      <p className="text-[10px] text-gray-500">HTTP {item.lastHttpStatus ?? "-"}</p>
                      <button
                        className="mt-1 text-[10px] font-bold text-gray-500 underline decoration-dotted"
                        disabled={attemptsPanelLoading}
                        onClick={() => onToggleAttemptPanel(item)}
                      >
                        {attemptsPanelOpen ? "收起 attempts" : "查看 attempts"}
                      </button>
                    </td>
                    <td className="p-2 text-red-700">
                      <p className="font-mono">{item.lastErrorClass || "-"}</p>
                      <p className="text-[10px]" title={item.lastErrorMessage || undefined}>
                        {item.lastErrorMessage || item.errorCode || "-"}
                      </p>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col items-start gap-2">
                        {item.traceId ? (
                          <button className="b-btn bg-white text-xs" onClick={() => onJumpToAuditTrace(item.traceId)}>
                            查看审计
                          </button>
                        ) : null}
                        <button
                          className="b-btn bg-white text-xs"
                          onClick={() =>
                            onJumpToReplayAudits({
                              outboxId: item.id,
                              traceId: item.traceId,
                            })
                          }
                        >
                          按 outboxId 查 replay
                        </button>
                        {item.deliveryState === "delivered" ? (
                          <span className="text-[10px] font-bold text-gray-500">已投递</span>
                        ) : (
                          <button
                            className="b-btn bg-white text-xs"
                            disabled={replayingId === item.id || batchReplaying}
                            onClick={() => onReplayById(item.id)}
                          >
                            {replayingId === item.id ? "replay 中..." : "执行 replay"}
                          </button>
                        )}
                        <span className="font-mono text-[10px] text-gray-500">#{item.id}</span>
                      </div>
                    </td>
                  </tr>
                  {attemptsPanelOpen ? (
                    <tr className="bg-[#FFF8CC]">
                      <td className="p-0" colSpan={9}>
                        <div className="border-t-2 border-black bg-[#FFF8CC] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-[10px] uppercase text-gray-600">Delivery Attempts</p>
                              <p className="text-sm font-black uppercase">Outbox #{item.id} Attempts Detail</p>
                              <p className="font-mono text-[10px] text-gray-500">
                                traceId: {item.traceId || "-"} | idempotencyKey: {item.idempotencyKey || "-"}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="b-btn bg-white text-xs"
                                disabled={attemptsPanelLoading}
                                onClick={() => onReloadAttemptPanel(attemptsPage)}
                              >
                                {attemptsPanelLoading
                                  ? "刷新中..."
                                  : attemptApiAvailable
                                    ? "刷新 attempts"
                                    : "重新探测接口"}
                              </button>
                              <button className="b-btn bg-white text-xs" onClick={onCloseAttemptPanel}>
                                收起
                              </button>
                            </div>
                          </div>

                          {!attemptApiAvailable ? (
                            <p className="mt-3 text-xs font-bold text-gray-500">
                              当前环境暂未开放 delivery attempts 接口，本 detail panel 已降级，不影响 outbox / replay 主区。
                            </p>
                          ) : null}

                          {attemptError ? (
                            <div className="mt-3 flex flex-col gap-3 border-2 border-black bg-[#FFE0E0] p-3 md:flex-row md:items-center md:justify-between">
                              <div className="space-y-1 text-red-700">
                                <p className="text-xs font-black uppercase tracking-[0.16em]">Attempts 加载失败</p>
                                <p className="text-xs font-bold">{attemptError}</p>
                              </div>
                              <button
                                className="b-btn bg-white text-xs"
                                disabled={attemptsPanelLoading}
                                onClick={() => onReloadAttemptPanel(attemptsPage)}
                              >
                                重试 attempts
                              </button>
                            </div>
                          ) : null}

                          {attemptsPanelLoading && !attemptError && !attempts && !attemptSummary ? (
                            <p className="mt-3 text-xs font-bold text-gray-500">正在加载 attempts 明细...</p>
                          ) : null}

                          {attemptApiAvailable && !attemptError && attemptSummary ? (
                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                              <div className="border-2 border-black bg-white p-3">
                                <p className="text-[10px] uppercase text-gray-600">总尝试数</p>
                                <p className="text-2xl font-black">{attemptSummary.total}</p>
                              </div>
                              <div className="border-2 border-black bg-white p-3">
                                <p className="text-[10px] uppercase text-gray-600">来源分布</p>
                                <div className="mt-2 grid grid-cols-1 gap-1 text-xs font-mono">
                                  {(Object.entries(attemptSummary.bySource) as Array<
                                    [AgentLedgerDeliveryAttemptSource, number]
                                  >).map(([key, value]) => (
                                    <p key={key}>
                                      {formatAgentLedgerDeliveryAttemptSource(key, true)}: {value}
                                    </p>
                                  ))}
                                </div>
                              </div>
                              <div className="border-2 border-black bg-white p-3">
                                <p className="text-[10px] uppercase text-gray-600">结果分布</p>
                                <div className="mt-2 grid grid-cols-1 gap-1 text-xs font-mono">
                                  {(Object.entries(attemptSummary.byResult) as Array<
                                    [AgentLedgerReplayAuditResult, number]
                                  >).map(([key, value]) => (
                                    <p key={key}>
                                      {formatAgentLedgerReplayResult(key, true)}: {value}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {attemptApiAvailable && !attemptError ? (
                            <div className="mt-4 border-2 border-black overflow-x-auto">
                              <table className="w-full text-left">
                                <thead className="bg-black text-white text-xs uppercase">
                                  <tr>
                                    <th className="p-2">时间</th>
                                    <th className="p-2">Attempt</th>
                                    <th className="p-2">来源</th>
                                    <th className="p-2">结果</th>
                                    <th className="p-2">HTTP / 耗时</th>
                                    <th className="p-2">错误</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-black/20 text-xs">
                                  {(attempts?.data || []).map((attempt) => (
                                    <tr key={attempt.id}>
                                      <td className="p-2 font-mono">{formatOptionalDateTime(attempt.createdAt)}</td>
                                      <td className="p-2 font-mono">
                                        <p>attempt #{attempt.attemptNumber || "-"}</p>
                                        <p className="text-[10px] text-gray-500">#{attempt.id}</p>
                                      </td>
                                      <td className="p-2">
                                        <span
                                          className={cn(
                                            "inline-flex border border-black px-2 py-1 text-[10px] font-black uppercase",
                                            attempt.source === "worker"
                                              ? "bg-white text-black"
                                              : attempt.source === "manual_replay"
                                                ? "bg-[#FFD500]/30 text-black"
                                                : "bg-orange-100 text-orange-800",
                                          )}
                                          title={attempt.source}
                                        >
                                          {formatAgentLedgerDeliveryAttemptSource(attempt.source)}
                                        </span>
                                      </td>
                                      <td className="p-2">
                                        <span
                                          className={cn(
                                            "inline-flex border border-black px-2 py-1 text-[10px] font-black uppercase",
                                            attempt.result === "delivered"
                                              ? "bg-emerald-100 text-emerald-800"
                                              : attempt.result === "retryable_failure"
                                                ? "bg-amber-100 text-amber-800"
                                                : "bg-[#FFE0E0] text-red-700",
                                          )}
                                          title={attempt.result}
                                        >
                                          {formatAgentLedgerReplayResult(attempt.result)}
                                        </span>
                                      </td>
                                      <td className="p-2 font-mono">
                                        <p>HTTP {attempt.httpStatus ?? "-"}</p>
                                        <p className="text-[10px] text-gray-500">
                                          {attempt.durationMs !== null &&
                                          attempt.durationMs !== undefined &&
                                          attempt.durationMs >= 0
                                            ? `${attempt.durationMs}ms`
                                            : "-"}
                                        </p>
                                      </td>
                                      <td className="p-2 text-red-700">
                                        <p className="font-mono">{attempt.errorClass || "-"}</p>
                                        <p className="text-[10px]" title={attempt.errorMessage || undefined}>
                                          {attempt.errorMessage || "-"}
                                        </p>
                                      </td>
                                    </tr>
                                  ))}
                                  {(attempts?.data || []).length === 0 ? (
                                    <TableFeedbackRow
                                      colSpan={6}
                                      emptyMessage="暂无 delivery attempts 记录"
                                      onRetry={() => onReloadAttemptPanel(attemptsPage)}
                                      retryLabel="重试 attempts"
                                    />
                                  ) : null}
                                </tbody>
                              </table>
                            </div>
                          ) : null}

                          {attemptApiAvailable &&
                          !attemptError &&
                          attempts &&
                          attempts.totalPages > 1 ? (
                            <div className="mt-4 flex items-center justify-between">
                              <p className="text-xs font-bold text-gray-500">
                                共 {attempts.total} 条，第 {attempts.page}/{attempts.totalPages} 页
                              </p>
                              <div className="flex gap-2">
                                <button
                                  className="b-btn bg-white text-xs"
                                  disabled={attempts.page <= 1 || attemptsPanelLoading}
                                  onClick={() => onReloadAttemptPanel(Math.max(1, attempts.page - 1))}
                                >
                                  上一页
                                </button>
                                <button
                                  className="b-btn bg-white text-xs"
                                  disabled={attempts.page >= attempts.totalPages || attemptsPanelLoading}
                                  onClick={() =>
                                    onReloadAttemptPanel(Math.min(attempts.totalPages, attempts.page + 1))
                                  }
                                >
                                  下一页
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {(outbox?.data || []).length === 0 ? (
              <TableFeedbackRow
                colSpan={9}
                error={sectionError}
                emptyMessage={apiAvailable ? "暂无 AgentLedger outbox 记录" : "当前后端未启用 AgentLedger outbox 接口"}
                onRetry={() => onApplyFilters(currentPage)}
                retryLabel="重试当前页"
              />
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-bold text-gray-500">
          共 {outbox?.total || 0} 条，第 {currentPage}/{totalPages} 页，当前已选 {selectedIds.length} 条
        </p>
        <div className="flex gap-2">
          <button className="b-btn bg-white" disabled={currentPage <= 1} onClick={() => onApplyFilters(Math.max(1, currentPage - 1))}>
            上一页
          </button>
          <button
            className="b-btn bg-white"
            disabled={currentPage >= totalPages}
            onClick={() => onApplyFilters(Math.min(totalPages, currentPage + 1))}
          >
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}
