import { BaseProvider } from "./base";
import type { ChatRequest } from "./base";
import type { AuthConfig } from "../auth/oauth-client";
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
  protected override async handleAuthUrl(c: Context) {
    try {
      // 1. Generate PKCE Pair
      const { verifier, challenge } =
        await this.oauthService.generatePkcePair();

      // 2. Initiate Device Flow (Must use x-www-form-urlencoded)
      const params = new URLSearchParams({
        client_id: this.authConfig.clientId,
        scope: this.authConfig.scopes.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
      });

      const resp = await fetch(this.authConfig.authUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Device flow init failed: ${resp.status} ${text}`);
      }

      const data = (await resp.json()) as any;

      // 3. Return info to client (including verifier for polling)
      return c.json({
        url: data.verification_uri_complete || data.verification_uri,
        code: data.user_code,
        device_code: data.device_code,
        code_verifier: verifier, // Client must send this back when polling
        verification_uri: data.verification_uri,
      });
    } catch (e: any) {
      logger.error("Qwen Auth Url Error:", e);
      return c.json({ error: e.message }, 500);
    }
  }

  /**
   * Override handleDevicePoll to support Qwen's Device code polling with PKCE verification
   */
  protected override async handleDevicePoll(c: Context) {
    const { device_code, code_verifier } = await c.req.json();

    if (!device_code) return c.json({ error: "No device_code provided" }, 400);
    // code_verifier is technically required by Qwen but if missing we might fail.

    try {
      // Poll for token (Must use x-www-form-urlencoded)
      const params = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: this.authConfig.clientId,
        device_code: device_code,
        code_verifier: code_verifier || "",
      });

      const resp = await fetch(this.authConfig.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });

      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as any;
        const error = data.error || "unknown_error";

        // Standard OAuth 2.0 Device Flow Errors
        if (error === "authorization_pending" || error === "slow_down") {
          return c.json({ status: "pending" }, 202);
        }

        const text = JSON.stringify(data);
        throw new Error(`Token poll failed: ${resp.status} ${text}`);
      }

      const tokenData = (await resp.json()) as any;
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      // Pass through pending status if we caught it as an error
      if (
        e.message.includes("authorization_pending") ||
        e.message.includes("slow_down")
      ) {
        return c.json({ status: "pending" }, 202);
      }
      logger.error("Qwen Device Poll Error:", e);
      return c.json({ error: e.message }, 400);
    }
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
export default qwenProvider.router;
