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

export interface ApiStructuredResult<TPayload = unknown, TData = unknown> {
  ok: boolean;
  status: number;
  traceId?: string;
  error?: string;
  payload: TPayload;
  data: TData;
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

function getPayloadData<TData>(payload: unknown): TData {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: TData }).data;
  }
  return payload as TData;
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

async function readStructuredApiResult<TPayload = unknown, TData = unknown>(
  resp: Response,
  options: ApiJsonRequestOptions = {},
): Promise<ApiStructuredResult<TPayload, TData>> {
  const payload = (await resp.json().catch(() => ({}))) as TPayload;
  return {
    ok: resp.ok,
    status: resp.status,
    traceId: getPayloadTraceId(payload, resp),
    error: resp.ok
      ? undefined
      : getPayloadErrorMessage(
          payload,
          options.fallbackErrorMessage || `请求失败（${resp.status}）`,
        ),
    payload,
    data: getPayloadData<TData>(payload),
    response: resp,
  };
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

export const ORG_DOMAIN_API_CONTRACT = Object.freeze({
  overview: "/api/org/overview",
  organizations: "/api/org/organizations",
  projects: "/api/org/projects",
  members: "/api/org/members",
  memberProjectBindings: "/api/org/member-project-bindings",
});

export const ORG_DOMAIN_API_CONTRACT_PATHS = Object.freeze(
  Object.values(ORG_DOMAIN_API_CONTRACT),
);

export interface OrgDomainMutationResult {
  success: boolean;
  traceId?: string;
  id?: string;
}

export interface OrgDomainBatchMutationResult<TSuccess> {
  success: boolean;
  traceId?: string;
  data: {
    requested: number;
    successCount: number;
    errorCount: number;
    successes: TSuccess[];
    errors: Array<{
      index: number;
      code: string;
      error: string;
    }>;
  };
}

export interface CreateOrgProjectPayload {
  name: string;
  organizationId: string;
  description?: string;
}

export interface UpdateOrgOrganizationPayload {
  name?: string;
  description?: string;
  status?: "active" | "disabled";
}

export interface OrgDomainListQuery {
  status?: "active" | "disabled";
}

export interface OrgProjectListQuery extends OrgDomainListQuery {
  organizationId?: string;
}

export interface OrgMemberListQuery extends OrgDomainListQuery {
  organizationId?: string;
  userId?: string;
}

export interface OrgMemberProjectBindingListQuery {
  organizationId?: string;
  memberId?: string;
  projectId?: string;
}

export interface UpdateOrgProjectPayload {
  name?: string;
  description?: string;
  status?: "active" | "disabled";
}

export interface UpdateOrgMemberPayload {
  organizationId: string;
}

export interface CreateOrgMemberPayload {
  id?: string;
  organizationId: string;
  userId?: string;
  email?: string;
  displayName?: string;
  role?: "owner" | "admin" | "member" | "viewer";
  status?: "active" | "disabled";
}

export interface CreateOrgMemberProjectBindingPayload {
  organizationId: string;
  memberId: string;
  projectId: string;
}

function buildOrgQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    const normalized = value?.trim();
    if (normalized) {
      params.set(key, normalized);
    }
  });
  const search = params.toString();
  return search ? `?${search}` : "";
}

