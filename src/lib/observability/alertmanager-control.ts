import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { config } from "../../config";
import { db, dbClients } from "../../db";
import {
  oauthAlertAlertmanagerConfigs,
  oauthAlertAlertmanagerSyncHistories,
  settings,
} from "../../db/schema";

export const ALERTMANAGER_CONFIG_SETTING_KEY = "alertmanager_control_config";
export const ALERTMANAGER_HISTORY_SETTING_KEY = "alertmanager_control_history";
export const ALERTMANAGER_HISTORY_SCHEMA_VERSION = 1;
export const ALERTMANAGER_RUNTIME_FILE =
  (config.alertmanager.configFilename || "alertmanager.generated.yml").trim() ||
  "alertmanager.generated.yml";

const ALERTMANAGER_CONFIG_DESCRIPTION = "Alertmanager 下发配置";
const ALERTMANAGER_HISTORY_DESCRIPTION = "Alertmanager 下发历史";
const ALERTMANAGER_HISTORY_MAX_ENTRIES = 200;

type JsonRecord = Record<string, unknown>;
type JsonArray = unknown[];

export interface AlertmanagerControlConfig {
  global?: JsonRecord;
  route: JsonRecord;
  receivers: JsonRecord[];
  inhibit_rules?: JsonRecord[];
  mute_time_intervals?: JsonRecord[];
  time_intervals?: JsonRecord[];
  templates?: string[];
}

export interface AlertmanagerStoredConfig {
  version: number;
  updatedAt: string;
  updatedBy: string;
  comment?: string;
  config: AlertmanagerControlConfig;
}

export interface AlertmanagerRuntimeConfig {
  reloadUrl: string;
  readyUrl: string;
  runtimeDir: string;
  timeoutMs: number;
}

export type AlertmanagerHistoryOutcome =
  | "success"
  | "rolled_back"
  | "rollback_failed";

export interface AlertmanagerConfigHistoryEntry {
  id: string;
  ts: string;
  actor: string;
  outcome: AlertmanagerHistoryOutcome;
  reason?: string;
  error?: string;
  rollbackError?: string;
  runtime: AlertmanagerRuntimeConfig;
  webhookTargets: string[];
}

export interface AlertmanagerConfigHistoryDocument {
  version: number;
  entries: AlertmanagerConfigHistoryEntry[];
}

export interface AlertmanagerControlStore {
  readSetting(key: string): Promise<string | null>;
  writeSetting(input: {
    key: string;
    value: string;
    description: string;
  }): Promise<void>;
  deleteSetting?(key: string): Promise<void>;
}

export interface AlertmanagerRuntimeAdapter {
  writeRuntimeYaml(
    yaml: string,
    runtime: AlertmanagerRuntimeConfig,
  ): Promise<string>;
  reload(runtime: AlertmanagerRuntimeConfig): Promise<void>;
  ready(runtime: AlertmanagerRuntimeConfig): Promise<void>;
}

export interface UpdateAlertmanagerControlOptions {
  actor?: string;
  comment?: string;
  store?: AlertmanagerControlStore;
}

export interface AppendAlertmanagerHistoryInput {
  actor?: string;
  outcome: AlertmanagerHistoryOutcome;
  runtime: AlertmanagerRuntimeConfig;
  reason?: string;
  error?: string;
  rollbackError?: string;
  webhookTargets?: string[];
  config?: AlertmanagerControlConfig;
}

export interface AppendAlertmanagerHistoryOptions {
  store?: AlertmanagerControlStore;
  maxEntries?: number;
}

export interface ListAlertmanagerHistoryOptions {
  store?: AlertmanagerControlStore;
  limit?: number;
  page?: number;
  pageSize?: number;
}

export interface AlertmanagerHistoryListResult {
  data: AlertmanagerConfigHistoryEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SyncAlertmanagerControlOptions {
  actor?: string;
  comment?: string;
  reason?: string;
  runtime?: Partial<AlertmanagerRuntimeConfig>;
  store?: AlertmanagerControlStore;
  runtimeAdapter?: AlertmanagerRuntimeAdapter;
}

export interface RollbackAlertmanagerHistoryOptions {
  actor?: string;
  comment?: string;
  reason?: string;
  runtime?: Partial<AlertmanagerRuntimeConfig>;
  store?: AlertmanagerControlStore;
  runtimeAdapter?: AlertmanagerRuntimeAdapter;
}

export interface AlertmanagerSyncResult {
  stored: AlertmanagerStoredConfig;
  renderedYaml: string;
  runtimeFilePath: string;
  maskedConfig: AlertmanagerControlConfig;
  history: AlertmanagerConfigHistoryEntry;
}

export interface AlertmanagerHistoryRollbackResult extends AlertmanagerSyncResult {
  sourceHistoryId: string;
}

export class AlertmanagerSyncError extends Error {
  rollbackSucceeded: boolean;
  rollbackError?: string;

