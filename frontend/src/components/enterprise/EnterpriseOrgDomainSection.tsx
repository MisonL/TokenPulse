import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import type { OrgOverviewData } from "../../lib/client";

interface EnterpriseOrgDomainSectionProps {
  sectionId?: string;
  loading: boolean;
  error: string;
  summaryText: string;
  readOnlyBanner?: string;
  overview: OrgOverviewData | null;
  overviewFromFallback: boolean;
  readOnlyFallback: boolean;
  overviewFallbackHint?: string;
  entityOverviewSlot?: ReactNode;
  onRefresh: () => void;
  children?: ReactNode;
}

export function EnterpriseOrgDomainSection({
  sectionId = "enterprise-org-domain-section",
  loading,
  error,
  summaryText,
  readOnlyBanner = "",
  overview,
  overviewFromFallback,
  readOnlyFallback,
  overviewFallbackHint = "",
  entityOverviewSlot,
  onRefresh,
  children,
}: EnterpriseOrgDomainSectionProps) {
  const quotaPoliciesTip = (() => {
    if (!overview) return "";
    const { total, enabled } = overview.quotaPolicies;
    if (total === 0) return "暂无配额策略";
    if (enabled === 0) return `已创建 ${total} 条，但当前均未启用`;
    return "";
  })();

  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="w-6 h-6" />
          <h3 className="text-2xl font-black uppercase">组织 / 项目 / 成员绑定</h3>
        </div>
        <button className="b-btn bg-white" disabled={loading} onClick={onRefresh}>
          {loading ? "刷新中..." : "刷新组织域"}
        </button>
      </div>

      {error ? (
        <p className="text-xs font-bold text-red-700">{error}</p>
      ) : (
        <p className="text-xs font-bold text-gray-500">{summaryText}</p>
      )}

      {readOnlyBanner ? (
        <p className="text-xs font-bold text-amber-700">{readOnlyBanner}</p>
      ) : null}

      {overview ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border-2 border-black p-3 bg-[#FFD500]/20">
              <p className="text-[10px] uppercase text-gray-600">组织</p>
              <p className="text-2xl font-black">{overview.organizations.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{overview.organizations.active} D:{overview.organizations.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">项目</p>
              <p className="text-2xl font-black">{overview.projects.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{overview.projects.active} D:{overview.projects.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">成员</p>
              <p className="text-2xl font-black">{overview.members.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{overview.members.active} D:{overview.members.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">绑定</p>
              <p className="text-2xl font-black">{overview.bindings.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                来源:{overviewFromFallback ? "fallback" : "overview"} · 模式:
                {readOnlyFallback ? "readonly" : "api"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-700">
            <span className="font-mono">
              配额策略（项目）：{overview.quotaPolicies.enabled}/{overview.quotaPolicies.total}
            </span>
            {quotaPoliciesTip ? <span className="text-gray-500">{quotaPoliciesTip}</span> : null}
          </div>
        </>
      ) : null}

      {overviewFallbackHint ? (
        <p className="text-[10px] font-bold text-gray-500">{overviewFallbackHint}</p>
      ) : null}

      {entityOverviewSlot ? <div>{entityOverviewSlot}</div> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">{children}</div>
    </section>
  );
}
