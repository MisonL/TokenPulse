import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  oauthAlertRuleItems,
  oauthAlertRuleVersions,
} from "../../db/schema";

export type OAuthAlertRuleSeverity = "warning" | "critical" | "recovery";
export type OAuthAlertRuleField =
  | "provider"
  | "phase"
  | "severity"
  | "failureRateBps"
  | "failureCount"
  | "totalCount"
  | "quietHours";

export type OAuthAlertRuleOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in";

export type OAuthAlertRuleActionType = "emit" | "suppress" | "escalate" | "set_channel";
export type OAuthAlertRuleChannel = "webhook" | "wecom";

const RULE_STATUS_SET = ["draft", "active", "inactive", "archived"] as const;
const CLOCK_HHMM_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const ALL_SEVERITIES: OAuthAlertRuleSeverity[] = ["warning", "critical", "recovery"];

export const OAUTH_ALERT_RULE_VERSION_ALREADY_EXISTS_CODE =
  "oauth_alert_rule_version_already_exists";
export const OAUTH_ALERT_RULE_MUTE_WINDOW_CONFLICT_CODE =
  "oauth_alert_rule_mute_window_conflict";

export class OAuthAlertRuleVersionConflictError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "OAuthAlertRuleVersionConflictError";
    this.code = code;
    this.details = details;
  }
}

export const oauthAlertRuleMuteWindowSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .default("Asia/Shanghai")
    .refine((value) => {
      try {
        Intl.DateTimeFormat("zh-CN", { timeZone: value }).format(new Date());
        return true;
      } catch {
        return false;
      }
    }, "timezone 非法"),
  start: z
    .string()
    .trim()
    .regex(CLOCK_HHMM_PATTERN, "start 必须为 HH:mm"),
  end: z
    .string()
    .trim()
    .regex(CLOCK_HHMM_PATTERN, "end 必须为 HH:mm"),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional().default([]),
  severities: z.array(z.enum(["warning", "critical", "recovery"])).max(3).optional().default([]),
});

export const oauthAlertRuleRecoveryPolicySchema = z.object({
  consecutiveWindows: z.coerce.number().int().min(1).max(1000).optional(),
});

export const oauthAlertRuleConditionSchema = z.object({
  field: z.enum([
    "provider",
    "phase",
    "severity",
    "failureRateBps",
    "failureCount",
    "totalCount",
    "quietHours",
  ]),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in"]),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
    ])
    .optional(),
});

export const oauthAlertRuleActionSchema = z.object({
  type: z.enum(["emit", "suppress", "escalate", "set_channel"]),
  severity: z.enum(["warning", "critical", "recovery"]).optional(),
  channels: z.array(z.enum(["webhook", "wecom"]).or(z.string())).optional(),
});

export const oauthAlertRuleItemInputSchema = z.object({
  ruleId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9._:-]+$/),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional().default(true),
  priority: z.coerce.number().int().min(0).max(10_000).optional().default(100),
  allConditions: z.array(oauthAlertRuleConditionSchema).optional().default([]),
  anyConditions: z.array(oauthAlertRuleConditionSchema).optional().default([]),
  actions: z.array(oauthAlertRuleActionSchema).min(1),
});

export const oauthAlertRuleVersionCreateSchema = z.object({
  version: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(512).optional(),
  muteWindows: z.array(oauthAlertRuleMuteWindowSchema).max(64).optional().default([]),
  recoveryPolicy: oauthAlertRuleRecoveryPolicySchema.optional().default({}),
  activate: z.boolean().optional().default(true),
  rules: z.array(oauthAlertRuleItemInputSchema).min(1).max(200),
});

export const oauthAlertRuleVersionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  status: z.enum(RULE_STATUS_SET).optional(),
});

export const oauthAlertRuleRollbackSchema = z.object({
  versionId: z.coerce.number().int().positive(),
});

export type OAuthAlertRuleCondition = z.infer<typeof oauthAlertRuleConditionSchema>;
export type OAuthAlertRuleAction = z.infer<typeof oauthAlertRuleActionSchema>;
export type OAuthAlertRuleMuteWindow = z.infer<typeof oauthAlertRuleMuteWindowSchema>;
export type OAuthAlertRuleRecoveryPolicy = z.infer<typeof oauthAlertRuleRecoveryPolicySchema>;
export type OAuthAlertRuleItemInput = z.infer<typeof oauthAlertRuleItemInputSchema>;
export type OAuthAlertRuleVersionCreateInput = z.input<typeof oauthAlertRuleVersionCreateSchema>;

