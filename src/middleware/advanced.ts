import type { Context, Next } from "hono";
import { isAdvancedEnabled } from "../lib/edition";

/**
 * 高级版能力守卫：
 * 当 ENABLE_ADVANCED 未开启时，企业能力对外表现为 404，避免暴露内部实现细节。
 */
export async function advancedOnly(c: Context, next: Next) {
  if (!isAdvancedEnabled()) {
    return c.notFound();
  }
  await next();
}
