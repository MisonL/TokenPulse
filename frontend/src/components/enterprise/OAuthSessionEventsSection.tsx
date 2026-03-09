import type { Dispatch, SetStateAction } from "react";
import type { OAuthSessionEventQueryResult } from "../../lib/client";
import { SectionErrorBanner } from "./EnterpriseSectionFeedback";

interface OAuthSessionEventsSectionProps {
  sectionId?: string;
  apiAvailable: boolean;
  sectionError?: string;
  result: OAuthSessionEventQueryResult | null;
  providerFilter: string;
  stateFilter: string;
  flowFilter: "" | "auth_code" | "device_code" | "manual_key" | "service_account";
  phaseFilter:
    | ""
    | "pending"
    | "waiting_callback"
    | "waiting_device"
    | "exchanging"
    | "completed"
    | "error";
  statusFilter: "" | "pending" | "completed" | "error";
  typeFilter: "" | "register" | "set_phase" | "complete" | "mark_error";
  fromFilter: string;
  toFilter: string;
  setProviderFilter: Dispatch<SetStateAction<string>>;
  setStateFilter: Dispatch<SetStateAction<string>>;
  setFlowFilter: Dispatch<
    SetStateAction<"" | "auth_code" | "device_code" | "manual_key" | "service_account">
  >;
  setPhaseFilter: Dispatch<
    SetStateAction<
      | ""
      | "pending"
      | "waiting_callback"
      | "waiting_device"
      | "exchanging"
      | "completed"
      | "error"
    >
  >;
  setStatusFilter: Dispatch<SetStateAction<"" | "pending" | "completed" | "error">>;
  setTypeFilter: Dispatch<SetStateAction<"" | "register" | "set_phase" | "complete" | "mark_error">>;
  setFromFilter: Dispatch<SetStateAction<string>>;
  setToFilter: Dispatch<SetStateAction<string>>;
  onApplyFilters: (page?: number) => void;
  onRetry: () => void;
  onExport: () => void;
  onTraceByState: (state: string) => void;
}

export function OAuthSessionEventsSection({
  sectionId = "oauth-session-events-panel",
  apiAvailable,
  sectionError = "",
  result,
  providerFilter,
  stateFilter,
  flowFilter,
  phaseFilter,
  statusFilter,
  typeFilter,
  fromFilter,
  toFilter,
  setProviderFilter,
  setStateFilter,
  setFlowFilter,
  setPhaseFilter,
  setStatusFilter,
  setTypeFilter,
  setFromFilter,
  setToFilter,
  onApplyFilters,
  onRetry,
  onExport,
  onTraceByState,
}: OAuthSessionEventsSectionProps) {
  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="text-2xl font-black uppercase">OAuth 会话事件</h3>
        <div className="flex flex-wrap gap-2">
          <input
            className="b-input h-10 w-40"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            placeholder="provider"
          />
          <input
            className="b-input h-10 w-44"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            placeholder="state"
          />
          <select
            className="b-input h-10 w-32"
            value={flowFilter}
            onChange={(e) =>
              setFlowFilter(
                e.target.value as "" | "auth_code" | "device_code" | "manual_key" | "service_account",
              )
            }
          >
            <option value="">全部 flow</option>
            <option value="auth_code">auth_code</option>
            <option value="device_code">device_code</option>
            <option value="manual_key">manual_key</option>
            <option value="service_account">service_account</option>
          </select>
          <select
            className="b-input h-10 w-36"
            value={phaseFilter}
            onChange={(e) =>
              setPhaseFilter(
                e.target.value as
                  | ""
                  | "pending"
                  | "waiting_callback"
                  | "waiting_device"
                  | "exchanging"
                  | "completed"
                  | "error",
              )
            }
          >
            <option value="">全部 phase</option>
            <option value="pending">pending</option>
            <option value="waiting_callback">waiting_callback</option>
            <option value="waiting_device">waiting_device</option>
            <option value="exchanging">exchanging</option>
            <option value="completed">completed</option>
            <option value="error">error</option>
          </select>
          <select
            className="b-input h-10 w-28"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "" | "pending" | "completed" | "error")
            }
          >
            <option value="">全部状态</option>
            <option value="pending">pending</option>
            <option value="completed">completed</option>
            <option value="error">error</option>
          </select>
          <select
            className="b-input h-10 w-32"
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as "" | "register" | "set_phase" | "complete" | "mark_error")
            }
          >
            <option value="">全部事件</option>
            <option value="register">register</option>
            <option value="set_phase">set_phase</option>
            <option value="complete">complete</option>
            <option value="mark_error">mark_error</option>
          </select>
          <input
            type="datetime-local"
            className="b-input h-10 w-56"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            title="起始时间"
          />
          <input
            type="datetime-local"
            className="b-input h-10 w-56"
            value={toFilter}
            onChange={(e) => setToFilter(e.target.value)}
            title="结束时间"
          />
          <button className="b-btn bg-white" onClick={() => onApplyFilters(1)}>
            查询
          </button>
          <button className="b-btn bg-white" onClick={onExport}>
            导出 CSV
          </button>
        </div>
      </div>

      {!apiAvailable ? (
        <p className="mb-3 text-xs font-bold text-gray-500">
          当前后端未提供 <code>/api/admin/oauth/session-events*</code>，该诊断面板已自动降级。
        </p>
      ) : (
        <p className="mb-3 text-xs font-bold text-gray-500">
          提示：点击表格中的 state 可自动回填筛选并追溯该会话链路。
        </p>
      )}

      <SectionErrorBanner
        title="OAuth 会话事件"
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
              <th className="p-2">state</th>
              <th className="p-2">flow</th>
              <th className="p-2">phase</th>
              <th className="p-2">status</th>
              <th className="p-2">event</th>
              <th className="p-2">错误</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20 text-xs">
            {(result?.data || []).map((item, index) => (
              <tr key={`${item.id || "se"}-${item.createdAt}-${index}`}>
                <td className="p-2 font-mono">{new Date(item.createdAt).toLocaleString()}</td>
                <td className="p-2 font-mono">{item.provider}</td>
                <td className="p-2 font-mono">
                  <button
                    className="underline decoration-dotted"
                    onClick={() => onTraceByState(item.state)}
                    title={`按 state=${item.state} 追溯`}
                  >
                    {item.state}
                  </button>
                </td>
                <td className="p-2 font-mono">{item.flowType}</td>
                <td className="p-2 font-mono">{item.phase}</td>
                <td className="p-2">{item.status}</td>
                <td className="p-2 font-mono">{item.eventType}</td>
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
            onClick={() =>
              onApplyFilters(Math.min(result?.totalPages || 1, (result?.page || 1) + 1))
            }
          >
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}