  constructor(message: string, rollbackSucceeded: boolean, rollbackError?: string) {
    super(message);
    this.name = "AlertmanagerSyncError";
    this.rollbackSucceeded = rollbackSucceeded;
    this.rollbackError = rollbackError;
  }
}

export const ALERTMANAGER_SYNC_IN_PROGRESS_CODE = "alertmanager_sync_in_progress";

export class AlertmanagerLockConflictError extends Error {
  code: string;

  constructor(message = "Alertmanager 同步/回滚正在执行，请稍后重试") {
    super(message);
    this.name = "AlertmanagerLockConflictError";
    this.code = ALERTMANAGER_SYNC_IN_PROGRESS_CODE;
  }
}

const ALERTMANAGER_ADVISORY_LOCK_KEY_1 = 12051;
const ALERTMANAGER_ADVISORY_LOCK_KEY_2 = 1;
let alertmanagerFallbackLock = false;

function isRecord(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function cloneValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

function normalizeActor(actor: unknown): string {
  return normalizeText(actor) || "system";
}

function normalizeIsoTime(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function normalizeTimeout(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(100, Math.floor(parsed));
}

function normalizeRuntimeConfig(
  runtime?: Partial<AlertmanagerRuntimeConfig>,
): AlertmanagerRuntimeConfig {
  return {
    reloadUrl: (runtime?.reloadUrl || config.alertmanager.reloadUrl).trim(),
    readyUrl: (runtime?.readyUrl || config.alertmanager.readyUrl).trim(),
    runtimeDir:
      (runtime?.runtimeDir || config.alertmanager.runtimeDir).trim() ||
      config.alertmanager.runtimeDir,
    timeoutMs: normalizeTimeout(
      runtime?.timeoutMs,
      config.alertmanager.timeoutMs,
    ),
  };
}

function normalizeRecord(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return cloneValue(value);
}

function normalizeRecordArray(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item) => isRecord(item))
    .map((item) => cloneValue(item));
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => Boolean(item));
  return list.length > 0 ? list : undefined;
}

function normalizeAlertmanagerControlConfig(
  raw: unknown,
): AlertmanagerControlConfig {
  const source = isRecord(raw) ? raw : {};
  const configValue: AlertmanagerControlConfig = {
    route: normalizeRecord(source.route) || { receiver: "default" },
    receivers: normalizeRecordArray(source.receivers) || [],
  };

  const global = normalizeRecord(source.global);
  const inhibitRules = normalizeRecordArray(source.inhibit_rules);
  const muteTimeIntervals = normalizeRecordArray(source.mute_time_intervals);
  const timeIntervals = normalizeRecordArray(source.time_intervals);
  const templates = normalizeStringArray(source.templates);

  if (global) configValue.global = global;
  if (inhibitRules) configValue.inhibit_rules = inhibitRules;
  if (muteTimeIntervals) configValue.mute_time_intervals = muteTimeIntervals;
  if (timeIntervals) configValue.time_intervals = timeIntervals;
  if (templates) configValue.templates = templates;

  return configValue;
}

function parseStoredConfig(raw: unknown): AlertmanagerStoredConfig | null {
  if (!isRecord(raw)) return null;

  const nowIso = new Date().toISOString();
  const directConfig = normalizeAlertmanagerControlConfig(raw);
  if (!("config" in raw)) {
    return {
      version: 1,
      updatedAt: nowIso,
      updatedBy: "system",
      config: directConfig,
    };
  }

  const configPart = normalizeAlertmanagerControlConfig(raw.config);
  const version = Number(raw.version);

  return {
    version: Number.isFinite(version) ? Math.max(1, Math.floor(version)) : 1,
    updatedAt: normalizeIsoTime(raw.updatedAt, nowIso),
    updatedBy: normalizeActor(raw.updatedBy),
    comment: normalizeText(raw.comment),
    config: configPart,
  };
}

