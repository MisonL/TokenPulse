import type { Dispatch, SetStateAction } from "react";
import type {
  AlertmanagerStoredConfig,
  AlertmanagerSyncHistoryItem,
} from "../../lib/client";
import { cn } from "../../lib/utils";
import type { AlertmanagerStructuredDraft } from "../../pages/enterpriseControlEditors";

interface AlertmanagerControlSectionProps {
  sectionId?: string;
  apiAvailable: boolean;
  actionBusy: boolean;
  configSaving: boolean;
  syncing: boolean;
  historyPageLoading: boolean;
  useStructuredEditor: boolean;
  structuredDraft: AlertmanagerStructuredDraft;
  receiverOptions: string[];
  hasMaskedManagedWebhook: boolean;
  configText: string;
  config: AlertmanagerStoredConfig | null;
  latestSync: AlertmanagerSyncHistoryItem | null;
  syncHistory: AlertmanagerSyncHistoryItem[];
  historyTotal: number;
  historyPage: number;
  historyTotalPages: number;
  historyPageInput: string;
  historyRollingId: string;
  renderSyncSummary: (item?: AlertmanagerSyncHistoryItem) => string;
  setStructuredDraft: Dispatch<SetStateAction<AlertmanagerStructuredDraft>>;
  setConfigText: Dispatch<SetStateAction<string>>;
  setHistoryPageInput: Dispatch<SetStateAction<string>>;
  onReadConfig: () => void;
  onSaveConfig: () => void;
  onTriggerSync: () => void;
  onSwitchToStructuredEditor: () => void;
  onSwitchToAdvancedEditor: () => void;
  onRollbackHistory: (item: AlertmanagerSyncHistoryItem) => void;
  onGotoHistoryPage: (page: number) => void;
  onInvalidPageInput: () => void;
}

