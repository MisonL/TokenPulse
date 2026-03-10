import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  oauthAlertConfigs,
  oauthAlertEvents,
  oauthSessionEvents,
  type OauthAlertConfig,
} from "../../db/schema";
import { logger } from "../logger";
import {
  oauthAlertEvaluationDuration,
  oauthAlertEventsCounter,
} from "../metrics";
import {
  deliverOAuthAlertEvent,
  type OAuthAlertDeliveryControl,
  type OAuthAlertDeliveryChannel,
  type OAuthAlertMinDeliverySeverity,
} from "./alert-delivery";
import {
  evaluateOAuthAlertRuleDecision,
  getActiveOAuthAlertRuleVersion,
  isOAuthAlertRuleVersionMuteWindowActive,
  resolveOAuthAlertRuleRecoveryConsecutiveWindows,
  type OAuthAlertRuleVersion,
} from "./oauth-alert-rules";

export type OAuthAlertSeverity = "warning" | "critical" | "recovery";

export interface OAuthAlertEngineConfig {
  enabled: boolean;
  warningRateThresholdBps: number;
  warningFailureCountThreshold: number;
  criticalRateThresholdBps: number;
  criticalFailureCountThreshold: number;
  recoveryRateThresholdBps: number;
  recoveryFailureCountThreshold: number;
  dedupeWindowSec: number;
  recoveryConsecutiveWindows: number;
  windowSizeSec: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  muteProviders: string[];
  minDeliverySeverity: OAuthAlertMinDeliverySeverity;
}

export interface OAuthAlertConfigUpdate {
  enabled?: boolean;
  warningRateThresholdBps?: number;
  warningFailureCountThreshold?: number;
  criticalRateThresholdBps?: number;
  criticalFailureCountThreshold?: number;
  recoveryRateThresholdBps?: number;
  recoveryFailureCountThreshold?: number;
  dedupeWindowSec?: number;
  recoveryConsecutiveWindows?: number;
  windowSizeSec?: number;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezone?: string;
  muteProviders?: string[];
  minDeliverySeverity?: OAuthAlertMinDeliverySeverity;
}

export interface OAuthAlertEventQuery {
  page?: number;
  pageSize?: number;
  incidentId?: string;
  provider?: string;
  phase?: string;
  severity?: OAuthAlertSeverity;
  from?: number;
  to?: number;
}

export interface OAuthAlertEventListItem {
  id: number;
  incidentId: string;
  provider: string;
  phase: string;
  severity: OAuthAlertSeverity;
  totalCount: number;
  failureCount: number;
  failureRateBps: number;
  statusBreakdown: Record<string, number>;
  windowStart: number;
  windowEnd: number;
  dedupeKey: string;
  message: string | null;
  createdAt: number;
}

