const isDev = process.env.NODE_ENV !== "production";
const isTest = process.env.NODE_ENV === "test";

function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
}

function parseNumber(
  value: string | undefined,
  defaultValue: number,
  min?: number,
): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  if (typeof min === "number") return Math.max(min, parsed);
  return parsed;
}

function parseEnum<T extends string>(
  value: string | undefined,
  options: readonly T[],
  defaultValue: T,
): T {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  const matched = options.find((item) => item === normalized);
  return matched || defaultValue;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const port = parseInt(process.env.PORT || "3000", 10);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const configuredOrigins = parseOrigins(process.env.CORS_ALLOW_ORIGINS);
const oauthAlertMentionedList = parseOrigins(
  process.env.OAUTH_ALERT_WECOM_MENTIONED_LIST,
);
const defaultOrigins =
  configuredOrigins.length > 0
    ? configuredOrigins
    : isDev
      ? ["*"]
      : [new URL(baseUrl).origin];

export const config = {
  isDev,
  isTest,
  port,
  baseUrl,
  databaseUrl: (process.env.DATABASE_URL || "").trim(),
  apiSecret: process.env.API_SECRET || (isDev ? "tokenpulse-dev-secret" : ""),
  proxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "",
  enableAdvanced: parseBool(process.env.ENABLE_ADVANCED, false),
  exposeMetrics: parseBool(process.env.EXPOSE_METRICS, isDev),
  corsAllowedOrigins: defaultOrigins,
  trustProxy: parseBool(process.env.TRUST_PROXY, false),
  allowInsecureTls: isDev && parseBool(process.env.UNSAFE_DISABLE_TLS_CHECK, false),
  oauthSelection: {
    defaultPolicy: parseEnum(
      process.env.OAUTH_SELECTION_POLICY,
      ["round_robin", "latest_valid", "sticky_user"] as const,
      "round_robin",
    ),
    allowHeaderOverride: parseBool(
      process.env.OAUTH_SELECTION_ALLOW_HEADER_OVERRIDE,
      true,
    ),
    allowHeaderAccountOverride: parseBool(
      process.env.ALLOW_HEADER_ACCOUNT_OVERRIDE,
      false,
    ),
    failureCooldownSec: parseNumber(
      process.env.OAUTH_SELECTION_FAILURE_COOLDOWN_SEC,
      120,
      0,
    ),
    maxRetryOnAccountFailure: parseNumber(
      process.env.OAUTH_SELECTION_MAX_RETRY_ON_ACCOUNT_FAILURE,
      1,
      0,
    ),
  },
  oauthAlerts: {
    evalIntervalSec: parseNumber(
      process.env.OAUTH_ALERT_EVAL_INTERVAL_SEC,
      60,
      5,
    ),
    webhookUrl: (process.env.OAUTH_ALERT_WEBHOOK_URL || "").trim(),
    webhookSecret: (process.env.OAUTH_ALERT_WEBHOOK_SECRET || "").trim(),
    wecomWebhookUrl: (process.env.OAUTH_ALERT_WECOM_WEBHOOK_URL || "").trim(),
    wecomMentionedList: oauthAlertMentionedList,
  },
  alertmanager: {
    controlEnabled: parseBool(process.env.ALERTMANAGER_CONTROL_ENABLED, false),
    runtimeDir: (process.env.ALERTMANAGER_RUNTIME_DIR || "./monitoring/runtime").trim(),
    configFilename: (process.env.ALERTMANAGER_CONFIG_FILENAME || "alertmanager.generated.yml").trim(),
    reloadUrl: (process.env.ALERTMANAGER_RELOAD_URL || "http://127.0.0.1:9093/-/reload").trim(),
    readyUrl: (process.env.ALERTMANAGER_READY_URL || "http://127.0.0.1:9093/-/ready").trim(),
    timeoutMs: parseNumber(
      process.env.ALERTMANAGER_REQUEST_TIMEOUT_MS,
      5000,
      500,
    ),
  },
  admin: {
    authMode: parseEnum(
      process.env.ADMIN_AUTH_MODE,
      ["local", "header", "hybrid"] as const,
      "hybrid",
    ),
    trustHeaderAuth: parseBool(
      process.env.ADMIN_TRUST_HEADER_AUTH,
      false,
    ),
    sessionCookieName:
      process.env.ADMIN_SESSION_COOKIE_NAME || "tp_admin_session",
    sessionTtlHours: parseNumber(
      process.env.ADMIN_SESSION_TTL_HOURS,
      24,
      1,
    ),
    bootstrapUsername:
      (process.env.ADMIN_BOOTSTRAP_USERNAME || "admin").trim() || "admin",
    bootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD || "",
  },
  enterprise: {
    baseUrl: (process.env.ENTERPRISE_BASE_URL || "http://127.0.0.1:9010").trim(),
    proxyTimeoutMs: parseNumber(
      process.env.ENTERPRISE_PROXY_TIMEOUT_MS,
      5000,
      500,
    ),
    internalSharedKey: (process.env.ENTERPRISE_SHARED_KEY || "").trim(),
  },
  claudeTransport: {
    tlsMode: parseEnum(
      process.env.CLAUDE_TLS_MODE,
      ["strict", "bridge"] as const,
      "strict",
    ),
    bridgeUrl:
      process.env.CLAUDE_BRIDGE_URL || "http://127.0.0.1:9460",
    bridgeTimeoutMs: parseNumber(
      process.env.CLAUDE_BRIDGE_TIMEOUT_MS,
      12000,
      1000,
    ),
    bridgeMaxRetries: parseNumber(
      process.env.CLAUDE_BRIDGE_MAX_RETRIES,
      1,
      0,
    ),
    bridgeCircuitThreshold: parseNumber(
      process.env.CLAUDE_BRIDGE_CIRCUIT_THRESHOLD,
      5,
      1,
    ),
    bridgeCircuitCooldownSec: parseNumber(
      process.env.CLAUDE_BRIDGE_CIRCUIT_COOLDOWN_SEC,
      60,
      5,
    ),
    bridgeSharedKey: (process.env.CLAUDE_BRIDGE_SHARED_KEY || "").trim(),
  },
  oauth: {
    claudeClientId:
      process.env.CLAUDE_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    codexClientId:
      process.env.CODEX_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann",
    qwenClientId:
      process.env.QWEN_CLIENT_ID || "f0304373b74a44d2b584a3fb70ca9e56",
    copilotClientId:
      process.env.COPILOT_CLIENT_ID || "Iv1.b507a08c87ecfe98",
  },
  antigravity: {
    clientId: process.env.ANTIGRAVITY_CLIENT_ID || "",
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || "",
  },
  kiro: {
    endpoint:
      process.env.KIRO_ENDPOINT || "https://oidc.us-east-1.amazonaws.com",
    startUrl: process.env.KIRO_START_URL || "https://view.awsapps.com/start",
    userAgent: "KiroIDE",
  },
  gemini: {
    clientId:
      process.env.GEMINI_CLIENT_ID ||
      "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    clientSecret: process.env.GEMINI_CLIENT_SECRET || "",
  },
  iflow: {
    clientId: process.env.IFLOW_CLIENT_ID || "",
    clientSecret: process.env.IFLOW_CLIENT_SECRET || "",
  },
};

if (!isDev && !config.apiSecret) {
  throw new Error("生产环境必须设置 API_SECRET");
}

if (!isTest && !config.databaseUrl) {
  throw new Error("必须设置 DATABASE_URL");
}
