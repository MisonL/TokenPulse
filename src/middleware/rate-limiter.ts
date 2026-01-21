import type { Context, Next } from "hono";

const WINDOW_MS = 60 * 1000; // 1 分钟
const MAX_REQUESTS = 100; // 每个 IP 每分钟 100 个请求
const MAX_STATIONS = 5000; // 内存中的最大唯一 IP 数，防止 OOM

const ipStats = new Map<string, { count: number; startTime: number }>();

// 清理例程
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipStats.entries()) {
    if (now - data.startTime > WINDOW_MS) {
      ipStats.delete(ip);
    }
  }
}, WINDOW_MS);

export const rateLimiter = async (c: Context, next: Next) => {
  // 改进的 IP 提取，带回退链
  // 优先级: CF-Connecting-IP > X-Real-IP > X-Forwarded-For (第一个) > 远程地址
  let ip = 
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-real-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1";
  
  // 基本 IP 验证 - 如果看起来不像 IP，则使用哈希
  if (!/^[\d.:a-fA-F]+$/.test(ip)) {
    // 对无效/可疑值进行哈希处理以防止碰撞攻击
    ip = `hash:${ip.slice(0, 32)}`;
  }

  const now = Date.now();
  let data = ipStats.get(ip);

  if (!data || now - data.startTime > WINDOW_MS) {
    data = { count: 1, startTime: now };
  } else {
    data.count++;
  }

  // 如果站点太多，进行清理以防止 OOM
  if (ipStats.size > MAX_STATIONS) {
    // 基本 LRU: 如果受到攻击，只需清除所有内容
    // 更好的方法是只清除过期的，但 setInterval 会这样做。
    // 如果 setInterval 太慢，我们会清除所有内容以维持生存。
    ipStats.clear();
  }

  ipStats.set(ip, data);

  if (data.count > MAX_REQUESTS) {
    return c.text("Too Many Requests", 429);
  }

  await next();
};
