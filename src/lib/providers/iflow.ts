import { BaseProvider } from "./base";
import type { ChatRequest } from "./base";
import type { AuthConfig } from "../auth/oauth-client";

const IFLOW_CLIENT_ID = "10009311001";
const IFLOW_CLIENT_SECRET =
  process.env.IFLOW_CLIENT_SECRET || "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW";
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

  protected override async transformResponse(
    response: Response,
  ): Promise<Response> {
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
}

const iflowProvider = new IFlowProvider();
export default iflowProvider.router;
