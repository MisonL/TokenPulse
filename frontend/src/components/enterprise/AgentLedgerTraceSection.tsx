import type {
  AgentLedgerDeliveryAttemptQueryResult,
  AgentLedgerDeliveryAttemptSummary,
  AgentLedgerOutboxHealth,
  AgentLedgerOutboxReadiness,
  AgentLedgerOutboxQueryResult,
  AgentLedgerOutboxSummary,
  AgentLedgerReplayAuditQueryResult,
  AgentLedgerReplayAuditSummary,
  AgentLedgerTraceDrilldownSummary,
  AuditEventItem,
} from "../../lib/client";
import { cn } from "../../lib/utils";
import {
  formatAgentLedgerAvailability,
  formatAgentLedgerDeliveryAttemptSource,
  formatAgentLedgerDeliveryState,
  formatAgentLedgerNeedsReplay,
  formatAgentLedgerReadinessStatus,
  formatAgentLedgerReadyState,
  formatAgentLedgerReplayResult,
  formatAgentLedgerReplayTriggerSource,
  formatAgentLedgerRuntimeStatus,
  formatAgentLedgerTraceState,
} from "./agentLedgerLabels";
import { SectionErrorBanner, TableFeedbackRow } from "./EnterpriseSectionFeedback";

interface AgentLedgerTraceSectionProps {
  sectionId?: string;
  traceId: string;
  resolvedTraceId: string;
  agentLedgerConsoleUrl?: string;
  hasQueried: boolean;
  loading: boolean;
  sectionError?: string;
  outboxApiAvailable: boolean;
  outbox: AgentLedgerOutboxQueryResult | null;
  outboxSummary: AgentLedgerOutboxSummary | null;
  attemptApiAvailable: boolean;
  attempts: AgentLedgerDeliveryAttemptQueryResult | null;
  attemptSummary: AgentLedgerDeliveryAttemptSummary | null;
  replayAuditApiAvailable: boolean;
  replayAudits: AgentLedgerReplayAuditQueryResult | null;
  replayAuditSummary: AgentLedgerReplayAuditSummary | null;
  traceSummary: AgentLedgerTraceDrilldownSummary | null;
  auditEvents: AuditEventItem[];
  readiness: AgentLedgerOutboxReadiness | null;
  health: AgentLedgerOutboxHealth | null;
  formatOptionalDateTime: (value?: number | string | null) => string;
  onTraceIdChange: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onJumpToOutbox: () => void;
  onReplayOutboxBatchByTrace: (ids: number[]) => void | Promise<void>;
  onJumpToReplayAudits: (options: { outboxId?: number | null; traceId?: string | null }) => void;
  onJumpToAuditTrace: (traceId?: string | null) => void;
}

interface TraceLaneMeta {
  label: string;
  available: boolean;
  total: number;
  accentClassName: string;
}