export interface OAuthAlertRuleItem {
  id: number;
  versionId: number;
  ruleId: string;
  name: string;
  enabled: boolean;
  priority: number;
  allConditions: OAuthAlertRuleCondition[];
  anyConditions: OAuthAlertRuleCondition[];
  actions: OAuthAlertRuleAction[];
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface OAuthAlertRuleVersion {
  id: number;
  version: string;
  status: "draft" | "active" | "inactive" | "archived";
  description: string | null;
  muteWindows: OAuthAlertRuleMuteWindow[];
  recoveryPolicy: OAuthAlertRuleRecoveryPolicy;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  rules: OAuthAlertRuleItem[];
}

export interface OAuthAlertRuleVersionSummary {
  id: number;
  version: string;
  status: string;
  description: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  totalRules: number;
  enabledRules: number;
  totalHits: number;
}

export interface OAuthAlertRuleVersionListResult {
  data: OAuthAlertRuleVersionSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OAuthAlertRuleContext {
  provider: string;
  phase: string;
  severity: OAuthAlertRuleSeverity | null;
  failureRateBps: number;
  failureCount: number;
  totalCount: number;
  quietHours: boolean;
}

export interface OAuthAlertRuleDecision {
  action: "none" | "emit" | "suppress" | "escalate";
  severity: OAuthAlertRuleSeverity | null;
  channels: OAuthAlertRuleChannel[];
  matched: boolean;
  matchedRuleId?: string;
  matchedVersionId?: number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeLowerText(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeSeverity(value: unknown): OAuthAlertRuleSeverity | null {
  const normalized = normalizeLowerText(value);
  if (normalized === "critical" || normalized === "warning" || normalized === "recovery") {
    return normalized;
  }
  return null;
}

function normalizeClockText(value: unknown, fallback: string): string {
  const normalized = normalizeText(value);
  if (CLOCK_HHMM_PATTERN.test(normalized)) return normalized;
  return fallback;
}

function normalizeTimeZone(value: unknown, fallback: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  try {
    Intl.DateTimeFormat("zh-CN", { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    return fallback;
  }
}

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed as T[];
  } catch {
    return fallback;
  }
}

function parseJsonObject<T extends Record<string, unknown>>(
  raw: string | null | undefined,
  fallback: T,
): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function uniqueChannels(channels: unknown[]): OAuthAlertRuleChannel[] {
  const values = new Set<OAuthAlertRuleChannel>();
  for (const item of channels) {
    const normalized = normalizeLowerText(item);
    if (normalized === "webhook" || normalized === "wecom") {
      values.add(normalized);
    }
  }
  return [...values];
}

function parseConditionArray(raw: string | null | undefined): OAuthAlertRuleCondition[] {
  const source = parseJsonArray<unknown>(raw, []);
  const result: OAuthAlertRuleCondition[] = [];
  for (const item of source) {
    const parsed = oauthAlertRuleConditionSchema.safeParse(item);
    if (parsed.success) {
      result.push(parsed.data);
    }
  }
  return result;
}

function parseActionArray(raw: string | null | undefined): OAuthAlertRuleAction[] {
  const source = parseJsonArray<unknown>(raw, []);
  const result: OAuthAlertRuleAction[] = [];
  for (const item of source) {
    const parsed = oauthAlertRuleActionSchema.safeParse(item);
    if (parsed.success) {
      result.push({
        ...parsed.data,
        channels: uniqueChannels((parsed.data.channels || []) as unknown[]),
      });
    }
  }
  return result;
}

function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => clampInt(item, -1, 0, 6))
        .filter((item) => item >= 0 && item <= 6),
    ),
  );
}

function normalizeMuteWindow(
  value: unknown,
  fallbackId: string,
): OAuthAlertRuleMuteWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const start = normalizeClockText(source.start, "");
  const end = normalizeClockText(source.end, "");
  if (!start || !end) return null;
  const id = normalizeText(source.id) || fallbackId;
  const parsed = oauthAlertRuleMuteWindowSchema.safeParse({
    id,
    name: normalizeText(source.name) || undefined,
    timezone: normalizeTimeZone(source.timezone, "Asia/Shanghai"),
    start,
    end,
    weekdays: normalizeWeekdays(source.weekdays),
    severities: Array.isArray(source.severities)
      ? source.severities
        .map((item) => normalizeSeverity(item))
        .filter((item): item is OAuthAlertRuleSeverity => Boolean(item))
      : [],
  });
  return parsed.success ? parsed.data : null;
}

function normalizeMuteWindows(value: unknown): OAuthAlertRuleMuteWindow[] {
  const source = Array.isArray(value) ? value : [];
  const result: OAuthAlertRuleMuteWindow[] = [];
  for (let idx = 0; idx < source.length; idx += 1) {
    const normalized = normalizeMuteWindow(source[idx], `window-${idx + 1}`);
    if (normalized) {
      result.push(normalized);
    }
  }
  return result;
}

