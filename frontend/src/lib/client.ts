import { hc } from "hono/client";
import type { AppType } from "../../../apps/core/src/index";

const BASE_URL = "/";
const API_SECRET_KEY = "tokenpulse_api_secret";
const LOGIN_REDIRECT_KEY = "tokenpulse_login_redirect";

export type ApiRequestError = Error & {
  status: number;
  traceId?: string;
  payload?: unknown;
};

export interface ApiJsonRequestOptions {
  fallbackErrorMessage?: string;
}

export interface ApiDownloadOptions {
  fallbackErrorMessage?: string;
  defaultFilename?: string;
}

export interface ApiDownloadResult {
  blob: Blob;
  filename?: string;
  response: Response;
}

export interface StoredApiSecretPreflightOptions {
  redirectTarget?: string;
}

function getStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function getSessionStorage(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function normalizeLoginRedirect(target: string): string {
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

function rememberLoginRedirect(target: string): void {
  const storage = getSessionStorage();
  if (!storage) return;

  const normalized = normalizeLoginRedirect(target);
  if (!normalized) {
    storage.removeItem(LOGIN_REDIRECT_KEY);
    return;
  }

  storage.setItem(LOGIN_REDIRECT_KEY, normalized);
}

function getCurrentLoginRedirect(): string {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }

  const pathname =
    typeof window.location.pathname === "string" && window.location.pathname
      ? window.location.pathname
      : "/";
  const search = typeof window.location.search === "string" ? window.location.search : "";
  const hash = typeof window.location.hash === "string" ? window.location.hash : "";
  return normalizeLoginRedirect(`${pathname}${search}${hash}`);
}

function getPayloadErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const message = (payload as Record<string, unknown>).error;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return fallback;
}

function getPayloadTraceId(payload: unknown, resp: Response): string | undefined {
  if (payload && typeof payload === "object") {
    const traceId = (payload as Record<string, unknown>).traceId;
    if (typeof traceId === "string" && traceId.trim()) {
      return traceId.trim();
    }
  }
  return resp.headers.get("x-request-id")?.trim() || undefined;
}

function createApiRequestError(
  resp: Response,
  payload: unknown,
  fallbackErrorMessage: string,
): ApiRequestError {
  const error = new Error(
    getPayloadErrorMessage(payload, fallbackErrorMessage),
  ) as ApiRequestError;
  error.status = resp.status;
  error.traceId = getPayloadTraceId(payload, resp);
  error.payload = payload;
  return error;
}

function buildAuthorizedHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });

  const token = getApiSecret();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

function handleUnauthorized(): void {
  invalidateApiSecret(getCurrentLoginRedirect());
  if (typeof window !== "undefined" && window.location) {
    window.location.href = "/login";
  }
}

function invalidateApiSecret(redirectTarget = ""): void {
  clearApiSecret();
  const redirect = normalizeLoginRedirect(redirectTarget);
  if (redirect) {
    rememberLoginRedirect(redirect);
  }
}

