import type { Context } from "hono";
import type {
  OAuthFlowType,
  ProviderCapability,
  ProviderCapabilityMap,
} from "../routing/capability-map";
import {
  oauthSessionStore,
  type OAuthSessionRecord,
} from "../auth/oauth-session-store";
import { initiateQwenDeviceFlow, pollQwenToken } from "../auth/qwen";
import {
  initiateKiroDeviceFlow,
  pollKiroToken,
  registerKiroClient,
} from "../auth/kiro";
import geminiRouter from "../providers/gemini";
import { claudeProvider } from "../providers/claude";
import { codexProvider } from "../providers/codex";
import { iflowProvider } from "../providers/iflow";
import { antigravityProvider } from "../providers/antigravity";
import { copilotProvider } from "../providers/copilot";
import { kiroProvider } from "../providers/kiro";

export interface RuntimeRouter {
  fetch: (request: Request) => Response | Promise<Response>;
}

export type DelegateToRouter = (
  c: Context,
  router: RuntimeRouter,
  method: string,
  path: string,
  rawBody?: BodyInit | null,
  extraHeaders?: Record<string, string>,
) => Promise<Response>;

export interface OAuthStartContext {
  c: Context;
  provider: string;
  capability: ProviderCapability;
  delegateToRouter: DelegateToRouter;
  extractStateFromUrl: (urlValue?: string) => string | null;
}

export interface OAuthPollContext {
  c: Context;
  provider: string;
  capability: ProviderCapability;
  body: Record<string, string | undefined>;
  state: string | null;
  session: OAuthSessionRecord | null;
  buildSessionPollPayload: (
    state: string,
    session: OAuthSessionRecord,
  ) => Record<string, unknown>;
  delegateToRouter: DelegateToRouter;
}

export interface ProviderRuntimeAdapter {
  provider: string;
  startFlows: OAuthFlowType[];
  start: (ctx: OAuthStartContext) => Promise<Response>;
  pollFlows?: OAuthFlowType[];
  poll?: (ctx: OAuthPollContext) => Promise<Response>;
  supportsManualCallback?: boolean;
  callbackRouter?: RuntimeRouter;
  callbackRedirectPath?: (suffix: string) => string;
}

export interface CapabilityRuntimeIssue {
  provider: string;
  code:
    | "capability_missing_adapter"
    | "adapter_missing_capability"
    | "start_flows_mismatch"
    | "poll_flows_mismatch"
    | "manual_callback_mismatch";
  message: string;
  capability?: {
    flows: OAuthFlowType[];
    supportsManualCallback: boolean;
  };
  runtime?: {
    startFlows: OAuthFlowType[];
    pollFlows: OAuthFlowType[];
    supportsManualCallback: boolean;
  };
}

export interface CapabilityRuntimeHealth {
  ok: boolean;
  checkedAt: string;
  issueCount: number;
  issues: CapabilityRuntimeIssue[];
}

function requireStartFlow(
  capability: ProviderCapability,
  provider: string,
  flows: OAuthFlowType[],
): string | null {
  if (flows.some((flow) => capability.flows.includes(flow))) {
    return null;
  }
  return `${provider} 未启用 ${flows.join("/")} 授权`;
}

function requirePollFlow(
  capability: ProviderCapability,
  provider: string,
  flows: OAuthFlowType[],
): string | null {
  if (flows.some((flow) => capability.flows.includes(flow))) {
    return null;
  }
  return `${provider} 未启用 ${flows.join("/")} 轮询`;
}

