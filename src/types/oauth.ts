export const OAUTH_ROUTE_ERROR_CODES = [
  "oauth_provider_unsupported",
  "oauth_invalid_state",
  "oauth_session_not_found",
  "oauth_provider_state_mismatch",
  "oauth_session_flow_mismatch",
  "oauth_provider_poll_not_supported",
  "oauth_provider_capability_missing",
  "oauth_manual_callback_disabled",
  "oauth_manual_callback_runtime_disabled",
  "oauth_manual_callback_unsupported",
  "oauth_manual_callback_missing_code_state",
  "oauth_manual_callback_delegate_failed",
  "oauth_callback_invalid_redirect_url",
  "oauth_callback_missing_state",
  "oauth_callback_missing_code",
  "oauth_callback_provider_not_supported",
  "oauth_callback_provider_error",
  "oauth_callback_delegate_failed",
] as const;

export type OAuthRouteErrorCode = (typeof OAUTH_ROUTE_ERROR_CODES)[number];

export interface OAuthErrorEnvelope {
  error: string;
  code: OAuthRouteErrorCode;
  traceId: string;
  details?: unknown;
  [key: string]: unknown;
}
