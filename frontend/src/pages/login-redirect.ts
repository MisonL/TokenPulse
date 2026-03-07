export type LoginRedirectState = {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
} | null;

export function normalizeLoginRedirectTarget(target: string): string {
  const normalized = target.trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return "";
  }
  if (
    normalized === "/login" ||
    normalized.startsWith("/login?") ||
    normalized.startsWith("/login#")
  ) {
    return "";
  }
  return normalized;
}

export function getStateRedirectTarget(state: LoginRedirectState): string {
  const from = state?.from;
  if (!from) return "";
  const pathname = from.pathname || "/";
  return normalizeLoginRedirectTarget(`${pathname}${from.search || ""}${from.hash || ""}`);
}

export function resolveLoginSuccessTarget(
  state: LoginRedirectState,
  storedRedirect: string,
): string {
  return getStateRedirectTarget(state) || normalizeLoginRedirectTarget(storedRedirect) || "/";
}
