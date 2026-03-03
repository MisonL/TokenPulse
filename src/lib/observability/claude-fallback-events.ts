import crypto from "node:crypto";

export type ClaudeFallbackMode = "api_key" | "bridge";
export type ClaudeFallbackPhase = "attempt" | "success" | "failure" | "skipped";

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
}

export interface ClaudeFallbackEventQuery {
  page?: number;
  pageSize?: number;
  mode?: ClaudeFallbackMode;
  phase?: ClaudeFallbackPhase;
  traceId?: string;
  from?: string;
  to?: string;
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
  const fromMs = parseTime(query.from);
  const toMs = parseTime(query.to);

  const filtered = events.filter((item) => {
    if (query.mode && item.mode !== query.mode) return false;
    if (query.phase && item.phase !== query.phase) return false;
    if (query.traceId && item.traceId !== query.traceId) return false;

    const eventMs = Date.parse(item.timestamp);
    if (Number.isFinite(eventMs)) {
      if (fromMs !== null && eventMs < fromMs) return false;
      if (toMs !== null && eventMs > toMs) return false;
    }
    return true;
  });

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
