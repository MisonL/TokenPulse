import type { Dispatch, SetStateAction } from "react";
import type {
  OAuthAlertCenterConfigPayload,
  OAuthAlertDeliveryQueryResult,
  OAuthAlertIncidentQueryResult,
  OAuthAlertRuleVersionListResult,
  OAuthAlertRuleVersionSummaryItem,
} from "../../lib/client";
import { cn } from "../../lib/utils";
import type { OAuthAlertRuleStructuredDraft } from "../../pages/enterpriseControlEditors";
import { SectionErrorBanner } from "./EnterpriseSectionFeedback";

interface OAuthAlertManualEvaluateFormValue {
  provider: string;
}

interface OAuthAlertCenterSectionProps {
  sectionId?: string;
  apiAvailable: boolean;
  sectionError?: string;
  config: OAuthAlertCenterConfigPayload;
  configSaving: boolean;
  evaluateForm: OAuthAlertManualEvaluateFormValue;
  evaluating: boolean;
  lastEvaluateResult: string;
  incidents: OAuthAlertIncidentQueryResult | null;
  deliveries: OAuthAlertDeliveryQueryResult | null;
  incidentProviderFilter: string;
  incidentPhaseFilter: string;
  incidentSeverityFilter: "" | "critical" | "warning" | "recovery";
  incidentFromFilter: string;
  incidentToFilter: string;
  deliveryIncidentIdFilter: string;
  deliveryEventIdFilter: string;
  deliveryChannelFilter: string;
  deliveryStatusFilter: "" | "success" | "failure";
  deliveryFromFilter: string;
  deliveryToFilter: string;
  activeVersion: OAuthAlertRuleVersionSummaryItem | null;
  versions: OAuthAlertRuleVersionListResult | null;
  rulePageLoading: boolean;
  rulePageInput: string;
  ruleActionBusy: boolean;
  ruleCreating: boolean;
  ruleRollingVersionId: number | null;
  useStructuredRuleEditor: boolean;
  ruleCreateText: string;
  ruleStructuredDraft: OAuthAlertRuleStructuredDraft;
  setConfig: Dispatch<SetStateAction<OAuthAlertCenterConfigPayload>>;
  setEvaluateForm: Dispatch<SetStateAction<OAuthAlertManualEvaluateFormValue>>;
  setIncidentProviderFilter: Dispatch<SetStateAction<string>>;
  setIncidentPhaseFilter: Dispatch<SetStateAction<string>>;
  setIncidentSeverityFilter: Dispatch<SetStateAction<"" | "critical" | "warning" | "recovery">>;
  setIncidentFromFilter: Dispatch<SetStateAction<string>>;
  setIncidentToFilter: Dispatch<SetStateAction<string>>;
  setDeliveryIncidentIdFilter: Dispatch<SetStateAction<string>>;
  setDeliveryEventIdFilter: Dispatch<SetStateAction<string>>;
  setDeliveryChannelFilter: Dispatch<SetStateAction<string>>;
  setDeliveryStatusFilter: Dispatch<SetStateAction<"" | "success" | "failure">>;
  setDeliveryFromFilter: Dispatch<SetStateAction<string>>;
  setDeliveryToFilter: Dispatch<SetStateAction<string>>;
  setRulePageInput: Dispatch<SetStateAction<string>>;
  setRuleCreateText: Dispatch<SetStateAction<string>>;
  setRuleStructuredDraft: Dispatch<SetStateAction<OAuthAlertRuleStructuredDraft>>;
  onRefreshCenter: () => void;
  onSaveConfig: () => void;
  onEvaluate: () => void;
  onRefreshRules: () => void;
  onCreateRuleVersion: () => void;
  onSwitchToStructuredRuleEditor: () => void;
  onSwitchToAdvancedRuleEditor: () => void;
  onRollbackRuleVersion: (item: OAuthAlertRuleVersionSummaryItem) => void;
  onGotoRulePage: (page: number) => void;
  onInvalidRulePageInput: () => void;
  onApplyIncidentFilters: (page?: number) => void;
  onApplyDeliveryFilters: (page?: number) => void;
  onLinkIncidentToSessionEvents: (item: { provider: string; phase: string }) => void;
  onJumpToDeliveriesByIncident: (incidentId?: string | null) => void;
  onJumpToAuditByKeyword: (keyword: string) => void;
}

