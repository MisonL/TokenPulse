import type { Context, Next } from "hono";
import crypto from "node:crypto";

const TRACE_ID_KEY = "traceId";
const REQUESTED_ACCOUNT_ID_KEY = "requestedAccountId";
const REQUESTED_SELECTION_POLICY_KEY = "requestedSelectionPolicy";
const SELECTED_ACCOUNT_ID_KEY = "selectedAccountId";

function normalizeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function getRequestTraceId(c: Context): string {
  return ((c.get(TRACE_ID_KEY) as string | undefined) || "").trim();
}

export function getRequestedAccountId(c: Context): string | undefined {
  const value = (c.get(REQUESTED_ACCOUNT_ID_KEY) as string | undefined) || "";
  return value.trim() || undefined;
}

export function getRequestedSelectionPolicy(c: Context): string | undefined {
  const value =
    (c.get(REQUESTED_SELECTION_POLICY_KEY) as string | undefined) || "";
  return value.trim() || undefined;
}

export function setSelectedAccountId(c: Context, accountId?: string) {
  const normalized = normalizeId(accountId || "");
  if (!normalized) return;
  c.set(SELECTED_ACCOUNT_ID_KEY, normalized);
}

export function getSelectedAccountId(c: Context): string | undefined {
  const value = (c.get(SELECTED_ACCOUNT_ID_KEY) as string | undefined) || "";
  return value.trim() || undefined;
}

function isJsonResponse(response: Response): boolean {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("application/json");
}

async function injectTraceIdIntoJsonErrorResponse(
  c: Context,
  traceId: string,
) {
  const response = c.res;
  if (!response) return;
  if (response.status < 400) return;
  if (!isJsonResponse(response)) return;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return;
  }

  const isPlainObject = Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
  const record = isPlainObject ? (payload as Record<string, unknown>) : null;
  if (
    record &&
    typeof record.traceId === "string" &&
    record.traceId.trim() === traceId
  ) {
    return;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  c.res = new Response(
    JSON.stringify({
      ...(record || { error: payload }),
      traceId,
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

export async function requestContextMiddleware(c: Context, next: Next) {
  const forwardedTraceId =
    c.req.header("x-request-id") ||
    c.req.header("x-tokenpulse-process-id") ||
    "";
  const traceId = forwardedTraceId.trim() || crypto.randomUUID();

  const requestedAccountIdHeader = c.req.header("x-tokenpulse-account-id") || "";
  const requestedSelectionPolicyHeader =
    c.req.header("x-tokenpulse-selection-policy") || "";

  const requestedAccountId = normalizeId(requestedAccountIdHeader);
  const requestedSelectionPolicy = requestedSelectionPolicyHeader
    .trim()
    .toLowerCase();

  c.set(TRACE_ID_KEY, traceId);
  if (requestedAccountId) {
    c.set(REQUESTED_ACCOUNT_ID_KEY, requestedAccountId);
  }
  if (requestedSelectionPolicy) {
    c.set(REQUESTED_SELECTION_POLICY_KEY, requestedSelectionPolicy);
  }

  await next();

  // 全局兜底：确保 JSON 错误响应包含 traceId，便于排障与对齐审计日志。
  await injectTraceIdIntoJsonErrorResponse(c, traceId);
  c.header("X-Request-Id", traceId);
}
