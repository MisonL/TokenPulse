import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger as customLogger } from "./lib/logger";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { config } from "./config";
import { metricsMiddleware } from "./middleware/metrics";
import { register } from "./lib/metrics";
import { verifyBearerToken } from "./middleware/auth";
import { getEdition } from "./lib/edition";
import { requestContextMiddleware } from "./middleware/request-context";
import {
  adminFeaturesHandler,
  enterpriseProxyMiddleware,
} from "./middleware/enterprise-proxy";

// 针对内部代理 (Kiro/iFlow) 有条件地禁用 TLS 验证
// 警告：这是不安全的，仅应在开发/受信任的环境中使用。
if (config.allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn(
    "[Security] TLS certificate verification is DISABLED via UNSAFE_DISABLE_TLS_CHECK.",
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
import { ensureAdminBootstrap } from "./lib/admin/auth";

// 运行调度 & 同步
syncConfigToDb().then(async () => {
  await ensureAdminBootstrap();
  startScheduler();
});

import { requestLogger } from "./middleware/request-logger";
import { rateLimiter } from "./middleware/rate-limiter";
import { quotaMiddleware } from "./middleware/quota";
import { legacyOAuthDeprecationMiddleware } from "./middleware/legacy-oauth";

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
        "'unsafe-inline'", // 保留：前端 CSS-in-JS 需要
        "data:",
        "blob:",
      ],
      scriptSrc: ["'self'", "'unsafe-inline'"], // 移除 unsafe-eval，仅保留必要的 inline
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
    },
  }),
);
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = config.corsAllowedOrigins;
      if (allowed.includes("*")) {
        return origin || "*";
      }
      if (origin && allowed.includes(origin)) {
        return origin;
      }
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Signature", "X-Timestamp"],
    maxAge: 86400,
  }),
);

app.use("*", requestContextMiddleware);
app.use("*", logger());
app.use("*", requestLogger);
app.use("*", metricsMiddleware); // Prometheus Metrics

import { maintenanceMiddleware } from "./middleware/maintenance";
app.use("/api/*", maintenanceMiddleware); // 保护 API

app.use("/api/*", rateLimiter); // 仅限制 API 路由
app.use("/api/credentials/auth/*", legacyOAuthDeprecationMiddleware); // 旧 OAuth 入口统一 410

// 全局 API 认证中间件
// 白名单：OAuth 回调、认证发起、健康检查、静态资源
import { strictAuthMiddleware } from "./middleware/auth";

const AUTH_WHITELIST = [
  "/api/oauth", // 新版统一 OAuth 路由（start/poll/callback/status/providers）
  "/api/credentials/status", // Public status check
  "/api/claude/callback", // Claude OAuth callback
  "/api/gemini/oauth2callback",
  "/api/codex/callback",
  "/api/iflow/callback",
  "/api/antigravity/callback",
  "/api/kiro/callback",
  "/api/copilot/callback",
  "/api/providers", // Provider list is public
  "/api/admin/features", // 前端能力探针（标准/高级版都可访问）
  "/api/admin/auth/", // 本地管理员登录会话接口
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
app.use("/v1/*", quotaMiddleware);

app.get("/api/admin/features", adminFeaturesHandler);
app.use("/api/admin/*", enterpriseProxyMiddleware);

app.get("/metrics", async (c) => {
  if (!config.exposeMetrics) {
    const token = c.req.header("Authorization") || "";
    if (!verifyBearerToken(token)) {
      return c.notFound();
    }
  }
  try {
    const metrics = await register.metrics();
    c.header("Content-Type", register.contentType);
    return c.body(metrics);
  } catch (err) {
    return c.text("服务器内部错误", 500);
  }
});

// 健康检查（移至 /health 以允许 / 服务 UI）
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "tokenpulse-core",
    edition: getEdition(),
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

import models from "./routes/models";
import credentials from "./routes/credentials";
import stats from "./routes/stats";
import logs from "./routes/logs";
import providers from "./routes/providers";
import settingsRoute from "./routes/settings";
import oauth from "./routes/oauth";
import enterprise from "./routes/enterprise";

// 挂载 /v1 用于 OpenAI & Anthropic 兼容
const routes = app
  .route("/v1", openaiCompat)
  .route("/v1", anthropicCompat)
  .route("/api/models", models)
  .route("/api/oauth", oauth)
  .route("/api/credentials", credentials)
  .route("/api/stats", stats)
  .route("/api/logs", logs)
  .route("/api/providers", providers)
  .route("/api/settings", settingsRoute)
  .route("/api/admin", enterprise)
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

customLogger.info(`TokenPulse running on port ${config.port}`, "System");
customLogger.info(`Server started on port ${config.port}`, "System");

export default {
  port: config.port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  maxRequestBodySize: 1024 * 1024 * 50, // 50MB，足以处理常规请求，避免 DoS
};
