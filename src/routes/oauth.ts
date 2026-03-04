import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db";
import { credentials } from "../db/schema";
import geminiRouter from "../lib/providers/gemini";
import {
  oauthSessionStore,
  type OAuthSessionRecord,
} from "../lib/auth/oauth-session-store";
import { oauthCallbackStore } from "../lib/auth/oauth-callback-store";
import {
  parseManualCallbackUrl,
  parseOAuthCallback,
} from "../lib/auth/oauth-callback";
import { getRequestTraceId } from "../middleware/request-context";
import {
  normalizeOAuthProvider,
  validateOAuthState,
} from "../lib/auth/oauth-state";
import {
  getProviderCapability,
  listProviderCapabilities,
  normalizeCapabilityProviderId,
  type ProviderCapability,
} from "../lib/routing/capability-map";
import {
  diagnoseProviderRuntimeRoute,
  getProviderRuntimeAdapter,
  resolveProviderCallbackRedirectPath,
  resolveProviderCallbackRouter,
  supportsProviderManualCallback,
} from "../lib/oauth/runtime-adapters";
import type { OAuthRouteErrorCode } from "../types/oauth";

const oauth = new Hono();
const providerSchema = z.object({
  provider: z.string().trim().min(1),
});

function oauthError(
  c: Context,
  status: ContentfulStatusCode,
  code: OAuthRouteErrorCode,
  error: string,
  extra?: Record<string, unknown>,
) {
  const traceId = getRequestTraceId(c);
  return c.json(
    {
      error,
      code,
      traceId,
      ...(extra || {}),
    },
    status,
  );
}

function normalizeErrorStatus(status: number): ContentfulStatusCode {
  if (status >= 400 && status <= 599) {
    return status as ContentfulStatusCode;
  }
  return 500 as ContentfulStatusCode;
}

async function delegateToRouter(
  c: Context,
  router: { fetch: (request: Request) => Response | Promise<Response> },
  method: string,
  path: string,
  rawBody?: BodyInit | null,
  extraHeaders?: Record<string, string>,
) {
  const headers = new Headers(c.req.raw.headers);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }
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

function parseCallbackUrl(urlValue?: string) {
  const rawUrl = (urlValue || "").trim();
  if (!rawUrl) return { url: "", code: undefined, state: undefined, error: undefined };
  try {
    const parsed = new URL(
      rawUrl.startsWith("http")
        ? rawUrl
        : `http://localhost${rawUrl.startsWith("?") ? "" : "/"}${rawUrl}`,
    );
    const callback = parseManualCallbackUrl(parsed);
    return {
      url: rawUrl,
      code: callback.code,
      state: callback.state,
      error:
        parsed.searchParams.get("error") ||
        parsed.searchParams.get("error_description") ||
        undefined,
    };
  } catch {
    return { url: rawUrl, code: undefined, state: undefined, error: undefined };
  }
}

function extractStateFromUrl(urlValue?: string): string | null {
  const rawUrl = (urlValue || "").trim();
  if (!rawUrl) return null;
  try {
    const parsed = new URL(
      rawUrl.startsWith("http")
        ? rawUrl
        : `http://localhost${rawUrl.startsWith("?") ? "" : "/"}${rawUrl}`,
    );
    const stateValue = parsed.searchParams.get("state") || "";
    const stateCheck = validateOAuthState(stateValue);
    if (!stateCheck.ok) return null;
    return stateCheck.normalized;
  } catch {
    return null;
  }
}

function buildSessionPollPayload(state: string, session: OAuthSessionRecord) {
  const remainingMs = Math.max(0, session.expiresAt - Date.now());
  return {
    state,
    provider: session.provider,
    flow: session.flowType,
    status: session.status,
    phase: session.phase,
    pending: session.status === "pending",
    success: session.status === "completed",
    error: session.error || session.lastError || null,
    expiresAtMs: session.expiresAt,
    remainingMs,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt || null,
  };
}

async function resolveProviderCapability(
  providerInput: string,
): Promise<{ provider: string; capability: ProviderCapability } | null> {
  const provider = normalizeCapabilityProviderId(
    normalizeOAuthProvider(providerInput),
  );
  if (!provider) return null;
  const capability = await getProviderCapability(provider);
  if (!capability) return null;
  return { provider, capability };
}