const ADAPTERS: Record<string, ProviderRuntimeAdapter> = {
  claude: {
    provider: "claude",
    startFlows: ["auth_code"],
    supportsManualCallback: true,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["auth_code"]);
      if (error) return c.json({ error }, 400);
      return claudeProvider.startOAuth(c);
    },
    callbackRouter: claudeProvider.router,
    callbackRedirectPath: (suffix) => `/api/claude/callback${suffix}`,
  },
  codex: {
    provider: "codex",
    startFlows: ["auth_code"],
    supportsManualCallback: true,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["auth_code"]);
      if (error) return c.json({ error }, 400);
      return codexProvider.startOAuth(c);
    },
    callbackRouter: codexProvider.router,
    callbackRedirectPath: (suffix) => `/api/codex/callback${suffix}`,
  },
  iflow: {
    provider: "iflow",
    startFlows: ["auth_code"],
    supportsManualCallback: true,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["auth_code"]);
      if (error) return c.json({ error }, 400);
      return iflowProvider.startOAuth(c);
    },
    callbackRouter: iflowProvider.router,
    callbackRedirectPath: (suffix) => `/api/iflow/callback${suffix}`,
  },
  antigravity: {
    provider: "antigravity",
    startFlows: ["auth_code"],
    supportsManualCallback: true,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["auth_code"]);
      if (error) return c.json({ error }, 400);
      return antigravityProvider.startOAuth(c);
    },
    callbackRouter: antigravityProvider.router,
    callbackRedirectPath: (suffix) => `/api/antigravity/callback${suffix}`,
  },
  gemini: {
    provider: "gemini",
    startFlows: ["auth_code"],
    supportsManualCallback: true,
    start: async ({ c, provider, capability, delegateToRouter, extractStateFromUrl }) => {
      const error = requireStartFlow(capability, provider, ["auth_code"]);
      if (error) return c.json({ error }, 400);
      const response = await delegateToRouter(c, geminiRouter, "GET", "/auth/url");
      if (response.ok) {
        const payload = (await response.clone().json().catch(() => null)) as
          | { url?: string }
          | null;
        const state = extractStateFromUrl(payload?.url);
        if (state) {
          await oauthSessionStore.register(state, provider, undefined, {
            flowType: "auth_code",
            phase: "waiting_callback",
          });
        }
      }
      return response;
    },
    callbackRedirectPath: (suffix) => `/api/gemini/oauth2callback${suffix}`,
  },
  qwen: {
    provider: "qwen",
    startFlows: ["device_code"],
    pollFlows: ["device_code"],
    supportsManualCallback: false,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["device_code"]);
      if (error) return c.json({ error }, 400);
      const data = await initiateQwenDeviceFlow();
      const state = crypto.randomUUID();
      await oauthSessionStore.register(state, provider, data.code_verifier, {
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
    },
    poll: async ({ c, provider, capability, body, state, session, buildSessionPollPayload }) => {
      const flowError = requirePollFlow(capability, provider, ["device_code"]);
      if (flowError) {
        return c.json({ error: flowError }, 400);
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
    },
    callbackRedirectPath: (suffix) => `/api/qwen/callback${suffix}`,
  },
  kiro: {
    provider: "kiro",
    startFlows: ["device_code"],
    pollFlows: ["device_code"],
    supportsManualCallback: true,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["device_code"]);
      if (error) return c.json({ error }, 400);
      const reg = await registerKiroClient();
      const flow = await initiateKiroDeviceFlow(reg.clientId, reg.clientSecret);
      const state = crypto.randomUUID();
      await oauthSessionStore.register(state, provider, undefined, {
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
    },
    poll: async ({ c, provider, capability, body, state, session, buildSessionPollPayload }) => {
      const flowError = requirePollFlow(capability, provider, ["device_code"]);
      if (flowError) {
        return c.json({ error: flowError }, 400);
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
    },
    callbackRouter: kiroProvider.router,
    callbackRedirectPath: (suffix) => `/api/kiro/callback${suffix}`,
  },
  copilot: {
    provider: "copilot",
    startFlows: ["device_code"],
    pollFlows: ["device_code"],
    supportsManualCallback: true,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["device_code"]);
      if (error) return c.json({ error }, 400);

      const response = await copilotProvider.startOAuth(c);
      if (!response.ok) return response;
      const payload = (await response.clone().json().catch(() => null)) as
        | Record<string, string>
        | null;
      if (!payload) return response;

      const deviceCode = payload.device_code || payload.deviceCode;
      if (!deviceCode) return response;

      const state = crypto.randomUUID();
      await oauthSessionStore.register(state, provider, undefined, {
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
    },
    poll: async ({ c, provider, capability, body, state, session, buildSessionPollPayload, delegateToRouter }) => {
      const flowError = requirePollFlow(capability, provider, ["device_code"]);
      if (flowError) {
        return c.json({ error: flowError }, 400);
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
    },
    callbackRouter: copilotProvider.router,
    callbackRedirectPath: (suffix) => `/api/copilot/callback${suffix}`,
  },
  aistudio: {
    provider: "aistudio",
    startFlows: ["manual_key"],
    supportsManualCallback: false,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["manual_key"]);
      if (error) return c.json({ error }, 400);
      return c.json({
        flow: "manual_key",
        provider,
        mode: "manual_key",
        message: "请通过 /api/credentials/auth/aistudio/save 提交 API Key 或服务账号。",
      });
    },
    callbackRedirectPath: (suffix) => `/api/credentials${suffix}`,
  },
  vertex: {
    provider: "vertex",
    startFlows: ["service_account"],
    supportsManualCallback: false,
    start: async ({ c, provider, capability }) => {
      const error = requireStartFlow(capability, provider, ["service_account"]);
      if (error) return c.json({ error }, 400);
      return c.json({
        flow: "service_account",
        provider,
        mode: "service_account",
        message: "请通过 /api/credentials/auth/vertex/save 提交服务账号 JSON。",
      });
    },
    callbackRedirectPath: (suffix) => `/api/credentials${suffix}`,
  },
};

