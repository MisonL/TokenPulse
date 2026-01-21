import path from "path";

const isDev = process.env.NODE_ENV !== "production";

export const config = {
  port: parseInt(process.env.PORT || "3000"),
  baseUrl:
    process.env.BASE_URL || `http://localhost:${process.env.PORT || "3000"}`,
  dbFileName: process.env.DB_FILE_NAME || path.join("data", "credentials.db"),
  apiSecret:
    process.env.API_SECRET ||
    (isDev ? "default-insecure-secret-change-me" : ""),
  proxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "",
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
    clientId: process.env.GEMINI_CLIENT_ID || "",
    clientSecret: process.env.GEMINI_CLIENT_SECRET || "",
  },
  iflow: {
    clientId: process.env.IFLOW_CLIENT_ID || "",
    clientSecret: process.env.IFLOW_CLIENT_SECRET || "",
  },
};

// Runtime Validation
if (!isDev) {
  if (!config.apiSecret)
    throw new Error("API_SECRET is required in production");
}
