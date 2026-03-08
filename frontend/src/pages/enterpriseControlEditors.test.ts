import { describe, expect, it } from "bun:test";
import {
  buildStructuredAlertmanagerPayload,
  buildStructuredOAuthAlertRulePayload,
  DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT,
  DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT,
  isManagedAlertmanagerReceiverName,
  normalizeAlertmanagerStructuredDraft,
  normalizeOAuthAlertRuleStructuredDraft,
} from "./enterpriseControlEditors";

describe("enterpriseControlEditors", () => {
  it("应归一化 OAuth 告警规则结构化草稿并构建 payload", () => {
    const normalized = normalizeOAuthAlertRuleStructuredDraft({
      version: "ops-v2",
      activate: false,
      recoveryPolicy: { consecutiveWindows: 4 },
      rules: [
        {
          ruleId: "critical-escalate",
          name: "关键升级",
          enabled: true,
          priority: 300,
          allConditions: [
            { field: "provider", value: "claude" },
            { field: "failureRateBps", value: 4200 },
          ],
          actions: [
            { type: "escalate", severity: "critical" },
            { type: "set_channel", channels: ["wecom"] },
          ],
        },
      ],
    });

    expect(normalized.version).toBe("ops-v2");
    expect(normalized.provider).toBe("claude");
    expect(normalized.failureRateBps).toBe("4200");
    expect(normalized.channel).toBe("wecom");

    const built = buildStructuredOAuthAlertRulePayload({
      ...DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT,
      version: "ops-v3",
      ruleId: "rule-v3",
      name: "规则 V3",
      priority: "250",
      failureRateBps: "3600",
      muteWindowEnabled: true,
      muteWindowStart: "22:00",
      muteWindowEnd: "08:00",
      muteWindowWeekdaysText: "1,2,3",
      muteWindowSeveritiesText: "warning,critical",
    });

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.version).toBe("ops-v3");
      expect(Array.isArray(built.payload.rules)).toBe(true);
      expect(Array.isArray(built.payload.muteWindows)).toBe(true);
    }
  });

  it("应归一化 Alertmanager 结构化草稿并构建 payload", () => {
    const normalized = normalizeAlertmanagerStructuredDraft({
      route: {
        receiver: "warning-webhook",
        group_by: ["alertname", "provider"],
        group_wait: "30s",
        group_interval: "300s",
        repeat_interval: "14400s",
      },
      receivers: [
        { name: "warning-webhook", webhook_configs: [{ url: "https://hooks.test/warning" }] },
        { name: "custom-receiver", webhook_configs: [{ url: "https://hooks.test/custom" }] },
      ],
      templates: ["/etc/alertmanager/templates/oauth.tmpl"],
    });

    expect(normalized.defaultReceiver).toBe("warning-webhook");
    expect(normalized.groupByText).toContain("alertname");
    expect(normalized.warningWebhookUrl).toBe("https://hooks.test/warning");

    const built = buildStructuredAlertmanagerPayload(
      {
        ...DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT,
        warningWebhookUrl: "https://hooks.test/warning",
      },
      {
        route: { receiver: "warning-webhook" },
        receivers: [{ name: "custom-receiver", webhook_configs: [{ url: "https://hooks.test/custom" }] }],
      },
    );

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.route.receiver).toBe("warning-webhook");
      expect(Array.isArray(built.payload.receivers)).toBe(true);
    }
  });

  it("应保留 Alertmanager receiver 管理规则判断", () => {
    expect(isManagedAlertmanagerReceiverName("warning-webhook")).toBe(true);
    expect(isManagedAlertmanagerReceiverName("custom-receiver")).toBe(false);
  });
});
