import type { Context, Next } from "hono";
import { httpRequestCounter, httpRequestDuration } from "../lib/metrics";

/**
 * Prometheus Metrics Middleware
 * Records request duration and status codes.
 */
export const metricsMiddleware = async (c: Context, next: Next) => {
  const start = performance.now();
  const method = c.req.method;
  // Normalized route path (e.g., /api/codex/v1/chat/completions -> /api/:provider/v1/chat/completions)
  // For simplicity, we use the route path if available, or fallback to URL path but try to avoid high cardinality
  const route = c.req.routePath || "unknown";

  // Try to extract provider from header or path
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

    // Record metrics
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
