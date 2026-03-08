import { describe, expect, it } from "bun:test";
import {
  buildReplayAgentLedgerOutboxBatchConfirmationMessage,
  buildReplayAgentLedgerOutboxConfirmationMessage,
  buildRollbackAlertmanagerSyncHistoryConfirmationMessage,
  buildRollbackOAuthAlertRuleVersionConfirmationMessage,
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
});
