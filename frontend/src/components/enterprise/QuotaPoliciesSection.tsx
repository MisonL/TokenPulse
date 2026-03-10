import { Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { OrgProjectItem, QuotaPolicyItem } from "../../lib/client";
import { TableFeedbackRow } from "./EnterpriseSectionFeedback";
import type {
  EnterprisePolicyCreateFormState,
  EnterprisePolicyEditFormState,
} from "../../pages/enterprisePolicyEditors";

interface QuotaPoliciesSectionProps {
  sectionId?: string;
  policies: QuotaPolicyItem[];
  orgProjects?: OrgProjectItem[];
  scopeTypeFilter: "" | QuotaPolicyItem["scopeType"];
  scopeValueFilter: string;
  setScopeTypeFilter: Dispatch<SetStateAction<"" | QuotaPolicyItem["scopeType"]>>;
  setScopeValueFilter: Dispatch<SetStateAction<string>>;
  createForm: EnterprisePolicyCreateFormState;
  editForm: EnterprisePolicyEditFormState;
  editingPolicyId: string | null;
  onCreateFormChange: (patch: Partial<EnterprisePolicyCreateFormState>) => void;
  onEditFormChange: (patch: Partial<EnterprisePolicyEditFormState>) => void;
  onCreate: () => void;
  onStartEdit: (policy: QuotaPolicyItem) => void;
  onSaveEdit: (policy: QuotaPolicyItem) => void;
  onCancelEdit: () => void;
  onRemove: (policy: QuotaPolicyItem) => void;
  onJumpToUsageByPolicy?: (policyId: string) => void;
  onJumpToAuditByPolicy?: (policyId: string) => void;
}

export function QuotaPoliciesSection({
  sectionId = "quota-policies-section",
  policies,
  orgProjects,
  scopeTypeFilter,
  scopeValueFilter,
  setScopeTypeFilter,
  setScopeValueFilter,
  createForm,
  editForm,
  editingPolicyId,
  onCreateFormChange,
  onEditFormChange,
  onCreate,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
  onJumpToUsageByPolicy,
  onJumpToAuditByPolicy,
}: QuotaPoliciesSectionProps) {
  const projectIdDatalistId = `${sectionId}-project-id-options`;
  const orgProjectIdOptions = Array.from(
    new Set(
      (orgProjects || [])
        .map((project) => project.id.trim())
        .filter((value) => value),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const orgProjectIdSet = new Set(orgProjectIdOptions);
  const fallbackProjectIdOptions = Array.from(
    new Set(
      policies
        .filter((policy) => policy.scopeType === "project")
        .map((policy) => (policy.scopeValue || "").trim())
        .filter((value) => value && !orgProjectIdSet.has(value)),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const projectIdOptions = [...orgProjectIdOptions, ...fallbackProjectIdOptions];

  const trimmedScopeValueFilter = scopeValueFilter.trim();
  const normalizedScopeValueFilter = trimmedScopeValueFilter.toLowerCase();
  const filteredPolicies = policies.filter((policy) => {
    if (scopeTypeFilter && policy.scopeType !== scopeTypeFilter) return false;
    if (!normalizedScopeValueFilter) return true;
    const normalizedScopeValue = (policy.scopeValue || "").trim().toLowerCase();
    return normalizedScopeValue === normalizedScopeValueFilter;
  });
  const filterSummary = [
    scopeTypeFilter ? `scopeType=${scopeTypeFilter}` : null,
    trimmedScopeValueFilter ? `scopeValue=${trimmedScopeValueFilter}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("，");

  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow space-y-4">
      <h3 className="text-2xl font-black uppercase">配额策略管理</h3>
      <datalist id={projectIdDatalistId}>
        {projectIdOptions.map((projectId) => (
          <option key={projectId} value={projectId} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          className="b-input h-10"
          placeholder="策略名"
          value={createForm.name}
          onChange={(e) => onCreateFormChange({ name: e.target.value })}
        />
        <select
          className="b-input h-10"
          value={createForm.scopeType}
          onChange={(e) => {
            const nextScopeType = e.target.value as QuotaPolicyItem["scopeType"];
            onCreateFormChange({
              scopeType: nextScopeType,
              scopeValue: nextScopeType === "global" ? "" : createForm.scopeValue,
            });
          }}
        >
          <option value="global">global</option>
          <option value="tenant">tenant</option>
          <option value="project">project</option>
          <option value="role">role</option>
          <option value="user">user</option>
        </select>
        <input
          className="b-input h-10"
          placeholder={
            createForm.scopeType === "global"
              ? "scopeValue（global 必须留空）"
              : createForm.scopeType === "project"
                ? "projectId（必填，可输入或选择）"
                : "scopeValue（必填）"
          }
          disabled={createForm.scopeType === "global"}
          value={createForm.scopeValue}
          list={createForm.scopeType === "project" ? projectIdDatalistId : undefined}
          onChange={(e) => onCreateFormChange({ scopeValue: e.target.value })}
        />
        <input
          className="b-input h-10"
          placeholder="provider（可选）"
          value={createForm.provider}
          onChange={(e) => onCreateFormChange({ provider: e.target.value })}
        />
        <input
          className="b-input h-10"
          placeholder="modelPattern（可选）"
          value={createForm.modelPattern}
          onChange={(e) => onCreateFormChange({ modelPattern: e.target.value })}
        />
        <input
          className="b-input h-10"
          type="number"
          min={0}
          placeholder="RPM"
          value={createForm.requestsPerMinute}
          onChange={(e) => onCreateFormChange({ requestsPerMinute: e.target.value })}
        />
        <input
          className="b-input h-10"
          type="number"
          min={0}
          placeholder="TPM"
          value={createForm.tokensPerMinute}
          onChange={(e) => onCreateFormChange({ tokensPerMinute: e.target.value })}
        />
        <input
          className="b-input h-10"
          type="number"
          min={0}
          placeholder="TPD"
          value={createForm.tokensPerDay}
          onChange={(e) => onCreateFormChange({ tokensPerDay: e.target.value })}
        />
      </div>
      <label className="inline-flex items-center gap-2 text-xs font-bold">
        <input
          type="checkbox"
          checked={createForm.enabled}
          onChange={(e) => onCreateFormChange({ enabled: e.target.checked })}
        />
        启用策略
      </label>
      <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={onCreate}>
        创建配额策略
      </button>

      <div className="flex flex-wrap items-center gap-2 border-2 border-black bg-[#F3F4F6] p-3">
        <select
          className="b-input h-10 w-40"
          value={scopeTypeFilter}
          onChange={(e) => setScopeTypeFilter(e.target.value as "" | QuotaPolicyItem["scopeType"])}
        >
          <option value="">全部范围</option>
          <option value="global">global</option>
          <option value="tenant">tenant</option>
          <option value="project">project</option>
          <option value="role">role</option>
          <option value="user">user</option>
        </select>
        <input
          className="b-input h-10 w-72"
          placeholder="scopeValue 精确匹配（忽略大小写，可留空）"
          value={scopeValueFilter}
          onChange={(e) => setScopeValueFilter(e.target.value)}
        />
        <button
          className="b-btn bg-white text-xs"
          type="button"
          onClick={() => {
            setScopeTypeFilter("");
            setScopeValueFilter("");
          }}
        >
          清空筛选
        </button>
        <p className="ml-auto text-xs font-bold text-gray-600">
          显示 {filteredPolicies.length}/{policies.length} 条
        </p>
      </div>

      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-black text-white text-xs uppercase">
            <tr>
              <th className="p-2">策略</th>
              <th className="p-2">范围</th>
              <th className="p-2">限制</th>
              <th className="p-2">状态</th>
              <th className="p-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20">
            {filteredPolicies.map((policy) => (
              <tr key={policy.id}>
                <td className="p-2">
                  {editingPolicyId === policy.id ? (
                    <div className="space-y-2">
                      <input
                        className="b-input h-8 text-xs"
                        value={editForm.name}
                        onChange={(e) => onEditFormChange({ name: e.target.value })}
                        placeholder="策略名"
                      />
                      <p className="font-mono text-xs text-gray-500">{policy.id}</p>
                    </div>
                  ) : (
                    <>
                      <p className="font-bold">{policy.name}</p>
                      <p className="font-mono text-xs text-gray-500">{policy.id}</p>
                    </>
                  )}
                </td>
                <td className="p-2 font-mono text-xs">
                  {editingPolicyId === policy.id ? (
                    <div className="grid grid-cols-1 gap-2">
                      <select
                        className="b-input h-8 text-xs"
                        value={editForm.scopeType}
                        onChange={(e) => {
                          const nextScopeType = e.target.value as QuotaPolicyItem["scopeType"];
                          onEditFormChange({
                            scopeType: nextScopeType,
                            scopeValue: nextScopeType === "global" ? "" : editForm.scopeValue,
                          });
                        }}
                      >
                        <option value="global">global</option>
                        <option value="tenant">tenant</option>
                        <option value="project">project</option>
                        <option value="role">role</option>
                        <option value="user">user</option>
                      </select>
                      <input
                        className="b-input h-8 text-xs"
                        value={editForm.scopeValue}
                        disabled={editForm.scopeType === "global"}
                        list={editForm.scopeType === "project" ? projectIdDatalistId : undefined}
                        onChange={(e) => onEditFormChange({ scopeValue: e.target.value })}
                        placeholder={
                          editForm.scopeType === "global"
                            ? "scopeValue（global 必须留空）"
                            : editForm.scopeType === "project"
                              ? "projectId（必填，可输入或选择）"
                            : "scopeValue（必填）"
                        }
                      />
                      <input
                        className="b-input h-8 text-xs"
                        value={editForm.provider}
                        onChange={(e) => onEditFormChange({ provider: e.target.value })}
                        placeholder="provider（可选）"
                      />
                      <input
                        className="b-input h-8 text-xs"
                        value={editForm.modelPattern}
                        onChange={(e) => onEditFormChange({ modelPattern: e.target.value })}
                        placeholder="modelPattern（可选）"
                      />
                    </div>
                  ) : (
                    <>
                      {policy.scopeType}
                      {policy.scopeValue ? `:${policy.scopeValue}` : ""}
                      {(policy.provider || policy.modelPattern) && (
                        <div className="mt-1 space-y-1 text-[11px] text-gray-500">
                          <div>provider: {policy.provider || "-"}</div>
                          <div>model: {policy.modelPattern || "-"}</div>
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="p-2 text-xs">
                  {editingPolicyId === policy.id ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input
                        className="b-input h-8 text-xs"
                        type="number"
                        min={0}
                        value={editForm.requestsPerMinute}
                        onChange={(e) => onEditFormChange({ requestsPerMinute: e.target.value })}
                        placeholder="RPM"
                      />
                      <input
                        className="b-input h-8 text-xs"
                        type="number"
                        min={0}
                        value={editForm.tokensPerMinute}
                        onChange={(e) => onEditFormChange({ tokensPerMinute: e.target.value })}
                        placeholder="TPM"
                      />
                      <input
                        className="b-input h-8 text-xs"
                        type="number"
                        min={0}
                        value={editForm.tokensPerDay}
                        onChange={(e) => onEditFormChange({ tokensPerDay: e.target.value })}
                        placeholder="TPD"
                      />
                    </div>
                  ) : (
                    <>
                      RPM {policy.requestsPerMinute ?? "-"} / TPM {policy.tokensPerMinute ?? "-"} / TPD{" "}
                      {policy.tokensPerDay ?? "-"}
                    </>
                  )}
                </td>
                <td className="p-2">
                  {editingPolicyId === policy.id ? (
                    <label className="inline-flex items-center gap-2 text-xs font-bold">
                      <input
                        type="checkbox"
                        checked={editForm.enabled}
                        onChange={(e) => onEditFormChange({ enabled: e.target.checked })}
                      />
                      启用
                    </label>
                  ) : policy.enabled ? (
                    "启用"
                  ) : (
                    "停用"
                  )}
                </td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-2">
                    {editingPolicyId === policy.id ? (
                      <>
                        <button className="b-btn bg-[#FFD500] text-xs" onClick={() => onSaveEdit(policy)}>
                          保存
                        </button>
                        <button className="b-btn bg-white text-xs" onClick={onCancelEdit}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        {onJumpToUsageByPolicy ? (
                          <button
                            className="b-btn bg-white text-xs"
                            onClick={() => onJumpToUsageByPolicy(policy.id)}
                          >
                            用量
                          </button>
                        ) : null}
                        {onJumpToAuditByPolicy ? (
                          <button
                            className="b-btn bg-white text-xs"
                            onClick={() => onJumpToAuditByPolicy(policy.id)}
                          >
                            审计
                          </button>
                        ) : null}
                        <button className="b-btn bg-white text-xs" onClick={() => onStartEdit(policy)}>
                          编辑
                        </button>
                        <button className="b-btn bg-white text-xs" onClick={() => onRemove(policy)}>
                          <Trash2 className="w-3 h-3" />
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredPolicies.length === 0 ? (
              <TableFeedbackRow
                colSpan={5}
                emptyMessage={
                  policies.length === 0
                    ? "暂无配额策略"
                    : filterSummary
                      ? `未找到匹配的配额策略（${filterSummary}），请调整筛选条件或点击“清空筛选”。`
                      : "未找到匹配的配额策略，请调整筛选条件或点击“清空筛选”。"
                }
              />
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
