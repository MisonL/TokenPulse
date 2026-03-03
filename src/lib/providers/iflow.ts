import { BaseProvider } from "./base";
import type { ChatRequest } from "./base";
import type { AuthConfig } from "../auth/oauth-client";
import { config } from "../../config";
import { logger } from "../logger";
import { fetchWithRetry } from "../http";
import { oauthSessionStore } from "../auth/oauth-session-store";
import { parseOAuthCallback } from "../auth/oauth-callback";

const IFLOW_CLIENT_ID = config.iflow.clientId;
const IFLOW_CLIENT_SECRET = config.iflow.clientSecret;
const AUTH_URL = "https://iflow.cn/oauth";
const TOKEN_URL = "https://iflow.cn/oauth/token";
const REDIRECT_URI = `${config.baseUrl}/api/iflow/callback`;

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
    const rawCode = c.req.query("code");
    const rawState = c.req.query("state");
    const error = c.req.query("error");
    const { code, state } = parseOAuthCallback(rawCode, rawState);

    if (error) {
      if (state) {
        await oauthSessionStore.markError(state, error);
      }
      return c.json({ error }, 400);
    }
    if (!code) return super.handleCallback(c);
    if (!state) {
      return c.json({ error: "状态校验失败（CSRF 防护）" }, 403);
    }

    const cookie = c.req.header("Cookie");
    const storedState =
      cookie?.match(/iflow_oauth_state=([^;]+)/)?.[1] ||
      cookie?.match(/iflow_state=([^;]+)/)?.[1];
    if (!storedState || storedState !== state) {
      return c.json({ error: "状态校验失败（CSRF 防护）" }, 403);
    }
    if (!(await oauthSessionStore.isPending(state, this.providerId))) {
      return c.json({ error: "授权会话不存在或已过期" }, 403);
    }

    try {
      await oauthSessionStore.setPhase(state, "exchanging");
      // 使用 'basic' 模式进行令牌交换
      const tokenData = await this.oauthService.exchangeCodeForToken(
        code,
        undefined,
        "basic",
      );
      await oauthSessionStore.complete(state);
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      await oauthSessionStore.markError(state, e.message || "授权失败");
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

    // 1. 思维模式映射
    if (effort !== "none") {
      if (model.includes("glm-4") || model.includes("cogview")) {
        payload.chat_template_kwargs = {
          ...payload.chat_template_kwargs,
          enable_thinking: true
        };
      } else if (model.includes("minimax") || model.includes("m2")) {
        payload.reasoning_split = true;
      }
    }

    // 2. 占位符工具 (参考: ensureToolsArray)
    // 防止在某些 iFlow 模型中发生“投毒”或随机令牌插入
    if (!payload.tools || payload.tools.length === 0) {
      // CLIProxyAPI 的逻辑：注入一个无功能的工具
      // 但仅在需要时针对特定模型？目前通用。
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
      // 仅当 UNSAFE_DISABLE_TLS_CHECK 显式开启时才禁用 TLS 校验
      const tlsOptions = config.allowInsecureTls
        ? { tls: { rejectUnauthorized: false } }
        : {};
      
      const resp = await fetchWithRetry(
        "https://apis.iflow.cn/v1/user/info",
        {
          headers: { Authorization: `Bearer ${token}` },
          ...tlsOptions
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
    }

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