function normalizeAgentLedgerConsoleUrl(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function AgentLedgerTraceSection({
  sectionId = "agentledger-trace-section",
  traceId,
  resolvedTraceId,
  agentLedgerConsoleUrl,
  hasQueried,
  loading,
  sectionError = "",
  outboxApiAvailable,
  outbox,
  outboxSummary,
  attemptApiAvailable,
  attempts,
  attemptSummary,
  replayAuditApiAvailable,
  replayAudits,
  replayAuditSummary,
  traceSummary,
  auditEvents,
  readiness,
  health,
  formatOptionalDateTime,
  onTraceIdChange,
  onSearch,
  onReset,
  onJumpToOutbox,
  onReplayOutboxBatchByTrace,
  onJumpToReplayAudits,
  onJumpToAuditTrace,
}: AgentLedgerTraceSectionProps) {
  const activeTraceId = resolvedTraceId.trim();
  const normalizedConsoleUrl = normalizeAgentLedgerConsoleUrl(agentLedgerConsoleUrl);
  const lanes: TraceLaneMeta[] = [
    {
      label: "Outbox",
      available: outboxApiAvailable,
      total: outboxSummary?.total || 0,
      accentClassName: "bg-[#FFD500]/25",
    },
    {
      label: "Delivery Attempts",
      available: attemptApiAvailable,
      total: attemptSummary?.total || 0,
      accentClassName: "bg-[#C7F9CC]/35",
    },
    {
      label: "Replay Audits",
      available: replayAuditApiAvailable,
      total: replayAuditSummary?.total || 0,
      accentClassName: "bg-[#FFE0E0]",
    },
    {
      label: "Platform Audit",
      available: true,
      total: auditEvents.length,
      accentClassName: "bg-[#E0F2FE]",
    },
  ];
  const availableLaneCount = lanes.filter((item) => item.available).length;
  const totalHits = lanes.reduce((sum, item) => sum + item.total, 0);
  const replayableOutboxIds = Array.from(
    new Set(
      (outbox?.data || [])
        .filter((item) => item.deliveryState !== "delivered")
        .map((item) => item.id)
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((left, right) => left - right);
  const traceOutboxReplayDisabledReason = loading
    ? "联查加载中，暂不可批量回放"
    : !activeTraceId
      ? "请先执行 traceId 联查"
      : !outboxApiAvailable
        ? "当前环境暂未开放 AgentLedger Outbox 查询接口"
        : replayableOutboxIds.length === 0
          ? "该 trace 下 outbox 均已投递，无需回放"
          : "";
  const traceOutboxReplayDisabled = Boolean(traceOutboxReplayDisabledReason);

  return (
    <section
      id={sectionId}
      className="overflow-hidden border-4 border-black bg-[linear-gradient(135deg,#fffef4_0%,#ffffff_54%,#fff6d6_100%)] p-6 b-shadow"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl space-y-2">
          <p className="inline-flex border-2 border-black bg-black px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-white">
            AgentLedger Trace Crosscheck
          </p>
          <div>
            <h3 className="text-2xl font-black uppercase">AgentLedger TraceId 联查</h3>
            <p className="mt-1 text-xs font-bold text-gray-600">
              以 traceId 为主键并发联查 outbox、delivery attempts、replay audits 三条观测链路，适合排查单次请求从写出到补偿的全链路轨迹。
            </p>
          </div>
        </div>
        <div className="grid min-w-[220px] grid-cols-1 gap-2 text-xs font-bold text-gray-600 sm:grid-cols-3">
          {lanes.map((lane) => (
            <div key={lane.label} className={cn("border-2 border-black p-3", lane.accentClassName)}>
              <p className="uppercase">{lane.label}</p>
              <p className="mt-2 text-2xl font-black text-black">{lane.total}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.16em]">
                {formatAgentLedgerAvailability(lane.available)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.3fr)_auto_auto_auto_auto]">
        <label className="text-xs font-bold uppercase text-gray-500">
          traceId
          <input
            className="b-input mt-1 h-12 w-full font-mono"
            value={traceId}
            onChange={(e) => onTraceIdChange(e.target.value)}
            placeholder="输入 traceId，联查 AgentLedger 三段链路"
          />
        </label>
        <button className="b-btn bg-white self-end" disabled={loading} onClick={onSearch}>
          {loading ? "联查中..." : "开始联查"}
        </button>
        <button className="b-btn bg-white self-end" disabled={loading && !hasQueried} onClick={onReset}>
          清空
        </button>
        <button className="b-btn bg-white self-end" disabled={!activeTraceId} onClick={onJumpToOutbox}>
          带入 Outbox 主区
        </button>
        <button
          className="b-btn bg-[#FFD500] self-end"
          disabled={!activeTraceId}
          onClick={() => onJumpToReplayAudits({ traceId: activeTraceId })}
        >
          带入 Replay 主区
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-2 border-black bg-white/80 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            Trace Snapshot
          </p>
          <p className="font-mono text-sm font-black text-black">{activeTraceId || "尚未执行联查"}</p>
          <p className="text-xs font-bold text-gray-600">
            当前命中 {totalHits} 条关联记录，已接入 {availableLaneCount}/3 条观测接口。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="b-btn bg-white text-xs"
            disabled={!activeTraceId}
            onClick={() => onJumpToAuditTrace(activeTraceId)}
          >
            查看平台审计
          </button>
          <button
            className="b-btn bg-white text-xs"
            disabled={!activeTraceId}
            onClick={() => onJumpToReplayAudits({ traceId: activeTraceId })}
          >
            查看 replay 审计
          </button>
          {normalizedConsoleUrl ? (
            <button
              className="b-btn bg-white text-xs"
              disabled={!activeTraceId}
              onClick={() => {
                if (!activeTraceId) return;
                const fallbackMessage = "复制失败，请手动复制 traceId";
                if (navigator?.clipboard?.writeText) {
                  void navigator.clipboard.writeText(activeTraceId).catch(() => {
                    alert(fallbackMessage);
                  });
                } else {
                  alert(fallbackMessage);
                }
                window.open(`${normalizedConsoleUrl}/#/governance`, "_blank", "noopener,noreferrer");
              }}
            >
              打开 AgentLedger 控制台
            </button>
          ) : null}
        </div>
      </div>

      {traceSummary || readiness || health ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="border-2 border-black bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
              Current State
            </p>
            <p className="mt-2 text-lg font-black uppercase">
              {formatAgentLedgerTraceState(traceSummary?.currentState, true)}
            </p>
          </div>
          <div className="border-2 border-black bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
              Needs Replay
            </p>
            <p className="mt-2 text-lg font-black uppercase">
              {formatAgentLedgerNeedsReplay(Boolean(traceSummary?.needsReplay))}
            </p>
          </div>
          <div className="border-2 border-black bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
              Last Operator
            </p>
            <p className="mt-2 font-mono text-sm font-black text-black">
              {traceSummary?.lastOperatorId || "-"}
            </p>
          </div>
          <div className="border-2 border-black bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
              Readiness
            </p>
            <p className="mt-2 text-lg font-black uppercase">
              {formatAgentLedgerReadinessStatus(readiness?.status, true)}
            </p>
            <p className="mt-1 text-[10px] font-bold text-gray-500">
              ready: {readiness ? formatAgentLedgerReadyState(readiness.ready) : "-"}
            </p>
          </div>
          <div className="border-2 border-black bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
              Open Backlog
            </p>
            <p className="mt-2 text-lg font-black uppercase">
              {health?.openBacklogTotal ?? 0}
            </p>
            <p className="mt-1 text-[10px] font-bold text-gray-500">
              replay_required: {health?.backlog?.replay_required ?? 0}
            </p>
          </div>
        </div>
      ) : null}

      <SectionErrorBanner
        title="AgentLedger Trace"
        error={sectionError}
        onRetry={activeTraceId ? onSearch : undefined}
        retryLabel="重试联查"
      />

      {!hasQueried ? (
        <div className="mt-4 border-2 border-dashed border-black bg-white/80 p-5">
          <p className="text-sm font-black uppercase">输入 traceId 后开始联查</p>
          <p className="mt-2 text-xs font-bold text-gray-600">
            父组件通过聚合联查接口统一拉取 trace 快照，子组件仅负责展示与跳转，不持有任何业务状态。
          </p>
        </div>
      ) : null}

      {hasQueried ? (
        <>
            <div className="mt-5 grid grid-cols-1 gap-4">
            <div className="border-2 border-black bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-black bg-[#FFD500]/20 px-4 py-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                  Lane 01
                </p>
                <h4 className="text-lg font-black uppercase">Outbox 命中结果</h4>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    data-testid="agentledger-trace-outbox-batch-replay"
                    type="button"
                    className="b-btn bg-white text-xs"
                    disabled={traceOutboxReplayDisabled}
                    title={traceOutboxReplayDisabledReason || undefined}
                    onClick={() => {
                      if (traceOutboxReplayDisabled) return;
                      const preview = replayableOutboxIds.slice(0, 20).join(", ");
                      const messageLines = [
                        "确认批量 replay 本 trace 未投递 outbox？",
                        activeTraceId ? `traceId: ${activeTraceId}` : "",
                        `数量: ${replayableOutboxIds.length}`,
                        preview
                          ? `outboxId: ${preview}${replayableOutboxIds.length > 20 ? " ..." : ""}`
                          : "",
                      ].filter(Boolean);
                      if (!confirm(messageLines.join("\n"))) return;
                      void onReplayOutboxBatchByTrace(replayableOutboxIds);
                    }}
                  >
                    批量 replay 本 trace 未投递 outbox
                  </button>
                  <p className="text-xs font-bold text-gray-600">
                    {outboxApiAvailable
                      ? `共 ${outboxSummary?.total || 0} 条 outbox 记录`
                      : "当前环境暂未开放 AgentLedger Outbox 查询接口"}
                  </p>
                </div>
                {traceOutboxReplayDisabled && traceOutboxReplayDisabledReason ? (
                  <p
                    className="text-[10px] font-bold text-gray-500"
                    title={traceOutboxReplayDisabledReason}
                  >
                    {traceOutboxReplayDisabledReason}
                  </p>
                ) : null}
              </div>
              </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-black text-xs uppercase text-white">
                  <tr>
                    <th className="p-2">时间</th>
                    <th className="p-2">Outbox / 租户</th>
                    <th className="p-2">Provider / Model</th>
                    <th className="p-2">投递状态</th>
                    <th className="p-2">尝试</th>
                    <th className="p-2">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/20 text-xs">
                  {(outbox?.data || []).map((item) => (
                    <tr key={item.id}>
                      <td className="p-2 font-mono">
                        <p>{formatOptionalDateTime(item.createdAt)}</p>
                        <p className="text-[10px] text-gray-500">
                          updated: {formatOptionalDateTime(item.updatedAt)}
                        </p>
                      </td>
                      <td className="p-2 font-mono">
                        <p>#{item.id}</p>
                        <p className="text-[10px] text-gray-500">{item.tenantId || "-"}</p>
                      </td>
                      <td className="p-2">
                        <p className="font-mono">{item.provider || "-"}</p>
                        <p className="font-mono text-[10px] text-gray-500" title={item.model || undefined}>
                          {item.model || "-"}
                        </p>
                      </td>
                      <td className="p-2">
                        <span
                          className="inline-flex border border-black px-2 py-1 text-[10px] font-black uppercase"
                          title={item.deliveryState}
                        >
                          {formatAgentLedgerDeliveryState(item.deliveryState)}
                        </span>
                        <p className="mt-1 text-[10px] font-mono text-gray-500" title={item.status}>
                          {formatAgentLedgerRuntimeStatus(item.status)}
                        </p>
                      </td>
                      <td className="p-2 font-mono">
                        <p>{item.attemptCount}</p>
                        <p className="text-[10px] text-gray-500">HTTP {item.lastHttpStatus ?? "-"}</p>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="b-btn bg-white text-xs"
                            onClick={() => onJumpToAuditTrace(item.traceId)}
                          >
                            查看审计
                          </button>
                          <button
                            className="b-btn bg-white text-xs"
                            onClick={() =>
                              onJumpToReplayAudits({
                                outboxId: item.id,
                                traceId: item.traceId,
                              })
                            }
                          >
                            查 replay
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(outbox?.data || []).length === 0 ? (
                    <TableFeedbackRow
                      colSpan={6}
                      emptyMessage={
                        outboxApiAvailable
                          ? "该 traceId 暂未命中 AgentLedger outbox 记录"
                          : "当前后端未启用 AgentLedger outbox 接口"
                      }
                    />
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="border-2 border-black bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-black bg-[#C7F9CC]/35 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                    Lane 02
                  </p>
                  <h4 className="text-lg font-black uppercase">Delivery Attempts</h4>
                </div>
                <p className="text-xs font-bold text-gray-600">
                  {attemptApiAvailable
                    ? `共 ${attemptSummary?.total || 0} 条 attempts`
                    : "当前环境暂未开放 AgentLedger delivery attempts 接口"}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-black text-xs uppercase text-white">
                    <tr>
                      <th className="p-2">时间</th>
                      <th className="p-2">Outbox / Attempt</th>
                      <th className="p-2">Source / Result</th>
                      <th className="p-2">HTTP / Error</th>
                      <th className="p-2">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/20 text-xs">
                    {(attempts?.data || []).map((item) => (
                      <tr key={item.id}>
                        <td className="p-2 font-mono">{formatOptionalDateTime(item.createdAt)}</td>
                        <td className="p-2 font-mono">
                          <p>outbox #{item.outboxId || "-"}</p>
                          <p className="text-[10px] text-gray-500">attempt #{item.attemptNumber || "-"}</p>
                        </td>
                        <td className="p-2">
                          <p className="font-mono" title={item.source}>
                            {formatAgentLedgerDeliveryAttemptSource(item.source)}
                          </p>
                          <p className="mt-1 text-[10px] font-black uppercase text-gray-500">
                            {formatAgentLedgerReplayResult(item.result)}
                          </p>
                        </td>
                        <td className="p-2 font-mono text-red-700">
                          <p>HTTP {item.httpStatus ?? "-"}</p>
                          <p className="text-[10px]" title={item.errorMessage || undefined}>
                            {item.errorClass || item.errorMessage || "-"}
                          </p>
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() => onJumpToAuditTrace(item.traceId)}
                            >
                              查看审计
                            </button>
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() =>
                                onJumpToReplayAudits({
                                  outboxId: item.outboxId,
                                  traceId: item.traceId,
                                })
                              }
                            >
                              查 replay
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(attempts?.data || []).length === 0 ? (
                      <TableFeedbackRow
                        colSpan={5}
                        emptyMessage={
                          attemptApiAvailable
                            ? "该 traceId 暂未命中 delivery attempts"
                            : "当前后端未启用 AgentLedger delivery attempts 接口"
                        }
                      />
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

              <div className="border-2 border-black bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-black bg-[#FFE0E0] px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                    Lane 03
                  </p>
                  <h4 className="text-lg font-black uppercase">Replay Audits</h4>
                </div>
                <p className="text-xs font-bold text-gray-600">
                  {replayAuditApiAvailable
                    ? `共 ${replayAuditSummary?.total || 0} 条 replay 审计`
                    : "当前环境暂未开放 AgentLedger replay 审计接口"}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-black text-xs uppercase text-white">
                    <tr>
                      <th className="p-2">时间</th>
                      <th className="p-2">Outbox / Attempt</th>
                      <th className="p-2">Operator / Trigger</th>
                      <th className="p-2">Result / HTTP</th>
                      <th className="p-2">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/20 text-xs">
                    {(replayAudits?.data || []).map((item) => (
                      <tr key={item.id}>
                        <td className="p-2 font-mono">{formatOptionalDateTime(item.createdAt)}</td>
                        <td className="p-2 font-mono">
                          <p>outbox #{item.outboxId || "-"}</p>
                          <p className="text-[10px] text-gray-500">attempt #{item.attemptNumber || "-"}</p>
                        </td>
                        <td className="p-2">
                          <p className="font-mono">{item.operatorId || "-"}</p>
                          <p className="mt-1 text-[10px] font-black uppercase text-gray-500">
                            {formatAgentLedgerReplayTriggerSource(item.triggerSource)}
                          </p>
                        </td>
                        <td className="p-2 font-mono text-red-700">
                          <p title={item.result}>{formatAgentLedgerReplayResult(item.result)}</p>
                          <p className="text-[10px]">HTTP {item.httpStatus ?? "-"}</p>
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() => onJumpToAuditTrace(item.traceId)}
                            >
                              查看审计
                            </button>
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() =>
                                onJumpToReplayAudits({
                                  outboxId: item.outboxId,
                                  traceId: item.traceId,
                                })
                              }
                            >
                              打开主区
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(replayAudits?.data || []).length === 0 ? (
                      <TableFeedbackRow
                        colSpan={5}
                        emptyMessage={
                          replayAuditApiAvailable
                            ? "该 traceId 暂未命中 replay 审计记录"
                            : "当前后端未启用 AgentLedger replay 审计接口"
                        }
                      />
                    ) : null}
                  </tbody>
                </table>
              </div>
              </div>
            </div>
          </div>
          <div className="border-2 border-black bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-black bg-[#E0F2FE] px-4 py-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                  Lane 04
                </p>
                <h4 className="text-lg font-black uppercase">平台审计事件</h4>
              </div>
              <p className="text-xs font-bold text-gray-600">
                共 {auditEvents.length} 条 audit 记录
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-black text-xs uppercase text-white">
                  <tr>
                    <th className="p-2">时间</th>
                    <th className="p-2">Actor / Result</th>
                    <th className="p-2">Action / Resource</th>
                    <th className="p-2">Trace / ResourceId</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/20 text-xs">
                  {auditEvents.map((item) => (
                    <tr key={item.id}>
                      <td className="p-2 font-mono">{item.createdAt || "-"}</td>
                      <td className="p-2">
                        <p className="font-mono">{item.actor || "-"}</p>
                        <p className="mt-1 text-[10px] font-black uppercase text-gray-500">
                          {item.result || "-"}
                        </p>
                      </td>
                      <td className="p-2">
                        <p className="font-mono">{item.action || "-"}</p>
                        <p className="mt-1 text-[10px] font-mono text-gray-500">
                          {item.resource || "-"}
                        </p>
                      </td>
                      <td className="p-2 font-mono">
                        <p>{item.traceId || "-"}</p>
                        <p className="mt-1 text-[10px] text-gray-500">{item.resourceId || "-"}</p>
                      </td>
                    </tr>
                  ))}
                  {auditEvents.length === 0 ? (
                    <TableFeedbackRow colSpan={4} emptyMessage="该 traceId 暂未命中平台审计事件" />
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