oauth.get("/providers", async (c) => {
  const providers = await listProviderCapabilities();
  return c.json({
    data: providers.map((item) => ({
      id: item.provider,
      flows: item.flows,
      supportsChat: item.supportsChat,
      supportsModelList: item.supportsModelList,
      supportsStream: item.supportsStream,
      supportsManualCallback: item.supportsManualCallback,
    })),
  });
});

oauth.get("/status", async (c) => {
  const capabilities = await listProviderCapabilities();
  const all = await db.select().from(credentials);
  const statusMap: Record<string, boolean> = Object.fromEntries(
    capabilities.map((item) => [item.provider, false]),
  );
  const accountCounts: Record<string, number> = Object.fromEntries(
    capabilities.map((item) => [item.provider, 0]),
  );
  all.forEach((item) => {
    const status = item.status || "active";
    const isActive = status !== "revoked" && status !== "disabled";
    if (!isActive) return;
    if (!(item.provider in statusMap)) {
      statusMap[item.provider] = false;
    }
    if (!(item.provider in accountCounts)) {
      accountCounts[item.provider] = 0;
    }
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
    const { provider: providerInput } = c.req.valid("param");
    const resolved = await resolveProviderCapability(providerInput);
    if (!resolved) {
      return oauthError(c, 400, "oauth_provider_unsupported", "不支持的 provider");
    }
    const { provider, capability } = resolved;
    const adapter = getProviderRuntimeAdapter(provider);
    if (!adapter) {
      const diagnostic = diagnoseProviderRuntimeRoute(provider, capability, "start");
      return c.json(
        {
          ...diagnostic.payload,
          traceId: getRequestTraceId(c),
        },
        diagnostic.status,
      );
    }
    return adapter.start({
      c,
      provider,
      capability,
      delegateToRouter,
      extractStateFromUrl,
    });
  },
);

oauth.get(
  "/session/:state",
  async (c) => {
    const stateInput = c.req.param("state") || "";
    const stateCheck = validateOAuthState(stateInput);
    if (!stateCheck.ok) {
      return oauthError(c, 400, "oauth_invalid_state", "state 无效", {
        details: stateCheck.reason,
      });
    }
    const state = stateCheck.normalized;

    const session = await oauthSessionStore.get(state);
    if (!session) {
      return c.json({ exists: false }, 404);
    }

    return c.json({
      exists: true,
      ...buildSessionPollPayload(state, session),
    });
  },
);

oauth.post(
  "/:provider/poll",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider: providerInput } = c.req.valid("param");
    const resolved = await resolveProviderCapability(providerInput);
    if (!resolved) {
      return oauthError(c, 400, "oauth_provider_unsupported", "不支持的 provider");
    }
    const { provider, capability } = resolved;
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      string | undefined
    >;
    const stateInput = (body.state || "").trim();
    let state: string | null = null;
    let session: OAuthSessionRecord | null = null;
    if (stateInput) {
      const stateCheck = validateOAuthState(stateInput);
      if (!stateCheck.ok) {
        return oauthError(c, 400, "oauth_invalid_state", "state 无效", {
          details: stateCheck.reason,
        });
      }
      state = stateCheck.normalized;
      session = await oauthSessionStore.get(state);
      if (!session) {
        return oauthError(c, 404, "oauth_session_not_found", "授权会话不存在或已过期", {
          state,
        });
      }
      if (session.provider !== provider) {
        return oauthError(
          c,
          400,
          "oauth_provider_state_mismatch",
          "provider 与 state 不匹配",
          {
            expectedProvider: session.provider,
            actualProvider: provider,
            state,
          },
        );
      }
      if (session.flowType === "auth_code") {
        return c.json(buildSessionPollPayload(state, session));
      }
    }

    const adapter = getProviderRuntimeAdapter(provider);
    if (adapter?.poll) {
      return adapter.poll({
        c,
        provider,
        capability,
        body,
        state,
        session,
        buildSessionPollPayload,
        delegateToRouter,
      });
    }

    if (capability.flows.includes("auth_code")) {
      if (!state) {
        return oauthError(
          c,
          400,
          "oauth_session_flow_mismatch",
          "该 provider 轮询需要提供 state",
        );
      }
      // 如果 code 执行到这里，说明 state 对应会话非 auth_code（通常不会发生）。
      return oauthError(c, 400, "oauth_session_flow_mismatch", "state 会话类型不匹配");
    }

    if (capability.flows.includes("device_code")) {
      const diagnostic = diagnoseProviderRuntimeRoute(provider, capability, "poll");
      return c.json(
        {
          ...diagnostic.payload,
          traceId: getRequestTraceId(c),
        },
        diagnostic.status,
      );
    }

    return oauthError(c, 400, "oauth_provider_poll_not_supported", `${provider} 不支持轮询流程`);
  },
);

