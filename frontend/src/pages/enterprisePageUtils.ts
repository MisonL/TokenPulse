import type { AuditEventItem } from "../lib/client";

export const toText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

export const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const extractListData = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const root = toObject(value);
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.items)) return root.items;
  const nestedData = toObject(root.data);
  if (Array.isArray(nestedData.items)) return nestedData.items;
  return [];
};

export const normalizeDateTimeParam = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
};

export const formatTraceableMessage = (message: string, traceId?: string | null) => {
  const normalized = traceId?.trim();
  if (!normalized || message.includes(normalized)) {
    return message;
  }
  return `${message}（traceId: ${normalized}）`;
};

export const extractTraceIdFromResponse = (resp: Response, payload: unknown) =>
  toText(toObject(payload).traceId).trim() || resp.headers.get("x-request-id")?.trim() || "";

export const buildTraceableErrorMessage = (
  payload: unknown,
  fallback: string,
  traceIdHint?: string,
) => {
  const root = toObject(payload);
  const message = toText(root.error).trim() || fallback;
  const traceId = toText(root.traceId).trim() || traceIdHint?.trim() || "";
  return traceId ? `${message}（traceId: ${traceId}）` : message;
};

export const formatOptionalDateTime = (value?: number | string | null) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const parsed = typeof value === "string" ? Date.parse(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    return "-";
  }
  return new Date(parsed).toLocaleString();
};

export const formatWindowStart = (windowStart: number) => {
  const timestamp = windowStart < 1_000_000_000_000 ? windowStart * 1000 : windowStart;
  return new Date(timestamp).toLocaleString();
};

export const formatFlows = (
  flows?: Array<"auth_code" | "device_code" | "manual_key" | "service_account">,
) => {
  if (!flows || flows.length === 0) {
    return "-";
  }
  return flows.join(", ");
};

export const parseAuditDetails = (
  details?: Record<string, unknown> | string | null,
): Record<string, unknown> | null => {
  if (!details) return null;
  if (typeof details === "object") return details;
  if (typeof details !== "string") return null;
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

export const resolveAuditPolicyId = (item: AuditEventItem): string | null => {
  const details = parseAuditDetails(item.details);
  const fromDetails = details?.policyId;
  if (typeof fromDetails === "string" && fromDetails.trim()) {
    return fromDetails.trim();
  }
  if (typeof item.resourceId === "string" && item.resourceId.trim()) {
    return item.resourceId.trim();
  }
  return null;
};
