export interface RouteDecisionTrace {
  provider?: string;
  routePolicy?: string;
  fallback?: string;
  selectedAccountId?: string;
  traceId?: string;
}

export interface RouteDecisionHeaderOptions {
  emitHeaders?: boolean;
}

function normalizeValue(input?: string): string | undefined {
  const value = (input || "").trim();
  return value || undefined;
}

export function normalizeFallbackMode(input?: string): string {
  const value = (input || "").trim().toLowerCase();
  if (!value) return "none";
  return value;
}

export function appendFallbackMode(current: string, mode: "api_key" | "bridge"): string {
  const normalized = normalizeFallbackMode(current);
  if (normalized === "none") return mode;
  const parts = new Set(normalized.split(",").map((item) => item.trim()).filter(Boolean));
  parts.add(mode);
  return Array.from(parts).join(",");
}

export function extractRouteDecisionHeaders(
  headers?: Headers | null,
  fallback?: Partial<RouteDecisionTrace>,
): RouteDecisionTrace {
  const provider = normalizeValue(
    headers?.get("x-tokenpulse-provider") || fallback?.provider,
  );
  const routePolicy = normalizeValue(
    headers?.get("x-tokenpulse-route-policy") || fallback?.routePolicy,
  );
  const selectedAccountId = normalizeValue(
    headers?.get("x-tokenpulse-account-id") || fallback?.selectedAccountId,
  );
  const traceId = normalizeValue(
    headers?.get("x-request-id") || fallback?.traceId,
  );
  return {
    provider,
    routePolicy,
    selectedAccountId,
    traceId,
    fallback: normalizeFallbackMode(
      headers?.get("x-tokenpulse-fallback") || fallback?.fallback,
    ),
  };
}

export function withRouteDecisionHeaders(
  response: Response,
  decision: RouteDecisionTrace,
  options?: RouteDecisionHeaderOptions,
): Response {
  const emitHeaders = options?.emitHeaders !== false;
  if (!emitHeaders) return response;

  const headers = new Headers(response.headers);
  const provider = normalizeValue(decision.provider);
  const routePolicy = normalizeValue(decision.routePolicy);
  const accountId = normalizeValue(decision.selectedAccountId);
  const traceId = normalizeValue(decision.traceId);
  const fallbackMode = normalizeFallbackMode(decision.fallback);

  if (provider) headers.set("x-tokenpulse-provider", provider);
  if (routePolicy) headers.set("x-tokenpulse-route-policy", routePolicy);
  if (accountId) headers.set("x-tokenpulse-account-id", accountId);
  if (traceId) headers.set("x-request-id", traceId);
  headers.set("x-tokenpulse-fallback", fallbackMode);

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
