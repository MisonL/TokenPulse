export interface ResolveAccountIdInput {
  provider: string;
  accountId?: string;
  email?: string | null;
  metadata?: Record<string, any> | null;
}

function sanitizeAccountId(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) return "default";
  return normalized.slice(0, 96);
}

export function resolveAccountId(input: ResolveAccountIdInput): string {
  const explicit = (input.accountId || "").trim();
  if (explicit) return sanitizeAccountId(explicit);

  const email = (input.email || "").trim();
  if (email) return sanitizeAccountId(email);

  const meta = input.metadata || {};
  const fromMeta =
    meta.accountId ||
    meta.account_id ||
    meta.sub ||
    meta.user_id ||
    meta.userId ||
    meta.email ||
    meta.email_address ||
    meta.account?.id ||
    meta.account?.email ||
    meta.account?.email_address ||
    "";
  if (typeof fromMeta === "string" && fromMeta.trim()) {
    return sanitizeAccountId(fromMeta);
  }

  return "default";
}