function parseMuteWindowArray(raw: string | null | undefined): OAuthAlertRuleMuteWindow[] {
  return normalizeMuteWindows(parseJsonArray<unknown>(raw, []));
}

function normalizeRecoveryPolicy(value: unknown): OAuthAlertRuleRecoveryPolicy {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const parsed = oauthAlertRuleRecoveryPolicySchema.safeParse({
    consecutiveWindows: source.consecutiveWindows,
  });
  return parsed.success ? parsed.data : {};
}

function parseRecoveryPolicy(raw: string | null | undefined): OAuthAlertRuleRecoveryPolicy {
  return normalizeRecoveryPolicy(parseJsonObject(raw, {} as Record<string, unknown>));
}

function parseClockMinutes(clockText: string): number | null {
  if (!CLOCK_HHMM_PATTERN.test(clockText)) return null;
  const [hourText, minuteText] = clockText.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function resolveWindowSegments(startMinute: number, endMinute: number): Array<[number, number]> {
  if (startMinute === endMinute) {
    return [[0, 1440]];
  }
  if (startMinute < endMinute) {
    return [[startMinute, endMinute]];
  }
  return [
    [startMinute, 1440],
    [0, endMinute],
  ];
}

function hasWindowSegmentOverlap(
  firstSegments: Array<[number, number]>,
  secondSegments: Array<[number, number]>,
): boolean {
  for (const [firstStart, firstEnd] of firstSegments) {
    for (const [secondStart, secondEnd] of secondSegments) {
      if (Math.max(firstStart, secondStart) < Math.min(firstEnd, secondEnd)) {
        return true;
      }
    }
  }
  return false;
}

function hasClockWindowOverlap(first: OAuthAlertRuleMuteWindow, second: OAuthAlertRuleMuteWindow): boolean {
  const firstStart = parseClockMinutes(first.start);
  const firstEnd = parseClockMinutes(first.end);
  const secondStart = parseClockMinutes(second.start);
  const secondEnd = parseClockMinutes(second.end);
  if (firstStart === null || firstEnd === null || secondStart === null || secondEnd === null) {
    return false;
  }

  return hasWindowSegmentOverlap(
    resolveWindowSegments(firstStart, firstEnd),
    resolveWindowSegments(secondStart, secondEnd),
  );
}

function resolveWeekdayScope(window: OAuthAlertRuleMuteWindow): Set<number> {
  return new Set((window.weekdays && window.weekdays.length > 0 ? window.weekdays : ALL_WEEKDAYS) as number[]);
}

function resolveSeverityScope(window: OAuthAlertRuleMuteWindow): Set<OAuthAlertRuleSeverity> {
  return new Set(
    (window.severities && window.severities.length > 0
      ? window.severities
      : ALL_SEVERITIES) as OAuthAlertRuleSeverity[],
  );
}

function hasSetIntersection<T>(first: Set<T>, second: Set<T>): boolean {
  for (const value of first) {
    if (second.has(value)) return true;
  }
  return false;
}

function findMuteWindowConflict(
  windows: OAuthAlertRuleMuteWindow[],
): { left: OAuthAlertRuleMuteWindow; right: OAuthAlertRuleMuteWindow } | null {
  for (let leftIdx = 0; leftIdx < windows.length; leftIdx += 1) {
    const left = windows[leftIdx];
    if (!left) continue;
    const leftTimezone = normalizeLowerText(left.timezone);
    const leftWeekdays = resolveWeekdayScope(left);
    const leftSeverities = resolveSeverityScope(left);

    for (let rightIdx = leftIdx + 1; rightIdx < windows.length; rightIdx += 1) {
      const right = windows[rightIdx];
      if (!right) continue;
      if (leftTimezone !== normalizeLowerText(right.timezone)) continue;

      const rightWeekdays = resolveWeekdayScope(right);
      if (!hasSetIntersection(leftWeekdays, rightWeekdays)) continue;

      const rightSeverities = resolveSeverityScope(right);
      if (!hasSetIntersection(leftSeverities, rightSeverities)) continue;

      if (!hasClockWindowOverlap(left, right)) continue;
      return { left, right };
    }
  }
  return null;
}

function assertNoMuteWindowConflict(windows: OAuthAlertRuleMuteWindow[]) {
  const conflict = findMuteWindowConflict(windows);
  if (!conflict) return;
  const leftId = conflict.left.id || conflict.left.name || conflict.left.start;
  const rightId = conflict.right.id || conflict.right.name || conflict.right.start;
  throw new OAuthAlertRuleVersionConflictError(
    OAUTH_ALERT_RULE_MUTE_WINDOW_CONFLICT_CODE,
    `muteWindows 存在冲突: ${leftId} 与 ${rightId}`,
    {
      timezone: conflict.left.timezone,
      left: {
        id: leftId,
        start: conflict.left.start,
        end: conflict.left.end,
      },
      right: {
        id: rightId,
        start: conflict.right.start,
        end: conflict.right.end,
      },
    },
  );
}

function isVersionUniqueConflict(error: unknown): boolean {
  const candidates: any[] = [error as any];
  if ((error as any)?.cause) {
    candidates.push((error as any).cause);
  }

  for (const candidate of candidates) {
    const code = normalizeText(candidate?.code);
    const constraint = normalizeLowerText(candidate?.constraint);
    const message = normalizeLowerText(candidate?.message);
    if (constraint.includes("oauth_alert_rule_versions_version_unique_idx")) {
      return true;
    }
    if (code === "23505" && message.includes("oauth_alert_rule_versions")) {
      return true;
    }
    if (message.includes("oauth_alert_rule_versions_version_unique_idx")) {
      return true;
    }
    if (message.includes("unique constraint failed: core.oauth_alert_rule_versions.version")) {
      return true;
    }
    if (message.includes("unique constraint failed: oauth_alert_rule_versions.version")) {
      return true;
    }
    if (
      message.includes("duplicate key value violates unique constraint") &&
      message.includes("oauth_alert_rule_versions")
    ) {
      return true;
    }
  }
  return false;
}

function resolveTimezoneMinutes(nowMs: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value || "NaN");
    const minute = Number(parts.find((part) => part.type === "minute")?.value || "NaN");
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function resolveTimezoneWeekday(nowMs: number, timeZone: string): number | null {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(new Date(nowMs));
    if (weekday === "Sun") return 0;
    if (weekday === "Mon") return 1;
    if (weekday === "Tue") return 2;
    if (weekday === "Wed") return 3;
    if (weekday === "Thu") return 4;
    if (weekday === "Fri") return 5;
    if (weekday === "Sat") return 6;
    return null;
  } catch {
    return null;
  }
}

