import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db";
import { credentials } from "../db/schema";
import { initiateQwenDeviceFlow, pollQwenToken } from "../lib/auth/qwen";
import {
  initiateKiroDeviceFlow,
  pollKiroToken,
  registerKiroClient,
} from "../lib/auth/kiro";
import geminiRouter from "../lib/providers/gemini";
import { claudeProvider } from "../lib/providers/claude";
import { codexProvider } from "../lib/providers/codex";
import { iflowProvider } from "../lib/providers/iflow";
import { antigravityProvider } from "../lib/providers/antigravity";
import { copilotProvider } from "../lib/providers/copilot";
import { kiroProvider } from "../lib/providers/kiro";
import { oauthSessionStore } from "../lib/auth/oauth-session-store";
import { oauthCallbackStore } from "../lib/auth/oauth-callback-store";
import { getRequestTraceId } from "../middleware/request-context";

const oauth = new Hono();

const providerSchema = z.object({
  provider: z.enum([
    "claude",
    "gemini",
    "codex",
    "qwen",
    "kiro",
    "iflow",
    "antigravity",
    "copilot",
    "aistudio",
    "vertex",
  ]),
});

async function delegateToRouter(
  c: Context,
  router: { fetch: (request: Request) => Response | Promise<Response> },
  method: string,
  path: string,
  rawBody?: BodyInit | null,
) {
  const headers = new Headers(c.req.raw.headers);
  const request = new Request(new URL(path, "http://local"), {
    method,
    headers,
    body: method === "GET" ? undefined : rawBody ?? c.req.raw.body,
  });
  const response = await router.fetch(request);
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

function resolveCallbackProvider(
  provider: string,
): { fetch: (request: Request) => Response | Promise<Response> } | null {
  switch (provider) {
    case "claude":
      return claudeProvider.router;
    case "codex":
      return codexProvider.router;
    case "iflow":
      return iflowProvider.router;
    case "antigravity":
      return antigravityProvider.router;
    case "copilot":
      return copilotProvider.router;
    case "kiro":
      return kiroProvider.router;
    default:
      return null;
  }
}

function parseCallbackUrl(urlValue?: string) {
  const rawUrl = (urlValue || "").trim();
  if (!rawUrl) return { url: "", code: undefined, state: undefined, error: undefined };
  try {
    const parsed = new URL(
      rawUrl.startsWith("http")
        ? rawUrl
        : `http://localhost${rawUrl.startsWith("?") ? "" : "/"}${rawUrl}`,
    );
    return {
      url: rawUrl,
      code: parsed.searchParams.get("code") || undefined,
      state: parsed.searchParams.get("state") || undefined,
      error:
        parsed.searchParams.get("error") ||
        parsed.searchParams.get("error_description") ||
        undefined,
    };
  } catch {
    return { url: rawUrl, code: undefined, state: undefined, error: undefined };
  }
}

oauth.get("/providers", (c) => {
  return c.json({
    data: [
      { id: "claude", flow: "auth_code" },
      { id: "gemini", flow: "auth_code" },
      { id: "codex", flow: "auth_code" },
      { id: "iflow", flow: "auth_code" },
      { id: "antigravity", flow: "auth_code" },
      { id: "qwen", flow: "device_code" },
      { id: "kiro", flow: "device_code" },
      { id: "copilot", flow: "device_code" },
      { id: "aistudio", flow: "manual_key" },
      { id: "vertex", flow: "service_account" },
    ],
  });
});

oauth.get("/status", async (c) => {
  const all = await db.select().from(credentials);
  const statusMap: Record<string, boolean> = {
    kiro: false,
    codex: false,
    qwen: false,
    iflow: false,
    aistudio: false,
    vertex: false,
    claude: false,
    gemini: false,
    antigravity: false,
    copilot: false,
  };
  const accountCounts: Record<string, number> = {
    kiro: 0,
    codex: 0,
    qwen: 0,
    iflow: 0,
    aistudio: 0,
    vertex: 0,
    claude: 0,
    gemini: 0,
    antigravity: 0,
    copilot: 0,
  };
  all.forEach((item) => {
    const status = item.status || "active";
    const isActive = status !== "revoked" && status !== "disabled";
    if (!isActive) return;
    statusMap[item.provider] = true;
    accountCounts[item.provider] = (accountCounts[item.provider] || 0) + 1;
  });
  return c.json({
    ...statusMap,
    counts: accountCounts,
  });
});

oauth.post(
  "/:provider/start",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider } = c.req.valid("param");

    switch (provider) {
      case "claude":
        return claudeProvider.startOAuth(c);
      case "codex":
        return codexProvider.startOAuth(c);
      case "iflow":
        return iflowProvider.startOAuth(c);
      case "antigravity":
        return antigravityProvider.startOAuth(c);
      case "copilot":
        return copilotProvider.startOAuth(c);
      case "kiro":
        return kiroProvider.startOAuth(c);
      case "gemini":
        return delegateToRouter(c, geminiRouter, "GET", "/auth/url");
      case "qwen": {
        const data = await initiateQwenDeviceFlow();
        return c.json(data);
      }
      case "aistudio":
        return c.json({
          mode: "manual_key",
          message: "请通过 /api/credentials/auth/aistudio/save 提交 API Key 或服务账号。",
        });
      case "vertex":
        return c.json({
          mode: "service_account",
          message: "请通过 /api/credentials/auth/vertex/save 提交服务账号 JSON。",
        });
      default:
        return c.json({ error: "不支持的 provider" }, 400);
    }
  },
);

