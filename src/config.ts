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
    clientId: process.env.ANTIGRAVITY_CLIENT_ID || "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || "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",
  }
};

// Runtime Validation
if (!isDev) {
  if (!config.apiSecret)
    throw new Error("API_SECRET is required in production");
}