function inClockWindow(current: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function isMuteWindowActive(
  window: OAuthAlertRuleMuteWindow,
  severity: OAuthAlertRuleSeverity | null | undefined,
  nowMs: number,
): boolean {
  const start = parseClockMinutes(window.start);
  const end = parseClockMinutes(window.end);
  if (start === null || end === null) return false;

  if (window.severities && window.severities.length > 0) {
    if (!severity || !window.severities.includes(severity)) {
      return false;
    }
  }

  const weekday = resolveTimezoneWeekday(nowMs, window.timezone);
  if (window.weekdays && window.weekdays.length > 0) {
    if (weekday === null || !window.weekdays.includes(weekday)) {
      return false;
    }
  }

  const minute = resolveTimezoneMinutes(nowMs, window.timezone);
  if (minute === null) return false;
  return inClockWindow(minute, start, end);
}

function normalizeRuleStatus(value: unknown): "draft" | "active" | "inactive" | "archived" {
  const normalized = normalizeLowerText(value);
  if (normalized === "draft") return "draft";
  if (normalized === "active") return "active";
  if (normalized === "archived") return "archived";
  return "inactive";
}

function toRuleItem(row: {
  id: number;
  versionId: number;
  ruleId: string;
  name: string;
  enabled: number;
  priority: number;
  allConditions: string;
  anyConditions: string;
  actions: string;
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}): OAuthAlertRuleItem {
  return {
    id: row.id,
    versionId: row.versionId,
    ruleId: row.ruleId,
    name: row.name,
    enabled: row.enabled !== 0,
    priority: clampInt(row.priority, 100, 0, 10_000),
    allConditions: parseConditionArray(row.allConditions),
    anyConditions: parseConditionArray(row.anyConditions),
    actions: parseActionArray(row.actions),
    hitCount: Math.max(0, Number(row.hitCount || 0)),
    createdAt: Math.max(0, Number(row.createdAt || 0)),
    updatedAt: Math.max(0, Number(row.updatedAt || 0)),
  };
}

function toRuleVersion(
  row: {
    id: number;
    version: string;
    status: string;
    description: string | null;
    muteWindows: string | null;
    recoveryPolicy: string | null;
    createdBy: string | null;
    createdAt: number;
    updatedAt: number;
    activatedAt: number | null;
  },
  rules: OAuthAlertRuleItem[],
): OAuthAlertRuleVersion {
  return {
    id: row.id,
    version: row.version,
    status: normalizeRuleStatus(row.status),
    description: row.description || null,
    muteWindows: parseMuteWindowArray(row.muteWindows),
    recoveryPolicy: parseRecoveryPolicy(row.recoveryPolicy),
    createdBy: row.createdBy || null,
    createdAt: Math.max(0, Number(row.createdAt || 0)),
    updatedAt: Math.max(0, Number(row.updatedAt || 0)),
    activatedAt: row.activatedAt ? Math.max(0, Number(row.activatedAt || 0)) : null,
    rules,
  };
}

function resolveContextValue(context: OAuthAlertRuleContext, field: OAuthAlertRuleField): unknown {
  if (field === "provider") return context.provider;
  if (field === "phase") return context.phase;
  if (field === "severity") return context.severity || "";
  if (field === "failureRateBps") return context.failureRateBps;
  if (field === "failureCount") return context.failureCount;
  if (field === "totalCount") return context.totalCount;
  if (field === "quietHours") return context.quietHours;
  return null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareNumber(op: OAuthAlertRuleOperator, left: number, right: number): boolean {
  if (op === "gt") return left > right;
  if (op === "gte") return left >= right;
  if (op === "lt") return left < right;
  if (op === "lte") return left <= right;
  if (op === "eq") return left === right;
  if (op === "neq") return left !== right;
  return false;
}

function compareScalar(op: OAuthAlertRuleOperator, left: unknown, right: unknown): boolean {
  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);
  const isNumericOp = op === "gt" || op === "gte" || op === "lt" || op === "lte";
  if (leftNumber !== null && rightNumber !== null) {
    return compareNumber(op, leftNumber, rightNumber);
  }
  if (isNumericOp) return false;

  if (typeof left === "boolean" || typeof right === "boolean") {
    if (op === "eq") return Boolean(left) === Boolean(right);
    if (op === "neq") return Boolean(left) !== Boolean(right);
    return false;
  }

  const leftText = normalizeLowerText(left);
  const rightText = normalizeLowerText(right);
  if (op === "eq") return leftText === rightText;
  if (op === "neq") return leftText !== rightText;
  return false;
}

function matchesCondition(condition: OAuthAlertRuleCondition, context: OAuthAlertRuleContext): boolean {
  const left = resolveContextValue(context, condition.field);
  const op = condition.op;
  const right = condition.value;

  if (op === "in" || op === "not_in") {
    if (!Array.isArray(right)) return false;
    const matched = right.some((item) => compareScalar("eq", left, item));
    return op === "in" ? matched : !matched;
  }

  if (typeof right === "undefined") return false;
  return compareScalar(op, left, right);
}

function matchesRule(rule: OAuthAlertRuleItem, context: OAuthAlertRuleContext): boolean {
  if (!rule.enabled) return false;
  const allConditions = rule.allConditions || [];
  const anyConditions = rule.anyConditions || [];

  const allMatched =
    allConditions.length === 0 || allConditions.every((condition) => matchesCondition(condition, context));
  if (!allMatched) return false;

  const anyMatched =
    anyConditions.length === 0 || anyConditions.some((condition) => matchesCondition(condition, context));
  return anyMatched;
}

function actionPriority(action: OAuthAlertRuleDecision["action"]): number {
  if (action === "suppress") return 3;
  if (action === "escalate") return 2;
  if (action === "emit") return 1;
  return 0;
}

function resolveActionResult(
  rule: OAuthAlertRuleItem,
  defaultSeverity: OAuthAlertRuleSeverity | null,
): OAuthAlertRuleDecision {
  const actions = rule.actions || [];
  const channels = uniqueChannels(
    actions
      .filter((item) => item.type === "set_channel")
      .flatMap((item) => (item.channels || []) as unknown[]),
  );

  if (actions.some((item) => item.type === "suppress")) {
    return {
      action: "suppress",
      severity: null,
      channels,
      matched: true,
      matchedRuleId: rule.ruleId,
      matchedVersionId: rule.versionId,
    };
  }

  const escalate = actions.find((item) => item.type === "escalate");
  if (escalate) {
    const severity = normalizeSeverity(escalate.severity) || "critical";
    return {
      action: "escalate",
      severity,
      channels,
      matched: true,
      matchedRuleId: rule.ruleId,
      matchedVersionId: rule.versionId,
    };
  }

  const emit = actions.find((item) => item.type === "emit");
  if (emit) {
    const severity = normalizeSeverity(emit.severity) || defaultSeverity;
    return {
      action: "emit",
      severity,
      channels,
      matched: true,
      matchedRuleId: rule.ruleId,
      matchedVersionId: rule.versionId,
    };
  }

  return {
    action: "none",
    severity: defaultSeverity,
    channels,
    matched: true,
    matchedRuleId: rule.ruleId,
    matchedVersionId: rule.versionId,
  };
}

async function loadItemsByVersionId(versionId: number): Promise<OAuthAlertRuleItem[]> {
  const rows = await db
    .select({
      id: oauthAlertRuleItems.id,
      versionId: oauthAlertRuleItems.versionId,
      ruleId: oauthAlertRuleItems.ruleId,
      name: oauthAlertRuleItems.name,
      enabled: oauthAlertRuleItems.enabled,
      priority: oauthAlertRuleItems.priority,
      allConditions: oauthAlertRuleItems.allConditions,
      anyConditions: oauthAlertRuleItems.anyConditions,
      actions: oauthAlertRuleItems.actions,
      hitCount: oauthAlertRuleItems.hitCount,
      createdAt: oauthAlertRuleItems.createdAt,
      updatedAt: oauthAlertRuleItems.updatedAt,
    })
    .from(oauthAlertRuleItems)
    .where(eq(oauthAlertRuleItems.versionId, versionId))
    .orderBy(desc(oauthAlertRuleItems.priority), asc(oauthAlertRuleItems.createdAt), asc(oauthAlertRuleItems.id));

  return rows.map((row) =>
    toRuleItem({
      ...row,
      hitCount: Number(row.hitCount || 0),
    }),
  );
}

export async function getActiveOAuthAlertRuleVersion(): Promise<OAuthAlertRuleVersion | null> {
  try {
    const rows = await db
      .select({
        id: oauthAlertRuleVersions.id,
        version: oauthAlertRuleVersions.version,
        status: oauthAlertRuleVersions.status,
        description: oauthAlertRuleVersions.description,
        muteWindows: oauthAlertRuleVersions.muteWindows,
        recoveryPolicy: oauthAlertRuleVersions.recoveryPolicy,
        createdBy: oauthAlertRuleVersions.createdBy,
        createdAt: oauthAlertRuleVersions.createdAt,
        updatedAt: oauthAlertRuleVersions.updatedAt,
        activatedAt: oauthAlertRuleVersions.activatedAt,
      })
      .from(oauthAlertRuleVersions)
      .where(eq(oauthAlertRuleVersions.status, "active"))
      .orderBy(desc(oauthAlertRuleVersions.activatedAt), desc(oauthAlertRuleVersions.updatedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const rules = await loadItemsByVersionId(row.id);
    return toRuleVersion(row, rules);
  } catch {
    return null;
  }
}

export async function listOAuthAlertRuleVersions(input: {
  page?: number;
  pageSize?: number;
  status?: "draft" | "active" | "inactive" | "archived";
} = {}): Promise<OAuthAlertRuleVersionListResult> {
  const page = clampInt(input.page, 1, 1, 100_000);
  const pageSize = clampInt(input.pageSize, 20, 1, 200);
  const offset = (page - 1) * pageSize;
  const whereClause = input.status
    ? eq(oauthAlertRuleVersions.status, input.status)
    : undefined;

  try {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(oauthAlertRuleVersions)
      .where(whereClause);
    const total = Math.max(0, Number(countRow?.count || 0));

    const versions = await db
      .select({
        id: oauthAlertRuleVersions.id,
        version: oauthAlertRuleVersions.version,
        status: oauthAlertRuleVersions.status,
        description: oauthAlertRuleVersions.description,
        muteWindows: oauthAlertRuleVersions.muteWindows,
        recoveryPolicy: oauthAlertRuleVersions.recoveryPolicy,
        createdBy: oauthAlertRuleVersions.createdBy,
        createdAt: oauthAlertRuleVersions.createdAt,
        updatedAt: oauthAlertRuleVersions.updatedAt,
        activatedAt: oauthAlertRuleVersions.activatedAt,
      })
      .from(oauthAlertRuleVersions)
      .where(whereClause)
      .orderBy(desc(oauthAlertRuleVersions.updatedAt), desc(oauthAlertRuleVersions.id))
      .limit(pageSize)
      .offset(offset);

    const summaries: OAuthAlertRuleVersionSummary[] = [];
    for (const version of versions) {
      const [stat] = await db
        .select({
          totalRules: sql<number>`count(*)`,
          enabledRules: sql<number>`sum(case when ${oauthAlertRuleItems.enabled} = 1 then 1 else 0 end)`,
          totalHits: sql<number>`sum(${oauthAlertRuleItems.hitCount})`,
        })
        .from(oauthAlertRuleItems)
        .where(eq(oauthAlertRuleItems.versionId, version.id));

      summaries.push({
        id: version.id,
        version: version.version,
        status: normalizeRuleStatus(version.status),
        description: version.description || null,
        createdBy: version.createdBy || null,
        createdAt: Number(version.createdAt || 0),
        updatedAt: Number(version.updatedAt || 0),
        activatedAt: version.activatedAt ? Number(version.activatedAt) : null,
        totalRules: Math.max(0, Number(stat?.totalRules || 0)),
        enabledRules: Math.max(0, Number(stat?.enabledRules || 0)),
        totalHits: Math.max(0, Number(stat?.totalHits || 0)),
      });
    }

    return {
      data: summaries,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch {
    return {
      data: [],
      page,
      pageSize,
      total: 0,
      totalPages: 1,
    };
  }
}

export async function createOAuthAlertRuleVersion(params: {
  payload: OAuthAlertRuleVersionCreateInput;
  actor?: string;
}): Promise<OAuthAlertRuleVersion | null> {
  const now = Date.now();
  const versionText = normalizeText(params.payload.version) || `v-${now}`;
  const normalizedMuteWindows = normalizeMuteWindows(params.payload.muteWindows || []);
  assertNoMuteWindowConflict(normalizedMuteWindows);
  const normalizedRecoveryPolicy = normalizeRecoveryPolicy(params.payload.recoveryPolicy || {});

  try {
    const normalizedRules = params.payload.rules.map((item) => ({
      ruleId: item.ruleId,
      name: item.name,
      enabled: item.enabled ? 1 : 0,
      priority: clampInt(item.priority, 100, 0, 10_000),
      allConditions: JSON.stringify(item.allConditions || []),
      anyConditions: JSON.stringify(item.anyConditions || []),
      actions: JSON.stringify(
        (item.actions || []).map((action) => ({
          ...action,
          channels: uniqueChannels((action.channels || []) as unknown[]),
        })),
      ),
      createdAt: now,
      updatedAt: now,
    }));

    const storedVersion = await db.transaction(async (tx) => {
      const [versionRow] = await tx
        .insert(oauthAlertRuleVersions)
        .values({
          version: versionText,
          status: "draft",
          description: params.payload.description || null,
          muteWindows: JSON.stringify(normalizedMuteWindows),
          recoveryPolicy: JSON.stringify(normalizedRecoveryPolicy),
          createdBy: params.actor || null,
          createdAt: now,
          updatedAt: now,
          activatedAt: null,
        })
        .returning({
          id: oauthAlertRuleVersions.id,
          version: oauthAlertRuleVersions.version,
          status: oauthAlertRuleVersions.status,
          description: oauthAlertRuleVersions.description,
          muteWindows: oauthAlertRuleVersions.muteWindows,
          recoveryPolicy: oauthAlertRuleVersions.recoveryPolicy,
          createdBy: oauthAlertRuleVersions.createdBy,
          createdAt: oauthAlertRuleVersions.createdAt,
          updatedAt: oauthAlertRuleVersions.updatedAt,
          activatedAt: oauthAlertRuleVersions.activatedAt,
        });
      if (!versionRow) return null;

      if (normalizedRules.length > 0) {
        await tx.insert(oauthAlertRuleItems).values(
          normalizedRules.map((item) => ({
            versionId: versionRow.id,
            ...item,
          })),
        );
      }

      if (!params.payload.activate) {
        return versionRow;
      }

      await tx
        .update(oauthAlertRuleVersions)
        .set({
          status: "inactive",
          updatedAt: now,
        })
        .where(
          and(
            eq(oauthAlertRuleVersions.status, "active"),
            sql`${oauthAlertRuleVersions.id} <> ${versionRow.id}`,
          ),
        );

      const [activated] = await tx
        .update(oauthAlertRuleVersions)
        .set({
          status: "active",
          updatedAt: now,
          activatedAt: now,
        })
        .where(eq(oauthAlertRuleVersions.id, versionRow.id))
        .returning({
          id: oauthAlertRuleVersions.id,
          version: oauthAlertRuleVersions.version,
          status: oauthAlertRuleVersions.status,
          description: oauthAlertRuleVersions.description,
          muteWindows: oauthAlertRuleVersions.muteWindows,
          recoveryPolicy: oauthAlertRuleVersions.recoveryPolicy,
          createdBy: oauthAlertRuleVersions.createdBy,
          createdAt: oauthAlertRuleVersions.createdAt,
          updatedAt: oauthAlertRuleVersions.updatedAt,
          activatedAt: oauthAlertRuleVersions.activatedAt,
        });

      return activated || null;
    });

    if (!storedVersion) return null;

    const rules = await loadItemsByVersionId(storedVersion.id);
    return toRuleVersion(storedVersion, rules);
  } catch (error) {
    if (error instanceof OAuthAlertRuleVersionConflictError) {
      throw error;
    }
    if (isVersionUniqueConflict(error)) {
      throw new OAuthAlertRuleVersionConflictError(
        OAUTH_ALERT_RULE_VERSION_ALREADY_EXISTS_CODE,
        `OAuth 告警规则版本已存在: ${versionText}`,
        { version: versionText },
      );
    }
    return null;
  }
}

export async function activateOAuthAlertRuleVersion(versionId: number): Promise<OAuthAlertRuleVersion | null> {
  const safeVersionId = clampInt(versionId, 0, 1, Number.MAX_SAFE_INTEGER);
  if (safeVersionId <= 0) return null;

  try {
    const now = Date.now();
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: oauthAlertRuleVersions.id,
        })
        .from(oauthAlertRuleVersions)
        .where(eq(oauthAlertRuleVersions.id, safeVersionId))
        .limit(1);
      if (!rows[0]) return null;

      await tx
        .update(oauthAlertRuleVersions)
        .set({
          status: "inactive",
          updatedAt: now,
        })
        .where(
          and(
            eq(oauthAlertRuleVersions.status, "active"),
            sql`${oauthAlertRuleVersions.id} <> ${safeVersionId}`,
          ),
        );

      const [activeRow] = await tx
        .update(oauthAlertRuleVersions)
        .set({
          status: "active",
          updatedAt: now,
          activatedAt: now,
        })
        .where(eq(oauthAlertRuleVersions.id, safeVersionId))
        .returning({
          id: oauthAlertRuleVersions.id,
          version: oauthAlertRuleVersions.version,
          status: oauthAlertRuleVersions.status,
          description: oauthAlertRuleVersions.description,
          muteWindows: oauthAlertRuleVersions.muteWindows,
          recoveryPolicy: oauthAlertRuleVersions.recoveryPolicy,
          createdBy: oauthAlertRuleVersions.createdBy,
          createdAt: oauthAlertRuleVersions.createdAt,
          updatedAt: oauthAlertRuleVersions.updatedAt,
          activatedAt: oauthAlertRuleVersions.activatedAt,
        });

      return activeRow || null;
    });

    if (!updated) return null;
    const rules = await loadItemsByVersionId(updated.id);
    return toRuleVersion(updated, rules);
  } catch {
    return null;
  }
}

export function isOAuthAlertRuleVersionMuteWindowActive(input: {
  version?: OAuthAlertRuleVersion | null;
  severity?: OAuthAlertRuleSeverity | null;
  nowMs?: number;
}): boolean {
  const version = input.version || null;
  if (!version || !Array.isArray(version.muteWindows) || version.muteWindows.length === 0) {
    return false;
  }

  const nowMs = clampInt(input.nowMs, Date.now(), 0, Number.MAX_SAFE_INTEGER);
  for (const window of version.muteWindows) {
    if (isMuteWindowActive(window, input.severity, nowMs)) {
      return true;
    }
  }
  return false;
}

export function resolveOAuthAlertRuleRecoveryConsecutiveWindows(
  version: OAuthAlertRuleVersion | null | undefined,
  fallback: number,
): number {
  const safeFallback = clampInt(fallback, 1, 1, 1000);
  const configured = version?.recoveryPolicy?.consecutiveWindows;
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return safeFallback;
  }
  return clampInt(configured, safeFallback, 1, 1000);
}