oauth.get(
  "/session/:state",
  async (c) => {
    const state = (c.req.param("state") || "").trim();
    if (!state) {
      return c.json({ error: "缺少 state" }, 400);
    }

    const session = await oauthSessionStore.get(state);
    if (!session) {
      return c.json({ exists: false }, 404);
    }

    return c.json({
      exists: true,
      state,
      provider: session.provider,
      status: session.status,
      error: session.error || null,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    });
  },
);

oauth.post(
  "/:provider/poll",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider } = c.req.valid("param");

    if (provider === "qwen") {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
      const deviceCode = body.deviceCode || body.device_code;
      const codeVerifier = body.codeVerifier || body.code_verifier;
      if (!deviceCode || !codeVerifier) {
        return c.json({ error: "缺少 deviceCode/codeVerifier" }, 400);
      }
      const result = await pollQwenToken(deviceCode, codeVerifier);
      return c.json(result);
    }

    if (provider === "kiro") {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
      const deviceCode = body.deviceCode || body.device_code;
      const clientId = body.clientId || body.client_id;
      const clientSecret = body.clientSecret || body.client_secret;
      if (!deviceCode || !clientId || !clientSecret) {
        return c.json({ error: "缺少 deviceCode/clientId/clientSecret" }, 400);
      }
      const result = await pollKiroToken(deviceCode, clientId, clientSecret);
      return c.json(result);
    }

    if (provider === "copilot") {
      return copilotProvider.pollOAuth(c);
    }

    if (provider === "codex") {
      return c.json({ success: true, message: "请通过 /status 检查授权状态" });
    }

    return c.json({ error: `${provider} 不支持轮询流程` }, 400);
  },
);

oauth.post(
  "/:provider/callback/manual",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider } = c.req.valid("param");
    const traceId = getRequestTraceId(c);
    const router = resolveCallbackProvider(provider);
    if (!router) {
      await oauthCallbackStore.append({
        provider,
        source: "manual",
        status: "failure",
        error: `${provider} 暂不支持手动回调`,
        traceId,
      });
      return c.json({ error: `${provider} 暂不支持手动回调` }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const callbackUrl = body?.url || body?.callbackUrl || body?.redirect_url || "";
    const parsed = parseCallbackUrl(callbackUrl);
    const rawBody = JSON.stringify({
      url: callbackUrl,
    });
    const response = await delegateToRouter(
      c,
      router,
      "POST",
      "/auth/callback/manual",
      rawBody,
    );
    const responseText = await response.text().catch(() => "");

    await oauthCallbackStore.append({
      provider,
      state: parsed.state,
      code: parsed.code,
      error: parsed.error || (response.ok ? undefined : responseText || "手动回调处理失败"),
      source: "manual",
      status: response.ok ? "success" : "failure",
      traceId,
      raw: {
        request: {
          url: parsed.url,
        },
        response: {
          status: response.status,
          body: responseText,
        },
      },
    });

    return new Response(responseText, {
      status: response.status,
      headers: response.headers,
    });
  },
);

const callbackBodySchema = z.object({
  provider: z.string().trim().min(1).optional(),
  redirect_url: z.string().trim().min(1).optional(),
  code: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
});