oauth.post(
  "/:provider/callback/manual",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider: providerInput } = c.req.valid("param");
    const provider = normalizeCapabilityProviderId(
      normalizeOAuthProvider(providerInput),
    );
    const traceId = getRequestTraceId(c);
    const capability = await getProviderCapability(provider);
    if (!capability) {
      await oauthCallbackStore.append({
        provider: provider || "unknown",
        source: "manual",
        status: "failure",
        error: `${provider} 不在能力图谱中`,
        traceId,
      });
      return oauthError(c, 400, "oauth_provider_capability_missing", `${provider} 不在能力图谱中`);
    }
    if (!capability.supportsManualCallback) {
      await oauthCallbackStore.append({
        provider,
        source: "manual",
        status: "failure",
        error: `${provider} 未启用手动回调能力`,
        traceId,
      });
      return oauthError(
        c,
        400,
        "oauth_manual_callback_disabled",
        `${provider} 未启用手动回调能力`,
      );
    }
    if (!supportsProviderManualCallback(provider)) {
      await oauthCallbackStore.append({
        provider,
        source: "manual",
        status: "failure",
        error: `${provider} 运行时未启用手动回调能力`,
        traceId,
      });
      return oauthError(
        c,
        400,
        "oauth_manual_callback_runtime_disabled",
        `${provider} 运行时未启用手动回调能力`,
      );
    }
    const body = await c.req.json().catch(() => ({}));
    const callbackUrl = body?.url || body?.callbackUrl || body?.redirect_url || "";
    const parsed = parseCallbackUrl(callbackUrl);
    const stateCheck = parsed.state ? validateOAuthState(parsed.state) : null;
    if (stateCheck && !stateCheck.ok) {
      await oauthCallbackStore.append({
        provider,
        state: parsed.state,
        code: parsed.code,
        error: `无效 state: ${stateCheck.reason}`,
        source: "manual",
        status: "failure",
        traceId,
        raw: {
          request: {
            url: parsed.url,
          },
        },
      });
      return oauthError(c, 400, "oauth_invalid_state", "state 无效", {
        details: stateCheck.reason,
      });
    }

    if (provider === "gemini") {
      if (!parsed.code || !parsed.state) {
        await oauthCallbackStore.append({
          provider,
          state: parsed.state,
          code: parsed.code,
          error: "手动回调缺少 code/state",
          source: "manual",
          status: "failure",
          traceId,
          raw: {
            request: {
              url: parsed.url,
            },
          },
        });
        return oauthError(
          c,
          400,
          "oauth_manual_callback_missing_code_state",
          "手动回调缺少 code/state",
        );
      }
      const geminiPath =
        `/oauth2callback?code=${encodeURIComponent(parsed.code)}` +
        `&state=${encodeURIComponent(parsed.state)}`;
      const response = await delegateToRouter(
        c,
        geminiRouter,
        "GET",
        geminiPath,
        undefined,
        { "x-tokenpulse-oauth-manual": "1" },
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
      if (!response.ok) {
        return oauthError(
          c,
          normalizeErrorStatus(response.status),
          "oauth_manual_callback_delegate_failed",
          "手动回调处理失败",
          {
            provider,
            state: parsed.state || null,
            details: responseText || parsed.error || "手动回调处理失败",
          },
        );
      }
      return new Response(responseText, {
        status: response.status,
        headers: response.headers,
      });
    }

    const router = resolveProviderCallbackRouter(provider);
    if (!router) {
      await oauthCallbackStore.append({
        provider,
        source: "manual",
        status: "failure",
        error: `${provider} 暂不支持手动回调`,
        traceId,
      });
      return oauthError(
        c,
        400,
        "oauth_manual_callback_unsupported",
        `${provider} 暂不支持手动回调`,
      );
    }

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
    if (!response.ok) {
      return oauthError(
        c,
        normalizeErrorStatus(response.status),
        "oauth_manual_callback_delegate_failed",
        "手动回调处理失败",
        {
          provider,
          state: parsed.state || null,
          details: responseText || parsed.error || "手动回调处理失败",
        },
      );
    }
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
    const codeState = parseOAuthCallback(code, state);
    code = codeState.code;
    state = codeState.state;

    if (redirectUrl) {
      try {
        const parsed = new URL(
          redirectUrl.startsWith("http")
            ? redirectUrl
            : `http://localhost${redirectUrl.startsWith("?") ? "" : "/"}${redirectUrl}`,
        );
        const callback = parseManualCallbackUrl(parsed);
        code = code || callback.code;
        state = state || callback.state;
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
        return oauthError(c, 400, "oauth_callback_invalid_redirect_url", "redirect_url 无效");
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
      return oauthError(c, 400, "oauth_callback_missing_state", "缺少 state");
    }
    const stateCheck = validateOAuthState(state);
    if (!stateCheck.ok) {
      await oauthCallbackStore.append({
        provider: normalizeOAuthProvider(provider || "unknown"),
        state,
        code,
        error: `无效 state: ${stateCheck.reason}`,
        source: "aggregate",
        status: "failure",
        traceId,
        raw: body,
      });
      return oauthError(c, 400, "oauth_invalid_state", "state 无效", {
        details: stateCheck.reason,
      });
    }
    state = stateCheck.normalized;

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
      return oauthError(c, 404, "oauth_session_not_found", "授权会话不存在或已过期");
    }

    const resolvedProvider = normalizeOAuthProvider(
      provider || session.provider || "",
    );
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
      return oauthError(
        c,
        400,
        "oauth_callback_provider_error",
        "授权回调返回错误",
        {
          provider: resolvedProvider,
          state,
          details: error,
        },
      );
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
      return oauthError(c, 400, "oauth_callback_missing_code", "缺少 code");
    }

    let callbackUrl = `http://localhost/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    let response: Response;
    if (resolvedProvider === "gemini") {
      const geminiPath =
        `/oauth2callback?code=${encodeURIComponent(code)}` +
        `&state=${encodeURIComponent(state)}`;
      callbackUrl = `http://localhost${geminiPath}`;
      response = await delegateToRouter(
        c,
        geminiRouter,
        "GET",
        geminiPath,
        undefined,
        { "x-tokenpulse-oauth-manual": "1" },
      );
    } else {
      const router = resolveProviderCallbackRouter(resolvedProvider);
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
        return oauthError(
          c,
          400,
          "oauth_callback_provider_not_supported",
          `provider 不支持: ${resolvedProvider}`,
        );
      }
      const rawBody = JSON.stringify({ url: callbackUrl });
      response = await delegateToRouter(
        c,
        router,
        "POST",
        "/auth/callback/manual",
        rawBody,
      );
    }

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
    return oauthError(
      c,
      normalizeErrorStatus(response.status),
      "oauth_callback_delegate_failed",
      "回调处理失败",
      {
        provider: resolvedProvider,
        state,
        details,
      },
    );
  },
);

oauth.get(
  "/:provider/callback",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider: providerInput } = c.req.valid("param");
    const provider = normalizeCapabilityProviderId(
      normalizeOAuthProvider(providerInput),
    );
    const capability = await getProviderCapability(provider);
    if (!capability) {
      return oauthError(c, 400, "oauth_provider_unsupported", "不支持的 provider");
    }
    const query = new URLSearchParams(c.req.query()).toString();
    const suffix = query ? `?${query}` : "";
    const target = resolveProviderCallbackRedirectPath(provider, suffix);
    if (!target) {
      const diagnostic = diagnoseProviderRuntimeRoute(provider, capability, "callback");
      return c.json(
        {
          ...diagnostic.payload,
          traceId: getRequestTraceId(c),
        },
        diagnostic.status,
      );
    }
    return c.redirect(target, 302);
  },
);

export default oauth;
