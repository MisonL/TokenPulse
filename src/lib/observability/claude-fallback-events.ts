import crypto from "node:crypto";

export type ClaudeFallbackMode = "api_key" | "bridge";
export type ClaudeFallbackPhase = "attempt" | "success" | "failure" | "skipped";
export const CLAUDE_FALLBACK_REASONS = [
  "api_key_bearer_rejected",
  "bridge_status_code",
  "bridge_cloudflare_signal",
  "bridge_circuit_open",
  "bridge_http_error",
  "bridge_exception",
  "unknown",
] as const;
export type ClaudeFallbackReason = (typeof CLAUDE_FALLBACK_REASONS)[number];

export interface ClaudeFallbackEvent {
  id: string;
  timestamp: string;
  mode: ClaudeFallbackMode;
  phase: ClaudeFallbackPhase;
  traceId?: string;
  accountId?: string;
  model?: string;
  status?: number;
  latencyMs?: number;
  message?: string;
  reason?: ClaudeFallbackReason;
}

export interface ClaudeFallbackEventQuery {
  page?: number;
  pageSize?: number;
  mode?: ClaudeFallbackMode;
  phase?: ClaudeFallbackPhase;
  reason?: ClaudeFallbackReason;
  traceId?: string;
  from?: string;
  to?: string;
}

export interface ClaudeFallbackSummary {
  total: number;
  byMode: Record<ClaudeFallbackMode, number>;
  byPhase: Record<ClaudeFallbackPhase, number>;
  byReason: Record<ClaudeFallbackReason, number>;
}

export const CLAUDE_FALLBACK_TIMESERIES_STEPS = [
  "5m",
  "15m",
  "1h",
  "6h",
  "1d",
] as const;
export type ClaudeFallbackTimeseriesStep =
  (typeof CLAUDE_FALLBACK_TIMESERIES_STEPS)[number];

export interface ClaudeFallbackTimeseriesQuery extends ClaudeFallbackEventQuery {
  step?: ClaudeFallbackTimeseriesStep;
}

export interface ClaudeFallbackTimeseriesBucket {
  bucketStart: string;
  total: number;
  success: number;
  failure: number;
  bridgeShare: number;
}

export interface ClaudeFallbackTimeseriesResult {
  step: ClaudeFallbackTimeseriesStep;
  data: ClaudeFallbackTimeseriesBucket[];
}

const MAX_EVENTS = 2000;
const events: ClaudeFallbackEvent[] = [];

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function normalizePage(value: unknown): number {
  return Math.max(1, normalizeNumber(value, 1));
}

function normalizePageSize(value: unknown): number {
  return Math.min(200, Math.max(1, normalizeNumber(value, 20)));
}

