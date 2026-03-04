import type { Context, Next } from "hono";
import { isAdvancedEnabled } from "../lib/edition";

/**
 * 高级版能力守卫：
 * 当 ENABLE_ADVANCED 未开启时：
 * - 读接口（GET/HEAD）返回结构化 503，便于前端展示与诊断
 * - 写接口（POST/PUT/PATCH/DELETE）保持 404，避免暴露内部实现细节
 */
export function buildAdvancedDisabledResponse(c: Context) {
  const method = (c.req.method || "").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return c.json(
      {
        error: "高级版能力未启用",
        code: "ADVANCED_DISABLED_READONLY",
        details: "请设置 ENABLE_ADVANCED=true 后重试。",
      },
      503,
    );
  }
  return c.notFound();
}

export async function advancedOnly(c: Context, next: Next) {
  if (!isAdvancedEnabled()) {
    return buildAdvancedDisabledResponse(c);
  }
  await next();
}
