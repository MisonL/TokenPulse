import { describe, expect, it } from "bun:test";
import {
  normalizeAlertmanagerHistoryQueryResult,
  normalizeAlertmanagerStoredConfig,
  normalizeOAuthAlertConfig,
  normalizeOAuthAlertDeliveryResult,
  normalizeOAuthAlertIncidentResult,
  normalizeOAuthAlertRuleVersionList,
  renderAlertmanagerSyncSummary,
} from "./enterpriseOAuthAlertAdapters";

const DEFAULT_OAUTH_ALERT_CENTER_CONFIG = {
  enabled: true,
  warningRateThresholdBps: 2000,
  warningFailureCountThreshold: 10,
  criticalRateThresholdBps: 3500,
  criticalFailureCountThreshold: 20,
  recoveryRateThresholdBps: 1000,
  recoveryFailureCountThreshold: 5,
  dedupeWindowSec: 600,
  recoveryConsecutiveWindows: 2,
  windowSizeSec: 300,
  quietHoursEnabled: false,
  quietHoursStart: "00:00",
  quietHoursEnd: "00:00",
  quietHoursTimezone: "Asia/Shanghai",
  muteProviders: [],
  minDeliverySeverity: "warning" as const,
};

describe("enterpriseOAuthAlertAdapters", () => {
  it("应归一化 OAuth 告警中心配置并兜底默认值", () => {
    const result = normalizeOAuthAlertConfig(
      {
        data: {
          enabled: false,
          warningRateThresholdBps: "3000",
          criticalRateThresholdBps: 5000,
          quietHoursEnabled: true,
          muteProviders: [" Claude ", "claude", "Gemini"],
          minDeliverySeverity: "critical",
        },
      },
      DEFAULT_OAUTH_ALERT_CENTER_CONFIG,
    );

    expect(result.enabled).toBe(false);
    expect(result.warningRateThresholdBps).toBe(3000);
    expect(result.criticalRateThresholdBps).toBe(5000);
    expect(result.quietHoursEnabled).toBe(true);
    expect(result.muteProviders).toEqual(["claude", "gemini"]);
    expect(result.minDeliverySeverity).toBe("critical");
  });

  it("应归一化 incidents、deliveries、history 与规则版本列表", () => {
    const incidents = normalizeOAuthAlertIncidentResult({
      data: [{ id: 1, provider: "claude", phase: "exchange", incidentId: "inc-1" }],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    const deliveries = normalizeOAuthAlertDeliveryResult({
      data: [{ id: 1, eventId: 2, provider: "claude", channel: "webhook", status: "success" }],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    const history = normalizeAlertmanagerHistoryQueryResult({
      data: [{ id: "h-1", ts: "2026-03-08T10:00:00Z", outcome: "success" }],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    const versions = normalizeOAuthAlertRuleVersionList({
      data: [{ id: 1, version: "ops-v1", status: "active" }],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });

    expect(incidents.data[0]?.incidentId).toBe("inc-1");
    expect(deliveries.data[0]?.eventId).toBe(2);
    expect(history.data[0]?.outcome).toBe("success");
    expect(versions.data[0]?.version).toBe("ops-v1");
  });

  it("应归一化 Alertmanager 存储配置并渲染同步摘要", () => {
    const stored = normalizeAlertmanagerStoredConfig({
      data: {
        version: 3,
        updatedAt: "2026-03-08T10:00:00Z",
        config: {
          route: { receiver: "warning-webhook" },
          receivers: [{ name: "warning-webhook" }],
        },
      },
    });

    expect(stored?.version).toBe(3);
    expect(stored?.config?.route).toEqual({ receiver: "warning-webhook" });
    expect(renderAlertmanagerSyncSummary({ outcome: "failed", error: "reload failed" })).toBe(
      "failed: reload failed",
    );
    expect(renderAlertmanagerSyncSummary(undefined)).toBe("暂无同步记录");
  });
});
