import type { Context, Next } from "hono";

const LEGACY_OAUTH_SAVE_PATHS = new Set([
  "/api/credentials/auth/aistudio/save",
  "/api/credentials/auth/vertex/save",
]);

function normalizePath(path: string): string {
  if (!path) return "/";
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * 旧版 /api/credentials/auth/* OAuth 入口统一返回 410，避免继续被调用。
 * 仅保留 aistudio / vertex 的手动凭据保存入口。
 */
export async function legacyOAuthDeprecationMiddleware(c: Context, next: Next) {
  const path = normalizePath(c.req.path);
  if (!path.startsWith("/api/credentials/auth/")) {
    await next();
    return;
  }

  if (LEGACY_OAUTH_SAVE_PATHS.has(path)) {
    await next();
    return;
  }

  return c.json(
    {
      error: "旧 OAuth 路径已废弃",
      code: "legacy_oauth_route_deprecated",
      replacement: "/api/oauth/:provider/start|poll|callback|status",
      deprecatedSince: "2026-03-01",
      details:
        "请改用 /api/oauth/:provider/start|poll|callback|status（旧路径仅保留手动凭据保存入口）。",
    },
    410,
  );
}
