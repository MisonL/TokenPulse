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

const oauth = new Hono();
const providerSchema = z.object({
  provider: z.string().trim().min(1),
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
  return {
    state,
    provider: session.provider,
    flow: session.flowType,
    status: session.status,
    phase: session.phase,
    pending: session.status === "pending",
    success: session.status === "completed",
    error: session.error || session.lastError || null,
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
      flow: item.flows[0] || "auth_code",
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
      return c.json({ error: "不支持的 provider" }, 400);
    }
    const { provider, capability } = resolved;

    switch (provider) {
      case "claude":
        if (!capability.flows.includes("auth_code")) {
          return c.json({ error: `${provider} 未启用 auth_code 授权` }, 400);
        }
        return claudeProvider.startOAuth(c);
      case "codex":
        if (!capability.flows.includes("auth_code")) {
          return c.json({ error: `${provider} 未启用 auth_code 授权` }, 400);
        }
        return codexProvider.startOAuth(c);
      case "iflow":
        if (!capability.flows.includes("auth_code")) {
          return c.json({ error: `${provider} 未启用 auth_code 授权` }, 400);
        }
        return iflowProvider.startOAuth(c);
      case "antigravity":
        if (!capability.flows.includes("auth_code")) {
          return c.json({ error: `${provider} 未启用 auth_code 授权` }, 400);
        }
        return antigravityProvider.startOAuth(c);
      case "copilot": {
        if (!capability.flows.includes("device_code")) {
          return c.json({ error: `${provider} 未启用 device_code 授权` }, 400);
        }
        const response = await copilotProvider.startOAuth(c);
        if (!response.ok) return response;
        const payload = (await response.clone().json().catch(() => null)) as
          | Record<string, string>
          | null;
        if (!payload) return response;

        const deviceCode = payload.device_code || payload.deviceCode;
        if (!deviceCode) return response;

        const state = crypto.randomUUID();
        await oauthSessionStore.register(state, "copilot", undefined, {
          flowType: "device_code",
          phase: "waiting_device",
        });
        return c.json({
          ...payload,
          state,
          flow: "device_code",
          status: "pending",
          phase: "waiting_device",
        });
      }
      case "kiro":
        if (!capability.flows.includes("device_code")) {
          return c.json({ error: `${provider} 未启用 device_code 授权` }, 400);
        }
        return kiroProvider.startOAuth(c);
      case "gemini": {
        if (!capability.flows.includes("auth_code")) {
          return c.json({ error: `${provider} 未启用 auth_code 授权` }, 400);
        }
        const response = await delegateToRouter(c, geminiRouter, "GET", "/auth/url");
        if (response.ok) {
          const payload = (await response.clone().json().catch(() => null)) as {
            url?: string;
          } | null;
          const state = extractStateFromUrl(payload?.url);
          if (state) {
            await oauthSessionStore.register(state, "gemini", undefined, {
              flowType: "auth_code",
              phase: "waiting_callback",
            });
          }
        }
        return response;
      }
      case "qwen": {
        if (!capability.flows.includes("device_code")) {
          return c.json({ error: `${provider} 未启用 device_code 授权` }, 400);
        }
        const data = await initiateQwenDeviceFlow();
        const state = crypto.randomUUID();
        await oauthSessionStore.register(state, "qwen", data.code_verifier, {
          flowType: "device_code",
          phase: "waiting_device",
        });
        return c.json({
          ...data,
          state,
          flow: "device_code",
          status: "pending",
          phase: "waiting_device",
        });
      }
      case "aistudio":
        if (!capability.flows.includes("manual_key")) {
          return c.json({ error: `${provider} 未启用 manual_key 授权` }, 400);
        }
        return c.json({
          mode: "manual_key",
          message: "请通过 /api/credentials/auth/aistudio/save 提交 API Key 或服务账号。",
        });
      case "vertex":
        if (!capability.flows.includes("service_account")) {
          return c.json({ error: `${provider} 未启用 service_account 授权` }, 400);
        }
        return c.json({
          mode: "service_account",
          message: "请通过 /api/credentials/auth/vertex/save 提交服务账号 JSON。",
        });
      default:
        return c.json({ error: `${provider} 已声明能力图谱，但 start 流程尚未实现` }, 501);
    }
  },
);

