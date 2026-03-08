import type { AlertmanagerConfigPayload } from "../lib/client";

export interface OAuthAlertRuleStructuredDraft {
  version: string;
  description: string;
  activate: boolean;
  recoveryConsecutiveWindows: string;
  muteWindowEnabled: boolean;
  muteWindowId: string;
  muteWindowName: string;
  muteWindowStart: string;
  muteWindowEnd: string;
  muteWindowTimezone: string;
  muteWindowWeekdaysText: string;
  muteWindowSeveritiesText: string;
  ruleId: string;
  name: string;
  enabled: boolean;
  priority: string;
  provider: string;
  failureRateBps: string;
  severity: "warning" | "critical" | "recovery";
  channel: "" | "webhook" | "wecom";
}

export interface AlertmanagerStructuredDraft {
  defaultReceiver: string;
  groupByText: string;
  groupWaitSec: string;
  groupIntervalSec: string;
  repeatIntervalSec: string;
  warningWebhookUrl: string;
  criticalWebhookUrl: string;
  p1WebhookUrl: string;
  templatesText: string;
}

export const DEFAULT_OAUTH_ALERT_RULE_CREATE_PAYLOAD = {
  version: "ops-default-v1",
  activate: true,
  description: "默认规则版本",
  recoveryPolicy: {
    consecutiveWindows: 3,
  },
  muteWindows: [],
  rules: [
    {
      ruleId: "critical-escalate",
      name: "高失败率升级",
      enabled: true,
      priority: 200,
      allConditions: [{ field: "failureRateBps", op: "gte", value: 3500 }],
      actions: [{ type: "escalate", severity: "critical" }],
    },
  ],
} satisfies Record<string, unknown>;

export const DEFAULT_OAUTH_ALERT_RULE_CREATE_TEXT = JSON.stringify(
  DEFAULT_OAUTH_ALERT_RULE_CREATE_PAYLOAD,
  null,
  2,
);

export const DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT: OAuthAlertRuleStructuredDraft = {
  version: "ops-default-v1",
  description: "默认规则版本",
  activate: true,
  recoveryConsecutiveWindows: "3",
  muteWindowEnabled: false,
  muteWindowId: "night-shift",
  muteWindowName: "夜间静默",
  muteWindowStart: "23:00",
  muteWindowEnd: "08:00",
  muteWindowTimezone: "Asia/Shanghai",
  muteWindowWeekdaysText: "1,2,3,4,5",
  muteWindowSeveritiesText: "warning",
  ruleId: "critical-escalate",
  name: "高失败率升级",
  enabled: true,
  priority: "200",
  provider: "",
  failureRateBps: "3500",
  severity: "critical",
  channel: "",
};

export const DEFAULT_ALERTMANAGER_CONFIG_TEXT = JSON.stringify(
  { route: { receiver: "warning-webhook" }, receivers: [] },
  null,
  2,
);

export const DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT: AlertmanagerStructuredDraft = {
  defaultReceiver: "warning-webhook",
  groupByText: "alertname, provider, severity",
  groupWaitSec: "30",
  groupIntervalSec: "300",
  repeatIntervalSec: "14400",
  warningWebhookUrl: "",
  criticalWebhookUrl: "",
  p1WebhookUrl: "",
  templatesText: "",
};

export const MANAGED_ALERTMANAGER_RECEIVER_NAMES = [
  "warning-webhook",
  "critical-webhook",
  "p1-webhook",
] as const;

const HHMM_TEXT_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const toText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const toObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  const normalized = toText(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
};

const toNonNegativeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(toText(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const splitEditorText = (value: string) =>
  value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);

const isValidTimeZone = (value: string) => {
  try {
    Intl.DateTimeFormat("zh-CN", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const parseOptionalNonNegativeInteger = (
  rawValue: string,
  label: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${label} 必须是非负整数` };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: `${label} 数值过大` };
  }
  return { ok: true, value };
};

const parseAlertmanagerDurationSec = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  const text = toText(value).trim().toLowerCase();
  if (!text) return fallback;
  if (/^\d+$/.test(text)) return Math.floor(Number(text));
  const matched = text.match(/^(\d+)(s|m|h|d)$/);
  if (!matched) return fallback;
  const amount = Number(matched[1]);
  const unit = matched[2];
  const multiplier = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return Math.floor(amount * multiplier);
};

const formatAlertmanagerDurationSec = (value: number) => `${Math.max(0, Math.floor(value))}s`;

export const isManagedAlertmanagerReceiverName = (value: string) =>
  MANAGED_ALERTMANAGER_RECEIVER_NAMES.includes(
    value as (typeof MANAGED_ALERTMANAGER_RECEIVER_NAMES)[number],
  );

export const isMaskedWebhookUrl = (value: string) => value.includes("***");

export const normalizeOAuthAlertRuleStructuredDraft = (
  value: unknown,
): OAuthAlertRuleStructuredDraft => {
  const root = toObject(value);
  const firstRule = toObject(Array.isArray(root.rules) ? root.rules[0] : undefined);
  const allConditions = Array.isArray(firstRule.allConditions)
    ? firstRule.allConditions.map((item) => toObject(item))
    : [];
  const actions = Array.isArray(firstRule.actions)
    ? firstRule.actions.map((item) => toObject(item))
    : [];
  const muteWindow = toObject(Array.isArray(root.muteWindows) ? root.muteWindows[0] : undefined);
  const recoveryPolicy = toObject(root.recoveryPolicy);
  const providerCondition = allConditions.find((item) => toText(item.field).trim() === "provider");
  const failureRateCondition = allConditions.find(
    (item) => toText(item.field).trim() === "failureRateBps",
  );
  const severityAction =
    actions.find((item) => {
      const type = toText(item.type).trim();
      return type === "escalate" || type === "emit";
    }) || {};
  const channelAction = actions.find((item) => toText(item.type).trim() === "set_channel") || {};
  const channelValues = Array.isArray(channelAction.channels)
    ? channelAction.channels.map((item) => toText(item).trim())
    : [];
  const severityText = toText(severityAction.severity).trim().toLowerCase();
  const severity =
    severityText === "warning" || severityText === "critical" || severityText === "recovery"
      ? severityText
      : DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.severity;
  const channel =
    channelValues.find((item) => item === "webhook" || item === "wecom") ||
    DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.channel;

  return {
    ...DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT,
    version: toText(root.version).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.version,
    description: toText(root.description).trim(),
    activate: toBoolean(root.activate, DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.activate),
    recoveryConsecutiveWindows: String(
      Math.max(
        1,
        Math.floor(
          toNonNegativeNumber(
            recoveryPolicy.consecutiveWindows,
            Number(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.recoveryConsecutiveWindows),
          ),
        ),
      ),
    ),
    muteWindowEnabled: Object.keys(muteWindow).length > 0,
    muteWindowId: toText(muteWindow.id).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowId,
    muteWindowName:
      toText(muteWindow.name).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowName,
    muteWindowStart:
      toText(muteWindow.start).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowStart,
    muteWindowEnd:
      toText(muteWindow.end).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowEnd,
    muteWindowTimezone:
      toText(muteWindow.timezone).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowTimezone,
    muteWindowWeekdaysText: Array.isArray(muteWindow.weekdays)
      ? muteWindow.weekdays.map((item) => toText(item).trim()).filter(Boolean).join(",")
      : DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowWeekdaysText,
    muteWindowSeveritiesText: Array.isArray(muteWindow.severities)
      ? muteWindow.severities.map((item) => toText(item).trim()).filter(Boolean).join(",")
      : DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowSeveritiesText,
    ruleId: toText(firstRule.ruleId).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.ruleId,
    name: toText(firstRule.name).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.name,
    enabled: toBoolean(firstRule.enabled, DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.enabled),
    priority: String(
      Math.max(
        0,
        Math.floor(
          toNonNegativeNumber(
            firstRule.priority,
            Number(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.priority),
          ),
        ),
      ),
    ),
    provider: toText(providerCondition?.value).trim(),
    failureRateBps: String(
      Math.max(
        0,
        Math.floor(
          toNonNegativeNumber(
            failureRateCondition?.value,
            Number(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.failureRateBps),
          ),
        ),
      ),
    ),
    severity,
    channel: channel as OAuthAlertRuleStructuredDraft["channel"],
  };
};

export const buildStructuredOAuthAlertRulePayload = (
  draft: OAuthAlertRuleStructuredDraft,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } => {
  const version = draft.version.trim();
  const description = draft.description.trim();
  const ruleId = draft.ruleId.trim();
  const name = draft.name.trim();
  const provider = draft.provider.trim().toLowerCase();
  const priority = Number(draft.priority.trim());
  const failureRateBps = Number(draft.failureRateBps.trim());
  const recoveryConsecutiveWindows = Number(draft.recoveryConsecutiveWindows.trim());
  if (!version) return { ok: false, error: "版本号不能为空" };
  if (!ruleId) return { ok: false, error: "规则 ID 不能为空" };
  if (!/^[a-zA-Z0-9._:-]+$/.test(ruleId)) {
    return { ok: false, error: "规则 ID 仅支持字母、数字、点、下划线、冒号和连字符" };
  }
  if (!name) return { ok: false, error: "规则名称不能为空" };
  if (!Number.isInteger(priority) || priority < 0 || priority > 10000) {
    return { ok: false, error: "优先级必须是 0-10000 的整数" };
  }
  if (!Number.isInteger(failureRateBps) || failureRateBps < 0 || failureRateBps > 10000) {
    return { ok: false, error: "失败率阈值必须是 0-10000 的整数" };
  }
  if (
    !Number.isInteger(recoveryConsecutiveWindows) ||
    recoveryConsecutiveWindows < 1 ||
    recoveryConsecutiveWindows > 1000
  ) {
    return { ok: false, error: "恢复连续窗口数必须是 1-1000 的整数" };
  }

  const rules: Array<Record<string, unknown>> = [
    {
      ruleId,
      name,
      enabled: draft.enabled,
      priority,
      allConditions: [
        ...(provider ? [{ field: "provider", op: "eq", value: provider }] : []),
        { field: "failureRateBps", op: "gte", value: failureRateBps },
      ],
      actions: [
        { type: "escalate", severity: draft.severity },
        ...(draft.channel ? [{ type: "set_channel", channels: [draft.channel] }] : []),
      ],
    },
  ];

  const hasMuteWindow =
    draft.muteWindowEnabled ||
    [
      draft.muteWindowId,
      draft.muteWindowName,
      draft.muteWindowStart,
      draft.muteWindowEnd,
      draft.muteWindowTimezone,
      draft.muteWindowWeekdaysText,
      draft.muteWindowSeveritiesText,
    ].some((item) => item.trim());

  const muteWindows: Array<Record<string, unknown>> = [];
  if (hasMuteWindow) {
    const start = draft.muteWindowStart.trim();
    const end = draft.muteWindowEnd.trim();
    const timezone = draft.muteWindowTimezone.trim() || "Asia/Shanghai";
    if (!HHMM_TEXT_PATTERN.test(start) || !HHMM_TEXT_PATTERN.test(end)) {
      return { ok: false, error: "静默窗口开始/结束时间必须为 HH:mm" };
    }
    if (!isValidTimeZone(timezone)) {
      return { ok: false, error: "静默窗口时区非法" };
    }
    const weekdays = splitEditorText(draft.muteWindowWeekdaysText).map((item) => Number(item));
    if (weekdays.some((item) => !Number.isInteger(item) || item < 0 || item > 6)) {
      return { ok: false, error: "静默窗口 weekdays 仅支持 0-6" };
    }
    const severities = splitEditorText(draft.muteWindowSeveritiesText).map((item) =>
      item.toLowerCase(),
    );
    if (
      severities.some((item) => item !== "warning" && item !== "critical" && item !== "recovery")
    ) {
      return { ok: false, error: "静默窗口 severities 仅支持 warning、critical、recovery" };
    }
    muteWindows.push({
      ...(draft.muteWindowId.trim() ? { id: draft.muteWindowId.trim() } : {}),
      ...(draft.muteWindowName.trim() ? { name: draft.muteWindowName.trim() } : {}),
      start,
      end,
      timezone,
      weekdays,
      severities,
    });
  }

  return {
    ok: true,
    payload: {
      version,
      ...(description ? { description } : {}),
      activate: draft.activate,
      recoveryPolicy: {
        consecutiveWindows: recoveryConsecutiveWindows,
      },
      muteWindows,
      rules,
    },
  };
};

const getAlertmanagerReceiverUrl = (value: unknown) => {
  const receiver = toObject(value);
  const webhookConfig = toObject(
    Array.isArray(receiver.webhook_configs) ? receiver.webhook_configs[0] : undefined,
  );
  const url = toText(webhookConfig.url).trim();
  return isMaskedWebhookUrl(url) ? "" : url;
};

export const normalizeAlertmanagerStructuredDraft = (
  value: AlertmanagerConfigPayload | null | undefined,
): AlertmanagerStructuredDraft => {
  const source = toObject(value);
  const route = toObject(source.route);
  const receivers = Array.isArray(source.receivers)
    ? source.receivers.map((item) => toObject(item))
    : [];
  const getReceiverByName = (name: string) =>
    receivers.find((item) => toText(item.name).trim() === name);
  return {
    ...DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT,
    defaultReceiver:
      toText(route.receiver).trim() || DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.defaultReceiver,
    groupByText: Array.isArray(route.group_by)
      ? route.group_by.map((item) => toText(item).trim()).filter(Boolean).join(", ")
      : DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupByText,
    groupWaitSec: String(
      parseAlertmanagerDurationSec(
        route.group_wait,
        Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupWaitSec),
      ),
    ),
    groupIntervalSec: String(
      parseAlertmanagerDurationSec(
        route.group_interval,
        Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupIntervalSec),
      ),
    ),
    repeatIntervalSec: String(
      parseAlertmanagerDurationSec(
        route.repeat_interval,
        Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.repeatIntervalSec),
      ),
    ),
    warningWebhookUrl: getAlertmanagerReceiverUrl(getReceiverByName("warning-webhook")),
    criticalWebhookUrl: getAlertmanagerReceiverUrl(getReceiverByName("critical-webhook")),
    p1WebhookUrl: getAlertmanagerReceiverUrl(getReceiverByName("p1-webhook")),
    templatesText: Array.isArray(source.templates)
      ? source.templates.map((item) => toText(item).trim()).filter(Boolean).join("\n")
      : "",
  };
};

const isManagedAlertmanagerRoute = (value: Record<string, unknown>) => {
  const receiver = toText(value.receiver).trim();
  if (isManagedAlertmanagerReceiverName(receiver)) return true;
  const matchers = Array.isArray(value.matchers)
    ? value.matchers.map((item) => toText(item).trim())
    : [];
  return matchers.some(
    (item) =>
      item.includes('severity="warning"') ||
      item.includes('severity="critical"') ||
      item.includes('priority="p1"'),
  );
};

export const buildStructuredAlertmanagerPayload = (
  draft: AlertmanagerStructuredDraft,
  currentConfig?: AlertmanagerConfigPayload | null,
): { ok: true; payload: AlertmanagerConfigPayload } | { ok: false; error: string } => {
  const defaultReceiver = draft.defaultReceiver.trim();
  if (!defaultReceiver) return { ok: false, error: "默认接收器不能为空" };

  const groupWaitParsed = parseOptionalNonNegativeInteger(draft.groupWaitSec, "group_wait 秒数");
  if (!groupWaitParsed.ok) return groupWaitParsed;
  const groupIntervalParsed = parseOptionalNonNegativeInteger(
    draft.groupIntervalSec,
    "group_interval 秒数",
  );
  if (!groupIntervalParsed.ok) return groupIntervalParsed;
  const repeatIntervalParsed = parseOptionalNonNegativeInteger(
    draft.repeatIntervalSec,
    "repeat_interval 秒数",
  );
  if (!repeatIntervalParsed.ok) return repeatIntervalParsed;

  const receiverUrlEntries = [
    ["warning-webhook", draft.warningWebhookUrl.trim()],
    ["critical-webhook", draft.criticalWebhookUrl.trim()],
    ["p1-webhook", draft.p1WebhookUrl.trim()],
  ] as const;

  for (const [receiverName, url] of receiverUrlEntries) {
    if (!url) continue;
    if (isMaskedWebhookUrl(url)) {
      return { ok: false, error: `${receiverName} 仍是脱敏地址，请重新填写真实 webhook URL` };
    }
    try {
      new URL(url);
    } catch {
      return { ok: false, error: `${receiverName} URL 非法` };
    }
  }

  if (
    receiverUrlEntries.every(([, url]) => !url) &&
    !currentConfig?.receivers?.some((item) => {
      const name = toText(toObject(item).name).trim();
      return name && !isManagedAlertmanagerReceiverName(name);
    })
  ) {
    return { ok: false, error: "至少需要配置一个接收器" };
  }

  if (
    isManagedAlertmanagerReceiverName(defaultReceiver) &&
    !receiverUrlEntries.some(([name, url]) => name === defaultReceiver && Boolean(url))
  ) {
    return { ok: false, error: `默认接收器 ${defaultReceiver} 缺少 URL` };
  }

  const groupBy = splitEditorText(draft.groupByText);
  const managedReceivers = receiverUrlEntries
    .filter(([, url]) => Boolean(url))
    .map(([name, url]) => ({
      name,
      webhook_configs: [
        {
          url,
          send_resolved: true,
        },
      ],
    }));

  const currentReceivers = Array.isArray(currentConfig?.receivers)
    ? currentConfig.receivers.map((item) => toObject(item))
    : [];
  const extraReceivers = currentReceivers.filter((item) => {
    const name = toText(item.name).trim();
    return name && !isManagedAlertmanagerReceiverName(name);
  });
  if (
    !isManagedAlertmanagerReceiverName(defaultReceiver) &&
    !extraReceivers.some((item) => toText(item.name).trim() === defaultReceiver)
  ) {
    return {
      ok: false,
      error: "结构化模式仅支持当前已有的自定义默认接收器，请改用高级 JSON 模式调整",
    };
  }

  const currentRoute = toObject(currentConfig?.route);
  const currentRoutes = Array.isArray(currentRoute.routes)
    ? currentRoute.routes.map((item) => toObject(item))
    : [];
  const extraRoutes = currentRoutes.filter((item) => !isManagedAlertmanagerRoute(item));
  const managedRoutes: Array<Record<string, unknown>> = [];
  if (draft.warningWebhookUrl.trim() && defaultReceiver !== "warning-webhook") {
    managedRoutes.push({
      receiver: "warning-webhook",
      matchers: ['severity="warning"'],
    });
  }
  if (draft.criticalWebhookUrl.trim() && defaultReceiver !== "critical-webhook") {
    managedRoutes.push({
      receiver: "critical-webhook",
      matchers: ['severity="critical"'],
    });
  }
  if (draft.p1WebhookUrl.trim() && defaultReceiver !== "p1-webhook") {
    managedRoutes.push({
      receiver: "p1-webhook",
      matchers: ['priority="p1"'],
    });
  }

  const payload: AlertmanagerConfigPayload = {
    route: {
      receiver: defaultReceiver,
      group_by:
        groupBy.length > 0
          ? groupBy
          : splitEditorText(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupByText),
      group_wait: formatAlertmanagerDurationSec(
        groupWaitParsed.value ?? Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupWaitSec),
      ),
      group_interval: formatAlertmanagerDurationSec(
        groupIntervalParsed.value ?? Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupIntervalSec),
      ),
      repeat_interval: formatAlertmanagerDurationSec(
        repeatIntervalParsed.value ?? Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.repeatIntervalSec),
      ),
      ...(managedRoutes.length > 0 || extraRoutes.length > 0
        ? { routes: [...managedRoutes, ...extraRoutes] }
        : {}),
    },
    receivers: [...managedReceivers, ...extraReceivers],
  };

  if (currentConfig?.global && Object.keys(currentConfig.global).length > 0) {
    payload.global = currentConfig.global;
  }
  if (Array.isArray(currentConfig?.inhibit_rules) && currentConfig.inhibit_rules.length > 0) {
    payload.inhibit_rules = currentConfig.inhibit_rules;
  }
  if (
    Array.isArray(currentConfig?.mute_time_intervals) &&
    currentConfig.mute_time_intervals.length > 0
  ) {
    payload.mute_time_intervals = currentConfig.mute_time_intervals;
  }
  if (Array.isArray(currentConfig?.time_intervals) && currentConfig.time_intervals.length > 0) {
    payload.time_intervals = currentConfig.time_intervals;
  }
  const templates = draft.templatesText
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  if (templates.length > 0) {
    payload.templates = templates;
  }
  return { ok: true, payload };
};
