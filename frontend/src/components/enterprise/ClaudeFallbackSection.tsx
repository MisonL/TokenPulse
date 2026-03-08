import type {
  ClaudeFallbackQueryResult,
  ClaudeFallbackSummary,
  ClaudeFallbackTimeseriesPoint,
} from "../../lib/client";
import { SectionErrorBanner } from "./EnterpriseSectionFeedback";

interface ClaudeFallbackSectionProps {
  sectionId?: string;
  sectionError?: string;
  modeFilter: "" | "api_key" | "bridge";
  phaseFilter: "" | "attempt" | "success" | "failure" | "skipped";
  reasonFilter:
    | ""
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown";
  traceFilter: string;
  fromFilter: string;
  toFilter: string;
  step: "5m" | "15m" | "1h" | "6h" | "1d";
  summary: ClaudeFallbackSummary | null;
  timeseries: ClaudeFallbackTimeseriesPoint[];
  events: ClaudeFallbackQueryResult | null;
  onModeFilterChange: (value: "" | "api_key" | "bridge") => void;
  onPhaseFilterChange: (value: "" | "attempt" | "success" | "failure" | "skipped") => void;
  onReasonFilterChange: (
    value:
      | ""
      | "api_key_bearer_rejected"
      | "bridge_status_code"
      | "bridge_cloudflare_signal"
      | "bridge_circuit_open"
      | "bridge_http_error"
      | "bridge_exception"
      | "unknown",
  ) => void;
  onTraceFilterChange: (value: string) => void;
  onFromFilterChange: (value: string) => void;
  onToFilterChange: (value: string) => void;
  onStepChange: (value: "5m" | "15m" | "1h" | "6h" | "1d") => void;
  onApplyFilters: (page?: number) => void;
}