async function incrementRuleHitCount(ruleDbId: number) {
  try {
    await db
      .update(oauthAlertRuleItems)
      .set({
        hitCount: sql`${oauthAlertRuleItems.hitCount} + 1`,
        updatedAt: Date.now(),
      })
      .where(eq(oauthAlertRuleItems.id, ruleDbId));
  } catch {
    // 规则命中计数失败不阻断告警主链路。
  }
}

export async function evaluateOAuthAlertRuleDecision(params: {
  context: OAuthAlertRuleContext;
  defaultSeverity: OAuthAlertRuleSeverity | null;
  activeVersion?: OAuthAlertRuleVersion | null;
}): Promise<OAuthAlertRuleDecision> {
  const fallback: OAuthAlertRuleDecision = {
    action: "none",
    severity: params.defaultSeverity,
    channels: [],
    matched: false,
  };

  const activeVersion =
    typeof params.activeVersion === "undefined"
      ? await getActiveOAuthAlertRuleVersion()
      : params.activeVersion;

  if (!activeVersion || activeVersion.rules.length === 0) {
    return fallback;
  }

  const matched = activeVersion.rules.filter((rule) => matchesRule(rule, params.context));
  if (matched.length === 0) {
    return fallback;
  }

  const maxPriority = Math.max(...matched.map((item) => item.priority));
  const topPriorityRules = matched.filter((item) => item.priority === maxPriority);

  const winner = [...topPriorityRules]
    .map((rule) => ({
      rule,
      decision: resolveActionResult(rule, params.defaultSeverity),
    }))
    .sort((a, b) => {
      const rankDiff = actionPriority(b.decision.action) - actionPriority(a.decision.action);
      if (rankDiff !== 0) return rankDiff;
      const createdDiff = a.rule.createdAt - b.rule.createdAt;
      if (createdDiff !== 0) return createdDiff;
      return a.rule.id - b.rule.id;
    })[0];

  if (!winner) return fallback;

  void incrementRuleHitCount(winner.rule.id);

  return {
    ...winner.decision,
    matched: true,
    matchedRuleId: winner.rule.ruleId,
    matchedVersionId: winner.rule.versionId,
  };
}
