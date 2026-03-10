import { Trash2 } from "lucide-react";
import type { OrgOrganizationItem, OrgProjectItem } from "../../lib/client";

interface OrgProjectsSectionProps {
  sectionId?: string;
  title?: string;
  writeHint?: string;
  writeDisabled: boolean;
  organizations: OrgOrganizationItem[];
  form: {
    organizationId: string;
    name: string;
  };
  filterOrganizationId: string;
  filteredProjects: OrgProjectItem[];
  resolveOrganizationDisplayName: (
    organizationId: string,
    organizations: OrgOrganizationItem[],
  ) => string;
  onFormChange: (patch: Partial<{ organizationId: string; name: string }>) => void;
  onCreate: () => void;
  onFilterOrganizationIdChange: (value: string) => void;
  onViewOverview?: (project: OrgProjectItem) => void;
  onViewUsage: (project: OrgProjectItem) => void;
  onViewAudit: (project: OrgProjectItem) => void;
  onViewStatusAudit: (project: OrgProjectItem) => void;
  onToggleStatus: (project: OrgProjectItem) => void;
  onRemove: (project: OrgProjectItem) => void;
}

export function OrgProjectsSection({
  sectionId = "org-projects-section",
  title = "项目列表",
  writeHint = "",
  writeDisabled,
  organizations,
  form,
  filterOrganizationId,
  filteredProjects,
  resolveOrganizationDisplayName,
  onFormChange,
  onCreate,
  onFilterOrganizationIdChange,
  onViewOverview,
  onViewUsage,
  onViewAudit,
  onViewStatusAudit,
  onToggleStatus,
  onRemove,
}: OrgProjectsSectionProps) {
  return (
    <div id={sectionId} className="border-2 border-black p-4 space-y-3">
      <h4 className="text-lg font-black uppercase">{title}</h4>
      {writeHint ? (
        <p className="text-[10px] font-bold text-amber-700">{writeHint}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2">
        <select
          className="b-input h-10"
          disabled={writeDisabled}
          value={form.organizationId}
          onChange={(e) => onFormChange({ organizationId: e.target.value })}
        >
          <option value="">选择组织</option>
          {organizations.map((organization) => (
            <option
              key={organization.id}
              value={organization.id}
              disabled={organization.status === "disabled"}
            >
              {organization.name} ({organization.id})
              {organization.status === "disabled" ? " · disabled" : ""}
            </option>
          ))}
        </select>
        <input
          className="b-input h-10"
          disabled={writeDisabled}
          placeholder="项目名称"
          value={form.name}
          onChange={(e) => onFormChange({ name: e.target.value })}
        />
        <button
          className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
          disabled={writeDisabled}
          onClick={onCreate}
        >
          创建项目
        </button>
      </div>

      <label className="text-xs font-bold uppercase text-gray-500 block">
        组织筛选
        <select
          className="b-input h-9 w-full mt-1"
          value={filterOrganizationId}
          onChange={(e) => onFilterOrganizationIdChange(e.target.value)}
        >
          <option value="">全部组织</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {filteredProjects.map((project) => (
          <div
            key={project.id}
            className="border-2 border-black p-3 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="font-bold truncate">{project.name}</p>
              <p className="text-[10px] font-mono text-gray-500 truncate">
                {project.id} · {resolveOrganizationDisplayName(project.organizationId, organizations)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {onViewOverview ? (
                <button className="b-btn bg-white text-xs" onClick={() => onViewOverview(project)}>
                  概览
                </button>
              ) : null}
              <button className="b-btn bg-white text-xs" onClick={() => onViewUsage(project)}>
                查看用量
              </button>
              <button className="b-btn bg-white text-xs" onClick={() => onViewAudit(project)}>
                查看审计
              </button>
              <button className="b-btn bg-white text-xs" onClick={() => onViewStatusAudit(project)}>
                启停审计
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={writeDisabled}
                onClick={() => onToggleStatus(project)}
              >
                {project.status === "disabled" ? "启用" : "禁用"}
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={writeDisabled}
                onClick={() => onRemove(project)}
              >
                <Trash2 className="w-3 h-3" />
                删除
              </button>
            </div>
          </div>
        ))}
        {filteredProjects.length === 0 ? (
          <p className="text-xs font-bold text-gray-500">暂无项目</p>
        ) : null}
      </div>
    </div>
  );
}
