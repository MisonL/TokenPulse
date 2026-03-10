import type { Dispatch, SetStateAction } from "react";
import type { BillingQuotaResult, BillingUsageItem } from "../../lib/client";
import { TableFeedbackRow, SectionErrorBanner } from "./EnterpriseSectionFeedback";

interface BillingUsageSectionProps {
  sectionId?: string;
  sectionError?: string;
  quotas: BillingQuotaResult["data"] | null;
  rows: BillingUsageItem[];
  page: number;
  total: number;
  totalPages: number;
  policyIdFilter: string;
  bucketTypeFilter: "" | "minute" | "day";
  providerFilter: string;
  modelFilter: string;
  tenantFilter: string;
  projectIdFilter: string;
  fromFilter: string;
  toFilter: string;
  setPolicyIdFilter: Dispatch<SetStateAction<string>>;
  setBucketTypeFilter: Dispatch<SetStateAction<"" | "minute" | "day">>;
  setProviderFilter: Dispatch<SetStateAction<string>>;
  setModelFilter: Dispatch<SetStateAction<string>>;
  setTenantFilter: Dispatch<SetStateAction<string>>;
  setProjectIdFilter: Dispatch<SetStateAction<string>>;
  setFromFilter: Dispatch<SetStateAction<string>>;
  setToFilter: Dispatch<SetStateAction<string>>;
  formatWindowStart: (value: number) => string;
  onApplyFilters: () => void;
  onExport: () => void;
  onRetry: () => void;
  onJumpToAuditByPolicy: (policyId: string) => void;
  onPageChange: (page: number) => void;
}

export function BillingUsageSection({
  sectionId = "billing-usage-section",
  sectionError = "",
  quotas,
  rows,
  page,
  total,
  totalPages,
  policyIdFilter,
  bucketTypeFilter,
  providerFilter,
  modelFilter,
  tenantFilter,
  projectIdFilter,
  fromFilter,
  toFilter,
  setPolicyIdFilter,
  setBucketTypeFilter,
  setProviderFilter,
  setModelFilter,
  setTenantFilter,
  setProjectIdFilter,
  setFromFilter,
  setToFilter,
  formatWindowStart,
  onApplyFilters,
  onExport,
  onRetry,
  onJumpToAuditByPolicy,
  onPageChange,
}: BillingUsageSectionProps) {
  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <h3 className="text-2xl font-black uppercase mb-3">计费与配额</h3>
      <p className="text-sm font-bold mb-3">{quotas?.message || "暂无配额信息"}</p>

      <SectionErrorBanner
        title="计费与配额"
        error={sectionError}
        onRetry={onRetry}
        retryLabel="重试当前页"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border-2 border-black p-4">
          <p className="text-xs uppercase text-gray-500">每分钟请求数</p>
          <p className="text-2xl font-black">{quotas?.limits.requestsPerMinute ?? 0}</p>
        </div>
        <div className="border-2 border-black p-4">
          <p className="text-xs uppercase text-gray-500">每日 Token 限额</p>
          <p className="text-2xl font-black">{quotas?.limits.tokensPerDay ?? 0}</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
          <label className="text-xs font-bold uppercase text-gray-500">
            policyId
            <input className="b-input h-10 w-full mt-1" value={policyIdFilter} onChange={(e) => setPolicyIdFilter(e.target.value)} placeholder="可选" />
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            bucketType
            <select className="b-input h-10 w-full mt-1" value={bucketTypeFilter} onChange={(e) => setBucketTypeFilter(e.target.value as "" | "minute" | "day")}>
              <option value="">全部</option>
              <option value="minute">minute</option>
              <option value="day">day</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            provider
            <input className="b-input h-10 w-full mt-1" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} placeholder="claude/gemini..." />
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            model
            <input className="b-input h-10 w-full mt-1" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder="模型名（支持 pattern）" />
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            tenantId
            <input
              className="b-input h-10 w-full mt-1"
              value={tenantFilter}
              disabled={Boolean(projectIdFilter.trim())}
              onChange={(e) => {
                const value = e.target.value;
                setTenantFilter(value);
                if (value.trim()) {
                  setProjectIdFilter("");
                }
              }}
              placeholder="租户 ID"
            />
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            projectId
            <input
              className="b-input h-10 w-full mt-1"
              value={projectIdFilter}
              disabled={Boolean(tenantFilter.trim())}
              onChange={(e) => {
                const value = e.target.value;
                setProjectIdFilter(value);
                if (value.trim()) {
                  setTenantFilter("");
                }
              }}
              placeholder="项目 ID"
            />
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            from
            <input className="b-input h-10 w-full mt-1" type="datetime-local" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} />
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            to
            <input className="b-input h-10 w-full mt-1" type="datetime-local" value={toFilter} onChange={(e) => setToFilter(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button className="b-btn bg-white" onClick={onApplyFilters}>查询用量</button>
          <button className="b-btn bg-white" onClick={onExport}>导出 CSV</button>
        </div>

        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-black text-white uppercase">
              <tr>
                <th className="p-2">时间窗口</th>
                <th className="p-2">桶类型</th>
                <th className="p-2">策略</th>
                <th className="p-2">请求数</th>
                <th className="p-2">Token(估算/实际/差值)</th>
                <th className="p-2">联动</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="p-2 font-mono">{formatWindowStart(row.windowStart)}</td>
                  <td className="p-2">{row.bucketType}</td>
                  <td className="p-2">
                    <p className="font-bold">{row.policyName || "-"}</p>
                    <p className="font-mono text-[10px] text-gray-500">{row.policyId}</p>
                  </td>
                  <td className="p-2 font-mono">{row.requestCount}</td>
                  <td className="p-2 font-mono">
                    {(row.estimatedTokenCount ?? row.tokenCount)}/{row.actualTokenCount ?? row.tokenCount}/
                    {row.reconciledDelta ?? 0}
                  </td>
                  <td className="p-2">
                    <button className="b-btn bg-white text-xs" onClick={() => onJumpToAuditByPolicy(row.policyId)}>
                      查看审计
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <TableFeedbackRow
                  colSpan={6}
                  error={sectionError}
                  emptyMessage="暂无配额使用记录"
                  onRetry={onRetry}
                  retryLabel="重试当前页"
                />
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs font-bold">
          <p>第 {page}/{totalPages} 页 · 共 {total} 条</p>
          <div className="flex gap-2">
            <button className="b-btn bg-white text-xs" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
              上一页
            </button>
            <button className="b-btn bg-white text-xs" disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>
              下一页
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
