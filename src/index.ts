import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger as customLogger } from "./lib/logger";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { config } from "./config";

// 针对内部代理 (Kiro/iFlow) 有条件地禁用 TLS 验证
// 警告：这是不安全的，仅应在开发/受信任的环境中使用。
if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn(
    "[Security] TLS certificate verification is DISABLED. Do not use in production!",
  );
}

import claude from "./lib/providers/claude";
import gemini from "./lib/providers/gemini";
import antigravity from "./lib/providers/antigravity";
import kiro from "./lib/providers/kiro";
import codex from "./lib/providers/codex";
import qwen from "./lib/providers/qwen";
import iflow from "./lib/providers/iflow";
import aistudio from "./lib/providers/aistudio";
import vertex from "./lib/providers/vertex";
import copilot from "./lib/providers/copilot";

import openaiCompat from "./api/unified/openai";
import anthropicCompat from "./api/unified/anthropic";

import { startScheduler } from "./lib/scheduler";
import { syncConfigToDb } from "./lib/auth/sync";

// 运行调度 & 同步 & 种子数据填充
syncConfigToDb().then(async () => {
  try {
    const { default: seed } = await import("./lib/seed");
    await seed();
  } catch (e) {
    // 忽略错误
  }
  startScheduler();
});

import { startCodexCallbackServer } from "./lib/auth/codex";
startCodexCallbackServer();

import { startIflowCallbackServer } from "./lib/auth/iflow";
startIflowCallbackServer();

import { startGeminiCallbackServer } from "./lib/auth/gemini";
startGeminiCallbackServer();

import { startClaudeCallbackServer } from "./lib/auth/claude";
startClaudeCallbackServer();

import { requestLogger } from "./middleware/request-logger";
import { rateLimiter } from "./middleware/rate-limiter";

const app = new Hono();

// 安全中间件
app.use(
  "*",
  secureHeaders({
    crossOriginOpenerPolicy: "unsafe-none",
    originAgentCluster: false,
    contentSecurityPolicy: {
      defaultSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "data:",
        "blob:",
      ],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
    },
  }),
);
app.use(
  "*",
  cors({
    origin: (origin) => {
      // 在生产环境中，您可能希望更严格，例如如果是白名单中的来源则返回 origin
      // 对于此应用，我们将允许所有来源，但保留结构以便后续加固。
      return origin; 
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Signature", "X-Timestamp"],
    maxAge: 86400,
  }),
);

app.use("*", logger());
app.use("*", requestLogger);

import { maintenanceMiddleware } from "./middleware/maintenance";
app.use("/api/*", maintenanceMiddleware); // 保护 API

app.use("/api/*", rateLimiter); // 仅限制 API 路由

// 全局 API 认证中间件
// 白名单：OAuth 回调、认证发起、健康检查、静态资源
import { strictAuthMiddleware } from "./middleware/auth";

const AUTH_WHITELIST = [
  "/api/credentials/auth/", // OAuth flow initiation & polling
  "/api/credentials/status", // Public status check
  "/api/claude/callback", // Claude OAuth callback
  "/api/claude/auth/", // Claude auth routes
  "/api/gemini/oauth2callback",
  "/api/gemini/auth/",
  "/api/codex/callback",
  "/api/codex/auth/",
  "/api/iflow/callback",
  "/api/iflow/auth/",
  "/api/antigravity/callback",
  "/api/antigravity/auth/",
  "/api/kiro/callback",
  "/api/kiro/auth/",
  "/api/copilot/callback",
  "/api/copilot/auth/",
  "/api/qwen/auth/", // Device flow
  "/api/providers", // Provider list is public
  "/health",
];

app.use("/api/*", async (c, next) => {
  const path = c.req.path;

  // 检查白名单
  for (const pattern of AUTH_WHITELIST) {
    if (path.startsWith(pattern)) {
      await next();
      return;
    }
  }

  // 对所有其他 API 路由应用严格认证
  return strictAuthMiddleware(c, next);
});

// 统一网关认证 (/v1/*)
app.use("/v1/*", strictAuthMiddleware);

// 健康检查（移至 /health 以允许 / 服务 UI）
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "oauth2api",
    providers: [
      "claude",
      "gemini",
      "antigravity",
      "kiro",
      "codex",
      "qwen",
      "iflow",
      "aistudio",
      "vertex",
      "copilot",
    ],
  }),
);

// 服务静态资源
app.use("/assets/*", serveStatic({ root: "./frontend/dist" }));
app.use("/icon.png", serveStatic({ path: "./frontend/dist/icon.png" }));

// 1. 统一网关（优先级）

// 1. Unified Gateways (Priority)
import models from "./routes/models";
import credentials from "./routes/credentials";
import stats from "./routes/stats";
import logs from "./routes/logs";
import providers from "./routes/providers";
import settingsRoute from "./routes/settings";

// 挂载 /v1 用于 OpenAI & Anthropic 兼容
const routes = app
  .route("/v1", openaiCompat)
  .route("/v1", anthropicCompat)
  .route("/api/models", models)
  .route("/api/credentials", credentials)
  .route("/api/stats", stats)
  .route("/api/logs", logs)
  .route("/api/providers", providers)
  .route("/api/settings", settingsRoute)
  .route("/api/claude", claude)
  .route("/api/gemini", gemini)
  .route("/api/antigravity", antigravity)
  .route("/api/kiro", kiro)
  .route("/api/codex", codex)
  .route("/api/qwen", qwen)
  .route("/api/iflow", iflow)
  .route("/api/aistudio", aistudio)
  .route("/api/vertex", vertex)
  .route("/api/copilot", copilot);

// Gemini 回调的特殊情况
app.get("/oauth2callback", (c) => {
  return c.redirect(
    `/api/gemini/oauth2callback?${new URLSearchParams(c.req.query()).toString()}`,
  );
});

export type AppType = typeof routes;

// SPA 回退 - 对任何未匹配的非 API 路由服务 index.html
app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));

/* 
   服务器入口点
*/
// customLogger already imported at top

customLogger.info(`TokenPulse running on port ${config.port}`, "System");
customLogger.info(`Server started on port ${config.port}`, "System");

export default {
  port: config.port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  maxRequestBodySize: 1024 * 1024 * 200,
};
