import { createHmac } from "node:crypto";
import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { config } from "../../config";
import { db } from "../../db";
import { oauthAlertDeliveries, oauthAlertEvents } from "../../db/schema";
import { logger } from "../logger";
import {
  oauthAlertDeliveryCounter,
  oauthAlertDeliveryDuration,
} from "../metrics";

export type OAuthAlertDeliveryChannel = "webhook" | "wecom";
export type OAuthAlertDeliveryStatus = "success" | "failure";
export type OAuthAlertMinDeliverySeverity = "warning" | "critical";
export type OAuthAlertDeliverySuppressionReason =
  | "muted_provider"
  | "below_min_severity"
  | "quiet_hours_suppressed";

export interface OAuthAlertDeliveryControl {
  muteProviders: string[];
  minDeliverySeverity: OAuthAlertMinDeliverySeverity;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  forcedChannels?: OAuthAlertDeliveryChannel[];
  now?: number;
}

export interface OAuthAlertDeliveryEvent {
  id: number;
  incidentId: string;
  provider: string;
  phase: string;
  severity: "warning" | "critical" | "recovery";
  totalCount: number;
  failureCount: number;
  failureRateBps: number;
  windowStart: number;
  windowEnd: number;
  message?: string | null;
  createdAt: number;
}

export interface OAuthAlertDeliverySummary {
  eventId: number;
  attemptedChannels: number;
  successfulChannels: number;
  failedChannels: number;
  totalAttempts: number;
}

export interface OAuthAlertDeliveryQuery {
  eventId?: number;
  incidentId?: string;
  channel?: OAuthAlertDeliveryChannel;
  status?: OAuthAlertDeliveryStatus;
  from?: number;
  to?: number;
  limit?: number;
}

const RETRY_DELAYS_MS = [300, 900] as const;
const DEFAULT_TIMEOUT_MS = 10_000;
const CLOCK_HHMM_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OAUTH_ALERT_LEGACY_INCIDENT_ID_PATTERN = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:\d+$/;
const OAUTH_ALERT_DELIVERY_LEGACY_INCIDENT_ID_PATTERN = /^legacy:(\d+)$/;
const OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX = "incident:legacy:delivery:";
const ALERT_DELIVERY_STATUS_SET = new Set(["success", "failure", "suppressed"]);
const ALERT_DELIVERY_REASON_SET = new Set([
  "none",
  "muted_provider",
  "below_min_severity",
  "quiet_hours_suppressed",
  "http_non_2xx",
  "request_error",
]);

function canonicalizeIncidentId(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return normalized.startsWith("incident:") ? normalized : null;
}

function buildOAuthAlertIncidentIdQueryVariants(incidentId: string): string[] {
  const normalized = incidentId.trim();
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const deliveryLegacyMatch = normalized.match(OAUTH_ALERT_DELIVERY_LEGACY_INCIDENT_ID_PATTERN);
  const syntheticLegacyMatch = normalized.match(/^incident:legacy:delivery:(\d+)$/);
  const incidentMatch = syntheticLegacyMatch
    ? null
    : normalized.match(/^incident:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):(\d+)$/);
  const legacyMatch = OAUTH_ALERT_LEGACY_INCIDENT_ID_PATTERN.test(normalized)
    ? normalized.match(/^([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):(\d+)$/)
    : null;

  if (incidentMatch) {
    const [, provider, phase, eventId] = incidentMatch;
    variants.add(`${provider}:${phase}:${eventId}`);
    variants.add(`legacy:${eventId}`);
    variants.add(`${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${eventId}`);
  }
  if (legacyMatch) {
    const [, provider, phase, eventId] = legacyMatch;
    variants.add(`incident:${provider}:${phase}:${eventId}`);
    variants.add(`legacy:${eventId}`);
    variants.add(`${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${eventId}`);
  }
  if (deliveryLegacyMatch) {
    variants.add(`${OAUTH_ALERT_DELIVERY_SYNTHETIC_PREFIX}${deliveryLegacyMatch[1]}`);
  }
  if (syntheticLegacyMatch) {
    variants.add(`legacy:${syntheticLegacyMatch[1]}`);
  }

  return [...variants];
}

