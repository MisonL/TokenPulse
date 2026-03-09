export type LoginEntryIntent = "app" | "enterprise";

export type LoginRedirectState = {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
  intent?: LoginEntryIntent;
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

export function isEnterpriseRedirectTarget(target: string): boolean {
  const normalized = normalizeLoginRedirectTarget(target);
  return (
    normalized === "/enterprise" ||
    normalized.startsWith("/enterprise?") ||
    normalized.startsWith("/enterprise#") ||
    normalized.startsWith("/enterprise/")
  );
}

export function resolveLoginEntryIntent(
  state: LoginRedirectState,
  storedRedirect: string,
): LoginEntryIntent {
  if (state?.intent === "enterprise" || state?.intent === "app") {
    return state.intent;
  }

  const target = getStateRedirectTarget(state) || normalizeLoginRedirectTarget(storedRedirect);
  return isEnterpriseRedirectTarget(target) ? "enterprise" : "app";
}

export function resolveLoginSuccessTarget(
  state: LoginRedirectState,
  storedRedirect: string,
): string {
  return getStateRedirectTarget(state) || normalizeLoginRedirectTarget(storedRedirect) || "/";
}
