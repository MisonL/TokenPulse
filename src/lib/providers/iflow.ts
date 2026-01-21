import { BaseProvider } from "./base";
import type { ChatRequest } from "./base";
import type { AuthConfig } from "../auth/oauth-client";
import { config } from "../../config";
import { logger } from "../logger";
import { fetchWithRetry } from "../http";

const IFLOW_CLIENT_ID = config.iflow.clientId;
const IFLOW_CLIENT_SECRET = config.iflow.clientSecret;
const AUTH_URL = "https://iflow.cn/oauth";
const TOKEN_URL = "https://iflow.cn/oauth/token";
const REDIRECT_URI = `http://localhost:11451/oauth2callback`;

export class IFlowProvider extends BaseProvider {
  protected providerId = "iflow";
  protected endpoint = "https://apis.iflow.cn/v1/chat/completions";

  protected authConfig: AuthConfig = {
    providerId: "iflow",
    clientId: IFLOW_CLIENT_ID,
    clientSecret: IFLOW_CLIENT_SECRET,
    authUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    redirectUri: REDIRECT_URI,
    scopes: [],
    customAuthParams: {
      loginMethod: "phone",
      type: "phone",
    },
  };

  constructor() {
    super();
    this.init();
  }

  protected override async getCustomHeaders(
    token: string,
    body: any,
    context?: any,
  ): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "iFlow-Cli",
    };
  }

  /**
   * 最优实现：利用基类能力处理 Basic Auth
   */
  protected override async handleCallback(c: any) {
    const code = c.req.query("code");
    if (!code) return super.handleCallback(c);

    try {
      // 使用 'basic' 模式进行令牌交换
      const tokenData = await this.oauthService.exchangeCodeForToken(
        code,
        undefined,
        "basic",
      );
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  }

  protected override async fetchUserInfo(token: string): Promise<any> {
    try {
      const resp = await fetch(
        `https://iflow.cn/api/oauth/getUserInfo?accessToken=${token}`,
      );
      if (resp.ok) {
        const data = (await resp.json()) as any;
        if (data.success && data.data) {
          return {
            email: data.data.email || data.data.phone || "iflow-user",
            id: data.data.apiKey,
            attributes: {
              api_key: data.data.apiKey,
              phone: data.data.phone,
            },
            metadata: {
              phone: data.data.phone,
            },
          };
        }
      }
    } catch (e) {}
    return null;
  }

  protected override async transformRequest(
    body: ChatRequest,
    headers?: any,
    context?: any,
  ): Promise<any> {
    const payload: any = { ...body };
    const model = (body.model || "").toLowerCase();
    const effort = (body as any).reasoning_effort || "medium";

    // 1. Thinking Mode Mapping
    if (effort !== "none") {
      if (model.includes("glm-4") || model.includes("cogview")) {
        // Zhipu GLM Thinking Mode
        payload.chat_template_kwargs = {
          ...payload.chat_template_kwargs,
          enable_thinking: true
        };
      } else if (model.includes("minimax") || model.includes("m2")) {
        // MiniMax Thinking Mode
        payload.reasoning_split = true;
      }
    }

    // 2. Placeholder Tool (Reference: ensureToolsArray)
    // To prevent "poisoning" or random token insertion in some iFlow models
    if (!payload.tools || payload.tools.length === 0) {
      // Logic from CLIProxyAPI: inject a non-functional tool 
      // but only for specific models if needed? for now general.
    }

    return payload;
  }

  protected override async transformResponse(
    response: Response,
  ): Promise<Response> {
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  public override async getModels(token: string): Promise<{ id: string; name: string; provider: string }[]> {
    try {
      // iFlow OIDC Discovery / UserInfo
      const resp = await fetchWithRetry(
        "https://apis.iflow.cn/v1/user/info",
        {
          headers: { Authorization: `Bearer ${token}` },
          // @ts-ignore - Bun specific
          tls: { rejectUnauthorized: false }
        },
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const models = (data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
          provider: "iflow"
        }));
        if (models.length > 0) return models;
      }
    } catch (e) {
      // ignore
    }

    // Fallback to static list (2026 version)
    return [
      { id: "claude-3-5-sonnet@anthropic", name: "Claude 3.5 Sonnet", provider: "iflow" },
      { id: "claude-3-7-sonnet@anthropic", name: "Claude 3.7 Sonnet (Latest)", provider: "iflow" },
      { id: "gpt-4o@openai", name: "GPT-4o", provider: "iflow" },
      { id: "o3-mini@openai", name: "o3 Mini", provider: "iflow" },
      { id: "deepseek-chat", name: "DeepSeek Chat", provider: "iflow" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner", provider: "iflow" },
    ];
  }
}

const iflowProvider = new IFlowProvider();
export { iflowProvider };
export default iflowProvider.router;
