import { RefreshCw, X } from "lucide-react";
import type {
  OrgOrganizationOverviewData,
  OrgProjectOverviewData,
} from "../../pages/enterpriseOrgAdapters";

interface OrgEntityOverviewBaseProps {
  sectionId?: string;
  kind: "organization" | "project";
  entityId: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onFilterProjects?: (organizationId: string) => void;
  onJumpToAudit?: (options: { resource: string; resourceId: string; keyword?: string }) => void;
  onJumpToUsage?: (projectId: string) => void;
  onPrefillQuotaPolicy?: (projectId: string) => void;
}

type OrgEntityOverviewCardProps =
  | (OrgEntityOverviewBaseProps & {
      kind: "organization";
      overview: OrgOrganizationOverviewData | null;
    })
  | (OrgEntityOverviewBaseProps & {
      kind: "project";
      overview: OrgProjectOverviewData | null;
    });

export function OrgEntityOverviewCard({
  sectionId = "org-entity-overview-card",
  kind,
  entityId,
  loading,
  error,
  overview,
  onClose,
  onRefresh,
  onFilterProjects,
  onJumpToAudit,
  onJumpToUsage,
  onPrefillQuotaPolicy,
}: OrgEntityOverviewCardProps) {
  const title = kind === "organization" ? "组织概览" : "项目概览";

  const resolvedResource = kind === "organization" ? "organization" : "project";
  const resolvedResourceId =
    kind === "organization" ? overview?.organization.id || entityId : overview?.project.id || entityId;
  const resolvedKeyword =
    kind === "organization" ? overview?.organization.name : overview?.project.name;

  const organizationIdForProjectFilter =
    kind === "organization" ? overview?.organization.id || entityId : overview?.organization.id || "";

  const projectIdForActions = kind === "project" ? overview?.project.id || entityId : "";

  return (
    <section
      id={sectionId}
      className="border-2 border-black bg-[#F3F4F6] p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase">{title}</p>
          <p className="text-[10px] font-mono text-gray-600 truncate">
            {resolvedResource}:{resolvedResourceId}
            {kind === "project" && overview?.organization?.id
              ? ` · org:${overview.organization.id}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="b-btn bg-white text-xs"
            disabled={loading}
            onClick={onRefresh}
            title="刷新概览"
          >
            <RefreshCw className="w-3 h-3" />
            刷新
          </button>
          <button className="b-btn bg-white text-xs" onClick={onClose} title="关闭概览">
            <X className="w-3 h-3" />
            关闭
          </button>
        </div>
      </div>

      {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
      {loading ? <p className="text-xs font-bold text-gray-600">概览加载中...</p> : null}

      {overview ? (
        kind === "organization" ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">项目</p>
              <p className="text-2xl font-black">{overview.projects.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{overview.projects.active} D:{overview.projects.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">成员</p>
              <p className="text-2xl font-black">{overview.members.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{overview.members.active} D:{overview.members.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">绑定</p>
              <p className="text-2xl font-black">{overview.bindings.total}</p>
              <p className="text-[10px] font-mono text-gray-600">member-project</p>
            </div>
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">组织</p>
              <p className="text-sm font-black truncate">{overview.organization.name}</p>
              <p className="text-[10px] font-mono text-gray-600 truncate">
                {overview.organization.id} · {overview.organization.status}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">绑定</p>
              <p className="text-2xl font-black">{overview.bindings.total}</p>
              <p className="text-[10px] font-mono text-gray-600">member-project</p>
            </div>
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">绑定成员</p>
              <p className="text-2xl font-black">{overview.bindings.members}</p>
              <p className="text-[10px] font-mono text-gray-600">distinct members</p>
            </div>
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">项目</p>
              <p className="text-sm font-black truncate">{overview.project.name}</p>
              <p className="text-[10px] font-mono text-gray-600 truncate">
                {overview.project.id} · {overview.project.status}
              </p>
            </div>
            <div className="border-2 border-black p-3 bg-white">
              <p className="text-[10px] uppercase text-gray-600">组织</p>
              <p className="text-sm font-black truncate">{overview.organization.name}</p>
              <p className="text-[10px] font-mono text-gray-600 truncate">
                {overview.organization.id} · {overview.organization.status}
              </p>
            </div>
          </div>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {kind === "organization" && onFilterProjects ? (
          <button
            className="b-btn bg-white text-xs"
            disabled={loading}
            onClick={() => onFilterProjects(organizationIdForProjectFilter)}
          >
            筛选项目
          </button>
        ) : null}

        {onJumpToAudit ? (
          <button
            className="b-btn bg-white text-xs"
            disabled={loading}
            onClick={() =>
              onJumpToAudit({
                resource: resolvedResource,
                resourceId: resolvedResourceId,
                keyword: resolvedKeyword,
              })
            }
          >
            查看审计
          </button>
        ) : null}

        {kind === "project" && onJumpToUsage ? (
          <button
            className="b-btn bg-white text-xs"
            disabled={loading}
            onClick={() => onJumpToUsage(projectIdForActions)}
          >
            查看用量
          </button>
        ) : null}

        {kind === "project" && onPrefillQuotaPolicy ? (
          <button
            className="b-btn bg-[#FFD500] hover:bg-[#ffe033] text-xs"
            disabled={loading}
            onClick={() => onPrefillQuotaPolicy(projectIdForActions)}
          >
            预填配额策略
          </button>
        ) : null}
      </div>
    </section>
  );
}
