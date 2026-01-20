import type { Context, Next } from "hono";

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // 100 requests per minute per IP

const ipStats = new Map<string, { count: number; startTime: number }>();

// Cleanup routine
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipStats.entries()) {
    if (now - data.startTime > WINDOW_MS) {
      ipStats.delete(ip);
    }
  }
}, WINDOW_MS);

export const rateLimiter = async (c: Context, next: Next) => {
  // Simple IP extraction (consider X-Forwarded-For if behind proxy)
  const ip = c.req.header("x-forwarded-for") || "unknown";

  const now = Date.now();
  let data = ipStats.get(ip);

  if (!data || now - data.startTime > WINDOW_MS) {
    data = { count: 1, startTime: now };
  } else {
    data.count++;
  }

  ipStats.set(ip, data);

  if (data.count > MAX_REQUESTS) {
    return c.text("Too Many Requests", 429);
  }

  await next();
};
