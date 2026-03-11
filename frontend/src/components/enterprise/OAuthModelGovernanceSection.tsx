import type { OAuthExcludedModelsPayload, OAuthModelAliasPayload } from "../../lib/client";
import { countModelAliasEntries } from "../../pages/enterpriseGovernance";

interface OAuthModelGovernanceSectionProps {
  sectionId?: string;
  actionBusy: boolean;
  modelAlias: OAuthModelAliasPayload;
  modelAliasText: string;
  modelAliasSaving: boolean;
  modelAliasApiAvailable: boolean;
  modelAliasDirty?: boolean;
  excludedModels: OAuthExcludedModelsPayload;
  excludedModelsText: string;
  excludedModelsSaving: boolean;
  excludedModelsApiAvailable: boolean;
  excludedModelsDirty?: boolean;
  onRefreshModelAlias: () => void;
  onRefreshExcludedModels: () => void;
  onModelAliasTextChange: (value: string) => void;
  onExcludedModelsTextChange: (value: string) => void;
  onSaveModelAlias: () => void;
  onSaveExcludedModels: () => void;
}

export function OAuthModelGovernanceSection({
  sectionId,
  actionBusy,
  modelAlias,
  modelAliasText,
  modelAliasSaving,
  modelAliasApiAvailable,
  modelAliasDirty = false,
  excludedModels,
  excludedModelsText,
  excludedModelsSaving,
  excludedModelsApiAvailable,
  excludedModelsDirty = false,
  onRefreshModelAlias,
  onRefreshExcludedModels,
  onModelAliasTextChange,
  onExcludedModelsTextChange,
  onSaveModelAlias,
  onSaveExcludedModels,
}: OAuthModelGovernanceSectionProps) {
  return (
    <section
      id={sectionId}
      className="bg-white border-4 border-black p-6 b-shadow space-y-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-black uppercase">OAuth 模型治理</h3>
          <p className="text-xs font-bold text-gray-500">
            维护模型别名与禁用模型列表，规则会作用于 <code>/v1/chat/completions</code>、
            <code>/v1/messages</code> 与 <code>/api/models</code>。
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="b-btn bg-white text-xs"
            disabled={actionBusy}
            onClick={onRefreshModelAlias}
          >
            刷新别名规则
          </button>
          <button
            className="b-btn bg-white text-xs"
            disabled={actionBusy}
            onClick={onRefreshExcludedModels}
          >
            刷新禁用模型
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="border-2 border-black p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-black uppercase">模型别名规则</h4>
              <p className="text-[10px] font-bold text-gray-500">
                当前别名条目：{countModelAliasEntries(modelAlias)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!modelAliasApiAvailable ? (
                <span className="text-[10px] font-bold text-amber-700">接口未开放</span>
              ) : null}
              {modelAliasDirty ? (
                <span className="text-[10px] font-black uppercase text-amber-700">
                  已修改
                </span>
              ) : null}
            </div>
          </div>
          <p className="text-xs font-bold text-gray-500">
            支持全局平铺映射和按 Provider 分组对象，例如{" "}
            <code>{`{ "claude": { "sonnet": "claude:claude-3-7-sonnet" } }`}</code>。
          </p>
          <textarea
            className="b-input min-h-[220px] w-full font-mono text-xs"
            disabled={!modelAliasApiAvailable || modelAliasSaving}
            value={modelAliasText}
            onChange={(e) => onModelAliasTextChange(e.target.value)}
          />
          <div className="flex gap-3">
            <button
              className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
              disabled={!modelAliasApiAvailable || modelAliasSaving}
              onClick={onSaveModelAlias}
            >
              {modelAliasSaving ? "保存中..." : "保存别名规则"}
            </button>
            <button
              className="b-btn bg-white"
              disabled={modelAliasSaving}
              onClick={onRefreshModelAlias}
            >
              从服务端刷新
            </button>
          </div>
        </div>

        <div className="border-2 border-black p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-black uppercase">禁用模型列表</h4>
              <p className="text-[10px] font-bold text-gray-500">
                当前禁用模型：{Array.isArray(excludedModels) ? excludedModels.length : 0}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!excludedModelsApiAvailable ? (
                <span className="text-[10px] font-bold text-amber-700">接口未开放</span>
              ) : null}
              {excludedModelsDirty ? (
                <span className="text-[10px] font-black uppercase text-amber-700">
                  已修改
                </span>
              ) : null}
            </div>
          </div>
          <p className="text-xs font-bold text-gray-500">
            一行一个模型，建议直接使用 <code>provider:model</code> 命名空间形式。
          </p>
          <textarea
            className="b-input min-h-[220px] w-full font-mono text-xs"
            disabled={!excludedModelsApiAvailable || excludedModelsSaving}
            placeholder={"claude:legacy-model\ngemini:test-model"}
            value={excludedModelsText}
            onChange={(e) => onExcludedModelsTextChange(e.target.value)}
          />
          <div className="flex gap-3">
            <button
              className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
              disabled={!excludedModelsApiAvailable || excludedModelsSaving}
              onClick={onSaveExcludedModels}
            >
              {excludedModelsSaving ? "保存中..." : "保存禁用模型"}
            </button>
            <button
              className="b-btn bg-white"
              disabled={excludedModelsSaving}
              onClick={onRefreshExcludedModels}
            >
              从服务端刷新
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
