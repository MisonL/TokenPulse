import { Trash2 } from "lucide-react";
import type { OrgOrganizationItem } from "../../lib/client";

interface OrgOrganizationsSectionProps {
  title?: string;
  writeHint?: string;
  writeDisabled: boolean;
  organizations: OrgOrganizationItem[];
  formName: string;
  onFormNameChange: (value: string) => void;
  onCreate: () => void;
  onViewAudit: (organization: OrgOrganizationItem) => void;
  onViewStatusAudit: (organization: OrgOrganizationItem) => void;
  onToggleStatus: (organization: OrgOrganizationItem) => void;
  onRemove: (organization: OrgOrganizationItem) => void;
}

export function OrgOrganizationsSection({
  title = "组织列表",
  writeHint = "",
  writeDisabled,
  organizations,
  formName,
  onFormNameChange,
  onCreate,
  onViewAudit,
  onViewStatusAudit,
  onToggleStatus,
  onRemove,
}: OrgOrganizationsSectionProps) {
  return (
    <div className="border-2 border-black p-4 space-y-3">
      <h4 className="text-lg font-black uppercase">{title}</h4>
      {writeHint ? (
        <p className="text-[10px] font-bold text-amber-700">{writeHint}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        <input
          className="b-input h-10"
          disabled={writeDisabled}
          placeholder="组织名称"
          value={formName}
          onChange={(e) => onFormNameChange(e.target.value)}
        />
        <button
          className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
          disabled={writeDisabled}
          onClick={onCreate}
        >
          创建组织
        </button>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {organizations.map((organization) => (
          <div
            key={organization.id}
            className="border-2 border-black p-3 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="font-bold truncate">{organization.name}</p>
              <p className="text-[10px] font-mono text-gray-500 truncate">
                {organization.id} · {organization.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="b-btn bg-white text-xs" onClick={() => onViewAudit(organization)}>
                查看审计
              </button>
              <button
                className="b-btn bg-white text-xs"
                onClick={() => onViewStatusAudit(organization)}
              >
                启停审计
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={writeDisabled}
                onClick={() => onToggleStatus(organization)}
              >
                {organization.status === "disabled" ? "启用" : "禁用"}
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={writeDisabled}
                onClick={() => onRemove(organization)}
              >
                <Trash2 className="w-3 h-3" />
                删除
              </button>
            </div>
          </div>
        ))}
        {organizations.length === 0 ? (
          <p className="text-xs font-bold text-gray-500">暂无组织</p>
        ) : null}
      </div>
    </div>
  );
}