oauth.get(
  "/session/:state",
  async (c) => {
    const stateInput = c.req.param("state") || "";
    const stateCheck = validateOAuthState(stateInput);
    if (!stateCheck.ok) {
      return c.json({ error: "state 无效", details: stateCheck.reason }, 400);
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
      return c.json({ error: "不支持的 provider" }, 400);
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
        return c.json({ error: "state 无效", details: stateCheck.reason }, 400);
      }
      state = stateCheck.normalized;
      session = await oauthSessionStore.get(state);
      if (!session) {
        return c.json({ error: "授权会话不存在或已过期", state }, 404);
      }
      if (session.provider !== provider) {
        return c.json(
          {
            error: "provider 与 state 不匹配",
            expectedProvider: session.provider,
            actualProvider: provider,
            state,
          },
          400,
        );
      }
      if (session.flowType === "auth_code") {
        return c.json(buildSessionPollPayload(state, session));
      }
    }

    if (provider === "qwen") {
      if (!capability.flows.includes("device_code")) {
        return c.json({ error: `${provider} 未启用 device_code 轮询` }, 400);
      }
      const deviceCode = body.deviceCode || body.device_code;
      const codeVerifier = body.codeVerifier || body.code_verifier;
      if (state && session && session.status !== "pending") {
        return c.json(buildSessionPollPayload(state, session));
      }
      if (!deviceCode || !codeVerifier) {
        return c.json({ error: "缺少 deviceCode/codeVerifier" }, 400);
      }
      const result = await pollQwenToken(deviceCode, codeVerifier);
      if (result.pending) {
        if (state) {
          await oauthSessionStore.setPhase(state, "waiting_device");
          const latest = await oauthSessionStore.get(state);
          if (latest) {
            return c.json({
              ...result,
              ...buildSessionPollPayload(state, latest),
            });
          }
        }
        return c.json(result);
      }
      if (result.success) {
        if (state) {
          await oauthSessionStore.complete(state);
          const latest = await oauthSessionStore.get(state);
          if (latest) {
            return c.json({
              ...result,
              ...buildSessionPollPayload(state, latest),
            });
          }
        }
        return c.json(result);
      }
      if (result.error && state) {
        await oauthSessionStore.markError(state, result.error);
        const latest = await oauthSessionStore.get(state);
        if (latest) {
          return c.json(
            {
              ...result,
              ...buildSessionPollPayload(state, latest),
            },
            400,
          );
        }
      }
      return c.json(result, 400);
    }

    if (provider === "kiro") {
      if (!capability.flows.includes("device_code")) {
        return c.json({ error: `${provider} 未启用 device_code 轮询` }, 400);
      }
      const deviceCode = body.deviceCode || body.device_code;
      const clientId = body.clientId || body.client_id;
      const clientSecret = body.clientSecret || body.client_secret;
      if (state && session && session.status !== "pending") {
        return c.json(buildSessionPollPayload(state, session));
      }
      if (!deviceCode || !clientId || !clientSecret) {
        return c.json({ error: "缺少 deviceCode/clientId/clientSecret" }, 400);
      }
      const result = await pollKiroToken(deviceCode, clientId, clientSecret);
      if (result.pending) {
        if (state) {
          await oauthSessionStore.setPhase(state, "waiting_device");
          const latest = await oauthSessionStore.get(state);
          if (latest) {
            return c.json({
              ...result,
              ...buildSessionPollPayload(state, latest),
            });
          }
        }
        return c.json(result);
      }
      if (result.success || result.accessToken) {
        if (state) {
          await oauthSessionStore.complete(state);
          const latest = await oauthSessionStore.get(state);
          if (latest) {
            return c.json({
              ...result,
              ...buildSessionPollPayload(state, latest),
            });
          }
        }
        return c.json(result);
      }
      if (result.error && state) {
        await oauthSessionStore.markError(state, result.error);
        const latest = await oauthSessionStore.get(state);
        if (latest) {
          return c.json(
            {
              ...result,
              ...buildSessionPollPayload(state, latest),
            },
            400,
          );
        }
      }
      return c.json(result, 400);
    }

    if (provider === "copilot") {
      if (!capability.flows.includes("device_code")) {
        return c.json({ error: `${provider} 未启用 device_code 轮询` }, 400);
      }
      const deviceCode = body.deviceCode || body.device_code;
      if (state && session && session.status !== "pending") {
        return c.json(buildSessionPollPayload(state, session));
      }
      if (!deviceCode) {
        return c.json({ error: "缺少 deviceCode" }, 400);
      }
      const response = await delegateToRouter(
        c,
        copilotProvider.router,
        "POST",
        "/auth/poll",
        JSON.stringify({ device_code: deviceCode }),
      );
      if (!state) {
        return response;
      }

      const payload = (await response.clone().json().catch(() => null)) as
        | Record<string, unknown>
        | null;
      if (response.ok && payload?.success) {
        await oauthSessionStore.complete(state);
      } else if (
        response.status === 202 ||
        payload?.status === "pending" ||
        payload?.pending === true
      ) {
        await oauthSessionStore.setPhase(state, "waiting_device");
      } else {
        const errorMessage =
          typeof payload?.error === "string" && payload.error
            ? payload.error
            : `copilot 轮询失败: ${response.status}`;
        await oauthSessionStore.markError(state, errorMessage);
      }

      const latest = await oauthSessionStore.get(state);
      if (latest) {
        return new Response(
          JSON.stringify({
            ...(payload || {}),
            ...buildSessionPollPayload(state, latest),
          }),
          {
            status: response.status,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          },
        );
      }
      return response;
    }

    if (capability.flows.includes("auth_code")) {
      if (!state) {
        return c.json(
          { error: "该 provider 轮询需要提供 state" },
          400,
        );
      }
      // 如果 code 执行到这里，说明 state 对应会话非 auth_code（通常不会发生）。
      return c.json({ error: "state 会话类型不匹配" }, 400);
    }

    if (capability.flows.includes("device_code")) {
      return c.json({ error: `${provider} 设备码轮询尚未实现` }, 501);
    }

    return c.json({ error: `${provider} 不支持轮询流程` }, 400);
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
      return c.json({ error: `${provider} 不在能力图谱中` }, 400);
    }
    if (!capability.supportsManualCallback) {
      await oauthCallbackStore.append({
        provider,
        source: "manual",
        status: "failure",
        error: `${provider} 未启用手动回调能力`,
        traceId,
      });
      return c.json({ error: `${provider} 未启用手动回调能力` }, 400);
    }
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
      return c.json({ error: "state 无效", details: stateCheck.reason }, 400);
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
      return c.json({ error: "state 无效", details: stateCheck.reason }, 400);
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
      return c.json({ error: "授权会话不存在或已过期" }, 404);
    }

    const resolvedProvider = normalizeOAuthProvider(
      provider || session.provider || "",
    );
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
  const state = crypto.randomUUID();
  await oauthSessionStore.register(state, "kiro", undefined, {
    flowType: "device_code",
    phase: "waiting_device",
  });
  return c.json({
    ...flow,
    clientId: reg.clientId,
    clientSecret: reg.clientSecret,
    state,
    flow: "device_code",
    status: "pending",
    phase: "waiting_device",
  });
});

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
      return c.json({ error: "不支持的 provider" }, 400);
    }
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
    if (!target) {
      return c.json({ error: `${provider} 回调入口尚未实现` }, 501);
    }
    return c.redirect(target, 302);
  },
);

export default oauth;
