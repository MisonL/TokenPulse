import type {
  AlertmanagerConfigPayload,
  AlertmanagerStoredConfig,
  AlertmanagerSyncHistoryItem,
  AlertmanagerSyncHistoryQueryResult,
  OAuthAlertCenterConfigPayload,
  OAuthAlertDeliveryItem,
  OAuthAlertDeliveryQueryResult,
  OAuthAlertIncidentItem,
  OAuthAlertIncidentQueryResult,
  OAuthAlertRuleVersionListResult,
  OAuthAlertRuleVersionSummaryItem,
} from "../lib/client";

const toText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const toTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toText(item).trim()).filter(Boolean);
};

const extractListData = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const root = toObject(value);
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.items)) return root.items;
  const nestedData = toObject(root.data);
  if (Array.isArray(nestedData.items)) return nestedData.items;
  return [];
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  const normalized = toText(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
};

const toNonNegativeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(toText(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

export const normalizeOAuthAlertConfig = (
  value: unknown,
  defaults: OAuthAlertCenterConfigPayload,
): OAuthAlertCenterConfigPayload => {
  const root = toObject(value);
  const data = toObject(root.data);
  const source = Object.keys(data).length > 0 ? data : root;
  const muteProvidersFromArray = toTextArray(source.muteProviders).map((item) =>
    item.trim().toLowerCase(),
  );
  const muteProvidersFromText = toText(source.muteProviders)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const muteProviders = Array.from(
    new Set(
      (muteProvidersFromArray.length > 0 ? muteProvidersFromArray : muteProvidersFromText).filter(
        Boolean,
      ),
    ),
  );
  const minDeliverySeverityRaw = toText(source.minDeliverySeverity).trim().toLowerCase();
  const minDeliverySeverity =
    minDeliverySeverityRaw === "critical" || minDeliverySeverityRaw === "warning"
      ? (minDeliverySeverityRaw as "warning" | "critical")
      : defaults.minDeliverySeverity;
  return {
    enabled: toBoolean(source.enabled, defaults.enabled),
    warningRateThresholdBps: Math.max(
      1,
      Math.floor(toNonNegativeNumber(source.warningRateThresholdBps, defaults.warningRateThresholdBps)),
    ),
    warningFailureCountThreshold: Math.max(
      1,
      Math.floor(
        toNonNegativeNumber(source.warningFailureCountThreshold, defaults.warningFailureCountThreshold),
      ),
    ),
    criticalRateThresholdBps: Math.max(
      1,
      Math.floor(toNonNegativeNumber(source.criticalRateThresholdBps, defaults.criticalRateThresholdBps)),
    ),
    criticalFailureCountThreshold: Math.max(
      1,
      Math.floor(
        toNonNegativeNumber(
          source.criticalFailureCountThreshold,
          defaults.criticalFailureCountThreshold,
        ),
      ),
    ),
    recoveryRateThresholdBps: Math.max(
      0,
      Math.floor(toNonNegativeNumber(source.recoveryRateThresholdBps, defaults.recoveryRateThresholdBps)),
    ),
    recoveryFailureCountThreshold: Math.max(
      0,
      Math.floor(
        toNonNegativeNumber(
          source.recoveryFailureCountThreshold,
          defaults.recoveryFailureCountThreshold,
        ),
      ),
    ),
    dedupeWindowSec: Math.max(
      0,
      Math.floor(toNonNegativeNumber(source.dedupeWindowSec, defaults.dedupeWindowSec)),
    ),
    recoveryConsecutiveWindows: Math.max(
      1,
      Math.floor(
        toNonNegativeNumber(source.recoveryConsecutiveWindows, defaults.recoveryConsecutiveWindows),
      ),
    ),
    windowSizeSec: Math.max(
      60,
      Math.floor(toNonNegativeNumber(source.windowSizeSec, defaults.windowSizeSec)),
    ),
    quietHoursEnabled: toBoolean(source.quietHoursEnabled, defaults.quietHoursEnabled),
    quietHoursStart: toText(source.quietHoursStart).trim() || defaults.quietHoursStart,
    quietHoursEnd: toText(source.quietHoursEnd).trim() || defaults.quietHoursEnd,
    quietHoursTimezone: toText(source.quietHoursTimezone).trim() || defaults.quietHoursTimezone,
    muteProviders,
    minDeliverySeverity,
  };
};

const normalizeOAuthAlertIncidentItem = (value: unknown): OAuthAlertIncidentItem | null => {
  const row = toObject(value);
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const provider = toText(row.provider).trim() || "unknown";
  const phase = toText(row.phase).trim() || "unknown";
  const incidentId = toText(row.incidentId).trim();
  return {
    id,
    incidentId: incidentId || undefined,
    provider,
    phase,
    severity: toText(row.severity).trim() || "warning",
    totalCount: Number.isFinite(Number(row.totalCount)) ? Number(row.totalCount) : 0,
    failureCount: Number.isFinite(Number(row.failureCount)) ? Number(row.failureCount) : 0,
    failureRateBps: Number.isFinite(Number(row.failureRateBps)) ? Number(row.failureRateBps) : 0,
    windowStart: Number.isFinite(Number(row.windowStart)) ? Number(row.windowStart) : Date.now(),
    windowEnd: Number.isFinite(Number(row.windowEnd)) ? Number(row.windowEnd) : Date.now(),
    dedupeKey: toText(row.dedupeKey).trim() || undefined,
    message: toText(row.message).trim() || null,
    createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : Date.now(),
  };
};

export const normalizeOAuthAlertIncidentResult = (
  value: unknown,
): OAuthAlertIncidentQueryResult => {
  const root = toObject(value);
  const rows = extractListData(value)
    .map((item) => normalizeOAuthAlertIncidentItem(item))
    .filter((item): item is OAuthAlertIncidentItem => Boolean(item));
  const page = Math.max(1, Math.floor(Number(root.page) || 1));
  const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || rows.length || 10));
  const total = Math.max(rows.length, Math.floor(Number(root.total) || rows.length));
  const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
  return { data: rows, page, pageSize, total, totalPages };
};