export function getProviderRuntimeAdapter(provider: string): ProviderRuntimeAdapter | null {
  return ADAPTERS[provider] || null;
}

export function supportsProviderManualCallback(provider: string): boolean {
  const adapter = ADAPTERS[provider];
  if (!adapter) return false;
  if (typeof adapter.supportsManualCallback === "boolean") {
    return adapter.supportsManualCallback;
  }
  return Boolean(adapter.callbackRouter);
}

export function resolveProviderCallbackRouter(provider: string): RuntimeRouter | null {
  return ADAPTERS[provider]?.callbackRouter || null;
}

export function resolveProviderCallbackRedirectPath(
  provider: string,
  suffix: string,
): string | null {
  const adapter = ADAPTERS[provider];
  if (!adapter?.callbackRedirectPath) {
    return null;
  }
  return adapter.callbackRedirectPath(suffix);
}

export function validateCapabilityRuntimeHealth(
  capabilityMap: ProviderCapabilityMap,
): CapabilityRuntimeHealth {
  const issues: CapabilityRuntimeIssue[] = [];
  const providers = Array.from(
    new Set([...Object.keys(capabilityMap), ...Object.keys(ADAPTERS)]),
  ).sort();

  for (const provider of providers) {
    const capability = capabilityMap[provider];
    const adapter = ADAPTERS[provider];

    if (capability && !adapter) {
      issues.push({
        provider,
        code: "adapter_missing_capability",
        message: `${provider} 已存在能力图谱，但缺少运行时适配器`,
        capability: {
          flows: capability.flows,
          supportsManualCallback: capability.supportsManualCallback,
        },
      });
      continue;
    }

    if (!capability && adapter) {
      issues.push({
        provider,
        code: "capability_missing_adapter",
        message: `${provider} 已存在运行时适配器，但缺少能力图谱`,
        runtime: {
          startFlows: adapter.startFlows,
          pollFlows: adapter.pollFlows || [],
          supportsManualCallback: supportsProviderManualCallback(provider),
        },
      });
      continue;
    }

    if (!capability || !adapter) continue;

    const startMissing = adapter.startFlows.filter(
      (flow) => !capability.flows.includes(flow),
    );
    if (startMissing.length > 0) {
      issues.push({
        provider,
        code: "start_flows_mismatch",
        message: `${provider} start flow 与能力图谱不一致: ${startMissing.join(",")}`,
        capability: {
          flows: capability.flows,
          supportsManualCallback: capability.supportsManualCallback,
        },
        runtime: {
          startFlows: adapter.startFlows,
          pollFlows: adapter.pollFlows || [],
          supportsManualCallback: supportsProviderManualCallback(provider),
        },
      });
    }

    const runtimePollFlows = adapter.pollFlows || [];
    const pollMissing = runtimePollFlows.filter(
      (flow) => !capability.flows.includes(flow),
    );
    if (pollMissing.length > 0) {
      issues.push({
        provider,
        code: "poll_flows_mismatch",
        message: `${provider} poll flow 与能力图谱不一致: ${pollMissing.join(",")}`,
        capability: {
          flows: capability.flows,
          supportsManualCallback: capability.supportsManualCallback,
        },
        runtime: {
          startFlows: adapter.startFlows,
          pollFlows: runtimePollFlows,
          supportsManualCallback: supportsProviderManualCallback(provider),
        },
      });
    }

    const runtimeManual = supportsProviderManualCallback(provider);
    if (capability.supportsManualCallback !== runtimeManual) {
      issues.push({
        provider,
        code: "manual_callback_mismatch",
        message:
          `${provider} manual callback 能力不一致: capability=${capability.supportsManualCallback} ` +
          `runtime=${runtimeManual}`,
        capability: {
          flows: capability.flows,
          supportsManualCallback: capability.supportsManualCallback,
        },
        runtime: {
          startFlows: adapter.startFlows,
          pollFlows: runtimePollFlows,
          supportsManualCallback: runtimeManual,
        },
      });
    }
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    issueCount: issues.length,
    issues,
  };
}
