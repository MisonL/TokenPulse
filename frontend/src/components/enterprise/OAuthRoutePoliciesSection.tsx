import type {
  RouteExecutionPolicyData,
  SelectionPolicyData,
} from "../../lib/client";

interface OAuthRoutePoliciesSectionProps {
  sectionId?: string;
  selectionPolicy: SelectionPolicyData | null;
  routeExecutionPolicy: RouteExecutionPolicyData | null;
  onSelectionPolicyChange: (
    updater: (prev: SelectionPolicyData | null) => SelectionPolicyData | null,
  ) => void;
  onRouteExecutionPolicyChange: (
    updater: (prev: RouteExecutionPolicyData | null) => RouteExecutionPolicyData | null,
  ) => void;
  onSave: () => void;
}

export function OAuthRoutePoliciesSection({
  sectionId,
  selectionPolicy,
  routeExecutionPolicy,
  onSelectionPolicyChange,
  onRouteExecutionPolicyChange,
  onSave,
}: OAuthRoutePoliciesSectionProps) {
  return (
    <section
      id={sectionId}
      className="bg-white border-4 border-black p-6 b-shadow"
    >
      <h3 className="text-2xl font-black uppercase mb-3">OAuth 路由与执行策略</h3>
      {!selectionPolicy || !routeExecutionPolicy ? (
        <p className="text-sm font-bold text-gray-500">暂无策略配置</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs font-bold uppercase text-gray-500">
              默认策略
              <select
                className="b-input h-10 w-full mt-1"
                value={selectionPolicy.defaultPolicy}
                onChange={(e) =>
                  onSelectionPolicyChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          defaultPolicy: e.target.value as SelectionPolicyData["defaultPolicy"],
                        }
                      : prev,
                  )
                }
              >
                <option value="round_robin">round_robin</option>
                <option value="latest_valid">latest_valid</option>
                <option value="sticky_user">sticky_user</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              失败冷却秒数
              <input
                type="number"
                min={0}
                className="b-input h-10 w-full mt-1"
                value={selectionPolicy.failureCooldownSec}
                onChange={(e) =>
                  onSelectionPolicyChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          failureCooldownSec: Number.parseInt(e.target.value || "0", 10) || 0,
                        }
                      : prev,
                  )
                }
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              失败跨账号重试次数
              <input
                type="number"
                min={0}
                className="b-input h-10 w-full mt-1"
                value={selectionPolicy.maxRetryOnAccountFailure}
                onChange={(e) =>
                  onSelectionPolicyChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          maxRetryOnAccountFailure:
                            Number.parseInt(e.target.value || "0", 10) || 0,
                        }
                      : prev,
                  )
                }
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs font-bold uppercase text-gray-500">
              账号失败重试状态码（逗号分隔）
              <input
                type="text"
                className="b-input h-10 w-full mt-1"
                value={routeExecutionPolicy.retryStatusCodes.join(",")}
                onChange={(e) =>
                  onRouteExecutionPolicyChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          retryStatusCodes: e.target.value
                            .split(",")
                            .map((item) => Number.parseInt(item.trim(), 10))
                            .filter(
                              (item) => Number.isInteger(item) && item >= 100 && item <= 599,
                            ),
                        }
                      : prev,
                  )
                }
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              Claude bridge 回退状态码（逗号分隔）
              <input
                type="text"
                className="b-input h-10 w-full mt-1"
                value={routeExecutionPolicy.claudeFallbackStatusCodes.join(",")}
                onChange={(e) =>
                  onRouteExecutionPolicyChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          claudeFallbackStatusCodes: e.target.value
                            .split(",")
                            .map((item) => Number.parseInt(item.trim(), 10))
                            .filter(
                              (item) => Number.isInteger(item) && item >= 100 && item <= 599,
                            ),
                        }
                      : prev,
                  )
                }
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 text-xs font-bold">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectionPolicy.allowHeaderOverride}
                onChange={(e) =>
                  onSelectionPolicyChange((prev) =>
                    prev ? { ...prev, allowHeaderOverride: e.target.checked } : prev,
                  )
                }
              />
              允许请求头覆盖策略
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectionPolicy.allowHeaderAccountOverride}
                onChange={(e) =>
                  onSelectionPolicyChange((prev) =>
                    prev ? { ...prev, allowHeaderAccountOverride: e.target.checked } : prev,
                  )
                }
              />
              允许请求头指定账号
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={routeExecutionPolicy.emitRouteHeaders}
                onChange={(e) =>
                  onRouteExecutionPolicyChange((prev) =>
                    prev ? { ...prev, emitRouteHeaders: e.target.checked } : prev,
                  )
                }
              />
              输出统一路由响应头
            </label>
          </div>

          <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={onSave}>
            保存路由策略
          </button>
        </div>
      )}
    </section>
  );
}