const normalizeOAuthAlertDeliveryItem = (value: unknown): OAuthAlertDeliveryItem | null => {
  const row = toObject(value);
  const id = Number(row.id);
  const eventId = Number(row.eventId);
  if (!Number.isFinite(id) || !Number.isFinite(eventId)) return null;
  const incidentId = toText(row.incidentId).trim();
  return {
    id,
    eventId,
    incidentId: incidentId || undefined,
    provider: toText(row.provider).trim() || null,
    phase: toText(row.phase).trim() || null,
    severity: toText(row.severity).trim() || null,
    channel: toText(row.channel).trim() || "webhook",
    target: toText(row.target).trim() || null,
    status: toText(row.status).trim() || "failure",
    attempt: Number.isFinite(Number(row.attempt)) ? Number(row.attempt) : 1,
    responseStatus: Number.isFinite(Number(row.responseStatus)) ? Number(row.responseStatus) : null,
    responseBody: toText(row.responseBody).trim() || null,
    error: toText(row.error).trim() || null,
    sentAt: Number.isFinite(Number(row.sentAt)) ? Number(row.sentAt) : Date.now(),
  };
};

export const normalizeOAuthAlertDeliveryResult = (
  value: unknown,
): OAuthAlertDeliveryQueryResult => {
  const root = toObject(value);
  const rows = extractListData(value)
    .map((item) => normalizeOAuthAlertDeliveryItem(item))
    .filter((item): item is OAuthAlertDeliveryItem => Boolean(item));
  const page = Math.max(1, Math.floor(Number(root.page) || 1));
  const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || rows.length || 10));
  const total = Math.max(rows.length, Math.floor(Number(root.total) || rows.length));
  const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
  return { data: rows, page, pageSize, total, totalPages };
};

export const toAlertmanagerConfigPayload = (
  value: Record<string, unknown>,
): AlertmanagerConfigPayload | null => {
  const route = toObject(value.route);
  if (Object.keys(route).length === 0) return null;
  if (!Array.isArray(value.receivers)) return null;
  const receivers = value.receivers
    .map((item) => toObject(item))
    .filter((item) => Object.keys(item).length > 0);
  if (receivers.length === 0) return null;

  const payload: AlertmanagerConfigPayload = { route, receivers };
  const global = toObject(value.global);
  if (Object.keys(global).length > 0) payload.global = global;
  if (Array.isArray(value.inhibit_rules)) {
    payload.inhibit_rules = value.inhibit_rules
      .map((item) => toObject(item))
      .filter((item) => Object.keys(item).length > 0);
  }
  if (Array.isArray(value.mute_time_intervals)) {
    payload.mute_time_intervals = value.mute_time_intervals
      .map((item) => toObject(item))
      .filter((item) => Object.keys(item).length > 0);
  }
  if (Array.isArray(value.time_intervals)) {
    payload.time_intervals = value.time_intervals
      .map((item) => toObject(item))
      .filter((item) => Object.keys(item).length > 0);
  }
  if (Array.isArray(value.templates)) {
    payload.templates = value.templates.map((item) => toText(item).trim()).filter(Boolean);
  }
  return payload;
};

