import type { Dispatch, SetStateAction } from "react";
import type { OAuthCallbackQueryResult } from "../../lib/client";
import { SectionErrorBanner } from "./EnterpriseSectionFeedback";

interface OAuthCallbackEventsSectionProps {
  sectionId?: string;
  sectionError?: string;
  result: OAuthCallbackQueryResult | null;
  providerFilter: string;
  statusFilter: "" | "success" | "failure";
  stateFilter: string;
  traceFilter: string;
  setProviderFilter: Dispatch<SetStateAction<string>>;
  setStatusFilter: Dispatch<SetStateAction<"" | "success" | "failure">>;
  setStateFilter: Dispatch<SetStateAction<string>>;
  setTraceFilter: Dispatch<SetStateAction<string>>;
  onApplyFilters: (page?: number) => void;
  onRetry: () => void;
  onJumpToAuditTrace: (traceId?: string | null) => void;
}

export function OAuthCallbackEventsSection({
  sectionId,
  sectionError = "",
  result,
  providerFilter,
  statusFilter,
  stateFilter,
  traceFilter,
  setProviderFilter,
  setStatusFilter,
  setStateFilter,
  setTraceFilter,
  onApplyFilters,
  onRetry,
  onJumpToAuditTrace,
}: OAuthCallbackEventsSectionProps) {
  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="text-2xl font-black uppercase">OAuth 回调事件</h3>
        <div className="flex flex-wrap gap-2">
          <input
            className="b-input h-10 w-32"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            placeholder="provider"
          />
          <select
            className="b-input h-10 w-28"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | "success" | "failure")}
          >
            <option value="">全部状态</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
          </select>
          <input
            className="b-input h-10 w-44"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            placeholder="state 包含过滤"
          />
          <input
            className="b-input h-10 w-44"
            value={traceFilter}
            onChange={(e) => setTraceFilter(e.target.value)}
            placeholder="traceId"
          />
          <button className="b-btn bg-white" onClick={() => onApplyFilters(1)}>
            查询
          </button>
        </div>
      </div>

      <SectionErrorBanner
        title="OAuth 回调事件"
        error={sectionError}
        onRetry={onRetry}
        retryLabel="重试当前筛选"
      />

      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-black text-white text-xs uppercase">
            <tr>
              <th className="p-2">时间</th>
              <th className="p-2">provider</th>
              <th className="p-2">source</th>
              <th className="p-2">status</th>
              <th className="p-2">state</th>
              <th className="p-2">traceId</th>
              <th className="p-2">错误</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20 text-xs">
            {(result?.data || []).map((item, index) => (
              <tr key={`${item.id || "cb"}-${item.createdAt}-${index}`}>
                <td className="p-2 font-mono">{new Date(item.createdAt).toLocaleString()}</td>
                <td className="p-2 font-mono">{item.provider}</td>
                <td className="p-2 font-mono">{item.source}</td>
                <td className="p-2">{item.status}</td>
                <td className="p-2 font-mono">{item.state || "-"}</td>
                <td className="p-2 font-mono">
                  {item.traceId ? (
                    <button
                      className="underline decoration-dotted"
                      onClick={() => onJumpToAuditTrace(item.traceId)}
                    >
                      {item.traceId}
                    </button>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-2 text-red-700">{item.error || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-bold text-gray-500">
          共 {result?.total || 0} 条，第 {result?.page || 1}/{result?.totalPages || 1} 页
        </p>
        <div className="flex gap-2">
          <button
            className="b-btn bg-white"
            disabled={(result?.page || 1) <= 1}
            onClick={() => onApplyFilters(Math.max(1, (result?.page || 1) - 1))}
          >
            上一页
          </button>
          <button
            className="b-btn bg-white"
            disabled={(result?.page || 1) >= (result?.totalPages || 1)}
            onClick={() => onApplyFilters(Math.min(result?.totalPages || 1, (result?.page || 1) + 1))}
          >
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}