export function ClaudeFallbackSection({
  sectionId = "claude-fallback-section",
  sectionError = "",
  modeFilter,
  phaseFilter,
  reasonFilter,
  traceFilter,
  fromFilter,
  toFilter,
  step,
  summary,
  timeseries,
  events,
  onModeFilterChange,
  onPhaseFilterChange,
  onReasonFilterChange,
  onTraceFilterChange,
  onFromFilterChange,
  onToFilterChange,
  onStepChange,
  onApplyFilters,
}: ClaudeFallbackSectionProps) {
  const currentPage = events?.page || 1;
  const pageCount = events?.pageCount || 1;
  const latestPoint = timeseries[timeseries.length - 1];

  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <h3 className="text-2xl font-black uppercase mb-3">Claude 回退事件</h3>

      <SectionErrorBanner
        title="Claude 回退事件"
        error={sectionError}
        onRetry={() => {
          void onApplyFilters(1);
        }}
        retryLabel="重试当前筛选"
      />

      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <label className="text-xs font-bold uppercase text-gray-500">
            mode
            <select
              className="b-input h-10 w-full mt-1"
              value={modeFilter}
              onChange={(e) => onModeFilterChange(e.target.value as "" | "api_key" | "bridge")}
            >
              <option value="">全部</option>
              <option value="api_key">api_key</option>
              <option value="bridge">bridge</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            phase
            <select
              className="b-input h-10 w-full mt-1"
              value={phaseFilter}
              onChange={(e) =>
                onPhaseFilterChange(
                  e.target.value as "" | "attempt" | "success" | "failure" | "skipped",
                )
              }
            >
              <option value="">全部</option>
              <option value="attempt">attempt</option>
              <option value="success">success</option>
              <option value="failure">failure</option>
              <option value="skipped">skipped</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            reason
            <select
              className="b-input h-10 w-full mt-1"
              value={reasonFilter}
              onChange={(e) =>
                onReasonFilterChange(
                  e.target.value as
                    | ""
                    | "api_key_bearer_rejected"
                    | "bridge_status_code"
                    | "bridge_cloudflare_signal"
                    | "bridge_circuit_open"
                    | "bridge_http_error"
                    | "bridge_exception"
                    | "unknown",
                )
              }
            >
              <option value="">全部</option>
              <option value="api_key_bearer_rejected">api_key_bearer_rejected</option>
              <option value="bridge_status_code">bridge_status_code</option>
              <option value="bridge_cloudflare_signal">bridge_cloudflare_signal</option>
              <option value="bridge_circuit_open">bridge_circuit_open</option>
              <option value="bridge_http_error">bridge_http_error</option>
              <option value="bridge_exception">bridge_exception</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            traceId
            <input
              className="b-input h-10 w-full mt-1"
              value={traceFilter}
              onChange={(e) => onTraceFilterChange(e.target.value)}
              placeholder="按 traceId 精确筛选"
            />
          </label>
          <label className="text-xs font-bold uppercase text-gray-500">
            step
            <select
              className="b-input h-10 w-full mt-1"
              value={step}
              onChange={(e) => onStepChange(e.target.value as "5m" | "15m" | "1h" | "6h" | "1d")}
            >
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="6h">6h</option>
              <option value="1d">1d</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
            <button className="b-btn bg-white w-full" onClick={() => onApplyFilters(1)}>
              应用筛选
            </button>
          </div>
        </div>
      </div>

      {summary ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="border-2 border-black p-3 bg-[#FFD500]/20">
            <p className="text-[10px] uppercase text-gray-600">事件总数</p>
            <p className="text-2xl font-black">{summary.total}</p>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">Mode 分布</p>
            <p className="text-xs font-mono mt-1">
              api_key: {summary.byMode.api_key} / bridge: {summary.byMode.bridge}
            </p>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">Phase 分布</p>
            <p className="text-xs font-mono mt-1">
              A:{summary.byPhase.attempt} S:{summary.byPhase.success} F:{summary.byPhase.failure} K:
              {summary.byPhase.skipped}
            </p>
          </div>
          <div className="border-2 border-black p-3">
            <p className="text-[10px] uppercase text-gray-600">Reason Top</p>
            <div className="mt-1 space-y-1">
              {(Object.entries(summary.byReason) as Array<[string, number]>)
                .filter(([, count]) => count > 0)
                .sort((left, right) => right[1] - left[1])
                .slice(0, 3)
                .map(([reason, count]) => (
                  <p key={reason} className="text-xs font-mono">
                    {reason}: {count}
                  </p>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {timeseries.length > 0 ? (
        <div className="border-2 border-black p-4 mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase text-gray-600">回退趋势（{step}）</p>
            <p className="text-xs font-mono">
              最近桶：
              {latestPoint ? new Date(latestPoint.bucketStart).toLocaleString() : "-"} / total{" "}
              {latestPoint?.total || 0} / failure {latestPoint?.failure || 0} / bridge{" "}
              {Math.round((latestPoint?.bridgeShare || 0) * 100)}%
            </p>
          </div>

          <div className="space-y-2">
            {timeseries.slice(-8).map((point) => {
              const failurePercent =
                point.total > 0 ? Math.round((point.failure / point.total) * 100) : 0;
              const bridgePercent = Math.round(point.bridgeShare * 100);
              return (
                <div
                  key={point.bucketStart}
                  className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center"
                >
                  <p className="text-xs font-mono md:col-span-2">
                    {new Date(point.bucketStart).toLocaleString()}
                  </p>
                  <p className="text-xs font-mono">
                    T:{point.total} S:{point.success} F:{point.failure}
                  </p>
                  <div className="h-2 bg-gray-200 border border-black">
                    <div className="h-full bg-[#DA0414]" style={{ width: `${failurePercent}%` }} />
                  </div>
                  <p className="text-xs font-mono">
                    失败率 {failurePercent}% / bridge {bridgePercent}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="overflow-auto border-2 border-black">
        <table className="w-full text-left text-sm">
          <thead className="bg-black text-[#FFD500] uppercase text-xs">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2">Phase</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">状态码</th>
              <th className="px-3 py-2">模型</th>
              <th className="px-3 py-2">耗时(ms)</th>
              <th className="px-3 py-2">TraceId</th>
            </tr>
          </thead>
          <tbody>
            {(events?.data || []).map((item) => (
              <tr key={item.id} className="border-t border-black/10">
                <td className="px-3 py-2 whitespace-nowrap">{item.timestamp}</td>
                <td className="px-3 py-2">{item.mode}</td>
                <td className="px-3 py-2">{item.phase}</td>
                <td className="px-3 py-2">{item.reason || "-"}</td>
                <td className="px-3 py-2">{item.status ?? "-"}</td>
                <td className="px-3 py-2 max-w-[240px] truncate">{item.model || "-"}</td>
                <td className="px-3 py-2">{item.latencyMs ?? "-"}</td>
                <td className="px-3 py-2 max-w-[260px] truncate">{item.traceId || "-"}</td>
              </tr>
            ))}
            {(events?.data || []).length === 0 && (
              <tr>
                <td className="px-3 py-4 text-gray-500 font-bold" colSpan={8}>
                  暂无回退事件
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 mt-3 text-xs font-bold">
        <span>
          共 {events?.total || 0} 条，第 {currentPage}/{pageCount} 页
        </span>
        <button
          className="b-btn bg-white"
          disabled={currentPage <= 1}
          onClick={() => {
            void onApplyFilters(Math.max(1, currentPage - 1));
          }}
        >
          上一页
        </button>
        <button
          className="b-btn bg-white"
          disabled={currentPage >= pageCount}
          onClick={() => {
            void onApplyFilters(Math.min(pageCount, currentPage + 1));
          }}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
