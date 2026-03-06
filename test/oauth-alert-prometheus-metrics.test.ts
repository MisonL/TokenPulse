import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import {
  oauthAlertDeliveryCounter,
  oauthAlertDeliveryDuration,
  oauthAlertEvaluationDuration,
  oauthAlertEventsCounter,
  register,
} from "../src/lib/metrics";
import {
  deliverOAuthAlertEvent,
} from "../src/lib/observability/alert-delivery";
import {
  evaluateOAuthSessionAlerts,
  updateOAuthAlertConfig,
} from "../src/lib/observability/oauth-session-alerts";

async function ensureMetricTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.system_logs (
        id serial PRIMARY KEY,
        timestamp text NOT NULL,
        level text NOT NULL,
        source text NOT NULL,
        message text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_session_events (
        id serial PRIMARY KEY,
        state text NOT NULL,
        provider text NOT NULL,
        flow_type text NOT NULL,
        phase text NOT NULL,
        status text NOT NULL,
        event_type text NOT NULL,
        error text,
        created_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_configs (
        id serial PRIMARY KEY,
        enabled integer NOT NULL DEFAULT 1,
        warning_rate_threshold_bps integer NOT NULL DEFAULT 2000,
        warning_failure_count_threshold integer NOT NULL DEFAULT 10,
        critical_rate_threshold_bps integer NOT NULL DEFAULT 3500,
        critical_failure_count_threshold integer NOT NULL DEFAULT 20,
        recovery_rate_threshold_bps integer NOT NULL DEFAULT 1000,
        recovery_failure_count_threshold integer NOT NULL DEFAULT 5,
        dedupe_window_sec integer NOT NULL DEFAULT 600,
        recovery_consecutive_windows integer NOT NULL DEFAULT 2,
        window_size_sec integer NOT NULL DEFAULT 300,
        quiet_hours_enabled integer NOT NULL DEFAULT 0,
        quiet_hours_start text NOT NULL DEFAULT '00:00',
        quiet_hours_end text NOT NULL DEFAULT '00:00',
        quiet_hours_timezone text NOT NULL DEFAULT 'Asia/Shanghai',
        mute_providers text NOT NULL DEFAULT '[]',
        min_delivery_severity text NOT NULL DEFAULT 'warning',
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_events (
        id serial PRIMARY KEY,
        incident_id text NOT NULL,
        provider text NOT NULL,
        phase text NOT NULL,
        severity text NOT NULL,
        total_count integer NOT NULL,
        failure_count integer NOT NULL,
        failure_rate_bps integer NOT NULL,
        window_start bigint NOT NULL,
        window_end bigint NOT NULL,
        status_breakdown text,
        dedupe_key text NOT NULL,
        message text,
        created_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_deliveries (
        id serial PRIMARY KEY,
        event_id integer NOT NULL,
        incident_id text NOT NULL,
        channel text NOT NULL,
        target text,
        attempt integer NOT NULL DEFAULT 1,
        status text NOT NULL,
        response_status integer,
        response_body text,
        error text,
        sent_at bigint NOT NULL
      )
    `),
  );
}

async function resetMetricTables() {
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_deliveries"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_events"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_configs"));
  await db.execute(sql.raw("DELETE FROM core.oauth_session_events"));
}

async function seedEvents(params: {
  provider: string;
  phase: string;
  errors: number;
  completed: number;
  createdAt: number;
}) {
  const values: string[] = [];
  for (let i = 0; i < params.errors; i += 1) {
    values.push(
      `('state-${params.provider}-${i}','${params.provider}','auth_code','${params.phase}','error','mark_error','mock',${params.createdAt})`,
    );
  }
  for (let i = 0; i < params.completed; i += 1) {
    values.push(
      `('state-${params.provider}-ok-${i}','${params.provider}','auth_code','${params.phase}','completed','complete',NULL,${params.createdAt})`,
    );
  }
  if (values.length === 0) return;
  await db.execute(
    sql.raw(`
      INSERT INTO core.oauth_session_events
      (state, provider, flow_type, phase, status, event_type, error, created_at)
      VALUES ${values.join(",")}
    `),
  );
}

function resetMetricValues() {
  oauthAlertEventsCounter.reset();
  oauthAlertEvaluationDuration.reset();
  oauthAlertDeliveryCounter.reset();
  oauthAlertDeliveryDuration.reset();
}

const originalWebhookUrl = config.oauthAlerts.webhookUrl;
const originalWebhookSecret = config.oauthAlerts.webhookSecret;
const originalWecomUrl = config.oauthAlerts.wecomWebhookUrl;
const originalMentioned = [...config.oauthAlerts.wecomMentionedList];

describe("OAuth 告警 Prometheus 指标", () => {
  beforeAll(async () => {
    await ensureMetricTables();
  });

  beforeEach(async () => {
    await resetMetricTables();
    resetMetricValues();
    config.oauthAlerts.webhookUrl = "";
    config.oauthAlerts.webhookSecret = "";
    config.oauthAlerts.wecomWebhookUrl = "";
    config.oauthAlerts.wecomMentionedList = [];
    await updateOAuthAlertConfig({
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
      minDeliverySeverity: "warning",
    });
  });

  afterAll(async () => {
    await resetMetricTables();
    config.oauthAlerts.webhookUrl = originalWebhookUrl;
    config.oauthAlerts.webhookSecret = originalWebhookSecret;
    config.oauthAlerts.wecomWebhookUrl = originalWecomUrl;
    config.oauthAlerts.wecomMentionedList = originalMentioned;
  });

  it("评估触发告警时应写入事件指标和评估耗时指标", async () => {
    const fixedNow = 1_776_001_020_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;
    try {
      const windowEnd = Math.floor(fixedNow / 300_000) * 300_000;
      await seedEvents({
        provider: "claude",
        phase: "error",
        errors: 12,
        completed: 18,
        createdAt: windowEnd - 60_000,
      });

      const result = await evaluateOAuthSessionAlerts();
      expect(result.createdEvents).toBe(1);

      const metricsText = await register.metrics();
      expect(metricsText).toContain(
        'tokenpulse_oauth_alert_events_total{provider="claude",phase="error",severity="warning",result="created",reason="threshold_breached"} 1',
      );
      expect(metricsText).toContain(
        'tokenpulse_oauth_alert_evaluation_duration_seconds_count{result="success"} 1',
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("命中抑制策略时应记录 suppressed 投递指标", async () => {
    config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
    config.oauthAlerts.wecomWebhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock";

    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      const summary = await deliverOAuthAlertEvent(
        {
          id: 3001,
          incidentId: "incident:claude:error:3001",
          provider: "claude",
          phase: "error",
          severity: "warning",
          totalCount: 100,
          failureCount: 30,
          failureRateBps: 3000,
          windowStart: 1_776_100_600_000,
          windowEnd: 1_776_100_900_000,
          message: "muted provider",
          createdAt: 1_776_100_905_000,
        },
        {
          muteProviders: ["claude"],
          minDeliverySeverity: "warning",
          quietHoursEnabled: false,
          quietHoursStart: "00:00",
          quietHoursEnd: "00:00",
          quietHoursTimezone: "Asia/Shanghai",
        },
      );

      expect(calls).toHaveLength(0);
      expect(summary.attemptedChannels).toBe(2);

      const metricsText = await register.metrics();
      expect(metricsText).toContain(
        'tokenpulse_oauth_alert_delivery_total{provider="claude",phase="error",severity="warning",channel="webhook",status="suppressed",reason="muted_provider"} 1',
      );
      expect(metricsText).toContain(
        'tokenpulse_oauth_alert_delivery_total{provider="claude",phase="error",severity="warning",channel="wecom",status="suppressed",reason="muted_provider"} 1',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("真实投递成功/失败时应分别累计 delivery 指标", async () => {
    config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      if (bodyText.includes('"id":3003')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 502 });
    }) as typeof globalThis.fetch;

    try {
      const successSummary = await deliverOAuthAlertEvent({
        id: 3003,
        incidentId: "incident:gemini:error:3003",
        provider: "gemini",
        phase: "error",
        severity: "critical",
        totalCount: 100,
        failureCount: 90,
        failureRateBps: 9000,
        windowStart: 1_776_100_000_000,
        windowEnd: 1_776_100_300_000,
        message: "success path",
        createdAt: 1_776_100_305_000,
      });
      expect(successSummary.successfulChannels).toBe(1);

      const failureSummary = await deliverOAuthAlertEvent({
        id: 3004,
        incidentId: "incident:gemini:error:3004",
        provider: "gemini",
        phase: "error",
        severity: "critical",
        totalCount: 100,
        failureCount: 90,
        failureRateBps: 9000,
        windowStart: 1_776_100_000_000,
        windowEnd: 1_776_100_300_000,
        message: "failure path",
        createdAt: 1_776_100_305_000,
      });
      expect(failureSummary.failedChannels).toBe(1);
      expect(failureSummary.totalAttempts).toBe(3);

      const metricsText = await register.metrics();
      expect(metricsText).toContain(
        'tokenpulse_oauth_alert_delivery_total{provider="gemini",phase="error",severity="critical",channel="webhook",status="success",reason="none"} 1',
      );
      expect(metricsText).toContain(
        'tokenpulse_oauth_alert_delivery_total{provider="gemini",phase="error",severity="critical",channel="webhook",status="failure",reason="http_non_2xx"} 3',
      );
      expect(metricsText).toContain(
        'tokenpulse_oauth_alert_delivery_duration_seconds_count{provider="gemini",phase="error",severity="critical",channel="webhook",status="success"} 1',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