oauth.post(
  "/callback",
  zValidator("json", callbackBodySchema),
  async (c) => {
    const traceId = getRequestTraceId(c);
    const body = c.req.valid("json");
    let { provider, redirect_url: redirectUrl, code, state, error } = body;

    if (redirectUrl) {
      try {
        const parsed = new URL(
          redirectUrl.startsWith("http")
            ? redirectUrl
            : `http://localhost${redirectUrl.startsWith("?") ? "" : "/"}${redirectUrl}`,
        );
        code = code || parsed.searchParams.get("code") || undefined;
        state = state || parsed.searchParams.get("state") || undefined;
        error =
          error ||
          parsed.searchParams.get("error") ||
          parsed.searchParams.get("error_description") ||
          undefined;
      } catch {
        await oauthCallbackStore.append({
          provider: (provider || "unknown").toLowerCase(),
          source: "aggregate",
          status: "failure",
          error: "redirect_url 无效",
          traceId,
          raw: body,
        });
        return c.json({ error: "redirect_url 无效" }, 400);
      }
    }

    if (!state) {
      await oauthCallbackStore.append({
        provider: (provider || "unknown").toLowerCase(),
        source: "aggregate",
        status: "failure",
        error: "缺少 state",
        traceId,
        raw: body,
      });
      return c.json({ error: "缺少 state" }, 400);
    }

    const session = await oauthSessionStore.get(state);
    if (!session) {
      await oauthCallbackStore.append({
        provider: (provider || "unknown").toLowerCase(),
        state,
        code,
        error,
        source: "aggregate",
        status: "failure",
        traceId,
        raw: body,
      });
      return c.json({ error: "授权会话不存在或已过期" }, 404);
    }

    const resolvedProvider = (provider || session.provider || "").toLowerCase();
    const router = resolveCallbackProvider(resolvedProvider);
    if (!router) {
      await oauthCallbackStore.append({
        provider: resolvedProvider || "unknown",
        state,
        code,
        error,
        source: "aggregate",
        status: "failure",
        traceId,
        raw: body,
      });
      return c.json({ error: `provider 不支持: ${resolvedProvider}` }, 400);
    }

    if (error) {
      await oauthSessionStore.markError(state, error);
      await oauthCallbackStore.append({
        provider: resolvedProvider,
        state,
        code,
        error,
        source: "aggregate",
        status: "failure",
        traceId,
        raw: body,
      });
      return c.json({ success: false, state, provider: resolvedProvider, error }, 400);
    }

    if (!code) {
      await oauthCallbackStore.append({
        provider: resolvedProvider,
        state,
        error: "缺少 code",
        source: "aggregate",
        status: "failure",
        traceId,
        raw: body,
      });
      return c.json({ error: "缺少 code" }, 400);
    }

    const callbackUrl = `http://localhost/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    const rawBody = JSON.stringify({ url: callbackUrl });
    const response = await delegateToRouter(
      c,
      router,
      "POST",
      "/auth/callback/manual",
      rawBody,
    );

    if (response.ok) {
      await oauthSessionStore.complete(state);
      await oauthCallbackStore.append({
        provider: resolvedProvider,
        state,
        code,
        source: "aggregate",
        status: "success",
        traceId,
        raw: {
          request: body,
          callbackUrl,
          delegateStatus: response.status,
        },
      });
      return c.json({ success: true, state, provider: resolvedProvider });
    }

    const details = await response.text().catch(() => "回调处理失败");
    await oauthSessionStore.markError(state, details);
    await oauthCallbackStore.append({
      provider: resolvedProvider,
      state,
      code,
      error: details,
      source: "aggregate",
      status: "failure",
      traceId,
      raw: {
        request: body,
        callbackUrl,
        delegateStatus: response.status,
      },
    });
    return new Response(
      JSON.stringify({
        success: false,
        state,
        provider: resolvedProvider,
        error: details,
      }),
      {
        status: response.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  },
);

oauth.post("/kiro/register", async (c) => {
  const reg = await registerKiroClient();
  const flow = await initiateKiroDeviceFlow(reg.clientId, reg.clientSecret);
  return c.json({
    ...flow,
    clientId: reg.clientId,
    clientSecret: reg.clientSecret,
  });
});

oauth.get(
  "/:provider/callback",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider } = c.req.valid("param");
    const query = new URLSearchParams(c.req.query()).toString();
    const suffix = query ? `?${query}` : "";

    const targetMap: Record<string, string> = {
      claude: `/api/claude/callback${suffix}`,
      gemini: `/api/gemini/oauth2callback${suffix}`,
      codex: `/api/codex/callback${suffix}`,
      iflow: `/api/iflow/callback${suffix}`,
      antigravity: `/api/antigravity/callback${suffix}`,
      kiro: `/api/kiro/callback${suffix}`,
      copilot: `/api/copilot/callback${suffix}`,
      qwen: `/api/qwen/callback${suffix}`,
      aistudio: `/api/credentials${suffix}`,
      vertex: `/api/credentials${suffix}`,
    };

    const target = targetMap[provider];
    if (!target) return c.notFound();
    return c.redirect(target, 302);
  },
);

export default oauth;
