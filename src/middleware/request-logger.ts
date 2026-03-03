import type { Context, Next } from "hono";
import { db } from "../db";
import { requestLogs } from "../db/schema";
import {
  getRequestTraceId,
  getRequestedAccountId,
  getSelectedAccountId,
} from "./request-context";

export const requestLogger = async (c: Context, next: Next) => {
  const start = Date.now();
  const path = c.req.path;
  const method = c.req.method;

  await next();

  const end = Date.now();
  const latency = end - start;
  const status = c.res.status;

  // 跳过内部 admin/dashboard 轮询的日志记录，以保持统计数据干净
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

  // 从路径中提取提供商 (例如 /api/claude/...)
  // 简单的正则或分割
  const match = path.match(/\/api\/([^/]+)/);
  const provider = match ? match[1] : "system";

  // 异步即发即弃，不阻塞响应
  // 在大规模场景下，使用队列。对于此应用，直接插入即可。
  const traceId = getRequestTraceId(c) || null;
  const selectedAccountId = getSelectedAccountId(c);
  const requestedAccountId = getRequestedAccountId(c);
  const accountId = selectedAccountId || requestedAccountId || null;

  db.insert(requestLogs)
    .values({
      timestamp: new Date().toISOString(),
      provider: provider,
      method: method,
      path: path,
      status: status,
      latencyMs: latency,
      traceId,
      accountId,
    })
    .catch((err) => console.error("记录请求日志失败", err));
};
