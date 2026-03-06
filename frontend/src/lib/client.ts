import { hc } from "hono/client";
import type { AppType } from "../../../src/index";

const BASE_URL = "/";
const API_SECRET_KEY = "tokenpulse_api_secret";

/**
 * 从 localStorage 获取存储的 API Secret
 */
export function getApiSecret(): string {
  return localStorage.getItem(API_SECRET_KEY) || "";
}

/**
 * 设置 API Secret 到 localStorage
 */
export function setApiSecret(secret: string): void {
  localStorage.setItem(API_SECRET_KEY, secret);
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

// 2. 创建带有自定义 fetch 的类型化客户端以注入 Authorization 标头
export const client = hc<AppType>(BASE_URL, {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getApiSecret();
    const headers = new Headers(init?.headers);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const resp = await fetch(input, {
      ...init,
      headers,
      credentials: "include",
    });

    if (resp.status === 401) {
      // 如果 401，清除 secret 并重定向到登录页
      localStorage.removeItem(API_SECRET_KEY);
      window.location.href = "/login";
    }

    return resp;
  },
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
