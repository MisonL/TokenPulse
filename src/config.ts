import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const isTest = process.env.NODE_ENV === "test";

function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
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
  dbFileName:
    process.env.DB_FILE_NAME || (isTest ? ":memory:" : path.join("data", "credentials.db")),
  apiSecret: process.env.API_SECRET || (isDev ? "tokenpulse-dev-secret" : ""),
  proxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "",
  enableAdvanced: parseBool(process.env.ENABLE_ADVANCED, false),
  exposeMetrics: parseBool(process.env.EXPOSE_METRICS, isDev),
  corsAllowedOrigins: defaultOrigins,
  trustProxy: parseBool(process.env.TRUST_PROXY, false),
  allowInsecureTls: isDev && parseBool(process.env.UNSAFE_DISABLE_TLS_CHECK, false),
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