function buildStoredConfig(
  nextConfig: AlertmanagerControlConfig,
  actor: string,
  comment?: string,
  previousVersion?: number,
): AlertmanagerStoredConfig {
  const baseVersion = Number(previousVersion);
  return {
    version: Number.isFinite(baseVersion) ? Math.max(1, Math.floor(baseVersion) + 1) : 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
    comment: normalizeText(comment),
    config: normalizeAlertmanagerControlConfig(nextConfig),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function yamlKey(key: string): string {
  if (/^[a-zA-Z0-9_-]+$/.test(key)) return key;
  return JSON.stringify(key);
}

function yamlScalar(value: unknown): string {
  if (value === null || typeof value === "undefined") return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

function isYamlNode(value: unknown): value is JsonRecord | JsonArray {
  return isRecord(value) || Array.isArray(value);
}

function renderYamlNode(value: unknown, indent: number): string[] {
  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${padding}[]`];
    const lines: string[] = [];
    for (const item of value) {
      if (isYamlNode(item)) {
        lines.push(`${padding}-`);
        lines.push(...renderYamlNode(item, indent + 2));
      } else {
        lines.push(`${padding}- ${yamlScalar(item)}`);
      }
    }
    return lines;
  }

  if (!isRecord(value)) {
    return [`${padding}${yamlScalar(value)}`];
  }

  const entries = Object.entries(value).filter(([, item]) => typeof item !== "undefined");
  if (entries.length === 0) return [`${padding}{}`];

  const lines: string[] = [];
  for (const [key, item] of entries) {
    if (isYamlNode(item)) {
      lines.push(`${padding}${yamlKey(key)}:`);
      lines.push(...renderYamlNode(item, indent + 2));
    } else {
      lines.push(`${padding}${yamlKey(key)}: ${yamlScalar(item)}`);
    }
  }
  return lines;
}

function shouldMaskWebhookUrl(key: string, parentPath: string[]): boolean {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "webhook_url") return true;
  if (normalizedKey.includes("webhook") && normalizedKey.includes("url")) return true;
  if (normalizedKey !== "url") return false;
  return parentPath.some((item) => item.includes("webhook"));
}

function collectWebhookUrls(
  value: unknown,
  parentPath: string[] = [],
  output: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectWebhookUrls(item, parentPath, output);
    }
    return output;
  }

  if (!isRecord(value)) return output;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (typeof child === "string" && shouldMaskWebhookUrl(normalizedKey, parentPath)) {
      output.push(child);
      continue;
    }
    collectWebhookUrls(child, [...parentPath, normalizedKey], output);
  }
  return output;
}

function maskWebhookNode(value: unknown, parentPath: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskWebhookNode(item, parentPath));
  }

  if (!isRecord(value)) return value;

  const out: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (typeof child === "string" && shouldMaskWebhookUrl(normalizedKey, parentPath)) {
      out[key] = maskWebhookAddress(child);
      continue;
    }
    out[key] = maskWebhookNode(child, [...parentPath, normalizedKey]);
  }
  return out;
}

function uniqueStrings(list: string[]): string[] {
  return Array.from(new Set(list.filter((item) => Boolean(item))));
}

function parseHistoryDocument(raw: unknown): AlertmanagerConfigHistoryDocument {
  if (!isRecord(raw)) {
    return {
      version: ALERTMANAGER_HISTORY_SCHEMA_VERSION,
      entries: [],
    };
  }

  const version = Number(raw.version);
  const entriesRaw = Array.isArray(raw.entries) ? raw.entries : [];
  const entries: AlertmanagerConfigHistoryEntry[] = [];
  for (const item of entriesRaw) {
    if (!isRecord(item)) continue;
    const runtime = normalizeRuntimeConfig(
      isRecord(item.runtime)
        ? {
            reloadUrl: typeof item.runtime.reloadUrl === "string"
              ? item.runtime.reloadUrl
              : undefined,
            readyUrl: typeof item.runtime.readyUrl === "string"
              ? item.runtime.readyUrl
              : undefined,
            runtimeDir: typeof item.runtime.runtimeDir === "string"
              ? item.runtime.runtimeDir
              : undefined,
            timeoutMs: typeof item.runtime.timeoutMs === "number"
              ? item.runtime.timeoutMs
              : undefined,
          }
        : undefined,
    );

    const outcome = item.outcome;
    if (
      outcome !== "success" &&
      outcome !== "rolled_back" &&
      outcome !== "rollback_failed"
    ) {
      continue;
    }

    const webhookTargets = Array.isArray(item.webhookTargets)
      ? item.webhookTargets
        .map((target) => (typeof target === "string" ? target.trim() : ""))
        .filter((target) => Boolean(target))
      : [];

    entries.push({
      id: normalizeText(item.id) || crypto.randomUUID(),
      ts: normalizeIsoTime(item.ts, new Date().toISOString()),
      actor: normalizeActor(item.actor),
      outcome,
      reason: normalizeText(item.reason),
      error: normalizeText(item.error),
      rollbackError: normalizeText(item.rollbackError),
      runtime,
      webhookTargets,
    });
  }

  return {
    version: Number.isFinite(version) ? Math.max(1, Math.floor(version)) : 1,
    entries,
  };
}

function parseConfigFromHistoryDetails(details: unknown): AlertmanagerControlConfig | null {
  if (!isRecord(details)) return null;
  if (!("config" in details)) return null;
  try {
    return normalizeAlertmanagerControlConfig(details.config);
  } catch {
    return null;
  }
}

async function requestWithTimeout(
  endpoint: string,
  timeoutMs: number,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(endpoint, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureHttpOk(
  endpoint: string,
  timeoutMs: number,
  method: "GET" | "POST",
  action: string,
): Promise<void> {
  let response: Response;
  try {
    response = await requestWithTimeout(endpoint, timeoutMs, { method });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${action} 超时（${timeoutMs}ms）`);
    }
    throw new Error(`${action} 请求失败: ${toErrorMessage(error)}`);
  }

  if (response.ok) return;

  let body = "";
  try {
    body = (await response.text()).trim();
  } catch {
    body = "";
  }
  const preview = body ? `, body=${body.slice(0, 160)}` : "";
  throw new Error(`${action} 失败，HTTP ${response.status}${preview}`);
}