export interface OAuthAlertEventQueryResult {
  data: OAuthAlertEventListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OAuthAlertEvaluationResult {
  windowStart: number;
  windowEnd: number;
  scannedGroups: number;
  createdEvents: number;
  deliveryAttempts: number;
  deliveryFailedChannels: number;
}

interface OAuthAlertWindowAggregate {
  provider: string;
  phase: string;
  totalCount: number;
  failureCount: number;
  failureRateBps: number;
  statusBreakdown: Record<string, number>;
}

const DEFAULT_CONFIG: OAuthAlertEngineConfig = {
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
  minDeliverySeverity: "warning",
};

const healthyWindowStreak = new Map<string, number>();
const CLOCK_HHMM_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OAUTH_ALERT_DELIVERY_LEGACY_INCIDENT_ID_PATTERN = /^legacy:(\d+)$/;
const OAUTH_ALERT_DELIVERY_SYNTHETIC_INCIDENT_ID_PATTERN = /^incident:legacy:delivery:(\d+)$/;
const ALERT_EVENT_RESULT_SET = new Set(["created", "skipped", "failed"]);
const ALERT_EVENT_REASON_SET = new Set([
  "threshold_breached",
  "recovery_threshold_met",
  "dedupe_suppressed",
  "rule_suppressed",
  "mute_window_suppressed",
  "rule_override",
  "engine_disabled",
  "evaluation_error",
  "event_insert_failed",
]);
const ALERT_EVAL_RESULT_SET = new Set(["success", "skipped", "failed"]);

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

function normalizeMetricEventResult(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return ALERT_EVENT_RESULT_SET.has(normalized) ? normalized : "failed";
}

function normalizeMetricEventReason(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return ALERT_EVENT_REASON_SET.has(normalized) ? normalized : "evaluation_error";
}

function normalizeMetricEvalResult(value: string | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return ALERT_EVAL_RESULT_SET.has(normalized) ? normalized : "failed";
}

function recordAlertEventMetric(input: {
  provider?: string;
  phase?: string;
  severity?: string;
  result?: string;
  reason?: string;
}) {
  try {
    oauthAlertEventsCounter.inc({
      provider: normalizeMetricProvider(input.provider),
      phase: normalizeMetricPhase(input.phase),
      severity: normalizeMetricSeverity(input.severity),
      result: normalizeMetricEventResult(input.result),
      reason: normalizeMetricEventReason(input.reason),
    });
  } catch {
    // 指标异常不影响主链路。
  }
}

function observeAlertEvaluationDuration(result: string, startedAtMs: number) {
  try {
    const durationSec = Math.max(0, (Date.now() - startedAtMs) / 1000);
    oauthAlertEvaluationDuration.observe(
      { result: normalizeMetricEvalResult(result) },
      durationSec,
    );
  } catch {
    // 指标异常不影响主链路。
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizePage(value: number | undefined): number {
  return clampInt(value, 1, 1, 100_000);
}

function normalizePageSize(value: number | undefined): number {
  return clampInt(value, 20, 1, 200);
}

function normalizeClockText(value: unknown, fallback: string): string {
  const normalized = String(value || "").trim();
  if (CLOCK_HHMM_PATTERN.test(normalized)) return normalized;
  return fallback;
}

function normalizeTimeZone(value: unknown, fallback: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  try {
    Intl.DateTimeFormat("zh-CN", { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    return fallback;
  }
}

function normalizeMutedProviders(value: unknown): string[] {
  let source: unknown[] = [];
  if (Array.isArray(value)) {
    source = value;
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        source = parsed;
      }
    } catch {
      source = [];
    }
  }

  return Array.from(
    new Set(
      source
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function normalizeMinDeliverySeverity(
  value: unknown,
  fallback: OAuthAlertMinDeliverySeverity,
): OAuthAlertMinDeliverySeverity {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "warning") return "warning";
  return fallback;
}

function normalizeConfig(raw?: OauthAlertConfig | null): OAuthAlertEngineConfig {
  if (!raw) return { ...DEFAULT_CONFIG };
  return {
    enabled: raw.enabled !== 0,
    warningRateThresholdBps: clampInt(
      raw.warningRateThresholdBps,
      DEFAULT_CONFIG.warningRateThresholdBps,
      1,
      10_000,
    ),
    warningFailureCountThreshold: clampInt(
      raw.warningFailureCountThreshold,
      DEFAULT_CONFIG.warningFailureCountThreshold,
      1,
      1_000_000,
    ),
    criticalRateThresholdBps: clampInt(
      raw.criticalRateThresholdBps,
      DEFAULT_CONFIG.criticalRateThresholdBps,
      1,
      10_000,
    ),
    criticalFailureCountThreshold: clampInt(
      raw.criticalFailureCountThreshold,
      DEFAULT_CONFIG.criticalFailureCountThreshold,
      1,
      1_000_000,
    ),
    recoveryRateThresholdBps: clampInt(
      raw.recoveryRateThresholdBps,
      DEFAULT_CONFIG.recoveryRateThresholdBps,
      0,
      10_000,
    ),
    recoveryFailureCountThreshold: clampInt(
      raw.recoveryFailureCountThreshold,
      DEFAULT_CONFIG.recoveryFailureCountThreshold,
      0,
      1_000_000,
    ),
    dedupeWindowSec: clampInt(raw.dedupeWindowSec, DEFAULT_CONFIG.dedupeWindowSec, 0, 86_400),
    recoveryConsecutiveWindows: clampInt(
      raw.recoveryConsecutiveWindows,
      DEFAULT_CONFIG.recoveryConsecutiveWindows,
      1,
      1_000,
    ),
    windowSizeSec: clampInt(raw.windowSizeSec, DEFAULT_CONFIG.windowSizeSec, 60, 86_400),
    quietHoursEnabled: raw.quietHoursEnabled !== 0,
    quietHoursStart: normalizeClockText(
      raw.quietHoursStart,
      DEFAULT_CONFIG.quietHoursStart,
    ),
    quietHoursEnd: normalizeClockText(raw.quietHoursEnd, DEFAULT_CONFIG.quietHoursEnd),
    quietHoursTimezone: normalizeTimeZone(
      raw.quietHoursTimezone,
      DEFAULT_CONFIG.quietHoursTimezone,
    ),
    muteProviders: normalizeMutedProviders(raw.muteProviders),
    minDeliverySeverity: normalizeMinDeliverySeverity(
      raw.minDeliverySeverity,
      DEFAULT_CONFIG.minDeliverySeverity,
    ),
  };
}

function mergeConfig(
  current: OAuthAlertEngineConfig,
  patch: OAuthAlertConfigUpdate,
): OAuthAlertEngineConfig {
  return {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    warningRateThresholdBps: clampInt(
      patch.warningRateThresholdBps,
      current.warningRateThresholdBps,
      1,
      10_000,
    ),
    warningFailureCountThreshold: clampInt(
      patch.warningFailureCountThreshold,
      current.warningFailureCountThreshold,
      1,
      1_000_000,
    ),
    criticalRateThresholdBps: clampInt(
      patch.criticalRateThresholdBps,
      current.criticalRateThresholdBps,
      1,
      10_000,
    ),
    criticalFailureCountThreshold: clampInt(
      patch.criticalFailureCountThreshold,
      current.criticalFailureCountThreshold,
      1,
      1_000_000,
    ),
    recoveryRateThresholdBps: clampInt(
      patch.recoveryRateThresholdBps,
      current.recoveryRateThresholdBps,
      0,
      10_000,
    ),
    recoveryFailureCountThreshold: clampInt(
      patch.recoveryFailureCountThreshold,
      current.recoveryFailureCountThreshold,
      0,
      1_000_000,
    ),
    dedupeWindowSec: clampInt(
      patch.dedupeWindowSec,
      current.dedupeWindowSec,
      0,
      86_400,
    ),
    recoveryConsecutiveWindows: clampInt(
      patch.recoveryConsecutiveWindows,
      current.recoveryConsecutiveWindows,
      1,
      1_000,
    ),
    windowSizeSec: clampInt(patch.windowSizeSec, current.windowSizeSec, 60, 86_400),
    quietHoursEnabled:
      typeof patch.quietHoursEnabled === "boolean"
        ? patch.quietHoursEnabled
        : current.quietHoursEnabled,
    quietHoursStart: normalizeClockText(
      patch.quietHoursStart,
      current.quietHoursStart,
    ),
    quietHoursEnd: normalizeClockText(patch.quietHoursEnd, current.quietHoursEnd),
    quietHoursTimezone: normalizeTimeZone(
      patch.quietHoursTimezone,
      current.quietHoursTimezone,
    ),
    muteProviders:
      typeof patch.muteProviders === "undefined"
        ? current.muteProviders
        : normalizeMutedProviders(patch.muteProviders),
    minDeliverySeverity: normalizeMinDeliverySeverity(
      patch.minDeliverySeverity,
      current.minDeliverySeverity,
    ),
  };
}

function toConfigPersistencePayload(configValue: OAuthAlertEngineConfig, now: number) {
  return {
    enabled: configValue.enabled ? 1 : 0,
    warningRateThresholdBps: configValue.warningRateThresholdBps,
    warningFailureCountThreshold: configValue.warningFailureCountThreshold,
    criticalRateThresholdBps: configValue.criticalRateThresholdBps,
    criticalFailureCountThreshold: configValue.criticalFailureCountThreshold,
    recoveryRateThresholdBps: configValue.recoveryRateThresholdBps,
    recoveryFailureCountThreshold: configValue.recoveryFailureCountThreshold,
    dedupeWindowSec: configValue.dedupeWindowSec,
    recoveryConsecutiveWindows: configValue.recoveryConsecutiveWindows,
    windowSizeSec: configValue.windowSizeSec,
    quietHoursEnabled: configValue.quietHoursEnabled ? 1 : 0,
    quietHoursStart: configValue.quietHoursStart,
    quietHoursEnd: configValue.quietHoursEnd,
    quietHoursTimezone: configValue.quietHoursTimezone,
    muteProviders: JSON.stringify(configValue.muteProviders),
    minDeliverySeverity: configValue.minDeliverySeverity,
    updatedAt: now,
  };
}

export function buildOAuthAlertDeliveryControl(
  configValue: OAuthAlertEngineConfig,
): OAuthAlertDeliveryControl {
  return {
    muteProviders: configValue.muteProviders,
    minDeliverySeverity: configValue.minDeliverySeverity,
    quietHoursEnabled: configValue.quietHoursEnabled,
    quietHoursStart: configValue.quietHoursStart,
    quietHoursEnd: configValue.quietHoursEnd,
    quietHoursTimezone: configValue.quietHoursTimezone,
  };
}

function buildDedupeKey(provider: string, phase: string, severity: OAuthAlertSeverity): string {
  return `${provider}:${phase}:${severity}`;
}

function buildAlertMessage(
  severity: OAuthAlertSeverity,
  aggregate: OAuthAlertWindowAggregate,
  windowStart: number,
  windowEnd: number,
): string {
  return [
    `severity=${severity}`,
    `provider=${aggregate.provider}`,
    `phase=${aggregate.phase}`,
    `failureRate=${(aggregate.failureRateBps / 100).toFixed(2)}%`,
    `failureCount=${aggregate.failureCount}/${aggregate.totalCount}`,
    `window=${new Date(windowStart).toISOString()}~${new Date(windowEnd).toISOString()}`,
  ].join(" ");
}

function normalizeIncidentId(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return normalized.startsWith("incident:") ? normalized : null;
}

function buildLegacyIncidentId(provider: string, phase: string, eventId: number): string {
  return `incident:${provider}:${phase}:${eventId}`;
}

function buildIncidentIdQueryVariants(incidentId: string): string[] {
  const normalized = incidentId.trim();
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const canonicalMatch = normalized.match(/^incident:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):(\d+)$/);
  const legacyMatch = normalized.match(/^([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):(\d+)$/);

  if (canonicalMatch) {
    const [, provider, phase, eventId] = canonicalMatch;
    variants.add(`${provider}:${phase}:${eventId}`);
  }
  if (legacyMatch) {
    const [, provider, phase, eventId] = legacyMatch;
    variants.add(`incident:${provider}:${phase}:${eventId}`);
  }

  return [...variants];
}

function buildIncidentId(provider: string, phase: string): string {
  return `incident:${provider}:${phase}:${crypto.randomUUID()}`;
}

function parseLegacyIncidentEventId(incidentId: string): number | null {
  const normalized = incidentId.trim();
  if (!normalized) return null;
  const match =
    normalized.match(OAUTH_ALERT_DELIVERY_LEGACY_INCIDENT_ID_PATTERN) ||
    normalized.match(OAUTH_ALERT_DELIVERY_SYNTHETIC_INCIDENT_ID_PATTERN);
  if (!match?.[1]) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

export async function resolveOAuthAlertIncidentId(params: {
  provider: string;
  phase: string;
  severity: OAuthAlertSeverity;
}) {
  const rows = await db
    .select({
      id: oauthAlertEvents.id,
      incidentId: oauthAlertEvents.incidentId,
      severity: oauthAlertEvents.severity,
    })
    .from(oauthAlertEvents)
    .where(
      and(
        eq(oauthAlertEvents.provider, params.provider),
        eq(oauthAlertEvents.phase, params.phase),
      ),
    )
    .orderBy(desc(oauthAlertEvents.createdAt), desc(oauthAlertEvents.id))
    .limit(1);

  const latest = rows[0];
  if (latest && latest.severity !== "recovery") {
    return (
      normalizeIncidentId(latest.incidentId) ||
      buildLegacyIncidentId(params.provider, params.phase, latest.id)
    );
  }

  return buildIncidentId(params.provider, params.phase);
}

function parseStatusBreakdown(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [status, value] of Object.entries(parsed)) {
      result[status] = clampInt(value, 0, 0, Number.MAX_SAFE_INTEGER);
    }
    return result;
  } catch {
    return {};
  }
}

async function loadLatestConfigRow() {
  const rows = await db
    .select()
    .from(oauthAlertConfigs)
    .orderBy(desc(oauthAlertConfigs.updatedAt), desc(oauthAlertConfigs.id))
    .limit(1);
  return rows[0] || null;
}

async function hasRecentEvent(dedupeKey: string, minCreatedAt: number): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: oauthAlertEvents.id })
      .from(oauthAlertEvents)
      .where(
        and(
          eq(oauthAlertEvents.dedupeKey, dedupeKey),
          gte(oauthAlertEvents.createdAt, minCreatedAt),
        ),
      )
      .orderBy(desc(oauthAlertEvents.createdAt), desc(oauthAlertEvents.id))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function getLatestEventByProviderAndPhase(provider: string, phase: string) {
  try {
    const rows = await db
      .select()
      .from(oauthAlertEvents)
      .where(and(eq(oauthAlertEvents.provider, provider), eq(oauthAlertEvents.phase, phase)))
      .orderBy(desc(oauthAlertEvents.createdAt), desc(oauthAlertEvents.id))
      .limit(1);
    return rows[0] || null;
  } catch {
    return null;
  }
}

function resolveSeverity(
  aggregate: OAuthAlertWindowAggregate,
  configValue: OAuthAlertEngineConfig,
): OAuthAlertSeverity | null {
  const isCritical =
    aggregate.failureRateBps >= configValue.criticalRateThresholdBps &&
    aggregate.failureCount >= configValue.criticalFailureCountThreshold;
  if (isCritical) return "critical";

  const isWarning =
    aggregate.failureRateBps >= configValue.warningRateThresholdBps &&
    aggregate.failureCount >= configValue.warningFailureCountThreshold;
  if (isWarning) return "warning";

  return null;
}

function parseClockMinutes(clockText: string): number | null {
  if (!CLOCK_HHMM_PATTERN.test(clockText)) return null;
  const [hourText, minuteText] = clockText.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
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

function inQuietHours(configValue: OAuthAlertEngineConfig, nowMs: number): boolean {
  if (!configValue.quietHoursEnabled) return false;
  const start = parseClockMinutes(configValue.quietHoursStart);
  const end = parseClockMinutes(configValue.quietHoursEnd);
  const current = resolveTimezoneMinutes(nowMs, configValue.quietHoursTimezone);
  if (start === null || end === null || current === null) return false;
  if (start === end) return true;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

async function applyRuleDecision(params: {
  activeRuleVersion: OAuthAlertRuleVersion | null;
  aggregate: OAuthAlertWindowAggregate;
  defaultSeverity: OAuthAlertSeverity | null;
  configValue: OAuthAlertEngineConfig;
  nowMs: number;
}): Promise<{
  severity: OAuthAlertSeverity | null;
  suppressed: boolean;
  suppressionReason: "rule_suppressed" | "mute_window_suppressed" | null;
  forcedChannels: OAuthAlertDeliveryChannel[];
}> {
  const muteWindowActive = isOAuthAlertRuleVersionMuteWindowActive({
    version: params.activeRuleVersion,
    severity: params.defaultSeverity,
    nowMs: params.nowMs,
  });
  const decision = await evaluateOAuthAlertRuleDecision({
    activeVersion: params.activeRuleVersion,
    defaultSeverity: params.defaultSeverity,
    context: {
      provider: params.aggregate.provider,
      phase: params.aggregate.phase,
      severity: params.defaultSeverity,
      failureRateBps: params.aggregate.failureRateBps,
      failureCount: params.aggregate.failureCount,
      totalCount: params.aggregate.totalCount,
      quietHours: inQuietHours(params.configValue, params.nowMs) || muteWindowActive,
    },
  });

  const suppressedByMuteWindow =
    muteWindowActive &&
    decision.action !== "escalate" &&
    decision.action !== "suppress";
  const suppressed = decision.action === "suppress" || suppressedByMuteWindow;

  return {
    severity: decision.severity,
    suppressed,
    suppressionReason: suppressed
      ? suppressedByMuteWindow
        ? "mute_window_suppressed"
        : "rule_suppressed"
      : null,
    forcedChannels: decision.channels,
  };
}

function isHealthyForRecovery(
  aggregate: OAuthAlertWindowAggregate,
  configValue: OAuthAlertEngineConfig,
): boolean {
  return (
    aggregate.failureRateBps < configValue.recoveryRateThresholdBps &&
    aggregate.failureCount < configValue.recoveryFailureCountThreshold
  );
}

async function createAlertEvent(params: {
  severity: OAuthAlertSeverity;
  aggregate: OAuthAlertWindowAggregate;
  windowStart: number;
  windowEnd: number;
}) {
  const dedupeKey = buildDedupeKey(
    params.aggregate.provider,
    params.aggregate.phase,
    params.severity,
  );
  const message = buildAlertMessage(
    params.severity,
    params.aggregate,
    params.windowStart,
    params.windowEnd,
  );
  const incidentId = await resolveOAuthAlertIncidentId({
    provider: params.aggregate.provider,
    phase: params.aggregate.phase,
    severity: params.severity,
  });

  try {
    const [created] = await db
      .insert(oauthAlertEvents)
      .values({
        incidentId,
        provider: params.aggregate.provider,
        phase: params.aggregate.phase,
        severity: params.severity,
        totalCount: params.aggregate.totalCount,
        failureCount: params.aggregate.failureCount,
        failureRateBps: params.aggregate.failureRateBps,
        windowStart: params.windowStart,
        windowEnd: params.windowEnd,
        statusBreakdown: JSON.stringify(params.aggregate.statusBreakdown),
        dedupeKey,
        message,
        createdAt: Date.now(),
      })
      .returning();

    return created || null;
  } catch (error) {
    logger.error("[OAuth 告警] 写入告警事件失败:", error, "OAuthAlert");
    return null;
  }
}

async function loadWindowAggregates(windowStart: number, windowEnd: number) {
  const rows = await db
    .select({
      provider: oauthSessionEvents.provider,
      phase: oauthSessionEvents.phase,
      status: oauthSessionEvents.status,
      count: sql<number>`count(*)`,
    })
    .from(oauthSessionEvents)
    .where(
      and(
        gte(oauthSessionEvents.createdAt, windowStart),
        lte(oauthSessionEvents.createdAt, windowEnd - 1),
      ),
    )
    .groupBy(oauthSessionEvents.provider, oauthSessionEvents.phase, oauthSessionEvents.status);

  const grouped = new Map<string, OAuthAlertWindowAggregate>();
  for (const row of rows) {
    const provider = row.provider || "unknown";
    const phase = row.phase || "unknown";
    const status = row.status || "unknown";
    const count = clampInt(row.count, 0, 0, Number.MAX_SAFE_INTEGER);
    const key = `${provider}:${phase}`;

    const aggregate =
      grouped.get(key) ||
      ({
        provider,
        phase,
        totalCount: 0,
        failureCount: 0,
        failureRateBps: 0,
        statusBreakdown: {},
      } as OAuthAlertWindowAggregate);

    aggregate.totalCount += count;
    aggregate.statusBreakdown[status] = (aggregate.statusBreakdown[status] || 0) + count;
    if (status === "error") {
      aggregate.failureCount += count;
    }

    grouped.set(key, aggregate);
  }

  const list = [...grouped.values()];
  for (const aggregate of list) {
    aggregate.failureRateBps =
      aggregate.totalCount > 0
        ? Math.floor((aggregate.failureCount * 10_000) / aggregate.totalCount)
        : 0;
  }

  return list;
}

export async function getOAuthAlertConfig(): Promise<OAuthAlertEngineConfig> {
  try {
    const existing = await loadLatestConfigRow();
    if (existing) return normalizeConfig(existing);

    const now = Date.now();
    const [created] = await db
      .insert(oauthAlertConfigs)
      .values({
        ...toConfigPersistencePayload(DEFAULT_CONFIG, now),
        createdAt: now,
      })
      .returning();
    return normalizeConfig(created || null);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function updateOAuthAlertConfig(
  patch: OAuthAlertConfigUpdate,
): Promise<OAuthAlertEngineConfig> {
  const current = await getOAuthAlertConfig();
  const merged = mergeConfig(current, patch);
  const now = Date.now();

  try {
    const existing = await loadLatestConfigRow();
    if (existing) {
      const [updated] = await db
        .update(oauthAlertConfigs)
        .set(toConfigPersistencePayload(merged, now))
        .where(eq(oauthAlertConfigs.id, existing.id))
        .returning();
      return normalizeConfig(updated || null);
    }

    const [created] = await db
      .insert(oauthAlertConfigs)
      .values({
        ...toConfigPersistencePayload(merged, now),
        createdAt: now,
      })
      .returning();
    return normalizeConfig(created || null);
  } catch {
    return merged;
  }
}

export async function evaluateOAuthSessionAlerts(): Promise<OAuthAlertEvaluationResult> {
  const evaluationStartedAt = Date.now();
  const configValue = await getOAuthAlertConfig();
  const deliveryControl = buildOAuthAlertDeliveryControl(configValue);
  const now = Date.now();
  const windowMs = configValue.windowSizeSec * 1000;
  const windowEnd = Math.floor(now / windowMs) * windowMs;
  const windowStart = windowEnd - windowMs;

  const initialResult: OAuthAlertEvaluationResult = {
    windowStart,
    windowEnd,
    scannedGroups: 0,
    createdEvents: 0,
    deliveryAttempts: 0,
    deliveryFailedChannels: 0,
  };

  if (!configValue.enabled) {
    recordAlertEventMetric({
      phase: "evaluate",
      result: "skipped",
      reason: "engine_disabled",
    });
    observeAlertEvaluationDuration("skipped", evaluationStartedAt);
    return initialResult;
  }

  try {
    const aggregates = await loadWindowAggregates(windowStart, windowEnd);
    const activeRuleVersion = await getActiveOAuthAlertRuleVersion();
    const recoveryConsecutiveWindows = resolveOAuthAlertRuleRecoveryConsecutiveWindows(
      activeRuleVersion,
      configValue.recoveryConsecutiveWindows,
    );
    initialResult.scannedGroups = aggregates.length;

    for (const aggregate of aggregates) {
      const key = `${aggregate.provider}:${aggregate.phase}`;
      const thresholdSeverity = resolveSeverity(aggregate, configValue);

      if (thresholdSeverity) {
        healthyWindowStreak.set(key, 0);
        const ruleDecision = await applyRuleDecision({
          activeRuleVersion,
          aggregate,
          defaultSeverity: thresholdSeverity,
          configValue,
          nowMs: now,
        });
        if (ruleDecision.suppressed || !ruleDecision.severity) {
          recordAlertEventMetric({
            provider: aggregate.provider,
            phase: aggregate.phase,
            severity: thresholdSeverity,
            result: "skipped",
            reason: ruleDecision.suppressionReason || "rule_suppressed",
          });
          continue;
        }

        const decidedSeverity = ruleDecision.severity;
        const dedupeKey = buildDedupeKey(aggregate.provider, aggregate.phase, decidedSeverity);
        const isSuppressed = await hasRecentEvent(
          dedupeKey,
          now - configValue.dedupeWindowSec * 1000,
        );
        if (isSuppressed) {
          recordAlertEventMetric({
            provider: aggregate.provider,
            phase: aggregate.phase,
            severity: decidedSeverity,
            result: "skipped",
            reason: "dedupe_suppressed",
          });
          continue;
        }

        const event = await createAlertEvent({
          severity: decidedSeverity,
          aggregate,
          windowStart,
          windowEnd,
        });
        if (!event || !event.id) {
          recordAlertEventMetric({
            provider: aggregate.provider,
            phase: aggregate.phase,
            severity: decidedSeverity,
            result: "failed",
            reason: "event_insert_failed",
          });
          continue;
        }

        recordAlertEventMetric({
          provider: event.provider,
          phase: event.phase,
          severity: event.severity,
          result: "created",
          reason: decidedSeverity === thresholdSeverity ? "threshold_breached" : "rule_override",
        });

        const delivery = await deliverOAuthAlertEvent({
          id: event.id,
          incidentId: event.incidentId,
          provider: event.provider,
          phase: event.phase,
          severity: event.severity as OAuthAlertSeverity,
          totalCount: event.totalCount,
          failureCount: event.failureCount,
          failureRateBps: event.failureRateBps,
          windowStart: event.windowStart,
          windowEnd: event.windowEnd,
          message: event.message,
          createdAt: event.createdAt,
        }, {
          ...deliveryControl,
          forcedChannels: ruleDecision.forcedChannels,
        });

        initialResult.createdEvents += 1;
        initialResult.deliveryAttempts += delivery.totalAttempts;
        initialResult.deliveryFailedChannels += delivery.failedChannels;
        continue;
      }

      const healthy = isHealthyForRecovery(aggregate, configValue);
      const streak = healthy ? (healthyWindowStreak.get(key) || 0) + 1 : 0;
      healthyWindowStreak.set(key, streak);

      if (!healthy || streak < recoveryConsecutiveWindows) {
        continue;
      }

      const latestEvent = await getLatestEventByProviderAndPhase(
        aggregate.provider,
        aggregate.phase,
      );
      if (!latestEvent) continue;
      if (latestEvent.severity !== "warning" && latestEvent.severity !== "critical") {
        continue;
      }

      const recoveryRuleDecision = await applyRuleDecision({
        activeRuleVersion,
        aggregate,
        defaultSeverity: "recovery",
        configValue,
        nowMs: now,
      });
      if (recoveryRuleDecision.suppressed || !recoveryRuleDecision.severity) {
        recordAlertEventMetric({
          provider: aggregate.provider,
          phase: aggregate.phase,
          severity: "recovery",
          result: "skipped",
          reason: recoveryRuleDecision.suppressionReason || "rule_suppressed",
        });
        continue;
      }

      const decidedRecoverySeverity = recoveryRuleDecision.severity;
      const recoveryDedupeKey = buildDedupeKey(
        aggregate.provider,
        aggregate.phase,
        decidedRecoverySeverity,
      );
      const isRecoverySuppressed = await hasRecentEvent(
        recoveryDedupeKey,
        now - configValue.dedupeWindowSec * 1000,
      );
      if (isRecoverySuppressed) {
        recordAlertEventMetric({
          provider: aggregate.provider,
          phase: aggregate.phase,
          severity: decidedRecoverySeverity,
          result: "skipped",
          reason: "dedupe_suppressed",
        });
        continue;
      }

      const recoveryEvent = await createAlertEvent({
        severity: decidedRecoverySeverity,
        aggregate,
        windowStart,
        windowEnd,
      });
      if (!recoveryEvent || !recoveryEvent.id) {
        recordAlertEventMetric({
          provider: aggregate.provider,
          phase: aggregate.phase,
          severity: decidedRecoverySeverity,
          result: "failed",
          reason: "event_insert_failed",
        });
        continue;
      }

      recordAlertEventMetric({
        provider: recoveryEvent.provider,
        phase: recoveryEvent.phase,
        severity: recoveryEvent.severity,
        result: "created",
        reason: decidedRecoverySeverity === "recovery" ? "recovery_threshold_met" : "rule_override",
      });

      const delivery = await deliverOAuthAlertEvent({
        id: recoveryEvent.id,
        incidentId: recoveryEvent.incidentId,
        provider: recoveryEvent.provider,
        phase: recoveryEvent.phase,
        severity: recoveryEvent.severity as OAuthAlertSeverity,
        totalCount: recoveryEvent.totalCount,
        failureCount: recoveryEvent.failureCount,
        failureRateBps: recoveryEvent.failureRateBps,
        windowStart: recoveryEvent.windowStart,
        windowEnd: recoveryEvent.windowEnd,
        message: recoveryEvent.message,
        createdAt: recoveryEvent.createdAt,
      }, {
        ...deliveryControl,
        forcedChannels: recoveryRuleDecision.forcedChannels,
      });

      initialResult.createdEvents += 1;
      initialResult.deliveryAttempts += delivery.totalAttempts;
      initialResult.deliveryFailedChannels += delivery.failedChannels;
    }

    observeAlertEvaluationDuration("success", evaluationStartedAt);
    return initialResult;
  } catch (error) {
    recordAlertEventMetric({
      phase: "evaluate",
      result: "failed",
      reason: "evaluation_error",
    });
    observeAlertEvaluationDuration("failed", evaluationStartedAt);
    logger.error("[OAuth 告警] 窗口评估失败:", error, "OAuthAlert");
    return initialResult;
  }
}

export async function queryOAuthAlertEvents(
  query: OAuthAlertEventQuery = {},
): Promise<OAuthAlertEventQueryResult> {
  const page = normalizePage(query.page);
  const pageSize = normalizePageSize(query.pageSize);
  const offset = (page - 1) * pageSize;
  const filters = [];

  if (query.incidentId) {
    const variants = buildIncidentIdQueryVariants(query.incidentId);
    const incidentIdCandidates = variants.length > 0 ? variants : [query.incidentId];
    const legacyEventId = parseLegacyIncidentEventId(query.incidentId);
    filters.push(
      typeof legacyEventId === "number"
        ? or(
          inArray(oauthAlertEvents.incidentId, incidentIdCandidates),
          eq(oauthAlertEvents.id, legacyEventId),
        )!
        : inArray(oauthAlertEvents.incidentId, incidentIdCandidates),
    );
  }
  if (query.provider) {
    filters.push(eq(oauthAlertEvents.provider, query.provider));
  }
  if (query.phase) {
    filters.push(eq(oauthAlertEvents.phase, query.phase));
  }
  if (query.severity) {
    filters.push(eq(oauthAlertEvents.severity, query.severity));
  }
  if (typeof query.from === "number" && Number.isFinite(query.from)) {
    filters.push(gte(oauthAlertEvents.createdAt, Math.floor(query.from)));
  }
  if (typeof query.to === "number" && Number.isFinite(query.to)) {
    filters.push(lte(oauthAlertEvents.createdAt, Math.floor(query.to)));
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  try {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(oauthAlertEvents)
      .where(whereClause);
    const total = clampInt(countRow?.count, 0, 0, Number.MAX_SAFE_INTEGER);

    const rows = await db
      .select()
      .from(oauthAlertEvents)
      .where(whereClause)
      .orderBy(desc(oauthAlertEvents.createdAt), desc(oauthAlertEvents.id))
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows.map((row) => ({
        id: row.id,
        incidentId: normalizeIncidentId(row.incidentId) || buildLegacyIncidentId(row.provider, row.phase, row.id),
        provider: row.provider,
        phase: row.phase,
        severity: row.severity as OAuthAlertSeverity,
        totalCount: row.totalCount,
        failureCount: row.failureCount,
        failureRateBps: row.failureRateBps,
        statusBreakdown: parseStatusBreakdown(row.statusBreakdown),
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        dedupeKey: row.dedupeKey,
        message: row.message,
        createdAt: row.createdAt,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch {
    return {
      data: [],
      page,
      pageSize,
      total: 0,
      totalPages: 1,
    };
  }
}
