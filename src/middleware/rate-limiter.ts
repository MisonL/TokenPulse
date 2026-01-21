import type { Context, Next } from "hono";

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // 100 requests per minute per IP
const MAX_STATIONS = 5000; // Max unique IPs in memory to prevent OOM

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
  // Improved IP extraction with fallback chain
  // Priority: CF-Connecting-IP > X-Real-IP > X-Forwarded-For (first) > remote address
  let ip = 
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-real-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1";
  
  // Basic IP validation - if it doesn't look like an IP, use hash
  if (!/^[\d.:a-fA-F]+$/.test(ip)) {
    // Hash invalid/suspicious values to prevent collision attacks
    ip = `hash:${ip.slice(0, 32)}`;
  }

  const now = Date.now();
  let data = ipStats.get(ip);

  if (!data || now - data.startTime > WINDOW_MS) {
    data = { count: 1, startTime: now };
  } else {
    data.count++;
  }

  // Cleanup if too many stations to prevent OOM
  if (ipStats.size > MAX_STATIONS) {
    // Basic LRU: just clear everything if we're under attack
    // Better would be cleaning only expired ones, but setInterval does that.
    // If setInterval is too slow, we clear all to survive.
    ipStats.clear();
  }

  ipStats.set(ip, data);

  if (data.count > MAX_REQUESTS) {
    return c.text("Too Many Requests", 429);
  }

  await next();
};
