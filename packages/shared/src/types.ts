export type ProviderId =
  | "claude"
  | "gemini"
  | "codex"
  | "qwen"
  | "kiro"
  | "iflow"
  | "antigravity"
  | "copilot"
  | "aistudio"
  | "vertex";

export type OAuthFlowType = "auth_code" | "device_code" | "manual_key" | "service_account";

export interface CredentialEnvelope {
  provider: ProviderId;
  accountId: string;
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
  status?: "active" | "expired" | "revoked" | "disabled";
}

export interface RoutePolicy {
  provider: ProviderId;
  allowModels?: string[];
  blockedModels?: string[];
  fallbackProviders?: ProviderId[];
  maxRetries?: number;
}

export interface EditionContext {
  edition: "standard" | "advanced";
  enableAdvanced: boolean;
}

export type PermissionKey =
  | "admin.dashboard.read"
  | "admin.users.manage"
  | "admin.billing.manage"
  | "admin.audit.read"
  | "admin.audit.write";
