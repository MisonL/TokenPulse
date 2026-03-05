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
    return client.api.admin.oauth.alertmanager.config.$get();
  },
  updateAlertmanagerConfig(payload: AlertmanagerConfigUpdatePayload) {
    return client.api.admin.oauth.alertmanager.config.$put({
      json: payload,
    });
  },
  syncAlertmanagerConfig(payload: AlertmanagerSyncPayload = {}) {
    return client.api.admin.oauth.alertmanager.sync.$post({
      json: payload,
    });
  },
  listAlertmanagerSyncHistory(query: AlertmanagerSyncHistoryQuery = {}) {
    return client.api.admin.oauth.alertmanager["sync-history"].$get({
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
    return client.api.admin.oauth.alertmanager["sync-history"][":historyId"].rollback.$post({
      param: {
        historyId,
      },
      json: payload,
    });
  },
  getAlertRuleActive() {
    return client.api.admin.oauth.alerts.rules.active.$get();
  },
  listAlertRuleVersions(query: OAuthAlertRuleVersionListQuery = {}) {
    return client.api.admin.oauth.alerts.rules.versions.$get({
      query: {
        page: query.page ? String(query.page) : undefined,
        pageSize: query.pageSize ? String(query.pageSize) : undefined,
        status: query.status || undefined,
      },
    });
  },
  createAlertRuleVersion(payload: Record<string, unknown>) {
    return client.api.admin.oauth.alerts.rules.versions.$post({
      json: payload,
    });
  },
  rollbackAlertRuleVersion(versionId: number) {
    return client.api.admin.oauth.alerts.rules.versions[":versionId"].rollback.$post({
      param: {
        versionId: String(versionId),
      },
    });
  },
};
