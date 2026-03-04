import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import enterprise from "../../../src/routes/enterprise";
import org from "../../../src/routes/org";
import { config } from "../../../src/config";
import { strictAuthMiddleware } from "../../../src/middleware/auth";
import { getEdition } from "../../../src/lib/edition";
import { logger as customLogger } from "../../../src/lib/logger";
import { requestContextMiddleware } from "../../../src/middleware/request-context";

const app = new Hono();

app.use(
  "*",
  secureHeaders({
    crossOriginOpenerPolicy: "unsafe-none",
    originAgentCluster: false,
  }),
);
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = config.corsAllowedOrigins;
      if (allowed.includes("*")) return origin || "*";
      if (origin && allowed.includes(origin)) return origin;
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.use("*", logger());
app.use("*", requestContextMiddleware);

app.use("/api/admin/*", async (c, next) => {
  if (c.req.path === "/api/admin/features") {
    await next();
    return;
  }

  const sharedKey = config.enterprise.internalSharedKey;
  if (!sharedKey) {
    await next();
    return;
  }

  const incomingKey = c.req.header("x-tokenpulse-internal-key") || "";
  if (incomingKey !== sharedKey) {
    return c.json({ error: "enterprise 内部鉴权失败" }, 403);
  }

  await next();
});

app.use("/api/org/*", async (c, next) => {
  const sharedKey = config.enterprise.internalSharedKey;
  if (!sharedKey) {
    await next();
    return;
  }

  const incomingKey = c.req.header("x-tokenpulse-internal-key") || "";
  if (incomingKey !== sharedKey) {
    return c.json({ error: "enterprise 内部鉴权失败" }, 403);
  }

  await next();
});

const AUTH_WHITELIST = ["/api/admin/features", "/api/admin/auth/"];

app.use("/api/admin/*", async (c, next) => {
  const path = c.req.path;
  for (const pattern of AUTH_WHITELIST) {
    if (path.startsWith(pattern)) {
      await next();
      return;
    }
  }
  return strictAuthMiddleware(c, next);
});

app.use("/api/org/*", async (c, next) => {
  return strictAuthMiddleware(c, next);
});

app.route("/api/admin", enterprise);
app.route("/api/org", org);

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "tokenpulse-enterprise",
    edition: getEdition(),
  });
});

customLogger.info(`TokenPulse Enterprise running on port ${config.port}`, "System");

export default {
  port: config.port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
};
