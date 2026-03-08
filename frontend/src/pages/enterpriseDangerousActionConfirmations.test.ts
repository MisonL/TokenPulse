import { describe, expect, it } from "bun:test";
import {
  buildCreateOAuthAlertRuleVersionConfirmationMessage,
  buildEvaluateOAuthAlertsConfirmationMessage,
  buildReplayAgentLedgerOutboxBatchConfirmationMessage,
  buildReplayAgentLedgerOutboxConfirmationMessage,
  buildSaveAlertmanagerConfigConfirmationMessage,
  buildSaveCapabilityMapConfirmationMessage,
  buildSaveExcludedModelsConfirmationMessage,
  buildSaveModelAliasConfirmationMessage,
  buildSaveOAuthAlertConfigConfirmationMessage,
  buildSaveRoutePoliciesConfirmationMessage,
  buildRollbackAlertmanagerSyncHistoryConfirmationMessage,
  buildRollbackOAuthAlertRuleVersionConfirmationMessage,
  buildTriggerAlertmanagerSyncConfirmationMessage,
} from "./enterpriseDangerousActionConfirmations";

describe("enterpriseDangerousActionConfirmations", () => {
  it("应生成规则版本回滚确认文案", () => {
    expect(
      buildRollbackOAuthAlertRuleVersionConfirmationMessage({
        id: 12,
        version: "ops-v1",
        status: "inactive",
      }),
    ).toBe(
      "确认将 OAuth 告警规则回滚到版本 ops-v1（ID: 12）吗？当前 active 版本会被替换。",
    );
  });

  it("应生成 Alertmanager 历史回滚确认文案", () => {
    expect(
      buildRollbackAlertmanagerSyncHistoryConfirmationMessage({
        id: "history-001",
        ts: "2026-03-08T10:00:00.000Z",
      }),
    ).toBe(
      "确认按同步记录 history-001（2026-03-08T10:00:00.000Z）回滚 Alertmanager 配置吗？当前线上配置会被覆盖。",
    );
  });

  it("应生成单条 outbox replay 确认文案", () => {
    expect(
      buildReplayAgentLedgerOutboxConfirmationMessage({
        id: 101,
        traceId: "trace-001",
        provider: "claude",
        deliveryState: "replay_required",
      }),
    ).toBe(
      "确认重放 outbox #101 吗？traceId=trace-001，provider=claude，当前状态=replay_required。",
    );
  });

  it("应生成批量 outbox replay 确认文案", () => {
    expect(
      buildReplayAgentLedgerOutboxBatchConfirmationMessage([
        { id: 101, traceId: "trace-001" },
        { id: 102, traceId: "trace-002" },
        { id: 103, traceId: "trace-003" },
        { id: 104, traceId: "trace-004" },
      ]),
    ).toBe(
      "确认批量重放 4 条 outbox 记录吗？样例：#101(trace-001)、#102(trace-002)、#103(trace-003) 等。",
    );
  });

  it("应生成手动评估确认文案", () => {
    expect(buildEvaluateOAuthAlertsConfirmationMessage(" claude ")).toBe(
      "确认立即执行 OAuth 告警手动评估吗？本次仅针对 provider=claude。",
    );
    expect(buildEvaluateOAuthAlertsConfirmationMessage("")).toBe(
      "确认立即执行 OAuth 告警手动评估吗？本次会按当前全局配置评估所有 provider。",
    );
  });

  it("应生成规则版本创建确认文案", () => {
    expect(
      buildCreateOAuthAlertRuleVersionConfirmationMessage({
        version: "ops-v2",
        activate: true,
        rules: [{}, {}],
      }),
    ).toBe("确认创建规则版本 ops-v2 吗？规则数=2，创建后会立即激活。");
  });

  it("应生成 Alertmanager 同步确认文案", () => {
    expect(buildTriggerAlertmanagerSyncConfirmationMessage(7)).toBe(
      "确认执行 Alertmanager 同步吗？当前配置版本=7，执行后会触发 reload/ready 链路。",
    );
  });

  it("应生成保存类控制面确认文案", () => {
    expect(buildSaveOAuthAlertConfigConfirmationMessage()).toBe(
      "确认保存 OAuth 告警配置吗？新的阈值、静默窗口和投递抑制会立即生效。",
    );
    expect(buildSaveAlertmanagerConfigConfirmationMessage(3)).toBe(
      "确认保存 Alertmanager 配置吗？当前版本=3，保存后待同步配置会被覆盖。",
    );
    expect(buildSaveRoutePoliciesConfirmationMessage("latest_valid")).toBe(
      "确认保存路由策略吗？默认选路策略将更新为 latest_valid。",
    );
    expect(buildSaveCapabilityMapConfirmationMessage(4)).toBe(
      "确认保存能力图谱吗？将写入 4 个 provider 的能力声明。",
    );
    expect(buildSaveModelAliasConfirmationMessage(6)).toBe(
      "确认保存模型别名规则吗？本次将写入 6 条别名映射。",
    );
    expect(buildSaveExcludedModelsConfirmationMessage(2)).toBe(
      "确认保存禁用模型列表吗？本次将写入 2 条禁用模型规则。",
    );
  });
});
