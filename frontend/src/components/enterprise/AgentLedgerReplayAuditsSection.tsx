import type {
  AgentLedgerReplayAuditQueryResult,
  AgentLedgerReplayAuditResult,
  AgentLedgerReplayAuditSummary,
  AgentLedgerReplayTriggerSource,
} from "../../lib/client";
import { cn } from "../../lib/utils";
import { SectionErrorBanner, TableFeedbackRow } from "./EnterpriseSectionFeedback";

interface AgentLedgerReplayAuditsSectionProps {
  sectionId?: string;
  apiAvailable: boolean;
  summary: AgentLedgerReplayAuditSummary | null;
  audits: AgentLedgerReplayAuditQueryResult | null;
  sectionError?: string;
  outboxIdFilter: string;
  traceFilter: string;
  operatorFilter: string;
  resultFilter: "" | AgentLedgerReplayAuditResult;
  triggerSourceFilter: "" | AgentLedgerReplayTriggerSource;
  fromFilter: string;
  toFilter: string;
  onOutboxIdFilterChange: (value: string) => void;
  onTraceFilterChange: (value: string) => void;
  onOperatorFilterChange: (value: string) => void;
  onResultFilterChange: (value: "" | AgentLedgerReplayAuditResult) => void;
  onTriggerSourceFilterChange: (value: "" | AgentLedgerReplayTriggerSource) => void;
  onFromFilterChange: (value: string) => void;
  onToFilterChange: (value: string) => void;
  onApplyFilters: (page?: number) => void;
  onJumpToAuditTrace: (traceId?: string | null) => void;
  formatOptionalDateTime: (value?: number | string | null) => string;
}

