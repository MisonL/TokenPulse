import type { Context, Next } from "hono";
import { httpRequestCounter, httpRequestDuration } from "../lib/metrics";

/**
 * Prometheus Metrics Middleware
 * Records request duration and status codes.
 */
export const metricsMiddleware = async (c: Context, next: Next) => {
  const start = performance.now();
  const method = c.req.method;
  const route = c.req.routePath || "unknown";

  let provider = c.req.header("X-TokenPulse-Provider") || "unknown";
  if (provider === "unknown") {
    const match = c.req.path.match(/\/api\/([^\/]+)/);
    if (match && match[1] && match[1] !== "v1" && match[1] !== "auth") {
      provider = match[1];
    }
  }

  try {
    await next();
  } finally {
    const duration = (performance.now() - start) / 1000; // seconds
    const status = c.res.status;

    httpRequestCounter.inc({
      method,
      route,
      status,
      provider,
    });

    httpRequestDuration.observe(
      {
        method,
        route,
        status,
        provider,
      },
      duration,
    );
  }
};