function parseTime(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function stepToMs(step: ClaudeFallbackTimeseriesStep): number {
  switch (step) {
    case "5m":
      return 5 * 60 * 1000;
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

function applyClaudeFallbackQuery(
  source: ClaudeFallbackEvent[],
  query: ClaudeFallbackEventQuery = {},
) {
  const fromMs = parseTime(query.from);
  const toMs = parseTime(query.to);

  return source.filter((item) => {
    if (query.mode && item.mode !== query.mode) return false;
    if (query.phase && item.phase !== query.phase) return false;
    if (query.reason && item.reason !== query.reason) return false;
    if (query.traceId && item.traceId !== query.traceId) return false;

    const eventMs = Date.parse(item.timestamp);
    if (Number.isFinite(eventMs)) {
      if (fromMs !== null && eventMs < fromMs) return false;
      if (toMs !== null && eventMs > toMs) return false;
    }
    return true;
  });
}

export function appendClaudeFallbackEvent(
  payload: Omit<ClaudeFallbackEvent, "id" | "timestamp"> & { timestamp?: string },
) {
  const event: ClaudeFallbackEvent = {
    ...payload,
    id: crypto.randomUUID(),
    timestamp: payload.timestamp || new Date().toISOString(),
  };
  events.unshift(event);
  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS;
  }
}

export function listClaudeFallbackEvents(query: ClaudeFallbackEventQuery = {}) {
  const page = normalizePage(query.page);
  const pageSize = normalizePageSize(query.pageSize);
  const filtered = applyClaudeFallbackQuery(events, query);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  return {
    data,
    page: safePage,
    pageSize,
    total,
    pageCount,
  };
}

export function summarizeClaudeFallbackEvents(
  query: ClaudeFallbackEventQuery = {},
): ClaudeFallbackSummary {
  const filtered = applyClaudeFallbackQuery(events, query);
  const summary: ClaudeFallbackSummary = {
    total: filtered.length,
    byMode: {
      api_key: 0,
      bridge: 0,
    },
    byPhase: {
      attempt: 0,
      success: 0,
      failure: 0,
      skipped: 0,
    },
    byReason: {
      api_key_bearer_rejected: 0,
      bridge_status_code: 0,
      bridge_cloudflare_signal: 0,
      bridge_circuit_open: 0,
      bridge_http_error: 0,
      bridge_exception: 0,
      unknown: 0,
    },
  };

  for (const item of filtered) {
    summary.byMode[item.mode] += 1;
    summary.byPhase[item.phase] += 1;
    if (item.reason) {
      summary.byReason[item.reason] += 1;
    } else {
      summary.byReason.unknown += 1;
    }
  }

  return summary;
}

export function summarizeClaudeFallbackTimeseries(
  query: ClaudeFallbackTimeseriesQuery = {},
): ClaudeFallbackTimeseriesResult {
  const step = query.step || "15m";
  const stepMs = stepToMs(step);
  const filtered = applyClaudeFallbackQuery(events, query);

  let minEventMs: number | null = null;
  let maxEventMs: number | null = null;
  for (const item of filtered) {
    const eventMs = Date.parse(item.timestamp);
    if (!Number.isFinite(eventMs)) continue;
    if (minEventMs === null || eventMs < minEventMs) minEventMs = eventMs;
    if (maxEventMs === null || eventMs > maxEventMs) maxEventMs = eventMs;
  }

  const fromMsInput = parseTime(query.from);
  const toMsInput = parseTime(query.to);
  const now = Date.now();

  let startMs =
    fromMsInput ??
    minEventMs ??
    ((toMsInput ?? now) - stepMs * 11);
  let endMs =
    toMsInput ??
    maxEventMs ??
    now;

  if (!Number.isFinite(startMs)) startMs = now - stepMs * 11;
  if (!Number.isFinite(endMs)) endMs = now;
  if (startMs > endMs) {
    const temp = startMs;
    startMs = endMs;
    endMs = temp;
  }

  const alignedStart = Math.floor(startMs / stepMs) * stepMs;
  const alignedEnd = Math.floor(endMs / stepMs) * stepMs;
  const bucketMap = new Map<
    number,
    { total: number; success: number; failure: number; bridgeCount: number }
  >();

  for (let bucket = alignedStart; bucket <= alignedEnd; bucket += stepMs) {
    bucketMap.set(bucket, {
      total: 0,
      success: 0,
      failure: 0,
      bridgeCount: 0,
    });
  }

  for (const item of filtered) {
    const eventMs = Date.parse(item.timestamp);
    if (!Number.isFinite(eventMs)) continue;
    const bucket = Math.floor(eventMs / stepMs) * stepMs;
    const current = bucketMap.get(bucket);
    if (!current) continue;
    current.total += 1;
    if (item.phase === "success") current.success += 1;
    if (item.phase === "failure") current.failure += 1;
    if (item.mode === "bridge") current.bridgeCount += 1;
  }

  const data: ClaudeFallbackTimeseriesBucket[] = Array.from(bucketMap.entries()).map(
    ([bucketMs, item]) => ({
      bucketStart: new Date(bucketMs).toISOString(),
      total: item.total,
      success: item.success,
      failure: item.failure,
      bridgeShare: item.total > 0 ? Number((item.bridgeCount / item.total).toFixed(4)) : 0,
    }),
  );

  return {
    step,
    data,
  };
}
