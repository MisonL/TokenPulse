import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger as customLogger } from "../../../src/lib/logger";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { config } from "../../../src/config";
import { metricsMiddleware } from "../../../src/middleware/metrics";
import { getEdition } from "../../../src/lib/edition";
import { requestContextMiddleware } from "../../../src/middleware/request-context";
import { startScheduler } from "../../../src/lib/scheduler";
import { syncConfigToDb } from "../../../src/lib/auth/sync";
import { ensureAdminBootstrap } from "../../../src/lib/admin/auth";
import { requestLogger } from "../../../src/middleware/request-logger";
import { rateLimiter } from "../../../src/middleware/rate-limiter";
import { quotaMiddleware } from "../../../src/middleware/quota";
import { maintenanceMiddleware } from "../../../src/middleware/maintenance";
import { strictAuthMiddleware } from "../../../src/middleware/auth";
import { legacyOAuthDeprecationMiddleware } from "../../../src/middleware/legacy-oauth";
import {
  adminFeaturesHandler,
  enterpriseProxyMiddleware,
} from "../../../src/middleware/enterprise-proxy";

import claude from "../../../src/lib/providers/claude";
import gemini from "../../../src/lib/providers/gemini";
import antigravity from "../../../src/lib/providers/antigravity";
import kiro from "../../../src/lib/providers/kiro";
import codex from "../../../src/lib/providers/codex";
import qwen from "../../../src/lib/providers/qwen";
import iflow from "../../../src/lib/providers/iflow";
import aistudio from "../../../src/lib/providers/aistudio";
import vertex from "../../../src/lib/providers/vertex";
import copilot from "../../../src/lib/providers/copilot";

import openaiCompat from "../../../src/api/unified/openai";
import anthropicCompat from "../../../src/api/unified/anthropic";

import models from "../../../src/routes/models";
import credentials from "../../../src/routes/credentials";
import stats from "../../../src/routes/stats";
import logs from "../../../src/routes/logs";
import providers from "../../../src/routes/providers";
import auth, { VERIFY_SECRET_PATH } from "../../../src/routes/auth";
import settingsRoute from "../../../src/routes/settings";
import oauth from "../../../src/routes/oauth";
import enterprise from "../../../src/routes/enterprise";
import org from "../../../src/routes/org";
import { metricsHandler } from "../../../src/routes/metrics";

if (config.allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn(
    "[Security] TLS certificate verification is DISABLED via UNSAFE_DISABLE_TLS_CHECK.",
  );
}

if (!config.isTest) {
  syncConfigToDb().then(async () => {
    await ensureAdminBootstrap();
    startScheduler();
  });
}

export const app = new Hono();

app.use(
  "*",
  secureHeaders({
    crossOriginOpenerPolicy: "unsafe-none",
    originAgentCluster: false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'", "'unsafe-inline'", "data:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
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

app.use("*", logger());
app.use("*", requestContextMiddleware);
app.use("*", requestLogger);
app.use("*", metricsMiddleware);

app.use("/api/*", maintenanceMiddleware);
app.use("/api/*", rateLimiter);
app.use("/api/credentials/auth/*", legacyOAuthDeprecationMiddleware);

const AUTH_WHITELIST = [
  "/api/oauth",
  VERIFY_SECRET_PATH,
  "/api/credentials/status",
  "/api/claude/callback",
  "/api/gemini/oauth2callback",
  "/api/codex/callback",
  "/api/iflow/callback",
  "/api/antigravity/callback",
  "/api/kiro/callback",
  "/api/copilot/callback",
  "/api/providers",
  "/api/admin/features",
  "/api/admin/auth/",
  "/health",
];

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  for (const pattern of AUTH_WHITELIST) {
    if (path.startsWith(pattern)) {
      await next();
      return;
    }
  }
  return strictAuthMiddleware(c, next);
});

app.use("/v1/*", strictAuthMiddleware);
app.use("/v1/*", quotaMiddleware);

app.get("/api/admin/features", adminFeaturesHandler);
app.use("/api/admin/*", enterpriseProxyMiddleware);
app.use("/api/org/*", enterpriseProxyMiddleware);

app.get("/metrics", async (c) => {
  return metricsHandler(c);
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "tokenpulse-core",
    edition: getEdition(),
  }),
);

app.use("/assets/*", serveStatic({ root: "./frontend/dist" }));
app.use("/icon.png", serveStatic({ path: "./frontend/dist/icon.png" }));

export const routes = app
  .route("/v1", openaiCompat)
  .route("/v1", anthropicCompat)
  .route("/api/auth", auth)
  .route("/api/models", models)
  .route("/api/oauth", oauth)
  .route("/api/credentials", credentials)
  .route("/api/stats", stats)
  .route("/api/logs", logs)
  .route("/api/providers", providers)
  .route("/api/settings", settingsRoute)
  .route("/api/admin", enterprise)
  .route("/api/org", org)
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

app.get("/oauth2callback", (c) => {
  return c.redirect(
    `/api/gemini/oauth2callback?${new URLSearchParams(c.req.query()).toString()}`,
  );
});

app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));

export type AppType = typeof routes;

if (!config.isTest) {
  customLogger.info(`TokenPulse Core running on port ${config.port}`, "System");
}

export default {
  port: config.port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  maxRequestBodySize: 1024 * 1024 * 50,
};