export const normalizeAlertmanagerStoredConfig = (
  value: unknown,
): AlertmanagerStoredConfig | null => {
  const root = toObject(value);
  const data = toObject(root.data);
  const source = Object.keys(data).length > 0 ? data : root;
  if (Object.keys(source).length === 0) return null;
  const configValue = toObject(source.config);
  return {
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : undefined,
    updatedAt: toText(source.updatedAt).trim() || undefined,
    updatedBy: toText(source.updatedBy).trim() || undefined,
    comment: toText(source.comment).trim() || undefined,
    config: toAlertmanagerConfigPayload(configValue),
  };
};

export const toAlertmanagerHistoryItem = (row: unknown): AlertmanagerSyncHistoryItem => {
  const item = toObject(row);
  return {
    id: toText(item.id).trim() || undefined,
    ts: toText(item.ts).trim() || undefined,
    outcome: toText(item.outcome).trim() || undefined,
    reason: toText(item.reason).trim() || undefined,
    error: toText(item.error).trim() || undefined,
    rollbackError: toText(item.rollbackError).trim() || undefined,
  };
};

const normalizeAlertmanagerHistory = (value: unknown): AlertmanagerSyncHistoryItem[] => {
  const rows = extractListData(value);
  return rows.map((row) => toAlertmanagerHistoryItem(row));
};

export const normalizeAlertmanagerHistoryQueryResult = (
  value: unknown,
): AlertmanagerSyncHistoryQueryResult => {
  const root = toObject(value);
  const data = normalizeAlertmanagerHistory(value);
  const page = Math.max(1, Math.floor(Number(root.page) || 1));
  const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || data.length || 20));
  const total = Math.max(data.length, Math.floor(Number(root.total) || data.length));
  const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
  return { data, page, pageSize, total, totalPages };
};

export const normalizeOAuthAlertRuleVersionSummary = (
  value: unknown,
): OAuthAlertRuleVersionSummaryItem | null => {
  const row = toObject(value);
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    version: toText(row.version).trim() || `v-${id}`,
    status: toText(row.status).trim() || "inactive",
    description: toText(row.description).trim() || null,
    createdBy: toText(row.createdBy).trim() || null,
    createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : undefined,
    updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : undefined,
    activatedAt: Number.isFinite(Number(row.activatedAt)) ? Number(row.activatedAt) : null,
    totalRules: Number.isFinite(Number(row.totalRules)) ? Number(row.totalRules) : undefined,
    enabledRules: Number.isFinite(Number(row.enabledRules)) ? Number(row.enabledRules) : undefined,
    totalHits: Number.isFinite(Number(row.totalHits)) ? Number(row.totalHits) : undefined,
  };
};

export const normalizeOAuthAlertRuleVersionList = (
  value: unknown,
): OAuthAlertRuleVersionListResult => {
  const root = toObject(value);
  const rows = extractListData(value)
    .map((row) => normalizeOAuthAlertRuleVersionSummary(row))
    .filter((row): row is OAuthAlertRuleVersionSummaryItem => Boolean(row));
  const page = Math.max(1, Math.floor(Number(root.page) || 1));
  const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || rows.length || 20));
  const total = Math.max(rows.length, Math.floor(Number(root.total) || rows.length));
  const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
  return { data: rows, page, pageSize, total, totalPages };
};

export const renderAlertmanagerSyncSummary = (item?: AlertmanagerSyncHistoryItem) => {
  if (!item) return "暂无同步记录";
  const base = toText(item.outcome).trim() || "unknown";
  const reason = toText(item.reason).trim();
  const error = toText(item.error).trim();
  if (error) return `${base}: ${error}`;
  if (reason) return `${base}: ${reason}`;
  return base;
};