function normalizeMetricProvider(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "unknown";
}

function normalizeMetricPhase(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "unknown";
}

function normalizeMetricSeverity(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "warning" || normalized === "critical" || normalized === "recovery") {
    return normalized;
  }
  return "unknown";
}

function normalizeMetricChannel(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "webhook" || normalized === "wecom") {
    return normalized;
  }
  return "unknown";
}

function normalizeMetricStatus(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return ALERT_DELIVERY_STATUS_SET.has(normalized) ? normalized : "failure";
}

function normalizeMetricReason(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return ALERT_DELIVERY_REASON_SET.has(normalized) ? normalized : "request_error";
}

function recordDeliveryMetric(input: {
  event: OAuthAlertDeliveryEvent;
  channel: string;
  status: string;
  reason?: string;
  durationMs?: number;
}) {
  try {
    const provider = normalizeMetricProvider(input.event.provider);
    const phase = normalizeMetricPhase(input.event.phase);
    const severity = normalizeMetricSeverity(input.event.severity);
    const channel = normalizeMetricChannel(input.channel);
    const status = normalizeMetricStatus(input.status);
    const reason = normalizeMetricReason(input.reason);
    oauthAlertDeliveryCounter.inc({
      provider,
      phase,
      severity,
      channel,
      status,
      reason,
    });
    if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
      const durationSec = Math.max(0, input.durationMs / 1000);
      oauthAlertDeliveryDuration.observe(
        {
          provider,
          phase,
          severity,
          channel,
          status,
        },
        durationSec,
      );
    }
  } catch {
    // 指标异常不影响主流程。
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string | undefined | null, max = 2048): string | null {
  const normalized = (value || "").trim();
  if (!normalized) return null;
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function toPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

function parseClockMinutes(clockText: string): number | null {
  if (!CLOCK_HHMM_PATTERN.test(clockText)) return null;
  const parts = clockText.split(":");
  if (parts.length !== 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function resolveTimezoneMinutes(nowMs: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value || "NaN");
    const minute = Number(parts.find((part) => part.type === "minute")?.value || "NaN");
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function inQuietHoursWindow(current: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function getSeverityScore(
  severity: OAuthAlertDeliveryEvent["severity"] | OAuthAlertMinDeliverySeverity,
) {
  if (severity === "critical") return 2;
  return 1;
}

export function resolveOAuthAlertDeliverySuppressionReason(
  event: OAuthAlertDeliveryEvent,
  control?: OAuthAlertDeliveryControl,
): OAuthAlertDeliverySuppressionReason | null {
  if (!control) return null;

  const muted = new Set(
    (control.muteProviders || [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (muted.has(event.provider.trim().toLowerCase())) {
    return "muted_provider";
  }

  const eventSeverity = getSeverityScore(event.severity);
  const minSeverity = getSeverityScore(control.minDeliverySeverity);
  if (eventSeverity < minSeverity) {
    return "below_min_severity";
  }

  if (!control.quietHoursEnabled) {
    return null;
  }
  const start = parseClockMinutes(control.quietHoursStart);
  const end = parseClockMinutes(control.quietHoursEnd);
  if (start === null || end === null) {
    return null;
  }
  const current = resolveTimezoneMinutes(control.now ?? Date.now(), control.quietHoursTimezone);
  if (current === null) {
    return null;
  }
  return inQuietHoursWindow(current, start, end) ? "quiet_hours_suppressed" : null;
}

function buildMessage(event: OAuthAlertDeliveryEvent): string {
  const lines = [
    `[TokenPulse OAuth 告警] ${event.severity.toUpperCase()}`,
    `provider=${event.provider}`,
    `phase=${event.phase}`,
    `失败率=${toPercent(event.failureRateBps)}% 失败数=${event.failureCount}/${event.totalCount}`,
    `窗口=${new Date(event.windowStart).toISOString()} ~ ${new Date(event.windowEnd).toISOString()}`,
  ];
  if (event.message) {
    lines.push(`描述=${event.message}`);
  }
  return lines.join("\n");
}

function buildWebhookHeaders(payload: string, secret: string) {
  const timestamp = `${Date.now()}`;
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-tokenpulse-timestamp": timestamp,
    "x-tokenpulse-signature": signature,
  };
}

async function persistDeliveryAttempt(params: {
  eventId: number;
  incidentId: string;
  channel: OAuthAlertDeliveryChannel;
  target: string;
  attempt: number;
  status: OAuthAlertDeliveryStatus;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
}) {
  try {
    await db.insert(oauthAlertDeliveries).values({
      eventId: params.eventId,
      incidentId: params.incidentId,
      channel: params.channel,
      target: normalizeText(params.target, 512),
      attempt: params.attempt,
      status: params.status,
      responseStatus: params.responseStatus || null,
      responseBody: normalizeText(params.responseBody, 4000),
      error: normalizeText(params.error, 1024),
      sentAt: Date.now(),
    });
  } catch {
    // 投递记录失败不阻断主流程。
  }
}

async function persistSuppressedDeliveryAttempts(
  event: OAuthAlertDeliveryEvent,
  reason: OAuthAlertDeliverySuppressionReason,
  forcedChannels?: OAuthAlertDeliveryChannel[],
): Promise<number> {
  const forcedChannelSet = new Set(
    (forcedChannels || [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => item === "webhook" || item === "wecom"),
  );
  const allowWebhook = forcedChannelSet.size === 0 || forcedChannelSet.has("webhook");
  const allowWecom = forcedChannelSet.size === 0 || forcedChannelSet.has("wecom");

  const targets: Array<{ channel: OAuthAlertDeliveryChannel; url: string }> = [];
  if (allowWebhook && config.oauthAlerts.webhookUrl) {
    targets.push({ channel: "webhook", url: config.oauthAlerts.webhookUrl });
  }
  if (allowWecom && config.oauthAlerts.wecomWebhookUrl) {
    targets.push({ channel: "wecom", url: config.oauthAlerts.wecomWebhookUrl });
  }

  if (targets.length === 0) {
    return 0;
  }

  await Promise.all(
    targets.map((target) =>
      persistDeliveryAttempt({
        eventId: event.id,
        incidentId: event.incidentId,
        channel: target.channel,
        target: target.url,
        attempt: 1,
        status: "failure",
        error: reason,
      }),
    ),
  );
  for (const target of targets) {
    recordDeliveryMetric({
      event,
      channel: target.channel,
      status: "suppressed",
      reason,
      durationMs: 0,
    });
  }
  return targets.length;
}

async function postWithRetry(options: {
  event: OAuthAlertDeliveryEvent;
  channel: OAuthAlertDeliveryChannel;
  url: string;
  body: unknown;
  headers?: Record<string, string>;
}): Promise<{ attempts: number; success: boolean }> {
  const bodyText = JSON.stringify(options.body);
  let attempts = 0;

  for (let idx = 0; idx <= RETRY_DELAYS_MS.length; idx += 1) {
    if (idx > 0) {
      await sleep(RETRY_DELAYS_MS[idx - 1] || 0);
    }

    attempts += 1;
    const attempt = idx + 1;
    const startedAt = Date.now();

    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
        body: bodyText,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      const responseText = normalizeText(await response.text(), 4000) || "";

      await persistDeliveryAttempt({
          eventId: options.event.id,
          incidentId: options.event.incidentId,
          channel: options.channel,
          target: options.url,
        attempt,
        status: response.ok ? "success" : "failure",
        responseStatus: response.status,
        responseBody: responseText,
      });
      recordDeliveryMetric({
        event: options.event,
        channel: options.channel,
        status: response.ok ? "success" : "failure",
        reason: response.ok ? "none" : "http_non_2xx",
        durationMs: Date.now() - startedAt,
      });

      if (response.ok) {
        return { attempts, success: true };
      }
    } catch (error) {
      await persistDeliveryAttempt({
          eventId: options.event.id,
          incidentId: options.event.incidentId,
          channel: options.channel,
          target: options.url,
        attempt,
        status: "failure",
        error: error instanceof Error ? error.message : String(error),
      });
      recordDeliveryMetric({
        event: options.event,
        channel: options.channel,
        status: "failure",
        reason: "request_error",
        durationMs: Date.now() - startedAt,
      });
    }
  }

  return { attempts, success: false };
}

async function deliverWebhook(
  event: OAuthAlertDeliveryEvent,
): Promise<{ attempted: boolean; attempts: number; success: boolean }> {
  const url = config.oauthAlerts.webhookUrl;
  if (!url) return { attempted: false, attempts: 0, success: false };

  const payload = {
    eventType: "oauth_session_alert",
    event: {
      id: event.id,
      provider: event.provider,
      phase: event.phase,
      severity: event.severity,
      totalCount: event.totalCount,
      failureCount: event.failureCount,
      failureRateBps: event.failureRateBps,
      windowStart: event.windowStart,
      windowEnd: event.windowEnd,
      createdAt: event.createdAt,
      message: event.message || undefined,
    },
  };

  const payloadText = JSON.stringify(payload);
  const headers = config.oauthAlerts.webhookSecret
    ? buildWebhookHeaders(payloadText, config.oauthAlerts.webhookSecret)
    : { "content-type": "application/json" };

  const result = await postWithRetry({
    event,
    channel: "webhook",
    url,
    body: payload,
    headers,
  });

  return { attempted: true, attempts: result.attempts, success: result.success };
}

async function deliverWecom(
  event: OAuthAlertDeliveryEvent,
): Promise<{ attempted: boolean; attempts: number; success: boolean }> {
  const url = config.oauthAlerts.wecomWebhookUrl;
  if (!url) return { attempted: false, attempts: 0, success: false };

  const mentionedList = config.oauthAlerts.wecomMentionedList;
  const payload = {
    msgtype: "text",
    text: {
      content: buildMessage(event),
      ...(mentionedList.length > 0 ? { mentioned_list: mentionedList } : {}),
    },
  };

  const result = await postWithRetry({
    event,
    channel: "wecom",
    url,
    body: payload,
  });

  return { attempted: true, attempts: result.attempts, success: result.success };
}

export async function deliverOAuthAlertEvent(
  event: OAuthAlertDeliveryEvent,
  control?: OAuthAlertDeliveryControl,
): Promise<OAuthAlertDeliverySummary> {
  const forcedChannelSet = new Set(
    (control?.forcedChannels || [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => item === "webhook" || item === "wecom"),
  );
  const allowWebhook = forcedChannelSet.size === 0 || forcedChannelSet.has("webhook");
  const allowWecom = forcedChannelSet.size === 0 || forcedChannelSet.has("wecom");

  const suppressionReason = resolveOAuthAlertDeliverySuppressionReason(event, control);
  if (suppressionReason) {
    const suppressedChannels = await persistSuppressedDeliveryAttempts(
      event,
      suppressionReason,
      [...forcedChannelSet] as OAuthAlertDeliveryChannel[],
    );
    return {
      eventId: event.id,
      attemptedChannels: suppressedChannels,
      successfulChannels: 0,
      failedChannels: suppressedChannels,
      totalAttempts: 0,
    };
  }

  const results = await Promise.all([
    allowWebhook ? deliverWebhook(event) : Promise.resolve({ attempted: false, attempts: 0, success: false }),
    allowWecom ? deliverWecom(event) : Promise.resolve({ attempted: false, attempts: 0, success: false }),
  ]);
  const attemptedChannels = results.filter((item) => item.attempted).length;
  const successfulChannels = results.filter((item) => item.attempted && item.success).length;
  const failedChannels = results.filter((item) => item.attempted && !item.success).length;
  const totalAttempts = results.reduce((sum, item) => sum + item.attempts, 0);

  if (attemptedChannels > 0 && failedChannels > 0) {
    logger.warn(
      `[OAuth 告警] 事件 ${event.id} 投递部分失败: 成功通道 ${successfulChannels}/${attemptedChannels}`,
      "OAuthAlert",
    );
  }

  return {
    eventId: event.id,
    attemptedChannels,
    successfulChannels,
    failedChannels,
    totalAttempts,
  };
}

export async function listOAuthAlertDeliveries(query: OAuthAlertDeliveryQuery = {}) {
  const safeLimit = Math.max(1, Math.min(query.limit || 50, 200));
  const filters = [];
  const canonicalIncidentIdExpr = sql<string | null>`
    CASE
      WHEN ${oauthAlertEvents.incidentId} IS NOT NULL
        AND btrim(${oauthAlertEvents.incidentId}) <> ''
        AND ${oauthAlertEvents.incidentId} LIKE 'incident:%'
        THEN ${oauthAlertEvents.incidentId}
      WHEN ${oauthAlertDeliveries.incidentId} IS NOT NULL
        AND btrim(${oauthAlertDeliveries.incidentId}) <> ''
        AND ${oauthAlertDeliveries.incidentId} LIKE 'incident:%'
        THEN ${oauthAlertDeliveries.incidentId}
      WHEN ${oauthAlertEvents.id} IS NOT NULL
        THEN 'incident:' || ${oauthAlertEvents.provider} || ':' || ${oauthAlertEvents.phase} || ':' || ${oauthAlertDeliveries.eventId}::text
      ELSE NULL
    END
  `;

  if (typeof query.eventId === "number" && Number.isFinite(query.eventId)) {
    filters.push(eq(oauthAlertDeliveries.eventId, Math.floor(query.eventId)));
  }
  if (typeof query.incidentId === "string" && query.incidentId.trim()) {
    const incidentIdVariants = buildOAuthAlertIncidentIdQueryVariants(query.incidentId);
    filters.push(
      or(
        ...incidentIdVariants.flatMap((incidentId) => [
          eq(oauthAlertDeliveries.incidentId, incidentId),
          eq(oauthAlertEvents.incidentId, incidentId),
          sql`${canonicalIncidentIdExpr} = ${incidentId}`,
        ]),
      )!,
    );
  }
  if (query.channel) {
    filters.push(eq(oauthAlertDeliveries.channel, query.channel));
  }
  if (query.status) {
    filters.push(eq(oauthAlertDeliveries.status, query.status));
  }
  if (typeof query.from === "number" && Number.isFinite(query.from)) {
    filters.push(gte(oauthAlertDeliveries.sentAt, Math.floor(query.from)));
  }
  if (typeof query.to === "number" && Number.isFinite(query.to)) {
    filters.push(lte(oauthAlertDeliveries.sentAt, Math.floor(query.to)));
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  try {
    const rows = await db
      .select({
        id: oauthAlertDeliveries.id,
        eventId: oauthAlertDeliveries.eventId,
        incidentId: canonicalIncidentIdExpr,
        channel: oauthAlertDeliveries.channel,
        target: oauthAlertDeliveries.target,
        attempt: oauthAlertDeliveries.attempt,
        status: oauthAlertDeliveries.status,
        responseStatus: oauthAlertDeliveries.responseStatus,
        responseBody: oauthAlertDeliveries.responseBody,
        error: oauthAlertDeliveries.error,
        sentAt: oauthAlertDeliveries.sentAt,
      })
      .from(oauthAlertDeliveries)
      .leftJoin(oauthAlertEvents, eq(oauthAlertDeliveries.eventId, oauthAlertEvents.id))
      .where(whereClause)
      .orderBy(desc(oauthAlertDeliveries.sentAt), desc(oauthAlertDeliveries.id))
      .limit(safeLimit);
    return rows.map((row) => ({
      ...row,
      incidentId: canonicalizeIncidentId(row.incidentId),
    }));
  } catch {
    return [];
  }
}
