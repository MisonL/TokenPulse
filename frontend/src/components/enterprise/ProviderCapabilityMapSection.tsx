import type { ProviderCapabilityMapData } from "../../lib/client";

interface ProviderCapabilityMapSectionProps {
  sectionId?: string;
  capabilityMap: ProviderCapabilityMapData;
  capabilityMapText: string;
  isDirty?: boolean;
  onCapabilityMapTextChange: (value: string) => void;
  onSave: () => void;
  onRefreshFromServer: () => void;
}

export function ProviderCapabilityMapSection({
  sectionId,
  capabilityMap,
  capabilityMapText,
  isDirty = false,
  onCapabilityMapTextChange,
  onSave,
  onRefreshFromServer,
}: ProviderCapabilityMapSectionProps) {
  return (
    <section
      id={sectionId}
      className="bg-white border-4 border-black p-6 b-shadow"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-2xl font-black uppercase">Provider 能力图谱</h3>
        {isDirty ? (
          <span className="rounded-full border-2 border-black px-2 py-1 text-[10px] font-black uppercase text-amber-700">
            已修改，尚未保存
          </span>
        ) : null}
      </div>
      <p className="text-xs font-bold text-gray-500 mb-3">
        直接编辑 JSON，可用于声明每个 Provider 的 flow/chat/model/stream/manualCallback 能力。
      </p>
      <p className="text-xs font-bold text-gray-500 mb-3">
        当前已配置 Provider 数量：{Object.keys(capabilityMap).length}
      </p>
      <textarea
        className="b-input min-h-[220px] w-full font-mono text-xs"
        value={capabilityMapText}
        onChange={(e) => onCapabilityMapTextChange(e.target.value)}
      />
      <div className="flex gap-3 mt-3">
        <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={onSave}>
          保存能力图谱
        </button>
        <button className="b-btn bg-white" onClick={onRefreshFromServer}>
          从服务端刷新
        </button>
      </div>
    </section>
  );
}
