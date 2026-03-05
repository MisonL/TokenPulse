import type { Context, Next } from "hono";
import { getRequestTraceId } from "../../middleware/request-context";

function isJsonResponse(response: Response): boolean {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("application/json");
}

function resolveTraceId(c: Context, response: Response): string {
  const fromContext = getRequestTraceId(c);
  if (fromContext) return fromContext;

  const fromResponseHeader = (response.headers.get("x-request-id") || "").trim();
  if (fromResponseHeader) return fromResponseHeader;

  const fromRequestHeader = (c.req.header("x-request-id") || "").trim();
  return fromRequestHeader;
}

/**
 * 路由级兜底：确保所有 JSON 错误响应都包含 traceId。
 *
 * 约束：
 * - 仅在 status >= 400 且 Content-Type=JSON 时触发
 * - 仅对 JSON object 进行注入（数组/字符串等保持原样）
 */
export async function traceIdJsonErrorMiddleware(c: Context, next: Next) {
  await next();

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

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }

  const traceId = resolveTraceId(c, response);
  if (!traceId) return;
  const record = payload as Record<string, unknown>;
  if (typeof record.traceId === "string" && record.traceId.trim() === traceId) {
    return;
  }

  const nextPayload = {
    ...record,
    traceId,
  };

  const headers = new Headers(response.headers);
  headers.delete("content-length");

  const patched = new Response(JSON.stringify(nextPayload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  c.res = patched;
}