export function OAuthAlertCenterSection({
  sectionId,
  apiAvailable,
  sectionError = "",
  config,
  configSaving,
  evaluateForm,
  evaluating,
  lastEvaluateResult,
  incidents,
  deliveries,
  incidentProviderFilter,
  incidentPhaseFilter,
  incidentSeverityFilter,
  incidentFromFilter,
  incidentToFilter,
  deliveryIncidentIdFilter,
  deliveryEventIdFilter,
  deliveryChannelFilter,
  deliveryStatusFilter,
  deliveryFromFilter,
  deliveryToFilter,
  activeVersion,
  versions,
  rulePageLoading,
  rulePageInput,
  ruleActionBusy,
  ruleCreating,
  ruleRollingVersionId,
  useStructuredRuleEditor,
  ruleCreateText,
  ruleStructuredDraft,
  setConfig,
  setEvaluateForm,
  setIncidentProviderFilter,
  setIncidentPhaseFilter,
  setIncidentSeverityFilter,
  setIncidentFromFilter,
  setIncidentToFilter,
  setDeliveryIncidentIdFilter,
  setDeliveryEventIdFilter,
  setDeliveryChannelFilter,
  setDeliveryStatusFilter,
  setDeliveryFromFilter,
  setDeliveryToFilter,
  setRulePageInput,
  setRuleCreateText,
  setRuleStructuredDraft,
  onRefreshCenter,
  onSaveConfig,
  onEvaluate,
  onRefreshRules,
  onCreateRuleVersion,
  onSwitchToStructuredRuleEditor,
  onSwitchToAdvancedRuleEditor,
  onRollbackRuleVersion,
  onGotoRulePage,
  onInvalidRulePageInput,
  onApplyIncidentFilters,
  onApplyDeliveryFilters,
  onLinkIncidentToSessionEvents,
  onJumpToDeliveriesByIncident,
  onJumpToAuditByKeyword,
}: OAuthAlertCenterSectionProps) {
  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-2xl font-black uppercase">OAuth 告警中心</h3>
        <button className="b-btn bg-white" onClick={onRefreshCenter}>
          刷新告警中心
        </button>
      </div>

      {!apiAvailable ? (
        <p className="text-xs font-bold text-gray-500">
          当前后端未提供 <code>/api/admin/observability/oauth-alerts/*</code>
          ，告警中心面板已自动降级。
        </p>
      ) : (
        <p className="text-xs font-bold text-gray-500">
          支持阈值配置、手动评估、incident / delivery 值班追踪；点击 incident 可联动会话事件筛选。
        </p>
      )}

      <SectionErrorBanner
        title="OAuth 告警中心"
        error={sectionError}
        onRetry={onRefreshCenter}
        retryLabel="重新拉取告警中心"
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="border-2 border-black p-4 space-y-3">
          <h4 className="text-lg font-black uppercase">告警配置（引擎 + 投递抑制）</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-xs font-bold uppercase text-gray-500">
              warningRateThresholdBps
              <input className="b-input h-9 mt-1" type="number" min={1} value={config.warningRateThresholdBps} onChange={(e) => setConfig((prev) => ({ ...prev, warningRateThresholdBps: Number.parseInt(e.target.value || "1", 10) || 1 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              warningFailureCountThreshold
              <input className="b-input h-9 mt-1" type="number" min={1} value={config.warningFailureCountThreshold} onChange={(e) => setConfig((prev) => ({ ...prev, warningFailureCountThreshold: Number.parseInt(e.target.value || "1", 10) || 1 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              criticalRateThresholdBps
              <input className="b-input h-9 mt-1" type="number" min={1} value={config.criticalRateThresholdBps} onChange={(e) => setConfig((prev) => ({ ...prev, criticalRateThresholdBps: Number.parseInt(e.target.value || "1", 10) || 1 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              criticalFailureCountThreshold
              <input className="b-input h-9 mt-1" type="number" min={1} value={config.criticalFailureCountThreshold} onChange={(e) => setConfig((prev) => ({ ...prev, criticalFailureCountThreshold: Number.parseInt(e.target.value || "1", 10) || 1 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              recoveryRateThresholdBps
              <input className="b-input h-9 mt-1" type="number" min={0} value={config.recoveryRateThresholdBps} onChange={(e) => setConfig((prev) => ({ ...prev, recoveryRateThresholdBps: Number.parseInt(e.target.value || "0", 10) || 0 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              recoveryFailureCountThreshold
              <input className="b-input h-9 mt-1" type="number" min={0} value={config.recoveryFailureCountThreshold} onChange={(e) => setConfig((prev) => ({ ...prev, recoveryFailureCountThreshold: Number.parseInt(e.target.value || "0", 10) || 0 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              dedupeWindowSec
              <input className="b-input h-9 mt-1" type="number" min={0} value={config.dedupeWindowSec} onChange={(e) => setConfig((prev) => ({ ...prev, dedupeWindowSec: Number.parseInt(e.target.value || "0", 10) || 0 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              recoveryConsecutiveWindows
              <input className="b-input h-9 mt-1" type="number" min={1} value={config.recoveryConsecutiveWindows} onChange={(e) => setConfig((prev) => ({ ...prev, recoveryConsecutiveWindows: Number.parseInt(e.target.value || "1", 10) || 1 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              windowSizeSec
              <input className="b-input h-9 mt-1" type="number" min={60} value={config.windowSizeSec} onChange={(e) => setConfig((prev) => ({ ...prev, windowSizeSec: Number.parseInt(e.target.value || "60", 10) || 60 }))} />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              quietHoursStart
              <input className="b-input h-9 mt-1" value={config.quietHoursStart} onChange={(e) => setConfig((prev) => ({ ...prev, quietHoursStart: e.target.value }))} placeholder="HH:mm" />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              quietHoursEnd
              <input className="b-input h-9 mt-1" value={config.quietHoursEnd} onChange={(e) => setConfig((prev) => ({ ...prev, quietHoursEnd: e.target.value }))} placeholder="HH:mm" />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              quietHoursTimezone
              <input className="b-input h-9 mt-1" value={config.quietHoursTimezone} onChange={(e) => setConfig((prev) => ({ ...prev, quietHoursTimezone: e.target.value }))} placeholder="Asia/Shanghai" />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              minDeliverySeverity
              <select className="b-input h-9 mt-1" value={config.minDeliverySeverity} onChange={(e) => setConfig((prev) => ({ ...prev, minDeliverySeverity: e.target.value as "warning" | "critical" }))}>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </label>
          </div>
          <label className="text-xs font-bold uppercase text-gray-500 block">
            muteProviders（逗号分隔）
            <input className="b-input h-9 mt-1" value={config.muteProviders.join(",")} onChange={(e) => setConfig((prev) => ({ ...prev, muteProviders: e.target.value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) }))} placeholder="claude,gemini" />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig((prev) => ({ ...prev, enabled: e.target.checked }))} />
              启用告警引擎
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" checked={config.quietHoursEnabled} onChange={(e) => setConfig((prev) => ({ ...prev, quietHoursEnabled: e.target.checked }))} />
              启用静默时段
            </label>
          </div>
          <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" disabled={configSaving} onClick={onSaveConfig}>
            {configSaving ? "保存中..." : "保存告警配置"}
          </button>
        </div>

        <div className="border-2 border-black p-4 space-y-3">
          <h4 className="text-lg font-black uppercase">手动评估</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              className="b-input h-9"
              value={evaluateForm.provider}
              onChange={(e) => setEvaluateForm((prev) => ({ ...prev, provider: e.target.value }))}
              placeholder="provider（可选）"
            />
          </div>
          <button className="b-btn bg-white" disabled={evaluating} onClick={onEvaluate}>
            {evaluating ? "评估中..." : "执行手动评估"}
          </button>
          {lastEvaluateResult ? (
            <p className="text-xs font-bold text-emerald-700">{lastEvaluateResult}</p>
          ) : (
            <p className="text-xs font-bold text-gray-500">
              评估结果会显示在这里，并自动刷新 incidents / deliveries 列表。
            </p>
          )}
        </div>
      </div>

      <div className="border-2 border-black p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-lg font-black uppercase">规则版本管理</h4>
          <div className="flex flex-wrap gap-2">
            <button className="b-btn bg-white text-xs" disabled={ruleActionBusy || rulePageLoading || !apiAvailable} onClick={onRefreshRules}>
              刷新规则
            </button>
            <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033] text-xs" disabled={ruleActionBusy || !apiAvailable} onClick={onCreateRuleVersion}>
              {ruleCreating ? "创建中..." : "创建并发布版本"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={cn("b-btn text-xs", useStructuredRuleEditor ? "bg-black text-white" : "bg-white text-black")} disabled={ruleActionBusy} onClick={onSwitchToStructuredRuleEditor}>
            结构化表单
          </button>
          <button className={cn("b-btn text-xs", !useStructuredRuleEditor ? "bg-black text-white" : "bg-white text-black")} disabled={ruleActionBusy} onClick={onSwitchToAdvancedRuleEditor}>
            高级 JSON
          </button>
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
            默认提供单规则模板，失败提示会附带 traceId。
          </span>
        </div>
        <p className="text-xs font-bold text-gray-500">
          当前激活版本：{activeVersion?.version || "-"}（{activeVersion?.status || "-"}）
        </p>
        {useStructuredRuleEditor ? (
          <div className="border-2 border-black bg-[#FFF6C2] p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                版本号
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.version} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, version: e.target.value }))} disabled={ruleActionBusy} placeholder="ops-v2" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                描述
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.description} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, description: e.target.value }))} disabled={ruleActionBusy} placeholder="针对高失败率的升级规则" />
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                provider
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.provider} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, provider: e.target.value }))} disabled={ruleActionBusy} placeholder="留空表示全部 provider" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                失败率阈值 Bps
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.failureRateBps} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, failureRateBps: e.target.value }))} disabled={ruleActionBusy} placeholder="3500" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                告警严重级别
                <select className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.severity} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, severity: e.target.value as OAuthAlertRuleStructuredDraft["severity"] }))} disabled={ruleActionBusy}>
                  <option value="warning">warning</option>
                  <option value="critical">critical</option>
                  <option value="recovery">recovery</option>
                </select>
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                通知通道
                <select className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.channel} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, channel: e.target.value as OAuthAlertRuleStructuredDraft["channel"] }))} disabled={ruleActionBusy}>
                  <option value="">继承默认</option>
                  <option value="webhook">webhook</option>
                  <option value="wecom">wecom</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                ruleId
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.ruleId} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, ruleId: e.target.value }))} disabled={ruleActionBusy} placeholder="critical-escalate" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                规则名称
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.name} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, name: e.target.value }))} disabled={ruleActionBusy} placeholder="高失败率升级" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                优先级
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.priority} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, priority: e.target.value }))} disabled={ruleActionBusy} placeholder="200" />
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                恢复连续窗口
                <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.recoveryConsecutiveWindows} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, recoveryConsecutiveWindows: e.target.value }))} disabled={ruleActionBusy} placeholder="3" />
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="border-2 border-black bg-white p-3 text-xs font-bold uppercase tracking-[0.12em]">
                发布策略
                <div className="mt-3 flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-black" checked={ruleStructuredDraft.activate} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, activate: e.target.checked }))} disabled={ruleActionBusy} />
                  <span className="text-xs font-bold normal-case">创建后立即激活</span>
                </div>
              </label>
              <label className="border-2 border-black bg-white p-3 text-xs font-bold uppercase tracking-[0.12em]">
                规则开关
                <div className="mt-3 flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-black" checked={ruleStructuredDraft.enabled} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, enabled: e.target.checked }))} disabled={ruleActionBusy} />
                  <span className="text-xs font-bold normal-case">规则默认启用</span>
                </div>
              </label>
            </div>
            <div className="border-2 border-black bg-white p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black uppercase">静默窗口</p>
                  <p className="text-[11px] font-bold text-gray-500">
                    仅生成一个常用静默窗口。weekdays 按 0-6 填写，0 表示周日。
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-bold">
                  <input type="checkbox" className="h-4 w-4 accent-black" checked={ruleStructuredDraft.muteWindowEnabled} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowEnabled: e.target.checked }))} disabled={ruleActionBusy} />
                  启用静默窗口
                </label>
              </div>
              {ruleStructuredDraft.muteWindowEnabled ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                    ID
                    <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.muteWindowId} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowId: e.target.value }))} disabled={ruleActionBusy} />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                    名称
                    <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.muteWindowName} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowName: e.target.value }))} disabled={ruleActionBusy} />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                    开始时间
                    <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.muteWindowStart} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowStart: e.target.value }))} disabled={ruleActionBusy} placeholder="23:00" />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                    结束时间
                    <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.muteWindowEnd} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowEnd: e.target.value }))} disabled={ruleActionBusy} placeholder="08:00" />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em] md:col-span-2">
                    时区
                    <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.muteWindowTimezone} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowTimezone: e.target.value }))} disabled={ruleActionBusy} placeholder="Asia/Shanghai" />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                    weekdays
                    <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.muteWindowWeekdaysText} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowWeekdaysText: e.target.value }))} disabled={ruleActionBusy} placeholder="1,2,3,4,5" />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                    severities
                    <input className="b-input h-10 w-full mt-1" value={ruleStructuredDraft.muteWindowSeveritiesText} onChange={(e) => setRuleStructuredDraft((prev) => ({ ...prev, muteWindowSeveritiesText: e.target.value }))} disabled={ruleActionBusy} placeholder="warning,critical" />
                  </label>
                </div>
              ) : (
              <p className="text-xs font-bold text-gray-500">
                关闭时不会写入 <code>muteWindows</code>。
              </p>
              )}
            </div>
          </div>
        ) : (
          <textarea
            className="b-input min-h-[180px] font-mono text-xs"
            value={ruleCreateText}
            onChange={(e) => setRuleCreateText(e.target.value)}
            disabled={ruleActionBusy}
            placeholder='{"version":"ops-v1","activate":true,"rules":[...]}'
          />
        )}
        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-black text-white uppercase">
              <tr>
                <th className="p-2">版本</th>
                <th className="p-2">状态</th>
                <th className="p-2">规则</th>
                <th className="p-2">命中</th>
                <th className="p-2">更新时间</th>
                <th className="p-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20">
              {(versions?.data || []).map((item) => (
                <tr key={`rule-version-${item.id}`}>
                  <td className="p-2 font-mono">{item.version}</td>
                  <td className="p-2">{item.status}</td>
                  <td className="p-2 font-mono">{item.enabledRules ?? 0}/{item.totalRules ?? 0}</td>
                  <td className="p-2 font-mono">{item.totalHits ?? 0}</td>
                  <td className="p-2 font-mono">{item.updatedAt ? new Date(item.updatedAt).toISOString() : "-"}</td>
                  <td className="p-2 text-right">
                    <button className="b-btn bg-white text-xs" disabled={ruleActionBusy || item.status === "active"} onClick={() => onRollbackRuleVersion(item)}>
                      {ruleRollingVersionId === item.id ? "回滚中..." : "回滚到此版本"}
                    </button>
                  </td>
                </tr>
              ))}
              {(versions?.data || []).length === 0 ? (
                <tr>
                  <td className="p-3 text-gray-500 font-bold" colSpan={6}>暂无规则版本</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-gray-600">
          <span>
            共 {versions?.total || 0} 条，第 {versions?.page || 1}/{versions?.totalPages || 1} 页
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button className="b-btn bg-white text-xs" disabled={ruleActionBusy || rulePageLoading || (versions?.page || 1) <= 1} onClick={() => onGotoRulePage(1)}>首页</button>
            <button className="b-btn bg-white text-xs" disabled={ruleActionBusy || rulePageLoading || (versions?.page || 1) <= 1} onClick={() => onGotoRulePage((versions?.page || 1) - 1)}>上一页</button>
            <button className="b-btn bg-white text-xs" disabled={ruleActionBusy || rulePageLoading || (versions?.page || 1) >= (versions?.totalPages || 1)} onClick={() => onGotoRulePage((versions?.page || 1) + 1)}>下一页</button>
            <button className="b-btn bg-white text-xs" disabled={ruleActionBusy || rulePageLoading || (versions?.page || 1) >= (versions?.totalPages || 1)} onClick={() => onGotoRulePage(versions?.totalPages || 1)}>末页</button>
            <input className="b-input h-8 w-20" value={rulePageInput} onChange={(e) => setRulePageInput(e.target.value)} placeholder="页码" disabled={ruleActionBusy || rulePageLoading} />
            <button
              className="b-btn bg-white text-xs"
              disabled={ruleActionBusy || rulePageLoading}
              onClick={() => {
                const target = Number(rulePageInput);
                if (!Number.isFinite(target) || target <= 0) {
                  onInvalidRulePageInput();
                  return;
                }
                onGotoRulePage(Math.floor(target));
              }}
            >
              跳转
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="border-2 border-black p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-lg font-black uppercase">Incidents</h4>
            <button className="b-btn bg-white text-xs" onClick={() => onApplyIncidentFilters(1)}>查询</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="b-input h-9" value={incidentProviderFilter} onChange={(e) => setIncidentProviderFilter(e.target.value)} placeholder="provider" />
            <input className="b-input h-9" value={incidentPhaseFilter} onChange={(e) => setIncidentPhaseFilter(e.target.value)} placeholder="phase" />
            <select className="b-input h-9" value={incidentSeverityFilter} onChange={(e) => setIncidentSeverityFilter(e.target.value as "" | "critical" | "warning" | "recovery")}>
              <option value="">全部级别</option>
              <option value="critical">critical</option>
              <option value="warning">warning</option>
              <option value="recovery">recovery</option>
            </select>
            <input type="datetime-local" className="b-input h-9" value={incidentFromFilter} onChange={(e) => setIncidentFromFilter(e.target.value)} />
            <input type="datetime-local" className="b-input h-9" value={incidentToFilter} onChange={(e) => setIncidentToFilter(e.target.value)} />
          </div>
          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-black text-white uppercase">
                <tr>
                  <th className="p-2">incident</th>
                  <th className="p-2">provider/phase</th>
                  <th className="p-2">severity</th>
                  <th className="p-2">失败率</th>
                  <th className="p-2">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20">
                {(incidents?.data || []).map((item) => (
                  <tr key={item.id}>
                    <td className="p-2">
                      <button
                        className="font-mono underline decoration-dotted"
                        onClick={() => onLinkIncidentToSessionEvents({ provider: item.provider, phase: item.phase })}
                        title="联动 OAuth 会话事件筛选"
                      >
                        {item.incidentId || "-"}
                      </button>
                      <p className="text-[10px] text-gray-500 truncate">
                        event={item.id} {item.dedupeKey ? `| ${item.dedupeKey}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold">
                        <button className="underline decoration-dotted" disabled={!item.incidentId} onClick={() => onJumpToDeliveriesByIncident(item.incidentId)} title="按 incidentId 联动 Deliveries">
                          查 deliveries
                        </button>
                        <button className="underline decoration-dotted" disabled={!item.incidentId} onClick={() => item.incidentId && onJumpToAuditByKeyword(item.incidentId)} title="按 incidentId 关键字联动统一审计">
                          查审计
                        </button>
                      </div>
                    </td>
                    <td className="p-2 font-mono">{item.provider} / {item.phase}</td>
                    <td className="p-2 font-mono">{item.severity}</td>
                    <td className="p-2 font-mono">
                      {item.failureCount}/{item.totalCount}
                      <p className="text-[10px] text-gray-500">
                        {(item.failureRateBps / 100).toFixed(2)}% {item.message || ""}
                      </p>
                    </td>
                    <td className="p-2 font-mono">{new Date(item.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {(incidents?.data || []).length === 0 ? (
                  <tr>
                    <td className="p-3 font-bold text-gray-500" colSpan={5}>暂无告警 incidents</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs font-bold text-gray-500">
            <p>共 {incidents?.total || 0} 条，第 {incidents?.page || 1}/{incidents?.totalPages || 1} 页</p>
            <div className="flex gap-2">
              <button className="b-btn bg-white text-xs" disabled={(incidents?.page || 1) <= 1} onClick={() => onApplyIncidentFilters(Math.max(1, (incidents?.page || 1) - 1))}>上一页</button>
              <button className="b-btn bg-white text-xs" disabled={(incidents?.page || 1) >= (incidents?.totalPages || 1)} onClick={() => onApplyIncidentFilters(Math.min(incidents?.totalPages || 1, (incidents?.page || 1) + 1))}>下一页</button>
            </div>
          </div>
        </div>

        <div id="oauth-alert-deliveries-section" className="border-2 border-black p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-lg font-black uppercase">Deliveries</h4>
            <button className="b-btn bg-white text-xs" onClick={() => onApplyDeliveryFilters(1)}>查询</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="b-input h-9" value={deliveryIncidentIdFilter} onChange={(e) => setDeliveryIncidentIdFilter(e.target.value)} placeholder="incidentId（主锚点）" />
            <input className="b-input h-9" value={deliveryEventIdFilter} onChange={(e) => setDeliveryEventIdFilter(e.target.value)} placeholder="兼容 eventId（可选）" />
            <input className="b-input h-9" value={deliveryChannelFilter} onChange={(e) => setDeliveryChannelFilter(e.target.value)} placeholder="channel" />
            <select className="b-input h-9" value={deliveryStatusFilter} onChange={(e) => setDeliveryStatusFilter(e.target.value as "" | "success" | "failure")}>
              <option value="">全部状态</option>
              <option value="success">success</option>
              <option value="failure">failure</option>
            </select>
            <input type="datetime-local" className="b-input h-9" value={deliveryFromFilter} onChange={(e) => setDeliveryFromFilter(e.target.value)} />
            <input type="datetime-local" className="b-input h-9" value={deliveryToFilter} onChange={(e) => setDeliveryToFilter(e.target.value)} />
          </div>
          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-black text-white uppercase">
                <tr>
                  <th className="p-2">delivery</th>
                  <th className="p-2">incident/channel/provider</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">响应</th>
                  <th className="p-2">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20">
                {(deliveries?.data || []).map((item) => (
                  <tr key={item.id}>
                    <td className="p-2 font-mono">{item.id}</td>
                    <td className="p-2 font-mono">
                      {item.incidentId || "-"}
                      <p className="text-[10px] text-gray-500">
                        channel={item.channel} / provider={(item.provider || "-") + " / " + (item.phase || "-")}
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">{item.target || "-"}</p>
                      <p className="text-[10px] text-gray-500">event={item.eventId}</p>
                    </td>
                    <td className="p-2 font-mono">
                      {item.status}
                      <p className="text-[10px] text-gray-500">
                        attempt={item.attempt} code={item.responseStatus ?? "-"}
                      </p>
                    </td>
                    <td className="p-2 font-mono">{item.error || item.responseBody || "-"}</td>
                    <td className="p-2 font-mono">{new Date(item.sentAt).toLocaleString()}</td>
                  </tr>
                ))}
                {(deliveries?.data || []).length === 0 ? (
                  <tr>
                    <td className="p-3 font-bold text-gray-500" colSpan={5}>暂无告警 deliveries</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs font-bold text-gray-500">
            <p>共 {deliveries?.total || 0} 条，第 {deliveries?.page || 1}/{deliveries?.totalPages || 1} 页</p>
            <div className="flex gap-2">
              <button className="b-btn bg-white text-xs" disabled={(deliveries?.page || 1) <= 1} onClick={() => onApplyDeliveryFilters(Math.max(1, (deliveries?.page || 1) - 1))}>上一页</button>
              <button className="b-btn bg-white text-xs" disabled={(deliveries?.page || 1) >= (deliveries?.totalPages || 1)} onClick={() => onApplyDeliveryFilters(Math.min(deliveries?.totalPages || 1, (deliveries?.page || 1) + 1))}>下一页</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
