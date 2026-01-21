import { BaseProvider } from "./base";
import type { ChatRequest } from "./base";
import type { AuthConfig, TokenResponse } from "../auth/oauth-client";
import { fetchWithRetry } from "../http";
import { config } from "../../config";
import { decodeJwt } from "./utils";

const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const DEVICE_AUTH_URL = "https://chat.qwen.ai/api/v1/oauth2/device/code";
const TOKEN_URL = "https://chat.qwen.ai/api/v1/oauth2/token";
// const BASE_URL_DEFAULT = 'https://portal.qwen.ai/v1'; // Legacy
const BASE_URL_DEFAULT = "https://chat.qwen.ai/api/v1"; // Reference implies this for token, maybe for chat too?
// Note: Reference `qwen_executor.go` uses `https://chat.qwen.ai/api/v1/chat/completions` ?
import type { Context } from "hono";
import { logger } from "../logger";
import { ToolPoisonerInterceptor } from "./atoms/tool-poisoner";

export class QwenProvider extends BaseProvider {
  protected providerId = "qwen";
  protected endpoint = "https://chat.qwen.ai/api/v1/chat/completions";

  protected authConfig: AuthConfig = {
    providerId: "qwen",
    clientId: "f0304373b74a44d2b584a3fb70ca9e56",
    authUrl: "https://chat.qwen.ai/api/v1/oauth2/device/code", // 实际上是 Device EndPoint
    tokenUrl: "https://chat.qwen.ai/api/v1/oauth2/token",
    redirectUri: "http://localhost:54545/callback",
    scopes: ["openid", "profile", "email", "model.completion"],
    usePkce: true,
  };

  constructor() {
    super();
    this.init();
    // 挂载原子管道：工具投毒
    this.requestPipeline.push(new ToolPoisonerInterceptor("do_not_call_me"));
  }

  protected override async getCustomHeaders(
    token: string,
    body: any,
    context?: any,
  ): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${token}`,
      "User-Agent": "google-api-nodejs-client/9.15.1",
      "X-Goog-Api-Client": "gl-node/22.17.0",
      "Client-Metadata":
        "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
      "Content-Type": "application/json",
    };
  }

  protected override async transformResponse(
    response: Response,
  ): Promise<Response> {
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  /**
   * Override handleAuthUrl to support Qwen's Device Code Flow with PKCE
   * Logic matches CLIProxyAPI/internal/auth/qwen/qwen_auth.go
   */
  protected override async startDeviceFlow(): Promise<any> {
    try {
      // 1. Generate PKCE Pair (removed from this step, handled by oauthService)
      // 2. Initiate Device Flow (Must use x-www-form-urlencoded)
      const resp = await fetchWithRetry(this.authConfig.authUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.authConfig.clientId,
          scope: this.authConfig.scopes.join(" "),
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Device flow init failed: ${resp.status} ${text}`);
      }

      const data = (await resp.json()) as any;

      // 3. Return info to client (including verifier for polling)
      return {
        url: data.verification_uri_complete || data.verification_uri,
        code: data.user_code,
        device_code: data.device_code,
        verification_uri: data.verification_uri,
      };
    } catch (e: any) {
      logger.error("Qwen Auth Url Error:", e);
      throw e;
    }
  }

  /**
   * Override handleDevicePoll to support Qwen's Device code polling with PKCE verification
   */
  protected override async pollDeviceToken(
    deviceCode: string,
    codeVerifier?: string,
  ): Promise<TokenResponse> {
    if (!deviceCode) throw new Error("No device_code provided");

    try {
      // Poll for token (Must use x-www-form-urlencoded)
      const resp = await fetchWithRetry(this.authConfig.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.authConfig.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          code_verifier: codeVerifier || "",
        }),
      });

      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as any;
        const error = data.error || "unknown_error";

        // Standard OAuth 2.0 Device Flow Errors
        if (error === "authorization_pending" || error === "slow_down") {
          throw new Error(error); // Re-throw to be caught by the oauthService
        }

        const text = JSON.stringify(data);
        throw new Error(`Token poll failed: ${resp.status} ${text}`);
      }

      const tokenData = (await resp.json()) as TokenResponse;
      return tokenData;
    } catch (e: any) {
      logger.error("Qwen Device Poll Error:", e);
      throw e;
    }
  }

  protected override async transformRequest(
    body: ChatRequest,
    headers?: any,
    context?: any,
  ): Promise<any> {
    const payload: any = { ...body };
    const effort = (body as any).reasoning_effort || "medium";

    // 1. Thinking Mode Mapping
    if (effort !== "none") {
       // Qwen specific thinking config could go here if DashScope supports it via OpenAI compatible fields
       // For now, reasoning_effort might be passed through if the backend supports it.
    }

    // 2. Tool Poisoning Prevention (Placeholder Tool)
    // Reference: inject dummy tool if no tools defined to prevent random tokens in streaming
    if (!payload.tools || payload.tools.length === 0) {
      payload.tools = [
        {
          type: "function",
          function: {
            name: "do_not_call_me",
            description: "A placeholder tool to stabilize reasoning output flow. Do not call this tool.",
            parameters: { type: "object", properties: {} }
          }
        }
      ];
      payload.tool_choice = "none";
    }

    return payload;
  }

  public override async getModels(token: string): Promise<{ id: string; name: string; provider: string }[]> {
    try {
      // Bailian / DashScope Model List API ?
      const resp = await fetchWithRetry("https://dashscope.aliyuncs.com/compatible-mode/v1/models", {
         headers: { Authorization: `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        return (data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
          provider: "alibaba"
        }));
      }
    } catch (e) {
      // continue to fallback
    }
    
    // Fallback to static list (2026 version)
    return [
      { id: "qwen-max-2025-01", name: "Qwen Max (Latest)", provider: "alibaba" },
      { id: "qwen-plus-2025-01", name: "Qwen Plus (Latest)", provider: "alibaba" },
      { id: "qwen-turbo-latest", name: "Qwen Turbo Latest", provider: "alibaba" },
      { id: "qv-max", name: "QV Max (Reasoning)", provider: "alibaba" },
      { id: "qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", provider: "alibaba" },
    ];
  }

  protected override async fetchUserInfo(
    token: string,
  ): Promise<{
    email?: string;
    id?: string;
    metadata?: Record<string, any>;
    attributes?: any;
  }> {
    try {
      const tokenData = decodeJwt(token);
      const alias = tokenData?.metadata?.alias || tokenData?.metadata?.username;
      const email = tokenData?.metadata?.email;

      const result: any = { id: tokenData.sub };

      if (email) {
        result.email = email;
      } else if (alias) {
        result.email = `${alias}@qwen.local`;
      } else if (tokenData?.sub) {
        result.email = `qwen-${String(tokenData.sub).substring(0, 8)}@generated.local`;
      }

      result.attributes = {
        alias: alias,
        email: email,
        sub: tokenData.sub,
      };

      return result;
    } catch (e) {
      // ignore
    }
    return {};
  }
}

const qwenProvider = new QwenProvider();
export { qwenProvider };
export default qwenProvider.router;