export function AlertmanagerControlSection({
  sectionId,
  apiAvailable,
  actionBusy,
  configSaving,
  syncing,
  historyPageLoading,
  useStructuredEditor,
  structuredDraft,
  receiverOptions,
  hasMaskedManagedWebhook,
  configText,
  config,
  latestSync,
  syncHistory,
  historyTotal,
  historyPage,
  historyTotalPages,
  historyPageInput,
  historyRollingId,
  renderSyncSummary,
  setStructuredDraft,
  setConfigText,
  setHistoryPageInput,
  onReadConfig,
  onSaveConfig,
  onTriggerSync,
  onSwitchToStructuredEditor,
  onSwitchToAdvancedEditor,
  onRollbackHistory,
  onGotoHistoryPage,
  onInvalidPageInput,
}: AlertmanagerControlSectionProps) {
  return (
    <div id={sectionId} className="border-2 border-black p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-lg font-black uppercase">Alertmanager 同步</h4>
        <div className="flex flex-wrap gap-2">
          <button className="b-btn bg-white text-xs" disabled={actionBusy || historyPageLoading} onClick={onReadConfig}>
            读取配置
          </button>
          <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033] text-xs" disabled={actionBusy || !apiAvailable} onClick={onSaveConfig}>
            {configSaving ? "保存中..." : "保存配置"}
          </button>
          <button className="b-btn bg-white text-xs" disabled={actionBusy || !apiAvailable} onClick={onTriggerSync}>
            {syncing ? "同步中..." : "执行同步"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={cn("b-btn text-xs", useStructuredEditor ? "bg-black text-white" : "bg-white text-black")} disabled={actionBusy} onClick={onSwitchToStructuredEditor}>
          结构化表单
        </button>
        <button className={cn("b-btn text-xs", !useStructuredEditor ? "bg-black text-white" : "bg-white text-black")} disabled={actionBusy} onClick={onSwitchToAdvancedEditor}>
          高级 JSON
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
          保存配置后再执行同步，复杂路由保留高级 JSON 模式。
        </span>
      </div>
      {!apiAvailable ? (
        <p className="text-xs font-bold text-gray-500">
          后端未启用 <code>/api/admin/observability/oauth-alerts/alertmanager/*</code>
          ，已自动降级该面板。
        </p>
      ) : (
        <p className="text-xs font-bold text-gray-500">
          支持后台维护 Alertmanager 配置并触发 reload/ready 同步回滚链路。
        </p>
      )}
      {useStructuredEditor ? (
        <div className="border-2 border-black bg-[#EAF2FF] p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              默认接收器
              <select
                className="b-input h-10 w-full mt-1"
                value={structuredDraft.defaultReceiver}
                onChange={(e) =>
                  setStructuredDraft((prev) => ({
                    ...prev,
                    defaultReceiver: e.target.value,
                  }))
                }
                disabled={actionBusy}
              >
                {receiverOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              group_by
              <input className="b-input h-10 w-full mt-1" value={structuredDraft.groupByText} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, groupByText: e.target.value }))} disabled={actionBusy} placeholder="alertname, provider, severity" />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              group_wait 秒数
              <input className="b-input h-10 w-full mt-1" value={structuredDraft.groupWaitSec} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, groupWaitSec: e.target.value }))} disabled={actionBusy} placeholder="30" />
            </label>
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              group_interval 秒数
              <input className="b-input h-10 w-full mt-1" value={structuredDraft.groupIntervalSec} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, groupIntervalSec: e.target.value }))} disabled={actionBusy} placeholder="300" />
            </label>
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              repeat_interval 秒数
              <input className="b-input h-10 w-full mt-1" value={structuredDraft.repeatIntervalSec} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, repeatIntervalSec: e.target.value }))} disabled={actionBusy} placeholder="14400" />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              warning webhook
              <input className="b-input h-10 w-full mt-1" value={structuredDraft.warningWebhookUrl} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, warningWebhookUrl: e.target.value }))} disabled={actionBusy} placeholder="https://hooks.example.com/warning" />
            </label>
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              critical webhook
              <input className="b-input h-10 w-full mt-1" value={structuredDraft.criticalWebhookUrl} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, criticalWebhookUrl: e.target.value }))} disabled={actionBusy} placeholder="https://hooks.example.com/critical" />
            </label>
            <label className="block text-xs font-bold uppercase tracking-[0.12em]">
              p1 webhook
              <input className="b-input h-10 w-full mt-1" value={structuredDraft.p1WebhookUrl} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, p1WebhookUrl: e.target.value }))} disabled={actionBusy} placeholder="https://hooks.example.com/p1" />
            </label>
          </div>
          <label className="block text-xs font-bold uppercase tracking-[0.12em]">
            templates
            <textarea className="b-input min-h-[96px] w-full mt-1 font-mono text-xs" value={structuredDraft.templatesText} onChange={(e) => setStructuredDraft((prev) => ({ ...prev, templatesText: e.target.value }))} disabled={actionBusy} placeholder={"/etc/alertmanager/templates/oauth-alerts.tmpl\n/etc/alertmanager/templates/common.tmpl"} />
          </label>
          {hasMaskedManagedWebhook ? (
            <p className="text-xs font-bold text-amber-700">
              当前已加载的 webhook 地址已脱敏。若要重新保存结构化配置，请填写真实 URL。
            </p>
          ) : null}
          <p className="text-xs font-bold text-gray-500">
            结构化模式会保留现有的 <code>global</code>、<code>inhibit_rules</code>、
            <code>time_intervals</code> 等高级字段；若要编辑复杂路由树，请切换到高级 JSON。
          </p>
        </div>
      ) : (
        <textarea className="b-input min-h-[180px] font-mono text-xs" value={configText} onChange={(e) => setConfigText(e.target.value)} disabled={actionBusy} placeholder='{"route":{"receiver":"warning-webhook"},"receivers":[]}' />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-bold text-gray-600">
        <p>版本：{config?.version ?? "-"}</p>
        <p>更新人：{config?.updatedBy || "-"}</p>
        <p>更新时间：{config?.updatedAt || "-"}</p>
        <p>最近同步：{renderSyncSummary(latestSync || undefined)}</p>
      </div>
      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-black text-white uppercase">
            <tr>
              <th className="p-2">时间</th>
              <th className="p-2">状态</th>
              <th className="p-2">信息</th>
              <th className="p-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20">
            {syncHistory.map((item, index) => (
              <tr key={`${item.id || "sync"}-${index}`}>
                <td className="p-2 font-mono">{item.ts || "-"}</td>
                <td className="p-2 font-mono">{item.outcome || "-"}</td>
                <td className="p-2">{renderSyncSummary(item)}</td>
                <td className="p-2 text-right">
                  <button className="b-btn bg-white text-xs" disabled={!item.id || !apiAvailable || actionBusy} onClick={() => item.id && onRollbackHistory(item)}>
                    {historyRollingId === item.id ? "回滚中..." : "回滚此记录"}
                  </button>
                </td>
              </tr>
            ))}
            {syncHistory.length === 0 ? (
              <tr>
                <td className="p-3 text-gray-500 font-bold" colSpan={4}>暂无同步记录</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-gray-600">
        <span>共 {historyTotal} 条，第 {historyPage}/{historyTotalPages} 页</span>
        <div className="flex flex-wrap items-center gap-2">
          <button className="b-btn bg-white text-xs" disabled={actionBusy || historyPageLoading || !apiAvailable || historyPage <= 1} onClick={() => onGotoHistoryPage(1)}>首页</button>
          <button className="b-btn bg-white text-xs" disabled={actionBusy || historyPageLoading || !apiAvailable || historyPage <= 1} onClick={() => onGotoHistoryPage(historyPage - 1)}>上一页</button>
          <button className="b-btn bg-white text-xs" disabled={actionBusy || historyPageLoading || !apiAvailable || historyPage >= historyTotalPages} onClick={() => onGotoHistoryPage(historyPage + 1)}>下一页</button>
          <button className="b-btn bg-white text-xs" disabled={actionBusy || historyPageLoading || !apiAvailable || historyPage >= historyTotalPages} onClick={() => onGotoHistoryPage(historyTotalPages)}>末页</button>
          <input className="b-input h-8 w-20" value={historyPageInput} onChange={(e) => setHistoryPageInput(e.target.value)} placeholder="页码" disabled={actionBusy || historyPageLoading || !apiAvailable} />
          <button
            className="b-btn bg-white text-xs"
            disabled={actionBusy || historyPageLoading || !apiAvailable}
            onClick={() => {
              const target = Number(historyPageInput);
              if (!Number.isFinite(target) || target <= 0) {
                onInvalidPageInput();
                return;
              }
              onGotoHistoryPage(Math.floor(target));
            }}
          >
            跳转
          </button>
        </div>
      </div>
    </div>
  );
}
