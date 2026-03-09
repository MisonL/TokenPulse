import type { CapabilityRuntimeHealthData } from "../../lib/client";
import { cn } from "../../lib/utils";

interface CapabilityHealthSectionProps {
  sectionId?: string;
  capabilityHealth: CapabilityRuntimeHealthData | null;
  capabilityHealthLoading: boolean;
  capabilityHealthError: string;
  formatFlows: (
    flows?: Array<"auth_code" | "device_code" | "manual_key" | "service_account">,
  ) => string;
  onRefresh: () => void;
}

export function CapabilityHealthSection({
  sectionId,
  capabilityHealth,
  capabilityHealthLoading,
  capabilityHealthError,
  formatFlows,
  onRefresh,
}: CapabilityHealthSectionProps) {
  return (
    <section
      id={sectionId}
      className="bg-white border-4 border-black p-6 b-shadow"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-2xl font-black uppercase">OAuth 能力健康状态</h3>
        <button
          className="b-btn bg-white"
          disabled={capabilityHealthLoading}
          onClick={onRefresh}
        >
          {capabilityHealthLoading ? "刷新中..." : "刷新健康状态"}
        </button>
      </div>

      <div
        className={cn(
          "border-2 border-black p-4",
          capabilityHealth
            ? capabilityHealth.ok
              ? "bg-emerald-50"
              : "bg-rose-50"
            : "bg-gray-100",
        )}
      >
        <p
          className={cn(
            "text-lg font-black",
            capabilityHealth
              ? capabilityHealth.ok
                ? "text-emerald-700"
                : "text-red-700"
              : "text-gray-700",
          )}
        >
          {capabilityHealth ? (capabilityHealth.ok ? "状态正常" : "存在一致性问题") : "待检查"}
        </p>
        <p className="text-xs font-bold text-gray-600 mt-1">
          最近检查时间：
          {capabilityHealth?.checkedAt ? new Date(capabilityHealth.checkedAt).toLocaleString() : "-"}
        </p>
        <p className="text-xs font-bold text-gray-600 mt-1">
          问题总数：{capabilityHealth?.issueCount ?? 0}
        </p>
      </div>

      {capabilityHealthError ? (
        <p className="mt-3 text-xs font-bold text-red-700">{capabilityHealthError}</p>
      ) : null}

      {!capabilityHealthError && !capabilityHealth ? (
        <p className="mt-3 text-sm font-bold text-gray-500">暂无能力健康数据</p>
      ) : null}

      {!capabilityHealthError && capabilityHealth && capabilityHealth.issues.length === 0 ? (
        <p className="mt-3 text-sm font-bold text-emerald-700">
          未发现能力图谱与运行时适配器不一致问题。
        </p>
      ) : null}

      {capabilityHealth && capabilityHealth.issues.length > 0 ? (
        <div className="mt-4 border-2 border-black overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-black text-white uppercase">
              <tr>
                <th className="p-2">Provider</th>
                <th className="p-2">问题码</th>
                <th className="p-2">描述</th>
                <th className="p-2">能力图谱</th>
                <th className="p-2">运行时</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20">
              {capabilityHealth.issues.map((issue, index) => (
                <tr key={`${issue.provider}-${issue.code}-${index}`}>
                  <td className="p-2 font-mono">{issue.provider}</td>
                  <td className="p-2 font-mono">{issue.code}</td>
                  <td className="p-2">{issue.message}</td>
                  <td className="p-2">
                    {issue.capability ? (
                      <div className="space-y-1 font-mono">
                        <p>flows: {formatFlows(issue.capability.flows)}</p>
                        <p>manual: {String(issue.capability.supportsManualCallback)}</p>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-2">
                    {issue.runtime ? (
                      <div className="space-y-1 font-mono">
                        <p>start: {formatFlows(issue.runtime.startFlows)}</p>
                        <p>poll: {formatFlows(issue.runtime.pollFlows)}</p>
                        <p>manual: {String(issue.runtime.supportsManualCallback)}</p>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
