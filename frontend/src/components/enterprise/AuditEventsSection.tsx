import type { Dispatch, SetStateAction } from "react";
import type { AuditEventItem, AuditQueryResult } from "../../lib/client";
import { cn } from "../../lib/utils";
import { SectionErrorBanner } from "./EnterpriseSectionFeedback";

interface AuditEventsSectionProps {
  sectionId?: string;
  sectionError?: string;
  result: AuditQueryResult | null;
  keyword: string;
  traceId: string;
  action: string;
  resource: string;
  resourceId: string;
  policyId: string;
  resultFilter: "" | "success" | "failure";
  from: string;
  to: string;
  setKeyword: Dispatch<SetStateAction<string>>;
  setTraceId: Dispatch<SetStateAction<string>>;
  setAction: Dispatch<SetStateAction<string>>;
  setResource: Dispatch<SetStateAction<string>>;
  setResourceId: Dispatch<SetStateAction<string>>;
  setPolicyId: Dispatch<SetStateAction<string>>;
  setResultFilter: Dispatch<SetStateAction<"" | "success" | "failure">>;
  setFrom: Dispatch<SetStateAction<string>>;
  setTo: Dispatch<SetStateAction<string>>;
  resolvePolicyId: (item: AuditEventItem) => string | null;
  onApplyFilters: () => void;
  onRetry: () => void;
  onExport: () => void;
  onJumpToAuditTrace: (traceId?: string | null) => void;
  onJumpToPolicy: (policyId: string) => void;
  onPageChange: (page: number) => void;
}

export function AuditEventsSection({
  sectionId = "audit-events-section",
  sectionError = "",
  result,
  keyword,
  traceId,
  action,
  resource,
  resourceId,
  policyId,
  resultFilter,
  from,
  to,
  setKeyword,
  setTraceId,
  setAction,
  setResource,
  setResourceId,
  setPolicyId,
  setResultFilter,
  setFrom,
  setTo,
  resolvePolicyId,
  onApplyFilters,
  onRetry,
  onExport,
  onJumpToAuditTrace,
  onJumpToPolicy,
  onPageChange,
}: AuditEventsSectionProps) {
  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="text-2xl font-black uppercase">审计事件</h3>
        <div className="flex flex-wrap gap-2">
          <input
            className="b-input h-10 w-64"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="关键词筛选（actor/action/resource）"
          />
          <input className="b-input h-10 w-40" value={traceId} onChange={(e) => setTraceId(e.target.value)} placeholder="traceId" />
          <input className="b-input h-10 w-32" value={action} onChange={(e) => setAction(e.target.value)} placeholder="action" />
          <input className="b-input h-10 w-32" value={resource} onChange={(e) => setResource(e.target.value)} placeholder="resource" />
          <input className="b-input h-10 w-36" value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder="resourceId" />
          <input className="b-input h-10 w-36" value={policyId} onChange={(e) => setPolicyId(e.target.value)} placeholder="policyId" />
          <input type="datetime-local" className="b-input h-10 w-56" value={from} onChange={(e) => setFrom(e.target.value)} title="起始时间" />
          <input type="datetime-local" className="b-input h-10 w-56" value={to} onChange={(e) => setTo(e.target.value)} title="结束时间" />
          <select className="b-input h-10 w-28" value={resultFilter} onChange={(e) => setResultFilter(e.target.value as "" | "success" | "failure")}>
            <option value="">全部结果</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
          </select>
          <button className="b-btn bg-white" onClick={onApplyFilters}>查询</button>
          <button className="b-btn bg-white" onClick={onExport}>导出 CSV</button>
        </div>
      </div>

      <SectionErrorBanner title="审计事件" error={sectionError} onRetry={onRetry} retryLabel="重试当前页" />

      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-black text-white text-xs uppercase">
            <tr>
              <th className="p-3">时间</th>
              <th className="p-3">操作人</th>
              <th className="p-3">动作</th>
              <th className="p-3">资源</th>
              <th className="p-3">资源ID</th>
              <th className="p-3">追踪 ID</th>
              <th className="p-3">结果</th>
              <th className="p-3">联动</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20 text-sm">
            {(result?.data || []).map((item) => {
              const resolvedPolicyId = resolvePolicyId(item);
              return (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="p-3 font-mono text-xs">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="p-3">{item.actor}</td>
                  <td className="p-3 font-mono text-xs">{item.action}</td>
                  <td className="p-3 font-mono text-xs">{item.resource}</td>
                  <td className="p-3 font-mono text-xs">{item.resourceId || "-"}</td>
                  <td className="p-3 font-mono text-xs">
                    {item.traceId ? (
                      <button className="underline decoration-dotted" onClick={() => onJumpToAuditTrace(item.traceId)}>
                        {item.traceId}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-3">
                    <span className={cn("font-black text-xs", item.result === "success" ? "text-emerald-600" : "text-red-600")}>
                      {item.result === "success" ? "成功" : "失败"}
                    </span>
                  </td>
                  <td className="p-3">
                    {resolvedPolicyId ? (
                      <button className="b-btn bg-white text-xs" onClick={() => onJumpToPolicy(resolvedPolicyId)}>
                        查看策略用量
                      </button>
                    ) : (
                      <span className="text-xs text-gray-500">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-bold text-gray-500">
          共 {result?.total || 0} 条，第 {result?.page || 1}/{result?.totalPages || 1} 页
        </p>
        <div className="flex gap-2">
          <button className="b-btn bg-white" disabled={(result?.page || 1) <= 1} onClick={() => onPageChange(Math.max(1, (result?.page || 1) - 1))}>
            上一页
          </button>
          <button className="b-btn bg-white" disabled={(result?.page || 1) >= (result?.totalPages || 1)} onClick={() => onPageChange(Math.min(result?.totalPages || 1, (result?.page || 1) + 1))}>
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}