function parseContentDispositionFilename(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;

  const filenameStarMatch = headerValue.match(/filename\*\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (filenameStarMatch) {
    const normalized = filenameStarMatch
      .replace(/^UTF-8''/i, "")
      .replace(/^["']|["']$/g, "");
    if (!normalized) return undefined;
    try {
      return decodeURIComponent(normalized);
    } catch {
      return normalized;
    }
  }

  const filenameMatch = headerValue.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (!filenameMatch) return undefined;
  const normalized = filenameMatch.replace(/^["']|["']$/g, "");
  return normalized || undefined;
}

/**
 * 从 localStorage 获取存储的 API Secret
 */
export function getApiSecret(): string {
  return (getStorage()?.getItem(API_SECRET_KEY) || "").trim();
}

/**
 * 设置 API Secret 到 localStorage
 */
export function setApiSecret(secret: string): void {
  getStorage()?.setItem(API_SECRET_KEY, secret.trim());
}

export function clearApiSecret(): void {
  getStorage()?.removeItem(API_SECRET_KEY);
}

export function consumeLoginRedirect(): string {
  const storage = getSessionStorage();
  const redirect = normalizeLoginRedirect(storage?.getItem(LOGIN_REDIRECT_KEY) || "");
  storage?.removeItem(LOGIN_REDIRECT_KEY);
  return redirect;
}

export async function loginWithApiSecret(secret: string): Promise<void> {
  const normalizedSecret = secret.trim();
  try {
    await verifyApiSecret(normalizedSecret);
    setApiSecret(normalizedSecret);
  } catch (error) {
    clearApiSecret();
    throw error;
  }
}

export async function verifyStoredApiSecret(
  options: StoredApiSecretPreflightOptions = {},
): Promise<boolean> {
  const secret = getApiSecret();
  if (!secret) {
    return false;
  }

  try {
    await verifyApiSecret(secret);
    return true;
  } catch {
    invalidateApiSecret(options.redirectTarget || getCurrentLoginRedirect());
    return false;
  }
}

interface ApiSecretProbeErrorBody {
  error?: string;
  traceId?: string;
}

/**
 * 使用显式传入的 secret 执行轻量探针校验。
 * 这里不能复用全局 client，避免登录页在校验失败时触发 401 自动跳转逻辑。
 */
export async function verifyApiSecret(secret: string): Promise<void> {
  const normalizedSecret = secret.trim();
  const headers = new Headers();

  if (normalizedSecret) {
    headers.set("Authorization", `Bearer ${normalizedSecret}`);
  }

  const resp = await fetch("/api/auth/verify-secret", {
    method: "GET",
    headers,
    credentials: "include",
  });

  if (resp.ok) {
    return;
  }

  const json = (await resp.json().catch(() => ({}))) as ApiSecretProbeErrorBody;
  const message =
    json.error?.trim() ||
    (resp.status === 404
      ? "后端尚未提供 /api/auth/verify-secret 探针"
      : `接口密钥校验失败（${resp.status}）`);
  throw new Error(message);
}

export async function fetchWithApiSecret(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const resp = await fetch(input, {
    ...init,
    headers: buildAuthorizedHeaders(input, init),
    credentials: "include",
  });

  if (resp.status === 401) {
    handleUnauthorized();
  }

  return resp;
}

export async function requestJsonWithApiSecret<T = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiJsonRequestOptions = {},
): Promise<T> {
  const resp = await fetchWithApiSecret(input, init);
  const payload = (await resp.json().catch(() => ({}))) as T;

  if (!resp.ok) {
    throw createApiRequestError(
      resp,
      payload,
      options.fallbackErrorMessage || `请求失败（${resp.status}）`,
    );
  }

  return payload;
}

export async function downloadWithApiSecret(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiDownloadOptions = {},
): Promise<ApiDownloadResult> {
  const resp = await fetchWithApiSecret(input, init);

  if (!resp.ok) {
    const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    throw createApiRequestError(
      resp,
      payload,
      options.fallbackErrorMessage || `下载失败（${resp.status}）`,
    );
  }

  return {
    blob: await resp.blob(),
    filename:
      parseContentDispositionFilename(resp.headers.get("content-disposition")) ||
      options.defaultFilename,
    response: resp,
  };
}

// 2. 创建带有自定义 fetch 的类型化客户端以注入 Authorization 标头
export const client = hc<AppType>(BASE_URL, {
  fetch: fetchWithApiSecret,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export type ClientType = typeof client;

export interface OAuthAlertCenterConfigPayload {
  enabled: boolean;
  warningRateThresholdBps: number;
  warningFailureCountThreshold: number;
  criticalRateThresholdBps: number;
  criticalFailureCountThreshold: number;
  recoveryRateThresholdBps: number;
  recoveryFailureCountThreshold: number;
  dedupeWindowSec: number;
  recoveryConsecutiveWindows: number;
  windowSizeSec: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  muteProviders: string[];
  minDeliverySeverity: "warning" | "critical";
}

export interface OAuthAlertCenterEvaluatePayload {
  provider?: string; // 兼容保留，后端当前忽略
}

export interface OAuthAlertCenterIncidentQuery {
  page?: number;
  pageSize?: number;
  provider?: string;
  phase?: string;
  severity?: "critical" | "warning" | "recovery";
  from?: string;
  to?: string;
}

export interface OAuthAlertCenterDeliveryQuery {
  page?: number;
  pageSize?: number;
  eventId?: string;
  incidentId?: string;
  provider?: string;
  phase?: string;
  severity?: "critical" | "warning" | "recovery";
  channel?: string;
  status?: "success" | "failure" | "sent" | "failed";
  from?: string;
  to?: string;
}

export interface AlertmanagerConfigPayload {
  global?: Record<string, unknown>;
  route: Record<string, unknown>;
  receivers: Array<Record<string, unknown>>;
  inhibit_rules?: Array<Record<string, unknown>>;
  mute_time_intervals?: Array<Record<string, unknown>>;
  time_intervals?: Array<Record<string, unknown>>;
  templates?: string[];
}

export interface AlertmanagerConfigUpdatePayload {
  config: AlertmanagerConfigPayload;
  comment?: string;
}

export interface AlertmanagerSyncPayload {
  reason?: string;
  comment?: string;
  config?: AlertmanagerConfigPayload;
}

export interface AlertmanagerSyncHistoryQuery {
  limit?: number;
  page?: number;
  pageSize?: number;
}

export interface OAuthAlertRuleVersionListQuery {
  page?: number;
  pageSize?: number;
  status?: "draft" | "active" | "inactive" | "archived";
}

export interface AlertmanagerSyncHistoryRollbackPayload {
  reason?: string;
  comment?: string;
}

const oauthAlertApi = client.api.admin.observability["oauth-alerts"];
const oauthAlertRulesApi = oauthAlertApi.rules;
const oauthAlertAlertmanagerApi = oauthAlertApi.alertmanager;

export const oauthAlertCenterClient = {
  getConfig() {
    return oauthAlertApi.config.$get();
  },
  updateConfig(payload: OAuthAlertCenterConfigPayload) {
    return oauthAlertApi.config.$put({
      json: payload,
    });
  },
  evaluate(payload: OAuthAlertCenterEvaluatePayload) {
    return oauthAlertApi.evaluate.$post({
      json: payload,
    });
  },
  listIncidents(query: OAuthAlertCenterIncidentQuery) {
    return oauthAlertApi.incidents.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        provider: query.provider || undefined,
        phase: query.phase || undefined,
        severity: query.severity || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  listDeliveries(query: OAuthAlertCenterDeliveryQuery) {
    return oauthAlertApi.deliveries.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        eventId: query.eventId || undefined,
        incidentId: query.incidentId || undefined,
        provider: query.provider || undefined,
        phase: query.phase || undefined,
        severity: query.severity || undefined,
        channel: query.channel || undefined,
        status: query.status || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  getAlertmanagerConfig() {
    return oauthAlertAlertmanagerApi.config.$get();
  },
  updateAlertmanagerConfig(payload: AlertmanagerConfigUpdatePayload) {
    return oauthAlertAlertmanagerApi.config.$put({
      json: payload,
    });
  },
  syncAlertmanagerConfig(payload: AlertmanagerSyncPayload = {}) {
    return oauthAlertAlertmanagerApi.sync.$post({
      json: payload,
    });
  },
  listAlertmanagerSyncHistory(query: AlertmanagerSyncHistoryQuery = {}) {
    return oauthAlertAlertmanagerApi["sync-history"].$get({
      query: {
        limit: query.limit ? String(query.limit) : undefined,
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
      },
    });
  },
  rollbackAlertmanagerSyncHistory(
    historyId: string,
    payload: AlertmanagerSyncHistoryRollbackPayload = {},
  ) {
    return oauthAlertAlertmanagerApi["sync-history"][":historyId"].rollback.$post({
      param: {
        historyId,
      },
      json: payload,
    });
  },
  getAlertRuleActive() {
    return oauthAlertRulesApi.active.$get();
  },
  listAlertRuleVersions(query: OAuthAlertRuleVersionListQuery = {}) {
    return oauthAlertRulesApi.versions.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        status: query.status || undefined,
      },
    });
  },
  createAlertRuleVersion(payload: Record<string, unknown>) {
    return oauthAlertRulesApi.versions.$post({
      json: payload,
    });
  },
  rollbackAlertRuleVersion(versionId: number) {
    return oauthAlertRulesApi.versions[":versionId"].rollback.$post({
      param: {
        versionId: String(versionId),
      },
    });
  },
};

export interface FeaturePayload {
  edition: "standard" | "advanced";
  features: Record<string, boolean>;
  enterpriseBackend?: {
    configured: boolean;
    reachable: boolean;
    baseUrl?: string;
    error?: string;
  };
}

export interface PermissionItem {
  key: string;
  name: string;
}

export interface RoleItem {
  key: string;
  name: string;
  permissions: string[];
}

export interface AuditEventItem {
  id: number;
  actor: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  traceId?: string | null;
  result: "success" | "failure";
  createdAt: string;
  details?: Record<string, unknown> | string | null;
}

export interface AuditQueryResult {
  data: AuditEventItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BillingQuotaResult {
  data: {
    mode: string;
    message: string;
    limits: {
      requestsPerMinute: number;
      tokensPerDay: number;
    };
  };
}

export interface RoleBindingItem {
  roleKey: string;
  tenantId?: string | null;
}

export interface AdminUserItem {
  id: string;
  username: string;
  displayName?: string | null;
  status: "active" | "disabled";
  roles: RoleBindingItem[];
}

export interface TenantItem {
  id: string;
  name: string;
  status: "active" | "disabled";
  updatedAt?: string;
}

export interface QuotaPolicyItem {
  id: string;
  name: string;
  scopeType: "global" | "tenant" | "role" | "user";
  scopeValue?: string | null;
  provider?: string | null;
  modelPattern?: string | null;
  requestsPerMinute?: number | null;
  tokensPerMinute?: number | null;
  tokensPerDay?: number | null;
  enabled: boolean;
}

export interface OAuthCallbackItem {
  id?: number;
  provider: string;
  state?: string | null;
  code?: string | null;
  error?: string | null;
  source: "aggregate" | "manual";
  status: "success" | "failure";
  traceId?: string | null;
  createdAt: string;
}

export interface OAuthCallbackQueryResult {
  data: OAuthCallbackItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OAuthSessionEventItem {
  id?: number;
  state: string;
  provider: string;
  flowType: "auth_code" | "device_code" | "manual_key" | "service_account";
  phase:
    | "pending"
    | "waiting_callback"
    | "waiting_device"
    | "exchanging"
    | "completed"
    | "error";
  status: "pending" | "completed" | "error";
  eventType: "register" | "set_phase" | "complete" | "mark_error";
  error?: string | null;
  createdAt: number;
}

export interface OAuthSessionEventQueryResult {
  data: OAuthSessionEventItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SelectionPolicyData {
  defaultPolicy: "round_robin" | "latest_valid" | "sticky_user";
  allowHeaderOverride: boolean;
  allowHeaderAccountOverride: boolean;
  failureCooldownSec: number;
  maxRetryOnAccountFailure: number;
}

export interface RouteExecutionPolicyData {
  emitRouteHeaders: boolean;
  retryStatusCodes: number[];
  claudeFallbackStatusCodes: number[];
}

export interface OAuthRoutePoliciesPayload {
  selection: SelectionPolicyData;
  execution: RouteExecutionPolicyData;
}

export type OAuthModelAliasPayload = Record<string, string | Record<string, string>>;

export type OAuthExcludedModelsPayload =
  | string[]
  | Record<string, boolean | string | string[]>;

export interface ProviderCapabilityItem {
  provider: string;
  flows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
  supportsChat: boolean;
  supportsModelList: boolean;
  supportsStream: boolean;
  supportsManualCallback: boolean;
}

export type ProviderCapabilityMapData = Record<string, ProviderCapabilityItem>;

export interface CapabilityRuntimeIssueItem {
  provider: string;
  code: string;
  message: string;
  capability?: {
    flows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
    supportsManualCallback: boolean;
  };
  runtime?: {
    startFlows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
    pollFlows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
    supportsManualCallback: boolean;
  };
}

export interface CapabilityRuntimeHealthData {
  ok: boolean;
  checkedAt: string;
  issueCount: number;
  issues: CapabilityRuntimeIssueItem[];
}

export interface ClaudeFallbackEventItem {
  id: string;
  timestamp: string;
  mode: "api_key" | "bridge";
  phase: "attempt" | "success" | "failure" | "skipped";
  reason?:
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown";
  traceId?: string;
  accountId?: string;
  model?: string;
  status?: number;
  latencyMs?: number;
  message?: string;
}

export interface ClaudeFallbackQueryResult {
  data: ClaudeFallbackEventItem[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface ClaudeFallbackSummary {
  total: number;
  byMode: {
    api_key: number;
    bridge: number;
  };
  byPhase: {
    attempt: number;
    success: number;
    failure: number;
    skipped: number;
  };
  byReason: Record<
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown",
    number
  >;
}

export interface ClaudeFallbackTimeseriesPoint {
  bucketStart: string;
  total: number;
  success: number;
  failure: number;
  bridgeShare: number;
}

export interface ClaudeFallbackTimeseriesResult {
  step: "5m" | "15m" | "1h" | "6h" | "1d";
  data: ClaudeFallbackTimeseriesPoint[];
}

export interface OAuthAlertIncidentItem {
  id: number;
  incidentId?: string;
  provider: string;
  phase: string;
  severity: "critical" | "warning" | "recovery" | string;
  totalCount: number;
  failureCount: number;
  failureRateBps: number;
  windowStart: number;
  windowEnd: number;
  dedupeKey?: string;
  message?: string | null;
  createdAt: number;
}

export interface OAuthAlertIncidentQueryResult {
  data: OAuthAlertIncidentItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OAuthAlertDeliveryItem {
  id: number;
  eventId: number;
  incidentId?: string;
  provider?: string | null;
  phase?: string | null;
  severity?: string | null;
  channel: string;
  target?: string | null;
  status: "success" | "failure" | string;
  attempt: number;
  responseStatus?: number | null;
  responseBody?: string | null;
  error?: string | null;
  sentAt: number;
}

export interface OAuthAlertDeliveryQueryResult {
  data: OAuthAlertDeliveryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AlertmanagerStoredConfig {
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
  comment?: string;
  config?: AlertmanagerConfigPayload | null;
}

export interface AlertmanagerSyncHistoryItem {
  id?: string;
  ts?: string;
  outcome?: "success" | "rolled_back" | "rollback_failed" | string;
  reason?: string;
  error?: string;
  rollbackError?: string;
}

export interface AlertmanagerSyncHistoryQueryResult {
  data: AlertmanagerSyncHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OAuthAlertRuleVersionSummaryItem {
  id: number;
  version: string;
  status: "draft" | "active" | "inactive" | "archived" | string;
  description?: string | null;
  createdBy?: string | null;
  createdAt?: number;
  updatedAt?: number;
  activatedAt?: number | null;
  totalRules?: number;
  enabledRules?: number;
  totalHits?: number;
}

export interface OAuthAlertRuleVersionListResult {
  data: OAuthAlertRuleVersionSummaryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BillingUsageItem {
  id: number;
  policyId: string;
  policyName?: string | null;
  bucketType: "minute" | "day";
  windowStart: number;
  requestCount: number;
  tokenCount: number;
  estimatedTokenCount?: number;
  actualTokenCount?: number;
  reconciledDelta?: number;
}

export interface BillingUsageQueryResult {
  data: BillingUsageItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BillingUsageFilterInput {
  policyId?: string;
  bucketType?: "" | "minute" | "day";
  provider?: string;
  model?: string;
  tenantId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface OrgOrganizationItem {
  id: string;
  name: string;
  status: "active" | "disabled";
  updatedAt?: string;
}

export interface OrgProjectItem {
  id: string;
  name: string;
  organizationId: string;
  status: "active" | "disabled";
  updatedAt?: string;
}

export interface OrgMemberBindingItem {
  memberId: string;
  username: string;
  organizationId: string;
  projectIds: string[];
}

export interface OrgMemberProjectBindingRow {
  id: number;
  organizationId: string;
  memberId: string;
  projectId: string;
}

export interface OrgOverviewBucket {
  total: number;
  active: number;
  disabled: number;
}

export interface OrgOverviewData {
  organizations: OrgOverviewBucket;
  projects: OrgOverviewBucket;
  members: OrgOverviewBucket;
  bindings: {
    total: number;
  };
}

export interface AuditEventQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  traceId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  policyId?: string;
  result?: "success" | "failure";
  from?: string;
  to?: string;
}

export interface OAuthCallbackEventQuery {
  page?: number;
  pageSize?: number;
  provider?: string;
  status?: "success" | "failure";
  state?: string;
  traceId?: string;
}

export interface OAuthSessionEventQuery {
  page?: number;
  pageSize?: number;
  state?: string;
  provider?: string;
  flowType?: "" | "auth_code" | "device_code" | "manual_key" | "service_account";
  phase?:
    | ""
    | "pending"
    | "waiting_callback"
    | "waiting_device"
    | "exchanging"
    | "completed"
    | "error";
  status?: "" | "pending" | "completed" | "error";
  eventType?: "" | "register" | "set_phase" | "complete" | "mark_error";
  from?: string;
  to?: string;
}

export interface ClaudeFallbackEventQuery {
  page?: number;
  pageSize?: number;
  mode?: "" | "api_key" | "bridge";
  phase?: "" | "attempt" | "success" | "failure" | "skipped";
  reason?:
    | ""
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown";
  traceId?: string;
  from?: string;
  to?: string;
}

export interface ClaudeFallbackTimeseriesQuery extends Omit<ClaudeFallbackEventQuery, "page" | "pageSize"> {
  step?: "5m" | "15m" | "1h" | "6h" | "1d";
}

const adminApi = client.api.admin;
const adminAuthApi = adminApi.auth;
const adminOauthApi = adminApi.oauth;
const adminBillingApi = adminApi.billing;
const adminObservabilityApi = adminApi.observability;

export const enterpriseAdminClient = {
  getFeatures() {
    return adminApi.features.$get();
  },
  getAdminSession() {
    return adminAuthApi.me.$get();
  },
  login(payload: { username: string; password: string }) {
    return adminAuthApi.login.$post({
      json: payload,
    });
  },
  logout() {
    return adminAuthApi.logout.$post();
  },
  listRoles() {
    return adminApi.rbac.roles.$get();
  },
  listPermissions() {
    return adminApi.rbac.permissions.$get();
  },
  getBillingQuotas() {
    return adminBillingApi.quotas.$get();
  },
  listBillingUsage(query: BillingUsageFilterInput = {}) {
    return adminBillingApi.usage.$get({
      query: {
        policyId: query.policyId || undefined,
        bucketType: query.bucketType || undefined,
        provider: query.provider || undefined,
        model: query.model || undefined,
        tenantId: query.tenantId || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
      },
    });
  },
  getRoutePolicies() {
    return adminOauthApi["route-policies"].$get();
  },
  updateRoutePolicies(payload: OAuthRoutePoliciesPayload) {
    return adminOauthApi["route-policies"].$put({
      json: payload,
    });
  },
  getCapabilityMap() {
    return adminOauthApi["capability-map"].$get();
  },
  updateCapabilityMap(payload: ProviderCapabilityMapData) {
    return adminOauthApi["capability-map"].$put({
      json: payload,
    });
  },
  getCapabilityHealth() {
    return adminOauthApi["capability-health"].$get();
  },
  getModelAlias() {
    return adminOauthApi["model-alias"].$get();
  },
  updateModelAlias(payload: OAuthModelAliasPayload) {
    return adminOauthApi["model-alias"].$put({
      json: payload,
    });
  },
  getExcludedModels() {
    return adminOauthApi["excluded-models"].$get();
  },
  updateExcludedModels(payload: OAuthExcludedModelsPayload) {
    return adminOauthApi["excluded-models"].$put({
      json: payload,
    });
  },
  listCallbackEvents(query: OAuthCallbackEventQuery = {}) {
    return adminOauthApi["callback-events"].$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        provider: query.provider || undefined,
        status: query.status || undefined,
        state: query.state || undefined,
        traceId: query.traceId || undefined,
      },
    });
  },
  listSessionEvents(query: OAuthSessionEventQuery = {}) {
    return adminOauthApi["session-events"].$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        state: query.state || undefined,
        provider: query.provider || undefined,
        flowType: query.flowType || undefined,
        phase: query.phase || undefined,
        status: query.status || undefined,
        eventType: query.eventType || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  listUsers() {
    return adminApi.users.$get();
  },
  listTenants() {
    return adminApi.tenants.$get();
  },
  listPolicies() {
    return adminBillingApi.policies.$get();
  },
  listAuditEvents(query: AuditEventQuery = {}) {
    return adminApi.audit.events.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        keyword: query.keyword || undefined,
        traceId: query.traceId || undefined,
        action: query.action || undefined,
        resource: query.resource || undefined,
        resourceId: query.resourceId || undefined,
        policyId: query.policyId || undefined,
        result: query.result || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  listClaudeFallbackEvents(query: ClaudeFallbackEventQuery = {}) {
    return adminObservabilityApi["claude-fallbacks"].$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        mode: query.mode || undefined,
        phase: query.phase || undefined,
        reason: query.reason || undefined,
        traceId: query.traceId || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  getClaudeFallbackSummary(query: ClaudeFallbackEventQuery = {}) {
    return adminObservabilityApi["claude-fallbacks"].summary.$get({
      query: {
        mode: query.mode || undefined,
        phase: query.phase || undefined,
        reason: query.reason || undefined,
        traceId: query.traceId || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  getClaudeFallbackTimeseries(query: ClaudeFallbackTimeseriesQuery = {}) {
    return adminObservabilityApi["claude-fallbacks"].timeseries.$get({
      query: {
        mode: query.mode || undefined,
        phase: query.phase || undefined,
        reason: query.reason || undefined,
        traceId: query.traceId || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
        step: query.step || undefined,
      },
    });
  },
};
