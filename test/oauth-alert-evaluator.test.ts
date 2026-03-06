import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { oauthAlertDeliveries } from "../src/db/schema";
import {
  evaluateOAuthSessionAlerts,
  queryOAuthAlertEvents,
  updateOAuthAlertConfig,
} from "../src/lib/observability/oauth-session-alerts";
import { config } from "../src/config";

async function ensureAlertTables() {
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

async function resetAlertTables() {
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_deliveries"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_events"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_configs"));
  await db.execute(sql.raw("DELETE FROM core.oauth_session_events"));
}

async function seedWindowEvents(params: {
  provider: string;
  phase: string;
  errors: number;
  completed: number;
  createdAt: number;
}) {
  const values: string[] = [];
  for (let i = 0; i < params.errors; i += 1) {
    values.push(
      `('state-${params.provider}-${params.phase}-err-${i}','${params.provider}','auth_code','${params.phase}','error','mark_error','mock',${params.createdAt})`,
    );
  }
  for (let i = 0; i < params.completed; i += 1) {
    values.push(
      `('state-${params.provider}-${params.phase}-ok-${i}','${params.provider}','auth_code','${params.phase}','completed','complete',NULL,${params.createdAt})`,
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

function windowSampleTs(nowMs: number, windowSizeSec = 300) {
  const windowMs = windowSizeSec * 1000;
  const windowEnd = Math.floor(nowMs / windowMs) * windowMs;
  return windowEnd - 60_000;
}

const originalWebhookUrl = config.oauthAlerts.webhookUrl;
const originalWebhookSecret = config.oauthAlerts.webhookSecret;
const originalWecomUrl = config.oauthAlerts.wecomWebhookUrl;

describe("OAuth 告警评估引擎", () => {
  beforeAll(async () => {
    await ensureAlertTables();
  });

  beforeEach(async () => {
    await resetAlertTables();
    config.oauthAlerts.webhookUrl = "";
    config.oauthAlerts.webhookSecret = "";
    config.oauthAlerts.wecomWebhookUrl = "";
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
    });
  });

  afterAll(async () => {
    config.oauthAlerts.webhookUrl = originalWebhookUrl;
    config.oauthAlerts.webhookSecret = originalWebhookSecret;
    config.oauthAlerts.wecomWebhookUrl = originalWecomUrl;
    await resetAlertTables();
  });

  it("应触发 warning/critical 并在同窗口内去重", async () => {
    const fixedNow = 1_776_000_120_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await seedWindowEvents({
        provider: "claude",
        phase: "error",
        errors: 20,
        completed: 20,
        createdAt: windowSampleTs(fixedNow),
      });
      await seedWindowEvents({
        provider: "gemini",
        phase: "error",
        errors: 10,
        completed: 40,
        createdAt: windowSampleTs(fixedNow),
      });

      const first = await evaluateOAuthSessionAlerts();
      expect(first.createdEvents).toBe(2);

      const listed = await queryOAuthAlertEvents({ page: 1, pageSize: 20 });
      expect(listed.total).toBe(2);
      const severities = listed.data.map((item) => item.severity);
      expect(severities).toContain("critical");
      expect(severities).toContain("warning");
      expect(listed.data.every((item) => item.incidentId.startsWith("incident:"))).toBe(true);

      const second = await evaluateOAuthSessionAlerts();
      expect(second.createdEvents).toBe(0);
    } finally {
      Date.now = originalNow;
    }
  });

  it("应在连续两个健康窗口后触发 recovery", async () => {
    const baseNow = 1_776_000_420_000;
    const originalNow = Date.now;

    try {
      Date.now = () => baseNow;
      await seedWindowEvents({
        provider: "claude",
        phase: "error",
        errors: 20,
        completed: 20,
        createdAt: windowSampleTs(baseNow),
      });
      const first = await evaluateOAuthSessionAlerts();
      expect(first.createdEvents).toBe(1);

      const secondWindowNow = baseNow + 300_000;
      Date.now = () => secondWindowNow;
      await seedWindowEvents({
        provider: "claude",
        phase: "error",
        errors: 0,
        completed: 30,
        createdAt: windowSampleTs(secondWindowNow),
      });
      const second = await evaluateOAuthSessionAlerts();
      expect(second.createdEvents).toBe(0);

      const thirdWindowNow = secondWindowNow + 300_000;
      Date.now = () => thirdWindowNow;
      await seedWindowEvents({
        provider: "claude",
        phase: "error",
        errors: 0,
        completed: 30,
        createdAt: windowSampleTs(thirdWindowNow),
      });
      const third = await evaluateOAuthSessionAlerts();
      expect(third.createdEvents).toBe(1);

      const listed = await queryOAuthAlertEvents({
        page: 1,
        pageSize: 20,
        provider: "claude",
      });
      expect(listed.data.some((item) => item.severity === "recovery")).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("最小投递级别为 critical 时，warning 告警应仅入库事件不发通知", async () => {
    const fixedNow = 1_776_000_720_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      await updateOAuthAlertConfig({
        minDeliverySeverity: "critical",
      });
      await seedWindowEvents({
        provider: "claude",
        phase: "error",
        errors: 10,
        completed: 30,
        createdAt: windowSampleTs(fixedNow),
      });

      const result = await evaluateOAuthSessionAlerts();
      expect(result.createdEvents).toBe(1);
      expect(calls).toHaveLength(0);

      const deliveries = await db.select().from(oauthAlertDeliveries);
      expect(deliveries.length).toBe(1);
      expect(deliveries[0]?.status).toBe("failure");
      expect(deliveries[0]?.error).toBe("below_min_severity");
      expect(String(deliveries[0]?.incidentId || "")).toContain("incident:");
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
    }
  });

  it("engine disabled 时应直接跳过评估，不扫描窗口也不写入事件/投递记录", async () => {
    const fixedNow = 1_776_001_020_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await updateOAuthAlertConfig({ enabled: false });
      await seedWindowEvents({
        provider: "claude",
        phase: "error",
        errors: 20,
        completed: 20,
        createdAt: windowSampleTs(fixedNow),
      });

      const result = await evaluateOAuthSessionAlerts();
      expect(result.scannedGroups).toBe(0);
      expect(result.createdEvents).toBe(0);
      expect(result.deliveryAttempts).toBe(0);
      expect(result.deliveryFailedChannels).toBe(0);

      const listed = await queryOAuthAlertEvents({ page: 1, pageSize: 20 });
      expect(listed.total).toBe(0);

      const deliveries = await db.select().from(oauthAlertDeliveries);
      expect(deliveries).toHaveLength(0);
    } finally {
      Date.now = originalNow;
    }
  });

  it("评估阶段发生异常时应捕获并返回默认结果（evaluation_error 不抛出）", async () => {
    const fixedNow = 1_776_001_320_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    try {
      await seedWindowEvents({
        provider: "claude",
        phase: "error",
        errors: 20,
        completed: 20,
        createdAt: windowSampleTs(fixedNow),
      });
    } finally {
      Date.now = originalNow;
    }

    // 制造不可用窗口参数，触发窗口聚合查询异常，验证评估引擎能兜底返回而不是抛出。
    Date.now = () => Number.NaN;

    try {
      const result = await evaluateOAuthSessionAlerts();
      expect(result.scannedGroups).toBe(0);
      expect(result.createdEvents).toBe(0);

      // 无论窗口内原本是否会触发告警，异常路径不应写入事件/投递记录。
      const listed = await queryOAuthAlertEvents({ page: 1, pageSize: 20 });
      expect(listed.total).toBe(0);

      const deliveries = await db.select().from(oauthAlertDeliveries);
      expect(deliveries).toHaveLength(0);
    } finally {
      Date.now = originalNow;
    }
  });
});