export function AgentLedgerReplayAuditsSection({
  sectionId = "agentledger-replay-audits-section",
  apiAvailable,
  summary,
  audits,
  sectionError,
  outboxIdFilter,
  traceFilter,
  operatorFilter,
  resultFilter,
  triggerSourceFilter,
  fromFilter,
  toFilter,
  onOutboxIdFilterChange,
  onTraceFilterChange,
  onOperatorFilterChange,
  onResultFilterChange,
  onTriggerSourceFilterChange,
  onFromFilterChange,
  onToFilterChange,
  onApplyFilters,
  onJumpToAuditTrace,
  formatOptionalDateTime,
}: AgentLedgerReplayAuditsSectionProps) {
  const currentPage = audits?.page || 1;
  const totalPages = audits?.totalPages || 1;

  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h3 className="text-2xl font-black uppercase">AgentLedger Replay Audits</h3>
          <p className="mt-1 text-xs font-bold text-gray-500">
            查看手动 / 批量 replay 的审计留痕与结果分布，支持按 outboxId / traceId 快速联查。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="b-btn bg-white" onClick={() => onApplyFilters(1)}>
            查询
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <label className="text-xs font-bold uppercase text-gray-500">
          outboxId
          <input
            type="number"
            min="1"
            className="b-input h-10 w-full mt-1"
            value={outboxIdFilter}
            onChange={(e) => onOutboxIdFilterChange(e.target.value)}
            placeholder="outbox id"
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
        <label className="text-xs font-bold uppercase text-gray-500">
          operatorId
          <input
            className="b-input h-10 w-full mt-1"
            value={operatorFilter}
            onChange={(e) => onOperatorFilterChange(e.target.value)}
            placeholder="操作人 ID"
          />
        </label>
        <label className="text-xs font-bold uppercase text-gray-500">
          result
          <select
            className="b-input h-10 w-full mt-1"
            value={resultFilter}
            onChange={(e) => onResultFilterChange(e.target.value as "" | AgentLedgerReplayAuditResult)}
          >
            <option value="">全部</option>
            <option value="delivered">delivered</option>
            <option value="retryable_failure">retryable_failure</option>
            <option value="permanent_failure">permanent_failure</option>
          </select>
        </label>
        <label className="text-xs font-bold uppercase text-gray-500">
          triggerSource
          <select
            className="b-input h-10 w-full mt-1"
            value={triggerSourceFilter}
            onChange={(e) =>
              onTriggerSourceFilterChange(e.target.value as "" | AgentLedgerReplayTriggerSource)
            }
          >
            <option value="">全部</option>
            <option value="manual">manual</option>
            <option value="batch_manual">batch_manual</option>
          </select>
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
              当前后端未提供 <code>/api/admin/observability/agentledger-replay-audits*</code>。
            </p>
          ) : (
            <p className="text-xs font-bold text-gray-500">
              支持按 outboxId / traceId 联查；从 Outbox 行可一键带入筛选。
            </p>
          )}
        </div>
      </div>

      <SectionErrorBanner
        title="AgentLedger Replay Audits"
        error={sectionError}
        onRetry={() => onApplyFilters(currentPage)}
        retryLabel="重试当前筛选"
      />

      {summary ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="border-2 border-black p-3 bg-[#FFD500]/20">
            <p className="text-[10px] uppercase text-gray-600">总审计数</p>
            <p className="text-2xl font-black">{summary.total}</p>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">delivered</p>
            <p className="text-2xl font-black text-emerald-700">{summary.byResult.delivered}</p>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">retryable_failure</p>
            <p className="text-2xl font-black text-amber-700">
              {summary.byResult.retryable_failure}
            </p>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">permanent_failure</p>
            <p className="text-2xl font-black text-red-700">
              {summary.byResult.permanent_failure}
            </p>
          </div>
        </div>
      ) : null}

      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-black text-white text-xs uppercase">
            <tr>
              <th className="p-2">时间</th>
              <th className="p-2">Outbox / Attempt</th>
              <th className="p-2">Trace / Idempotency</th>
              <th className="p-2">Operator</th>
              <th className="p-2">Trigger</th>
              <th className="p-2">Result</th>
              <th className="p-2">HTTP / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20 text-xs">
            {(audits?.data || []).map((item) => (
              <tr key={item.id}>
                <td className="p-2 font-mono">{formatOptionalDateTime(item.createdAt)}</td>
                <td className="p-2 font-mono">
                  <p>outbox #{item.outboxId || "-"}</p>
                  <p className="text-[10px] text-gray-500">attempt #{item.attemptNumber || "-"}</p>
                </td>
                <td className="p-2">
                  {item.traceId ? (
                    <button
                      className="font-mono underline decoration-dotted"
                      onClick={() => onJumpToAuditTrace(item.traceId)}
                      title={`按 traceId=${item.traceId} 查询审计`}
                    >
                      {item.traceId}
                    </button>
                  ) : (
                    <p className="font-mono text-gray-500">-</p>
                  )}
                  <p className="mt-1 font-mono text-[10px] text-gray-500" title={item.idempotencyKey}>
                    {item.idempotencyKey || "-"}
                  </p>
                </td>
                <td className="p-2 font-mono">{item.operatorId || "-"}</td>
                <td className="p-2">
                  <span
                    className={cn(
                      "inline-flex border border-black px-2 py-1 text-[10px] font-black uppercase",
                      item.triggerSource === "batch_manual"
                        ? "bg-[#FFD500]/30 text-black"
                        : "bg-white text-black",
                    )}
                  >
                    {item.triggerSource}
                  </span>
                </td>
                <td className="p-2">
                  <span
                    className={cn(
                      "inline-flex border border-black px-2 py-1 text-[10px] font-black uppercase",
                      item.result === "delivered"
                        ? "bg-emerald-100 text-emerald-800"
                        : item.result === "retryable_failure"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-[#FFE0E0] text-red-700",
                    )}
                  >
                    {item.result}
                  </span>
                </td>
                <td className="p-2 font-mono text-red-700">
                  <p>HTTP {item.httpStatus ?? "-"}</p>
                  <p className="text-[10px]">{item.errorClass || "-"}</p>
                </td>
              </tr>
            ))}
            {(audits?.data || []).length === 0 ? (
              <TableFeedbackRow
                colSpan={7}
                error={sectionError}
                emptyMessage={
                  apiAvailable ? "暂无 AgentLedger replay 审计记录" : "当前后端未启用 AgentLedger replay 审计接口"
                }
                onRetry={() => onApplyFilters(currentPage)}
                retryLabel="重试当前筛选"
              />
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-bold text-gray-500">
          共 {audits?.total || 0} 条，第 {currentPage}/{totalPages} 页
        </p>
        <div className="flex gap-2">
          <button
            className="b-btn bg-white"
            disabled={currentPage <= 1}
            onClick={() => onApplyFilters(Math.max(1, currentPage - 1))}
          >
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
