import { z } from "zod";

export interface TimeRangeQuery {
  from?: string;
  to?: string;
}

export type TimeRangeValidationResult =
  | {
      ok: true;
      fromMs: number | null;
      toMs: number | null;
    }
  | {
      ok: false;
      error: string;
    };

const ISO_DATETIME_WITH_TZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoDateTimeWithTimezone(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (!ISO_DATETIME_WITH_TZ_PATTERN.test(normalized)) return false;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed);
}

export function parseIsoDateTime(value?: string): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!isIsoDateTimeWithTimezone(normalized)) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function normalizeIsoDateTime(value?: string): string | undefined {
  const parsed = parseIsoDateTime(value);
  if (parsed === null) return undefined;
  return new Date(parsed).toISOString();
}

export function validateTimeRange(query: TimeRangeQuery): TimeRangeValidationResult {
  const fromMs = parseIsoDateTime(query.from);
  const toMs = parseIsoDateTime(query.to);

  if (query.from && fromMs === null) {
    return { ok: false, error: "from 时间格式无效，必须为 ISO 8601 且包含时区" };
  }
  if (query.to && toMs === null) {
    return { ok: false, error: "to 时间格式无效，必须为 ISO 8601 且包含时区" };
  }
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    return { ok: false, error: "from 不能晚于 to" };
  }

  return {
    ok: true,
    fromMs,
    toMs,
  };
}

export const optionalIsoDateTimeSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => isIsoDateTimeWithTimezone(value),
    "时间参数必须是 ISO 8601 且包含时区，例如 2026-03-01T00:00:00.000Z",
  )
  .optional();
