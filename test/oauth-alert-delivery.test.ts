import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import {
  deliverOAuthAlertEvent,
  listOAuthAlertDeliveries,
} from "../src/lib/observability/alert-delivery";

async function ensureDeliveryTables() {
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
      CREATE TABLE IF NOT EXISTS core.oauth_alert_deliveries (
        id serial PRIMARY KEY,
        event_id integer NOT NULL,
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

const originalWebhookUrl = config.oauthAlerts.webhookUrl;
const originalWebhookSecret = config.oauthAlerts.webhookSecret;
const originalWecomUrl = config.oauthAlerts.wecomWebhookUrl;
const originalMentioned = [...config.oauthAlerts.wecomMentionedList];

describe("OAuth 告警投递模块", () => {
  beforeAll(async () => {
    await ensureDeliveryTables();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("DELETE FROM core.oauth_alert_deliveries"));
    config.oauthAlerts.webhookUrl = "";
    config.oauthAlerts.webhookSecret = "";
    config.oauthAlerts.wecomWebhookUrl = "";
    config.oauthAlerts.wecomMentionedList = [];
  });

  afterAll(() => {
    config.oauthAlerts.webhookUrl = originalWebhookUrl;
    config.oauthAlerts.webhookSecret = originalWebhookSecret;
    config.oauthAlerts.wecomWebhookUrl = originalWecomUrl;
    config.oauthAlerts.wecomMentionedList = originalMentioned;
  });

  it("Webhook 投递应带签名头并记录成功", async () => {
    config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
    config.oauthAlerts.webhookSecret = "delivery-secret";

    const calls: Array<{ headers: Headers; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      const summary = await deliverOAuthAlertEvent({
        id: 1001,
        provider: "claude",
        phase: "error",
        severity: "warning",
        totalCount: 50,
        failureCount: 20,
        failureRateBps: 4000,
        windowStart: 1_776_000_000_000,
        windowEnd: 1_776_000_300_000,
        message: "mock warning",
        createdAt: 1_776_000_305_000,
      });

      expect(summary.attemptedChannels).toBe(1);
      expect(summary.successfulChannels).toBe(1);
      expect(summary.failedChannels).toBe(0);
      expect(calls).toHaveLength(1);

      const timestamp = calls[0]?.headers.get("x-tokenpulse-timestamp") || "";
      const signature = calls[0]?.headers.get("x-tokenpulse-signature") || "";
      const expected = createHmac("sha256", "delivery-secret")
        .update(`${timestamp}.${calls[0]?.body || ""}`)
        .digest("hex");
      expect(signature).toBe(expected);

      const rows = await listOAuthAlertDeliveries({ eventId: 1001, limit: 10 });
      expect(rows.length).toBe(1);
      expect(rows[0]?.channel).toBe("webhook");
      expect(rows[0]?.status).toBe("success");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Webhook 失败应重试，企业微信成功应写入完整投递记录", async () => {
    config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
    config.oauthAlerts.wecomWebhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock";
    config.oauthAlerts.wecomMentionedList = ["@all"];

    const attempts: Record<string, number> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      attempts[url] = (attempts[url] || 0) + 1;
      if (url.includes("example.com")) {
        return new Response(JSON.stringify({ ok: false }), { status: 502 });
      }
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      const summary = await deliverOAuthAlertEvent({
        id: 1002,
        provider: "gemini",
        phase: "error",
        severity: "critical",
        totalCount: 100,
        failureCount: 80,
        failureRateBps: 8000,
        windowStart: 1_776_100_000_000,
        windowEnd: 1_776_100_300_000,
        message: "mock critical",
        createdAt: 1_776_100_305_000,
      });

      expect(summary.attemptedChannels).toBe(2);
      expect(summary.successfulChannels).toBe(1);
      expect(summary.failedChannels).toBe(1);
      expect(summary.totalAttempts).toBe(4);

      const rows = await listOAuthAlertDeliveries({ eventId: 1002, limit: 20 });
      expect(rows.filter((item) => item.channel === "webhook")).toHaveLength(3);
      expect(rows.some((item) => item.channel === "wecom" && item.status === "success")).toBe(
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("命中抑制策略应跳过真实发送并记录失败原因", async () => {
    config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
    config.oauthAlerts.wecomWebhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock";

    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      const summary = await deliverOAuthAlertEvent(
        {
          id: 1003,
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
      expect(summary.failedChannels).toBe(2);
      expect(summary.totalAttempts).toBe(0);

      const rows = await listOAuthAlertDeliveries({ eventId: 1003, limit: 20 });
      expect(rows).toHaveLength(2);
      expect(rows.every((item) => item.status === "failure")).toBe(true);
      expect(rows.every((item) => item.error === "muted_provider")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
