import { Gauge } from "lucide-react";
import { cn } from "../../lib/utils";

interface EnterpriseFeatureFlagsSectionProps {
  sectionId?: string;
  entries: Array<[string, boolean]>;
}

export function EnterpriseFeatureFlagsSection({
  sectionId = "enterprise-feature-flags-section",
  entries,
}: EnterpriseFeatureFlagsSectionProps) {
  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow">
      <div className="flex items-center gap-3 mb-4">
        <Gauge className="w-6 h-6" />
        <h3 className="text-2xl font-black uppercase">能力开关</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {entries.map(([key, enabled]) => (
          <div
            key={key}
            className={cn(
              "border-2 border-black p-4 flex items-center justify-between",
              enabled ? "bg-emerald-50" : "bg-gray-100",
            )}
          >
            <span className="font-bold uppercase text-xs tracking-wider">{key}</span>
            <span className={cn("text-xs font-black", enabled ? "text-emerald-700" : "text-gray-500")}>
              {enabled ? "已启用" : "未启用"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