export const orgDomainClient = {
  getOverview() {
    return requestJsonWithApiSecret<Record<string, unknown>>(ORG_DOMAIN_API_CONTRACT.overview);
  },
  listOrganizations(query: OrgDomainListQuery = {}) {
    return requestJsonWithApiSecret<Record<string, unknown>>(
      `${ORG_DOMAIN_API_CONTRACT.organizations}${buildOrgQueryString({
        status: query.status,
      })}`,
    );
  },
  createOrganization(payload: { name: string }) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      ORG_DOMAIN_API_CONTRACT.organizations,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  updateOrganization(id: string, payload: UpdateOrgOrganizationPayload) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      `${ORG_DOMAIN_API_CONTRACT.organizations}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  },
  deleteOrganization(id: string) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      `${ORG_DOMAIN_API_CONTRACT.organizations}/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );
  },
  listProjects(query: OrgProjectListQuery = {}) {
    return requestJsonWithApiSecret<Record<string, unknown>>(
      `${ORG_DOMAIN_API_CONTRACT.projects}${buildOrgQueryString({
        organizationId: query.organizationId,
        status: query.status,
      })}`,
    );
  },
  createProject(payload: CreateOrgProjectPayload) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      ORG_DOMAIN_API_CONTRACT.projects,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  updateProject(id: string, payload: UpdateOrgProjectPayload) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      `${ORG_DOMAIN_API_CONTRACT.projects}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  },
  deleteProject(id: string) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      `${ORG_DOMAIN_API_CONTRACT.projects}/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );
  },
  listMembers(query: OrgMemberListQuery = {}) {
    return requestJsonWithApiSecret<Record<string, unknown>>(
      `${ORG_DOMAIN_API_CONTRACT.members}${buildOrgQueryString({
        organizationId: query.organizationId,
        userId: query.userId,
        status: query.status,
      })}`,
    );
  },
  createMember(payload: CreateOrgMemberPayload) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      ORG_DOMAIN_API_CONTRACT.members,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  updateMember(id: string, payload: UpdateOrgMemberPayload) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      `${ORG_DOMAIN_API_CONTRACT.members}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  },
  deleteMember(id: string) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      `${ORG_DOMAIN_API_CONTRACT.members}/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );
  },
  listMemberProjectBindings(query: OrgMemberProjectBindingListQuery = {}) {
    return requestJsonWithApiSecret<Record<string, unknown>>(
      `${ORG_DOMAIN_API_CONTRACT.memberProjectBindings}${buildOrgQueryString({
        organizationId: query.organizationId,
        memberId: query.memberId,
        projectId: query.projectId,
      })}`,
    );
  },
  createMemberProjectBinding(payload: CreateOrgMemberProjectBindingPayload) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      ORG_DOMAIN_API_CONTRACT.memberProjectBindings,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  createMemberProjectBindingsBatch(items: CreateOrgMemberProjectBindingPayload[]) {
    return requestJsonWithApiSecret<
      OrgDomainBatchMutationResult<{ index: number; memberId: string; projectId: string }>
    >(`${ORG_DOMAIN_API_CONTRACT.memberProjectBindings}/batch`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  },
  deleteMemberProjectBinding(id: string) {
    return requestJsonWithApiSecret<OrgDomainMutationResult>(
      `${ORG_DOMAIN_API_CONTRACT.memberProjectBindings}/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );
  },
};

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
  async updateConfigResult(payload: OAuthAlertCenterConfigPayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertApi.config.$put({
        json: payload,
      }),
      { fallbackErrorMessage: "保存 OAuth 告警配置失败" },
    );
  },
  async evaluateResult(payload: OAuthAlertCenterEvaluatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertApi.evaluate.$post({
        json: payload,
      }),
      { fallbackErrorMessage: "OAuth 告警手动评估失败" },
    );
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
  async listIncidentsResult(query: OAuthAlertCenterIncidentQuery) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertApi.incidents.$get({
        query: {
          page: query.page ? String(query.page) : undefined,
          pageSize: query.pageSize ? String(query.pageSize) : undefined,
          provider: query.provider || undefined,
          phase: query.phase || undefined,
          severity: query.severity || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 OAuth 告警 incidents 失败" },
    );
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
  async listDeliveriesResult(query: OAuthAlertCenterDeliveryQuery) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertApi.deliveries.$get({
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
      }),
      { fallbackErrorMessage: "加载 OAuth 告警 deliveries 失败" },
    );
  },
  getAlertmanagerConfig() {
    return oauthAlertAlertmanagerApi.config.$get();
  },
  async getConfigResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertApi.config.$get(),
      { fallbackErrorMessage: "加载 OAuth 告警配置失败" },
    );
  },
  async getAlertmanagerConfigResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertAlertmanagerApi.config.$get(),
      { fallbackErrorMessage: "加载 Alertmanager 配置失败" },
    );
  },
  updateAlertmanagerConfig(payload: AlertmanagerConfigUpdatePayload) {
    return oauthAlertAlertmanagerApi.config.$put({
      json: payload,
    });
  },
  async updateAlertmanagerConfigResult(payload: AlertmanagerConfigUpdatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertAlertmanagerApi.config.$put({
        json: payload,
      }),
      { fallbackErrorMessage: "保存 Alertmanager 配置失败" },
    );
  },
  syncAlertmanagerConfig(payload: AlertmanagerSyncPayload = {}) {
    return oauthAlertAlertmanagerApi.sync.$post({
      json: payload,
    });
  },
  async syncAlertmanagerConfigResult(payload: AlertmanagerSyncPayload = {}) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertAlertmanagerApi.sync.$post({
        json: payload,
      }),
      { fallbackErrorMessage: "Alertmanager 同步失败" },
    );
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
  async listAlertmanagerSyncHistoryResult(query: AlertmanagerSyncHistoryQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertAlertmanagerApi["sync-history"].$get({
        query: {
          limit: query.limit ? String(query.limit) : undefined,
          page: query.page ? String(query.page) : undefined,
          pageSize: query.pageSize ? String(query.pageSize) : undefined,
        },
      }),
      { fallbackErrorMessage: "加载 Alertmanager 同步历史失败" },
    );
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
  async rollbackAlertmanagerSyncHistoryResult(
    historyId: string,
    payload: AlertmanagerSyncHistoryRollbackPayload = {},
  ) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertAlertmanagerApi["sync-history"][":historyId"].rollback.$post({
        param: {
          historyId,
        },
        json: payload,
      }),
      { fallbackErrorMessage: "Alertmanager 历史回滚失败" },
    );
  },
  getAlertRuleActive() {
    return oauthAlertRulesApi.active.$get();
  },
  async getAlertRuleActiveResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertRulesApi.active.$get(),
      { fallbackErrorMessage: "加载 OAuth 告警规则当前版本失败" },
    );
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
  async listAlertRuleVersionsResult(query: OAuthAlertRuleVersionListQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertRulesApi.versions.$get({
        query: {
          page: query.page ? String(query.page) : undefined,
          pageSize: query.pageSize ? String(query.pageSize) : undefined,
          status: query.status || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 OAuth 告警规则版本失败" },
    );
  },
  createAlertRuleVersion(payload: Record<string, unknown>) {
    return oauthAlertRulesApi.versions.$post({
      json: payload,
    });
  },
  async createAlertRuleVersionResult(payload: Record<string, unknown>) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertRulesApi.versions.$post({
        json: payload,
      }),
      { fallbackErrorMessage: "创建规则版本失败" },
    );
  },
  rollbackAlertRuleVersion(versionId: number) {
    return oauthAlertRulesApi.versions[":versionId"].rollback.$post({
      param: {
        versionId: String(versionId),
      },
    });
  },
  async rollbackAlertRuleVersionResult(versionId: number) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await oauthAlertRulesApi.versions[":versionId"].rollback.$post({
        param: {
          versionId: String(versionId),
        },
      }),
      { fallbackErrorMessage: "规则版本回滚失败" },
    );
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

export function isEnterpriseFeatureEnabled(payload: FeaturePayload | null | undefined): boolean {
  return payload?.edition === "advanced" && payload?.features?.enterprise === true;
}

export function isEnterpriseBackendReachable(payload: FeaturePayload | null | undefined): boolean {
  return isEnterpriseFeatureEnabled(payload) && payload?.enterpriseBackend?.reachable === true;
}

export async function loadFeaturePayload(): Promise<FeaturePayload | null> {
  const response = await enterpriseAdminClient.getFeatures();
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json().catch(() => null)) as FeaturePayload | null;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload;
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

export interface AdminLoginPayload {
  username: string;
  password: string;
}

export interface AuditEventCreatePayload {
  action: string;
  resource: string;
  resourceId?: string;
  policyId?: string;
  traceId?: string;
  result: AuditEventItem["result"];
  details?: Record<string, unknown> | string | null;
}

export interface AdminUserCreatePayload {
  username: string;
  password: string;
  roleKey: string;
  tenantId: string;
  status: AdminUserItem["status"];
}

export interface AdminUserUpdatePayload {
  displayName?: string;
  roleBindings?: RoleBindingItem[];
  tenantIds?: string[];
  status?: AdminUserItem["status"];
  password?: string;
  roleKey?: string;
  tenantId?: string;
}

export interface TenantItem {
  id: string;
  name: string;
  status: "active" | "disabled";
  updatedAt?: string;
}

export interface TenantCreatePayload {
  name: string;
  status: TenantItem["status"];
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

export interface QuotaPolicyCreatePayload {
  id?: string;
  name: string;
  scopeType: QuotaPolicyItem["scopeType"];
  scopeValue?: string;
  provider?: string;
  modelPattern?: string;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
  enabled?: boolean;
}

export interface QuotaPolicyUpdatePayload {
  name?: string;
  scopeType?: QuotaPolicyItem["scopeType"];
  scopeValue?: string;
  provider?: string;
  modelPattern?: string;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
  enabled?: boolean;
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

export type AgentLedgerRuntimeStatus = "success" | "failure" | "blocked" | "timeout";

export type AgentLedgerDeliveryState =
  | "pending"
  | "delivered"
  | "retryable_failure"
  | "replay_required";

export interface AgentLedgerOutboxItem {
  id: number;
  traceId: string;
  tenantId: string;
  projectId?: string | null;
  provider: string;
  model: string;
  resolvedModel: string;
  routePolicy: string;
  accountId?: string | null;
  status: AgentLedgerRuntimeStatus | string;
  startedAt: string;
  finishedAt?: string | null;
  errorCode?: string | null;
  cost?: string | null;
  idempotencyKey: string;
  specVersion: string;
  keyId: string;
  targetUrl: string;
  payloadJson: string;
  payloadHash: string;
  headersJson: string;
  deliveryState: AgentLedgerDeliveryState | string;
  attemptCount: number;
  lastHttpStatus?: number | null;
  lastErrorClass?: string | null;
  lastErrorMessage?: string | null;
  firstFailedAt?: number | null;
  lastFailedAt?: number | null;
  nextRetryAt?: number | null;
  deliveredAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentLedgerOutboxSummary {
  total: number;
  byDeliveryState: Record<AgentLedgerDeliveryState, number>;
  byStatus: Record<AgentLedgerRuntimeStatus, number>;
}

export interface AgentLedgerOutboxQueryResult {
  data: AgentLedgerOutboxItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AgentLedgerOutboxQuery {
  page?: number;
  pageSize?: number;
  deliveryState?: "" | AgentLedgerDeliveryState;
  status?: "" | AgentLedgerRuntimeStatus;
  provider?: string;
  tenantId?: string;
  traceId?: string;
  from?: string;
  to?: string;
}

export interface AgentLedgerOutboxExportQuery
  extends Omit<AgentLedgerOutboxQuery, "page" | "pageSize"> {
  limit?: number;
}

export type AgentLedgerReplayAuditResult =
  | "delivered"
  | "retryable_failure"
  | "permanent_failure";

export type AgentLedgerReplayTriggerSource = "manual" | "batch_manual";
export type AgentLedgerDeliveryAttemptSource =
  | "worker"
  | "manual_replay"
  | "batch_replay";

export interface AgentLedgerReplayAuditItem {
  id: number;
  outboxId: number;
  traceId: string;
  idempotencyKey: string;
  operatorId: string;
  triggerSource: AgentLedgerReplayTriggerSource | string;
  attemptNumber: number;
  result: AgentLedgerReplayAuditResult | string;
  httpStatus?: number | null;
  errorClass?: string | null;
  createdAt: number;
}

export interface AgentLedgerReplayAuditSummary {
  total: number;
  byResult: Record<AgentLedgerReplayAuditResult, number>;
}

export interface AgentLedgerReplayAuditQueryResult {
  data: AgentLedgerReplayAuditItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AgentLedgerReplayAuditQuery {
  page?: number;
  pageSize?: number;
  outboxId?: number;
  traceId?: string;
  operatorId?: string;
  result?: "" | AgentLedgerReplayAuditResult;
  triggerSource?: "" | AgentLedgerReplayTriggerSource;
  from?: string;
  to?: string;
}

export interface AgentLedgerDeliveryAttemptItem {
  id: number;
  outboxId: number;
  traceId: string;
  idempotencyKey: string;
  source: AgentLedgerDeliveryAttemptSource | string;
  attemptNumber: number;
  result: AgentLedgerReplayAuditResult | string;
  httpStatus?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  createdAt: number;
}

export interface AgentLedgerDeliveryAttemptSummary {
  total: number;
  bySource: Record<AgentLedgerDeliveryAttemptSource, number>;
  byResult: Record<AgentLedgerReplayAuditResult, number>;
}

export interface AgentLedgerDeliveryAttemptQueryResult {
  data: AgentLedgerDeliveryAttemptItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AgentLedgerDeliveryAttemptQuery {
  page?: number;
  pageSize?: number;
  outboxId?: number;
  traceId?: string;
  source?: "" | AgentLedgerDeliveryAttemptSource;
  result?: "" | AgentLedgerReplayAuditResult;
  httpStatus?: number;
  errorClass?: string;
  from?: string;
  to?: string;
}

export interface AgentLedgerReplayBatchItem {
  id: number;
  ok: boolean;
  code?: "not_found" | "not_configured";
  result?: AgentLedgerReplayAuditResult | string;
  httpStatus?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  traceId?: string | null;
  deliveryState?: AgentLedgerDeliveryState | string | null;
}

export interface AgentLedgerReplayBatchResult {
  requestedCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  notFoundCount: number;
  notConfiguredCount: number;
  items: AgentLedgerReplayBatchItem[];
}

export type AgentLedgerTraceCurrentState =
  | "delivered"
  | "retryable_failure"
  | "replay_required"
  | "blocked"
  | "timeout"
  | "pending"
  | "unknown";

export interface AgentLedgerTraceDrilldownSummary {
  traceId: string;
  currentState: AgentLedgerTraceCurrentState;
  latestAttemptResult?: AgentLedgerReplayAuditResult | null;
  latestReplayResult?: AgentLedgerReplayAuditResult | null;
  needsReplay: boolean;
  lastOperatorId?: string | null;
  firstSeenAt?: number | string | null;
  lastUpdatedAt?: number | string | null;
  outboxCount: number;
  deliveryAttemptCount: number;
  replayAuditCount: number;
  auditEventCount: number;
}

export interface AgentLedgerTraceDrilldownResult {
  traceId: string;
  summary: AgentLedgerTraceDrilldownSummary;
  outbox: AgentLedgerOutboxItem[];
  deliveryAttempts: AgentLedgerDeliveryAttemptItem[];
  replayAudits: AgentLedgerReplayAuditItem[];
  auditEvents: AuditEventItem[];
  readiness: AgentLedgerOutboxReadiness | null;
  health: AgentLedgerOutboxHealth | null;
}

export interface AgentLedgerOutboxHealth {
  enabled: boolean;
  deliveryConfigured: boolean;
  workerPollIntervalMs: number;
  requestTimeoutMs: number;
  maxAttempts: number;
  retryScheduleSec: number[];
  backlog: Record<AgentLedgerDeliveryState, number> & {
    total: number;
  };
  openBacklogTotal: number;
  oldestOpenBacklogAgeSec: number;
  latestReplayRequiredAt?: number | null;
  lastCycleAt?: number | null;
  lastSuccessAt?: number | null;
}

export type AgentLedgerOutboxReadinessStatus =
  | "disabled"
  | "ready"
  | "degraded"
  | "blocking";

export interface AgentLedgerOutboxReadiness {
  ready: boolean;
  status: AgentLedgerOutboxReadinessStatus;
  checkedAt: number;
  blockingReasons: string[];
  degradedReasons: string[];
  errorMessage?: string | null;
  health: AgentLedgerOutboxHealth | null;
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
  userId?: string;
  email?: string;
  displayName?: string;
  role?: "owner" | "admin" | "member" | "viewer";
  status?: "active" | "disabled";
  updatedAt?: string;
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

export interface AuditEventExportQuery extends Omit<AuditEventQuery, "page" | "pageSize"> {
  limit?: number;
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

export interface OAuthSessionEventExportQuery
  extends Omit<OAuthSessionEventQuery, "page" | "pageSize"> {
  limit?: number;
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
const adminAgentLedgerOutboxApi = adminObservabilityApi["agentledger-outbox"];
const adminAgentLedgerDeliveryAttemptApi = adminObservabilityApi["agentledger-delivery-attempts"];
const adminAgentLedgerReplayAuditApi = adminObservabilityApi["agentledger-replay-audits"];

export const enterpriseAdminClient = {
  getFeatures() {
    return adminApi.features.$get();
  },
  getAdminSession() {
    return adminAuthApi.me.$get();
  },
  login(payload: AdminLoginPayload) {
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
  async listRolesResult() {
    return readStructuredApiResult<Record<string, unknown>, RoleItem[]>(
      await adminApi.rbac.roles.$get(),
      { fallbackErrorMessage: "加载角色失败" },
    );
  },
  listPermissions() {
    return adminApi.rbac.permissions.$get();
  },
  async listPermissionsResult() {
    return readStructuredApiResult<Record<string, unknown>, PermissionItem[]>(
      await adminApi.rbac.permissions.$get(),
      { fallbackErrorMessage: "加载权限词典失败" },
    );
  },
  getBillingQuotas() {
    return adminBillingApi.quotas.$get();
  },
  async getBillingQuotasResult() {
    return readStructuredApiResult<Record<string, unknown>, BillingQuotaResult["data"]>(
      await adminBillingApi.quotas.$get(),
      { fallbackErrorMessage: "加载基础配额失败" },
    );
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
  async listBillingUsageResult(query: BillingUsageFilterInput = {}) {
    return readStructuredApiResult<Record<string, unknown>, BillingUsageQueryResult>(
      await adminBillingApi.usage.$get({
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
      }),
      { fallbackErrorMessage: "加载配额使用记录失败" },
    );
  },
  getRoutePolicies() {
    return adminOauthApi["route-policies"].$get();
  },
  async getRoutePoliciesResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["route-policies"].$get(),
      { fallbackErrorMessage: "加载路由策略失败" },
    );
  },
  updateRoutePolicies(payload: OAuthRoutePoliciesPayload) {
    return adminOauthApi["route-policies"].$put({
      json: payload,
    });
  },
  async updateRoutePoliciesResult(payload: OAuthRoutePoliciesPayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["route-policies"].$put({
        json: payload,
      }),
      { fallbackErrorMessage: "保存路由策略失败" },
    );
  },
  getCapabilityMap() {
    return adminOauthApi["capability-map"].$get();
  },
  async getCapabilityMapResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["capability-map"].$get(),
      { fallbackErrorMessage: "加载能力图谱失败" },
    );
  },
  updateCapabilityMap(payload: ProviderCapabilityMapData) {
    return adminOauthApi["capability-map"].$put({
      json: payload,
    });
  },
  async updateCapabilityMapResult(payload: ProviderCapabilityMapData) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["capability-map"].$put({
        json: payload,
      }),
      { fallbackErrorMessage: "保存能力图谱失败" },
    );
  },
  getCapabilityHealth() {
    return adminOauthApi["capability-health"].$get();
  },
  async getCapabilityHealthResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["capability-health"].$get(),
      { fallbackErrorMessage: "加载能力健康状态失败" },
    );
  },
  getModelAlias() {
    return adminOauthApi["model-alias"].$get();
  },
  async getModelAliasResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["model-alias"].$get(),
      { fallbackErrorMessage: "加载模型别名规则失败" },
    );
  },
  updateModelAlias(payload: OAuthModelAliasPayload) {
    return adminOauthApi["model-alias"].$put({
      json: payload,
    });
  },
  async updateModelAliasResult(payload: OAuthModelAliasPayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["model-alias"].$put({
        json: payload,
      }),
      { fallbackErrorMessage: "保存模型别名规则失败" },
    );
  },
  getExcludedModels() {
    return adminOauthApi["excluded-models"].$get();
  },
  async getExcludedModelsResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["excluded-models"].$get(),
      { fallbackErrorMessage: "加载禁用模型列表失败" },
    );
  },
  updateExcludedModels(payload: OAuthExcludedModelsPayload) {
    return adminOauthApi["excluded-models"].$put({
      json: payload,
    });
  },
  async updateExcludedModelsResult(payload: OAuthExcludedModelsPayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminOauthApi["excluded-models"].$put({
        json: payload,
      }),
      { fallbackErrorMessage: "保存禁用模型列表失败" },
    );
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
  async listCallbackEventsResult(query: OAuthCallbackEventQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, OAuthCallbackQueryResult>(
      await adminOauthApi["callback-events"].$get({
        query: {
          page: query.page ? String(query.page) : undefined,
          pageSize: query.pageSize ? String(query.pageSize) : undefined,
          provider: query.provider || undefined,
          status: query.status || undefined,
          state: query.state || undefined,
          traceId: query.traceId || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 OAuth 回调事件失败" },
    );
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
  async listSessionEventsResult(query: OAuthSessionEventQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, OAuthSessionEventQueryResult>(
      await adminOauthApi["session-events"].$get({
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
      }),
      { fallbackErrorMessage: "加载 OAuth 会话事件失败" },
    );
  },
  buildSessionEventExportPath(query: OAuthSessionEventExportQuery = {}) {
    const params = new URLSearchParams();
    if (query.state) params.set("state", query.state);
    if (query.provider) params.set("provider", query.provider);
    if (query.flowType) params.set("flowType", query.flowType);
    if (query.phase) params.set("phase", query.phase);
    if (query.status) params.set("status", query.status);
    if (query.eventType) params.set("eventType", query.eventType);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.limit) params.set("limit", String(query.limit));
    const search = params.toString();
    return search
      ? `/api/admin/oauth/session-events/export?${search}`
      : "/api/admin/oauth/session-events/export";
  },
  listUsers() {
    return adminApi.users.$get();
  },
  async listUsersResult() {
    return readStructuredApiResult<Record<string, unknown>, AdminUserItem[]>(
      await adminApi.users.$get(),
      { fallbackErrorMessage: "加载用户失败" },
    );
  },
  createUser(payload: AdminUserCreatePayload) {
    return adminApi.users.$post({
      json: payload,
    });
  },
  async createUserResult(payload: AdminUserCreatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminApi.users.$post({
        json: payload,
      }),
      { fallbackErrorMessage: "创建用户失败" },
    );
  },
  updateUser(id: string, payload: AdminUserUpdatePayload) {
    const json: AdminUserUpdatePayload = {};
    if (typeof payload.displayName === "string") json.displayName = payload.displayName;
    if (Array.isArray(payload.roleBindings)) json.roleBindings = payload.roleBindings;
    if (Array.isArray(payload.tenantIds)) json.tenantIds = payload.tenantIds;
    if (payload.status) json.status = payload.status;
    if (typeof payload.password === "string") json.password = payload.password;
    if (typeof payload.roleKey === "string") json.roleKey = payload.roleKey;
    if (typeof payload.tenantId === "string") json.tenantId = payload.tenantId;
    return adminApi.users[":id"].$put({
      param: { id },
      json,
    });
  },
  async updateUserResult(id: string, payload: AdminUserUpdatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await this.updateUser(id, payload),
      { fallbackErrorMessage: "更新用户失败" },
    );
  },
  deleteUser(id: string) {
    return adminApi.users[":id"].$delete({
      param: { id },
    });
  },
  async deleteUserResult(id: string) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminApi.users[":id"].$delete({
        param: { id },
      }),
      { fallbackErrorMessage: "删除用户失败" },
    );
  },
  listTenants() {
    return adminApi.tenants.$get();
  },
  async listTenantsResult() {
    return readStructuredApiResult<Record<string, unknown>, TenantItem[]>(
      await adminApi.tenants.$get(),
      { fallbackErrorMessage: "加载租户失败" },
    );
  },
  createTenant(payload: TenantCreatePayload) {
    return adminApi.tenants.$post({
      json: payload,
    });
  },
  async createTenantResult(payload: TenantCreatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminApi.tenants.$post({
        json: payload,
      }),
      { fallbackErrorMessage: "创建租户失败" },
    );
  },
  deleteTenant(id: string) {
    return adminApi.tenants[":id"].$delete({
      param: { id },
    });
  },
  async deleteTenantResult(id: string) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminApi.tenants[":id"].$delete({
        param: { id },
      }),
      { fallbackErrorMessage: "删除租户失败" },
    );
  },
  listPolicies() {
    return adminBillingApi.policies.$get();
  },
  async listPoliciesResult() {
    return readStructuredApiResult<Record<string, unknown>, QuotaPolicyItem[]>(
      await adminBillingApi.policies.$get(),
      { fallbackErrorMessage: "加载配额策略失败" },
    );
  },
  createPolicy(payload: QuotaPolicyCreatePayload) {
    return adminBillingApi.policies.$post({
      json: payload,
    });
  },
  async createPolicyResult(payload: QuotaPolicyCreatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminBillingApi.policies.$post({
        json: payload,
      }),
      { fallbackErrorMessage: "创建策略失败" },
    );
  },
  updatePolicy(id: string, payload: QuotaPolicyUpdatePayload) {
    return adminBillingApi.policies[":id"].$put({
      param: { id },
      json: payload,
    });
  },
  async updatePolicyResult(id: string, payload: QuotaPolicyUpdatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminBillingApi.policies[":id"].$put({
        param: { id },
        json: payload,
      }),
      { fallbackErrorMessage: "更新策略失败" },
    );
  },
  deletePolicy(id: string) {
    return adminBillingApi.policies[":id"].$delete({
      param: { id },
    });
  },
  async deletePolicyResult(id: string) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminBillingApi.policies[":id"].$delete({
        param: { id },
      }),
      { fallbackErrorMessage: "删除策略失败" },
    );
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
  async listAuditEventsResult(query: AuditEventQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, AuditQueryResult>(
      await adminApi.audit.events.$get({
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
      }),
      { fallbackErrorMessage: "加载审计日志失败" },
    );
  },
  createAuditEvent(payload: AuditEventCreatePayload) {
    return adminApi.audit.events.$post({
      json: payload,
    });
  },
  async createAuditEventResult(payload: AuditEventCreatePayload) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminApi.audit.events.$post({
        json: payload,
      }),
      { fallbackErrorMessage: "写入测试审计事件失败" },
    );
  },
  buildAuditEventExportPath(query: AuditEventExportQuery = {}) {
    const params = new URLSearchParams();
    if (query.keyword) params.set("keyword", query.keyword);
    if (query.traceId) params.set("traceId", query.traceId);
    if (query.action) params.set("action", query.action);
    if (query.resource) params.set("resource", query.resource);
    if (query.resourceId) params.set("resourceId", query.resourceId);
    if (query.policyId) params.set("policyId", query.policyId);
    if (query.result) params.set("result", query.result);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.limit) params.set("limit", String(query.limit));
    const search = params.toString();
    return search ? `/api/admin/audit/export?${search}` : "/api/admin/audit/export";
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
  async listClaudeFallbackEventsResult(query: ClaudeFallbackEventQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, ClaudeFallbackQueryResult>(
      await adminObservabilityApi["claude-fallbacks"].$get({
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
      }),
      { fallbackErrorMessage: "加载 Claude 回退事件失败" },
    );
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
  async getClaudeFallbackSummaryResult(query: ClaudeFallbackEventQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, ClaudeFallbackSummary>(
      await adminObservabilityApi["claude-fallbacks"].summary.$get({
        query: {
          mode: query.mode || undefined,
          phase: query.phase || undefined,
          reason: query.reason || undefined,
          traceId: query.traceId || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 Claude 回退聚合失败" },
    );
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
  async getClaudeFallbackTimeseriesResult(query: ClaudeFallbackTimeseriesQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, ClaudeFallbackTimeseriesResult>(
      await adminObservabilityApi["claude-fallbacks"].timeseries.$get({
        query: {
          mode: query.mode || undefined,
          phase: query.phase || undefined,
          reason: query.reason || undefined,
          traceId: query.traceId || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
          step: query.step || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 Claude 回退趋势失败" },
    );
  },
  listAgentLedgerOutbox(query: AgentLedgerOutboxQuery = {}) {
    return adminAgentLedgerOutboxApi.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        deliveryState: query.deliveryState || undefined,
        status: query.status || undefined,
        provider: query.provider || undefined,
        tenantId: query.tenantId || undefined,
        traceId: query.traceId || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  async listAgentLedgerOutboxResult(query: AgentLedgerOutboxQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerOutboxApi.$get({
        query: {
          page: query.page ? String(query.page) : undefined,
          pageSize: query.pageSize ? String(query.pageSize) : undefined,
          deliveryState: query.deliveryState || undefined,
          status: query.status || undefined,
          provider: query.provider || undefined,
          tenantId: query.tenantId || undefined,
          traceId: query.traceId || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 AgentLedger outbox 列表失败" },
    );
  },
  getAgentLedgerOutboxSummary(
    query: Omit<AgentLedgerOutboxQuery, "page" | "pageSize"> = {},
  ) {
    return adminAgentLedgerOutboxApi.summary.$get({
      query: {
        deliveryState: query.deliveryState || undefined,
        status: query.status || undefined,
        provider: query.provider || undefined,
        tenantId: query.tenantId || undefined,
        traceId: query.traceId || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  async getAgentLedgerOutboxSummaryResult(
    query: Omit<AgentLedgerOutboxQuery, "page" | "pageSize"> = {},
  ) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerOutboxApi.summary.$get({
        query: {
          deliveryState: query.deliveryState || undefined,
          status: query.status || undefined,
          provider: query.provider || undefined,
          tenantId: query.tenantId || undefined,
          traceId: query.traceId || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 AgentLedger outbox 汇总失败" },
    );
  },
  buildAgentLedgerOutboxExportPath(query: AgentLedgerOutboxExportQuery = {}) {
    const params = new URLSearchParams();
    if (query.deliveryState) params.set("deliveryState", query.deliveryState);
    if (query.status) params.set("status", query.status);
    if (query.provider) params.set("provider", query.provider);
    if (query.tenantId) params.set("tenantId", query.tenantId);
    if (query.traceId) params.set("traceId", query.traceId);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.limit) params.set("limit", String(query.limit));
    const search = params.toString();
    return search
      ? `/api/admin/observability/agentledger-outbox/export?${search}`
      : "/api/admin/observability/agentledger-outbox/export";
  },
  getAgentLedgerOutboxHealth() {
    return adminAgentLedgerOutboxApi.health.$get();
  },
  async getAgentLedgerOutboxHealthResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerOutboxApi.health.$get(),
      { fallbackErrorMessage: "加载 AgentLedger 健康摘要失败" },
    );
  },
  getAgentLedgerOutboxReadiness() {
    return adminAgentLedgerOutboxApi.readiness.$get();
  },
  async getAgentLedgerOutboxReadinessResult() {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerOutboxApi.readiness.$get(),
      { fallbackErrorMessage: "加载 AgentLedger readiness 失败" },
    );
  },
  listAgentLedgerDeliveryAttempts(query: AgentLedgerDeliveryAttemptQuery = {}) {
    return adminAgentLedgerDeliveryAttemptApi.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
        traceId: query.traceId || undefined,
        source: query.source || undefined,
        result: query.result || undefined,
        httpStatus: Number.isFinite(query.httpStatus) ? String(query.httpStatus) : undefined,
        errorClass: query.errorClass || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  async listAgentLedgerDeliveryAttemptsResult(query: AgentLedgerDeliveryAttemptQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerDeliveryAttemptApi.$get({
        query: {
          page: query.page ? String(query.page) : undefined,
          pageSize: query.pageSize ? String(query.pageSize) : undefined,
          outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
          traceId: query.traceId || undefined,
          source: query.source || undefined,
          result: query.result || undefined,
          httpStatus: Number.isFinite(query.httpStatus) ? String(query.httpStatus) : undefined,
          errorClass: query.errorClass || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 AgentLedger delivery attempts 列表失败" },
    );
  },
  getAgentLedgerDeliveryAttemptSummary(
    query: Omit<AgentLedgerDeliveryAttemptQuery, "page" | "pageSize"> = {},
  ) {
    return adminAgentLedgerDeliveryAttemptApi.summary.$get({
      query: {
        outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
        traceId: query.traceId || undefined,
        source: query.source || undefined,
        result: query.result || undefined,
        httpStatus: Number.isFinite(query.httpStatus) ? String(query.httpStatus) : undefined,
        errorClass: query.errorClass || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  async getAgentLedgerDeliveryAttemptSummaryResult(
    query: Omit<AgentLedgerDeliveryAttemptQuery, "page" | "pageSize"> = {},
  ) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerDeliveryAttemptApi.summary.$get({
        query: {
          outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
          traceId: query.traceId || undefined,
          source: query.source || undefined,
          result: query.result || undefined,
          httpStatus: Number.isFinite(query.httpStatus) ? String(query.httpStatus) : undefined,
          errorClass: query.errorClass || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 AgentLedger delivery attempts 汇总失败" },
    );
  },
  replayAgentLedgerOutboxItem(id: number) {
    return adminAgentLedgerOutboxApi[":id"].replay.$post({
      param: {
        id: String(id),
      },
    });
  },
  async replayAgentLedgerOutboxItemResult(id: number) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerOutboxApi[":id"].replay.$post({
        param: {
          id: String(id),
        },
      }),
      { fallbackErrorMessage: "AgentLedger replay 失败" },
    );
  },
  replayAgentLedgerOutboxBatch(ids: number[]) {
    return adminAgentLedgerOutboxApi["replay-batch"].$post({
      json: {
        ids,
      },
    });
  },
  async replayAgentLedgerOutboxBatchResult(ids: number[]) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerOutboxApi["replay-batch"].$post({
        json: {
          ids,
        },
      }),
      { fallbackErrorMessage: "AgentLedger 批量 replay 失败" },
    );
  },
  listAgentLedgerReplayAudits(query: AgentLedgerReplayAuditQuery = {}) {
    return adminAgentLedgerReplayAuditApi.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
        traceId: query.traceId || undefined,
        operatorId: query.operatorId || undefined,
        result: query.result || undefined,
        triggerSource: query.triggerSource || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  async listAgentLedgerReplayAuditsResult(query: AgentLedgerReplayAuditQuery = {}) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerReplayAuditApi.$get({
        query: {
          page: query.page ? String(query.page) : undefined,
          pageSize: query.pageSize ? String(query.pageSize) : undefined,
          outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
          traceId: query.traceId || undefined,
          operatorId: query.operatorId || undefined,
          result: query.result || undefined,
          triggerSource: query.triggerSource || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 AgentLedger replay 审计列表失败" },
    );
  },
  getAgentLedgerReplayAuditSummary(
    query: Omit<AgentLedgerReplayAuditQuery, "page" | "pageSize"> = {},
  ) {
    return adminAgentLedgerReplayAuditApi.summary.$get({
      query: {
        outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
        traceId: query.traceId || undefined,
        operatorId: query.operatorId || undefined,
        result: query.result || undefined,
        triggerSource: query.triggerSource || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      },
    });
  },
  async getAgentLedgerReplayAuditSummaryResult(
    query: Omit<AgentLedgerReplayAuditQuery, "page" | "pageSize"> = {},
  ) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await adminAgentLedgerReplayAuditApi.summary.$get({
        query: {
          outboxId: Number.isFinite(query.outboxId) ? String(query.outboxId) : undefined,
          traceId: query.traceId || undefined,
          operatorId: query.operatorId || undefined,
          result: query.result || undefined,
          triggerSource: query.triggerSource || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
      }),
      { fallbackErrorMessage: "加载 AgentLedger replay 审计汇总失败" },
    );
  },
  getAgentLedgerTrace(traceId: string) {
    return fetchWithApiSecret(
      `/api/admin/observability/agentledger-traces/${encodeURIComponent(traceId.trim())}`,
      {
        method: "GET",
      },
    );
  },
  async getAgentLedgerTraceResult(traceId: string) {
    return readStructuredApiResult<Record<string, unknown>, Record<string, unknown>>(
      await fetchWithApiSecret(
        `/api/admin/observability/agentledger-traces/${encodeURIComponent(traceId.trim())}`,
        {
          method: "GET",
        },
      ),
      { fallbackErrorMessage: "加载 AgentLedger trace 联查失败" },
    );
  },
};
