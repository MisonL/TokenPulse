import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger as customLogger } from "./lib/logger";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { config } from "./config";

// Conditionally disable TLS verification for internal proxies (Kiro/iFlow)
// WARNING: This is insecure and should only be used in development/trusted environments.
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

// Run Scheduling & Sync & Seed
syncConfigToDb().then(async () => {
  try {
    const { default: seed } = await import("./lib/seed");
    await seed();
  } catch (e) {
    // ignore
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

// Security Middleware
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
      // In production, you'd likely want to be stricter, e.g. return origin if it's on a whitelist
      // For this app, we'll allow all but keep the structure ready for hardening.
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
app.use("/api/*", maintenanceMiddleware); // Protect APIs

app.use("/api/*", rateLimiter); // Only limit API routes

// Global API Authentication Middleware
// Whitelist: OAuth callbacks, auth initiation, health check, static assets
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

  // Check whitelist
  for (const pattern of AUTH_WHITELIST) {
    if (path.startsWith(pattern)) {
      await next();
      return;
    }
  }

  // Apply strict auth for all other API routes
  return strictAuthMiddleware(c, next);
});

// Unified Gateway Authentication (/v1/*)
app.use("/v1/*", strictAuthMiddleware);

// Health Check (Moved to /health to allow / to serve UI)
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

// Serve Static Assets
app.use("/assets/*", serveStatic({ root: "./frontend/dist" }));
app.use("/icon.png", serveStatic({ path: "./frontend/dist/icon.png" }));

// 1. Unified Gateways (Priority)

// 1. Unified Gateways (Priority)
import models from "./routes/models";
import credentials from "./routes/credentials";
import stats from "./routes/stats";
import logs from "./routes/logs";
import providers from "./routes/providers";
import settingsRoute from "./routes/settings";

// Mount /v1 for OpenAI & Anthropic compatibility
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

// Special case for Gemini Callback
app.get("/oauth2callback", (c) => {
  return c.redirect(
    `/api/gemini/oauth2callback?${new URLSearchParams(c.req.query()).toString()}`,
  );
});

export type AppType = typeof routes;

// SPA Fallback - Serve index.html for any unmatched non-API route
app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));

/* 
   Server Entry Point
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
