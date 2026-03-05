import type { Context } from "hono";
import { config } from "../config";
import { register } from "../lib/metrics";
import { verifyBearerToken } from "../middleware/auth";

export async function metricsHandler(c: Context) {
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
  } catch {
    return c.text("服务器内部错误", 500);
  }
}

