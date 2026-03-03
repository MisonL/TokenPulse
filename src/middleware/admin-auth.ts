import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "../config";
import {
  type AdminIdentity,
  getAdminIdentityBySession,
  getHeaderAdminIdentity,
} from "../lib/admin/auth";

const ADMIN_IDENTITY_KEY = "adminIdentity";

function supportsLocalMode() {
  return config.admin.authMode === "local" || config.admin.authMode === "hybrid";
}

function supportsHeaderMode() {
  return config.admin.authMode === "header" || config.admin.authMode === "hybrid";
}

export function getAdminIdentity(c: Context): AdminIdentity {
  const identity = c.get(ADMIN_IDENTITY_KEY) as AdminIdentity | undefined;
  if (identity) return identity;
  return {
    authenticated: false,
    source: "none",
  };
}

export async function resolveAdminIdentity(c: Context, next: Next) {
  let identity: AdminIdentity = {
    authenticated: false,
    source: "none",
  };

  if (supportsLocalMode()) {
    const sessionId = getCookie(c, config.admin.sessionCookieName) || "";
    if (sessionId) {
      try {
        const sessionIdentity = await getAdminIdentityBySession(sessionId);
        if (sessionIdentity) {
          identity = sessionIdentity;
        }
      } catch {
        // ignore and continue to header mode
      }
    }
  }

  if (!identity.authenticated && supportsHeaderMode()) {
    const headerIdentity = getHeaderAdminIdentity({
      user: c.req.header("x-admin-user"),
      role: c.req.header("x-admin-role"),
      tenant: c.req.header("x-admin-tenant"),
    });
    if (headerIdentity) {
      identity = headerIdentity;
    }
  }

  c.set(ADMIN_IDENTITY_KEY, identity);
  await next();
}

export async function requireAdminIdentity(c: Context, next: Next) {
  const identity = getAdminIdentity(c);
  if (!identity.authenticated) {
    return c.json({ error: "管理员未登录或无权限" }, 403);
  }
  await next();
}
