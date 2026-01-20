import type { Context, Next } from "hono";
import { db } from "../db";
import { requestLogs } from "../db/schema";

export const requestLogger = async (c: Context, next: Next) => {
  const start = Date.now();
  const path = c.req.path;
  const method = c.req.method;

  await next();

  const end = Date.now();
  const latency = end - start;
  const status = c.res.status;

  // Skip logging for internal admin/dashboard polling to keep stats clean
  if (
    path.startsWith("/api/stats") ||
    path.startsWith("/api/logs") ||
    path.startsWith("/api/settings") ||
    path.startsWith("/assets") ||
    path === "/icon.png"
  ) {
    return;
  }

  if (c.get("skipLogger")) return;

  // Extract Provider from path (e.g., /api/claude/...)
  // Simple regex or split
  const match = path.match(/\/api\/([^/]+)/);
  const provider = match ? match[1] : "system";

  // Async fire-and-forget to not block response
  // In high-scale, use a queue. For this app, direct insert is fine.
  db.insert(requestLogs)
    .values({
      timestamp: new Date().toISOString(),
      provider: provider,
      method: method,
      path: path,
      status: status,
      latencyMs: latency,
    })
    .catch((err) => console.error("Failed to log request", err));
};