async function withAlertmanagerExclusiveLock<T>(task: () => Promise<T>): Promise<T> {
  const pg = dbClients.postgres;
  if (pg) {
    const result = await pg.begin(async (sqlClient) => {
      const lockRows = await sqlClient.unsafe<Array<{ acquired: boolean }>>(
        "select pg_try_advisory_xact_lock($1, $2) as acquired",
        [ALERTMANAGER_ADVISORY_LOCK_KEY_1, ALERTMANAGER_ADVISORY_LOCK_KEY_2],
      );
      if (!lockRows[0]?.acquired) {
        throw new AlertmanagerLockConflictError();
      }
      return await task();
    });
    return result as T;
  }

  if (alertmanagerFallbackLock) {
    throw new AlertmanagerLockConflictError();
  }
  alertmanagerFallbackLock = true;
  try {
    return await task();
  } finally {
    alertmanagerFallbackLock = false;
  }
}

export const defaultAlertmanagerControlStore: AlertmanagerControlStore = {
  async readSetting(key: string): Promise<string | null> {
    if (key === ALERTMANAGER_CONFIG_SETTING_KEY) {
      try {
        const rows = await db
          .select({
            version: oauthAlertAlertmanagerConfigs.version,
            updatedBy: oauthAlertAlertmanagerConfigs.updatedBy,
            comment: oauthAlertAlertmanagerConfigs.comment,
            configJson: oauthAlertAlertmanagerConfigs.configJson,
            updatedAt: oauthAlertAlertmanagerConfigs.updatedAt,
          })
          .from(oauthAlertAlertmanagerConfigs)
          .orderBy(
            desc(oauthAlertAlertmanagerConfigs.updatedAt),
            desc(oauthAlertAlertmanagerConfigs.id),
          )
          .limit(1);

        const row = rows[0];
        if (row?.configJson) {
          const stored = parseStoredConfig({
            version: row.version,
            updatedAt:
              Number(row.updatedAt || 0) > 0
                ? new Date(Number(row.updatedAt)).toISOString()
                : new Date().toISOString(),
            updatedBy: row.updatedBy,
            comment: row.comment,
            config: (() => {
              try {
                return JSON.parse(row.configJson) as unknown;
              } catch {
                return {};
              }
            })(),
          });
          if (stored) return JSON.stringify(stored);
        }
      } catch {
        // 兼容旧环境：回退 legacy settings。
      }
    }

    if (key === ALERTMANAGER_HISTORY_SETTING_KEY) {
      try {
        const rows = await db
          .select({
            id: oauthAlertAlertmanagerSyncHistories.id,
            status: oauthAlertAlertmanagerSyncHistories.status,
            actor: oauthAlertAlertmanagerSyncHistories.actor,
            outcome: oauthAlertAlertmanagerSyncHistories.outcome,
            reason: oauthAlertAlertmanagerSyncHistories.reason,
            runtimeJson: oauthAlertAlertmanagerSyncHistories.runtimeJson,
            webhookTargets: oauthAlertAlertmanagerSyncHistories.webhookTargets,
            error: oauthAlertAlertmanagerSyncHistories.error,
            rollbackError: oauthAlertAlertmanagerSyncHistories.rollbackError,
            details: oauthAlertAlertmanagerSyncHistories.details,
            startedAt: oauthAlertAlertmanagerSyncHistories.startedAt,
          })
          .from(oauthAlertAlertmanagerSyncHistories)
          .orderBy(
            desc(oauthAlertAlertmanagerSyncHistories.startedAt),
            desc(oauthAlertAlertmanagerSyncHistories.id),
          )
          .limit(ALERTMANAGER_HISTORY_MAX_ENTRIES);

        if (rows.length > 0) {
          const entries: AlertmanagerConfigHistoryEntry[] = [];
          for (const row of rows) {
            const details = (() => {
              try {
                return JSON.parse(row.details || "{}") as JsonRecord;
              } catch {
                return {} as JsonRecord;
              }
            })();
            const runtimeRaw = (() => {
              try {
                return JSON.parse(row.runtimeJson || "{}") as JsonRecord;
              } catch {
                return {} as JsonRecord;
              }
            })();
            const runtimeSource = isRecord(runtimeRaw)
              ? runtimeRaw
              : isRecord(details.runtime)
                ? (details.runtime as JsonRecord)
                : {};

            const runtime = normalizeRuntimeConfig({
              reloadUrl: typeof runtimeSource.reloadUrl === "string"
                ? runtimeSource.reloadUrl
                : undefined,
              readyUrl: typeof runtimeSource.readyUrl === "string"
                ? runtimeSource.readyUrl
                : undefined,
              runtimeDir: typeof runtimeSource.runtimeDir === "string"
                ? runtimeSource.runtimeDir
                : undefined,
              timeoutMs: typeof runtimeSource.timeoutMs === "number"
                ? runtimeSource.timeoutMs
                : undefined,
            });

            const outcomeCandidate =
              normalizeText(row.outcome) || normalizeText(row.status) || "";
            const outcome =
              outcomeCandidate === "success" ||
                outcomeCandidate === "rolled_back" ||
                outcomeCandidate === "rollback_failed"
                ? outcomeCandidate
                : "success";

            const webhookTargets = (() => {
              try {
                const parsed = JSON.parse(row.webhookTargets || "[]");
                if (Array.isArray(parsed)) {
                  return parsed
                    .map((item) => (typeof item === "string" ? item.trim() : ""))
                    .filter((item) => Boolean(item));
                }
              } catch {
                // ignore
              }
              if (Array.isArray(details.webhookTargets)) {
                return details.webhookTargets
                  .map((item) => (typeof item === "string" ? item.trim() : ""))
                  .filter((item) => Boolean(item));
              }
              return [] as string[];
            })();

            entries.push({
              id:
                (typeof details.id === "string" && details.id.trim()) ||
                String(row.id),
              ts:
                (typeof details.ts === "string" && details.ts.trim()) ||
                (Number(row.startedAt || 0) > 0
                  ? new Date(Number(row.startedAt)).toISOString()
                  : new Date().toISOString()),
              actor: normalizeActor(row.actor || details.actor),
              outcome,
              reason: normalizeText(row.reason || details.reason),
              error: normalizeText(row.error || details.error),
              rollbackError: normalizeText(row.rollbackError || details.rollbackError),
              runtime,
              webhookTargets,
            });
          }

          return JSON.stringify({
            version: ALERTMANAGER_HISTORY_SCHEMA_VERSION,
            entries,
          } satisfies AlertmanagerConfigHistoryDocument);
        }
      } catch {
        // 兼容旧环境：回退 legacy settings。
      }
    }

    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  },
  async writeSetting(input: {
    key: string;
    value: string;
    description: string;
  }): Promise<void> {
    if (input.key === ALERTMANAGER_CONFIG_SETTING_KEY) {
      const parsed = parseStoredConfig((() => {
        try {
          return JSON.parse(input.value) as unknown;
        } catch {
          return null;
        }
      })());
      if (!parsed) {
        throw new Error("Alertmanager 配置持久化数据非法");
      }

      const route = isRecord(parsed.config.route) ? parsed.config.route : {};
      const groupByValues = Array.isArray(route.group_by)
        ? route.group_by.filter((item) => typeof item === "string") as string[]
        : [];
      const groupBy = JSON.stringify(
        groupByValues.length > 0
          ? groupByValues
          : ["alertname", "service", "severity", "provider"],
      );
      const groupWaitSec = Math.max(
        0,
        Math.floor(
          Number.isFinite(Number(route.group_wait)) ? Number(route.group_wait) : 30,
        ),
      );
      const groupIntervalSec = Math.max(
        0,
        Math.floor(
          Number.isFinite(Number(route.group_interval)) ? Number(route.group_interval) : 300,
        ),
      );
      const repeatIntervalSec = Math.max(
        0,
        Math.floor(
          Number.isFinite(Number(route.repeat_interval)) ? Number(route.repeat_interval) : 7200,
        ),
      );

      const webhookTargets = collectWebhookUrls(parsed.config);
      const ts = Date.parse(parsed.updatedAt);
      const updatedAt = Number.isFinite(ts) ? ts : Date.now();

      await db.insert(oauthAlertAlertmanagerConfigs).values({
        enabled: 1,
        version: Math.max(1, Math.floor(parsed.version || 1)),
        updatedBy: normalizeActor(parsed.updatedBy),
        comment: parsed.comment || null,
        configJson: JSON.stringify(parsed.config),
        warningWebhookUrl: webhookTargets[0] || "",
        criticalWebhookUrl: webhookTargets[1] || "",
        p1WebhookUrl: webhookTargets[2] || "",
        groupBy,
        groupWaitSec,
        groupIntervalSec,
        repeatIntervalSec,
        createdAt: updatedAt,
        updatedAt,
      });
      return;
    }

    if (input.key === ALERTMANAGER_HISTORY_SETTING_KEY) {
      const parsed = parseHistoryDocument((() => {
        try {
          return JSON.parse(input.value) as unknown;
        } catch {
          return null;
        }
      })());
      const latest = parsed.entries[0];
      if (!latest) return;

      const [latestConfig] = await db
        .select({
          id: oauthAlertAlertmanagerConfigs.id,
          configJson: oauthAlertAlertmanagerConfigs.configJson,
        })
        .from(oauthAlertAlertmanagerConfigs)
        .orderBy(
          desc(oauthAlertAlertmanagerConfigs.updatedAt),
          desc(oauthAlertAlertmanagerConfigs.id),
        )
        .limit(1);

      const ts = Date.parse(latest.ts);
      const startedAt = Number.isFinite(ts) ? ts : Date.now();
      const runtimeFilePath = path.join(
        latest.runtime.runtimeDir,
        ALERTMANAGER_RUNTIME_FILE,
      );
      const configSnapshot = (() => {
        try {
          if (!latestConfig?.configJson) return null;
          return normalizeAlertmanagerControlConfig(JSON.parse(latestConfig.configJson));
        } catch {
          return null;
        }
      })();

      await db.insert(oauthAlertAlertmanagerSyncHistories).values({
        configId: latestConfig?.id || null,
        status: latest.outcome,
        actor: normalizeActor(latest.actor),
        outcome: latest.outcome,
        reason: latest.reason || null,
        runtimeJson: JSON.stringify(latest.runtime),
        webhookTargets: JSON.stringify(latest.webhookTargets || []),
        error: latest.error || null,
        rollbackError: latest.rollbackError || null,
        generatedPath: runtimeFilePath,
        rollbackPath: latest.outcome === "success" ? null : runtimeFilePath,
        details: JSON.stringify({
          id: latest.id,
          ts: latest.ts,
          reason: latest.reason,
          error: latest.error,
          rollbackError: latest.rollbackError,
          runtime: latest.runtime,
          webhookTargets: latest.webhookTargets,
          config: configSnapshot || undefined,
        }),
        startedAt,
        finishedAt: startedAt,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    await db
      .insert(settings)
      .values({
        key: input.key,
        value: input.value,
        description: input.description,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: input.value,
          description: input.description,
          updatedAt: nowIso,
        },
      });
  },
  async deleteSetting(key: string): Promise<void> {
    if (key === ALERTMANAGER_CONFIG_SETTING_KEY) {
      await db.delete(oauthAlertAlertmanagerConfigs);
      await db.delete(settings).where(eq(settings.key, key));
      return;
    }
    if (key === ALERTMANAGER_HISTORY_SETTING_KEY) {
      await db.delete(oauthAlertAlertmanagerSyncHistories);
      await db.delete(settings).where(eq(settings.key, key));
      return;
    }
    await db.delete(settings).where(eq(settings.key, key));
  },
};

export const defaultAlertmanagerRuntimeAdapter: AlertmanagerRuntimeAdapter = {
  async writeRuntimeYaml(
    yaml: string,
    runtime: AlertmanagerRuntimeConfig,
  ): Promise<string> {
    const targetFile = path.join(runtime.runtimeDir, ALERTMANAGER_RUNTIME_FILE);
    await mkdir(runtime.runtimeDir, { recursive: true });
    await writeFile(targetFile, yaml, "utf8");
    return targetFile;
  },
  async reload(runtime: AlertmanagerRuntimeConfig): Promise<void> {
    await ensureHttpOk(
      runtime.reloadUrl,
      runtime.timeoutMs,
      "POST",
      "Alertmanager reload",
    );
  },
  async ready(runtime: AlertmanagerRuntimeConfig): Promise<void> {
    await ensureHttpOk(
      runtime.readyUrl,
      runtime.timeoutMs,
      "GET",
      "Alertmanager ready 检查",
    );
  },
};

async function readRawSettingAsJson(
  key: string,
  store: AlertmanagerControlStore,
): Promise<unknown> {
  const raw = await store.readSetting(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function writeStoredConfig(
  stored: AlertmanagerStoredConfig,
  store: AlertmanagerControlStore,
): Promise<void> {
  await store.writeSetting({
    key: ALERTMANAGER_CONFIG_SETTING_KEY,
    value: JSON.stringify(stored),
    description: ALERTMANAGER_CONFIG_DESCRIPTION,
  });
}

async function rollbackAlertmanagerControlConfig(
  previous: AlertmanagerStoredConfig | null,
  runtime: AlertmanagerRuntimeConfig,
  store: AlertmanagerControlStore,
  runtimeAdapter: AlertmanagerRuntimeAdapter,
): Promise<{ succeeded: boolean; error?: string }> {
  try {
    if (previous) {
      await writeStoredConfig(previous, store);
      const rollbackYaml = renderAlertmanagerYaml(previous.config);
      await runtimeAdapter.writeRuntimeYaml(rollbackYaml, runtime);
      await runtimeAdapter.reload(runtime);
      await runtimeAdapter.ready(runtime);
      return { succeeded: true };
    }

    if (store.deleteSetting) {
      await store.deleteSetting(ALERTMANAGER_CONFIG_SETTING_KEY);
    }
    return { succeeded: true };
  } catch (error) {
    return {
      succeeded: false,
      error: toErrorMessage(error),
    };
  }
}

export function maskWebhookAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}/***`;
  } catch {
    if (trimmed.length <= 12) return "***";
    return `${trimmed.slice(0, 6)}***${trimmed.slice(-3)}`;
  }
}

export function maskAlertmanagerWebhookUrls<T>(value: T): T {
  return maskWebhookNode(cloneValue(value)) as T;
}

export function renderAlertmanagerYaml(value: AlertmanagerControlConfig): string {
  const normalized = normalizeAlertmanagerControlConfig(value);
  const ordered: JsonRecord = {};
  const orderedKeys = [
    "global",
    "route",
    "receivers",
    "inhibit_rules",
    "mute_time_intervals",
    "time_intervals",
    "templates",
  ];
  const source = normalized as unknown as JsonRecord;

  for (const key of orderedKeys) {
    if (typeof source[key] !== "undefined") {
      ordered[key] = source[key];
    }
  }

  for (const [key, item] of Object.entries(source)) {
    if (typeof ordered[key] === "undefined") {
      ordered[key] = item;
    }
  }

  return `${renderYamlNode(ordered, 0).join("\n")}\n`;
}

export async function readAlertmanagerControlConfig(
  store: AlertmanagerControlStore = defaultAlertmanagerControlStore,
): Promise<AlertmanagerStoredConfig | null> {
  const parsed = await readRawSettingAsJson(ALERTMANAGER_CONFIG_SETTING_KEY, store);
  return parseStoredConfig(parsed);
}

export async function updateAlertmanagerControlConfig(
  nextConfig: AlertmanagerControlConfig,
  options: UpdateAlertmanagerControlOptions = {},
): Promise<AlertmanagerStoredConfig> {
  const store = options.store || defaultAlertmanagerControlStore;
  const actor = normalizeActor(options.actor);
  const previous = await readAlertmanagerControlConfig(store);
  const stored = buildStoredConfig(
    nextConfig,
    actor,
    options.comment,
    previous?.version,
  );
  await writeStoredConfig(stored, store);
  return stored;
}

export async function appendAlertmanagerControlHistory(
  input: AppendAlertmanagerHistoryInput,
  options: AppendAlertmanagerHistoryOptions = {},
): Promise<AlertmanagerConfigHistoryEntry> {
  const store = options.store || defaultAlertmanagerControlStore;
  const maxEntries = Math.max(
    1,
    Math.floor(options.maxEntries || ALERTMANAGER_HISTORY_MAX_ENTRIES),
  );
  const parsed = await readRawSettingAsJson(ALERTMANAGER_HISTORY_SETTING_KEY, store);
  const doc = parseHistoryDocument(parsed);

  const webhookCandidates = input.webhookTargets && input.webhookTargets.length > 0
    ? input.webhookTargets
    : input.config
      ? collectWebhookUrls(input.config)
      : [];

  const entry: AlertmanagerConfigHistoryEntry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    actor: normalizeActor(input.actor),
    outcome: input.outcome,
    reason: normalizeText(input.reason),
    error: normalizeText(input.error),
    rollbackError: normalizeText(input.rollbackError),
    runtime: normalizeRuntimeConfig(input.runtime),
    webhookTargets: uniqueStrings(
      webhookCandidates.map((item) => maskWebhookAddress(item)),
    ),
  };

  doc.entries.unshift(entry);
  if (doc.entries.length > maxEntries) {
    doc.entries.length = maxEntries;
  }
  doc.version = ALERTMANAGER_HISTORY_SCHEMA_VERSION;

  await store.writeSetting({
    key: ALERTMANAGER_HISTORY_SETTING_KEY,
    value: JSON.stringify(doc),
    description: ALERTMANAGER_HISTORY_DESCRIPTION,
  });

  return entry;
}

export async function listAlertmanagerControlHistory(
  options: ListAlertmanagerHistoryOptions = {},
): Promise<AlertmanagerConfigHistoryEntry[]> {
  const paged = await listAlertmanagerControlHistoryPage(options);
  return paged.data;
}

export async function listAlertmanagerControlHistoryPage(
  options: ListAlertmanagerHistoryOptions = {},
): Promise<AlertmanagerHistoryListResult> {
  const store = options.store || defaultAlertmanagerControlStore;
  const hasLimitOnly =
    typeof options.limit !== "undefined" &&
    typeof options.page === "undefined" &&
    typeof options.pageSize === "undefined";
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = hasLimitOnly
    ? Math.max(1, Math.min(200, Math.floor(Number(options.limit) || 20)))
    : Math.max(1, Math.min(200, Math.floor(Number(options.pageSize) || 20)));

  const parsed = await readRawSettingAsJson(ALERTMANAGER_HISTORY_SETTING_KEY, store);
  const doc = parseHistoryDocument(parsed);
  const total = doc.entries.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const data = doc.entries
    .slice(offset, offset + pageSize)
    .map((item) => cloneValue(item));

  return {
    data,
    page,
    pageSize,
    total,
    totalPages,
  };
}

async function resolveAlertmanagerHistorySnapshotConfig(
  historyId: string,
): Promise<{ sourceHistoryId: string; config: AlertmanagerControlConfig } | null> {
  const targetId = normalizeText(historyId);
  if (!targetId) return null;

  const rows = await db
    .select({
      id: oauthAlertAlertmanagerSyncHistories.id,
      configId: oauthAlertAlertmanagerSyncHistories.configId,
      details: oauthAlertAlertmanagerSyncHistories.details,
      startedAt: oauthAlertAlertmanagerSyncHistories.startedAt,
    })
    .from(oauthAlertAlertmanagerSyncHistories)
    .orderBy(
      desc(oauthAlertAlertmanagerSyncHistories.startedAt),
      desc(oauthAlertAlertmanagerSyncHistories.id),
    )
    .limit(ALERTMANAGER_HISTORY_MAX_ENTRIES);

  for (const row of rows) {
    const details = (() => {
      try {
        return JSON.parse(row.details || "{}") as unknown;
      } catch {
        return {};
      }
    })();
    const detailRecord = isRecord(details) ? details : {};
    const publicId =
      (typeof detailRecord.id === "string" && detailRecord.id.trim()) ||
      String(row.id);
    if (publicId !== targetId) continue;

    const detailConfig = parseConfigFromHistoryDetails(detailRecord);
    if (detailConfig) {
      return {
        sourceHistoryId: publicId,
        config: detailConfig,
      };
    }

    const configId = Number(row.configId);
    if (Number.isFinite(configId) && configId > 0) {
      const configRows = await db
        .select({
          configJson: oauthAlertAlertmanagerConfigs.configJson,
        })
        .from(oauthAlertAlertmanagerConfigs)
        .where(eq(oauthAlertAlertmanagerConfigs.id, Math.floor(configId)))
        .limit(1);
      const configRow = configRows[0];
      if (configRow?.configJson) {
        try {
          return {
            sourceHistoryId: publicId,
            config: normalizeAlertmanagerControlConfig(JSON.parse(configRow.configJson)),
          };
        } catch {
          // ignore
        }
      }
    }
    return null;
  }

  return null;
}

export async function rollbackAlertmanagerControlConfigByHistoryId(
  historyId: string,
  options: RollbackAlertmanagerHistoryOptions = {},
): Promise<AlertmanagerHistoryRollbackResult> {
  return await withAlertmanagerExclusiveLock(async () => {
    const sourceId = normalizeText(historyId);
    if (!sourceId) {
      throw new Error("historyId 非法");
    }

    const snapshot = await resolveAlertmanagerHistorySnapshotConfig(sourceId);
    if (!snapshot) {
      throw new Error("目标同步历史不存在或缺少可回滚配置");
    }

    const result = await syncAlertmanagerControlConfigUnsafe(snapshot.config, {
      actor: options.actor,
      comment: options.comment,
      reason: options.reason || `history-rollback:${snapshot.sourceHistoryId}`,
      runtime: options.runtime,
      store: options.store,
      runtimeAdapter: options.runtimeAdapter,
    });

    return {
      ...result,
      sourceHistoryId: snapshot.sourceHistoryId,
    };
  });
}

export async function syncAlertmanagerControlConfig(
  nextConfig: AlertmanagerControlConfig,
  options: SyncAlertmanagerControlOptions = {},
): Promise<AlertmanagerSyncResult> {
  return await withAlertmanagerExclusiveLock(async () => {
    return await syncAlertmanagerControlConfigUnsafe(nextConfig, options);
  });
}

async function syncAlertmanagerControlConfigUnsafe(
  nextConfig: AlertmanagerControlConfig,
  options: SyncAlertmanagerControlOptions = {},
): Promise<AlertmanagerSyncResult> {
  const store = options.store || defaultAlertmanagerControlStore;
  const runtimeAdapter = options.runtimeAdapter || defaultAlertmanagerRuntimeAdapter;
  const runtime = normalizeRuntimeConfig(options.runtime);
  const actor = normalizeActor(options.actor);

  const previous = await readAlertmanagerControlConfig(store);
  const stored = await updateAlertmanagerControlConfig(nextConfig, {
    actor,
    comment: options.comment,
    store,
  });
  const renderedYaml = renderAlertmanagerYaml(stored.config);
  const maskedConfig = maskAlertmanagerWebhookUrls(stored.config);

  try {
    const runtimeFilePath = await runtimeAdapter.writeRuntimeYaml(
      renderedYaml,
      runtime,
    );
    await runtimeAdapter.reload(runtime);
    await runtimeAdapter.ready(runtime);

    const history = await appendAlertmanagerControlHistory(
      {
        actor,
        outcome: "success",
        reason: options.reason,
        runtime,
        config: stored.config,
      },
      { store },
    );

    return {
      stored,
      renderedYaml,
      runtimeFilePath,
      maskedConfig,
      history,
    };
  } catch (error) {
    const rollback = await rollbackAlertmanagerControlConfig(
      previous,
      runtime,
      store,
      runtimeAdapter,
    );

    const errorMessage = toErrorMessage(error);
    const history = await appendAlertmanagerControlHistory(
      {
        actor,
        outcome: rollback.succeeded ? "rolled_back" : "rollback_failed",
        reason: options.reason,
        error: errorMessage,
        rollbackError: rollback.error,
        runtime,
        config: stored.config,
      },
      { store },
    );

    throw new AlertmanagerSyncError(
      rollback.succeeded
        ? `Alertmanager 同步失败，已回滚: ${errorMessage}`
        : `Alertmanager 同步失败且回滚失败: ${errorMessage}; rollback=${
          rollback.error || "unknown"
        }`,
      rollback.succeeded,
      history.rollbackError,
    );
  }
}
