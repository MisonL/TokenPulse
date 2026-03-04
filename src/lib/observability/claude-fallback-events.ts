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
