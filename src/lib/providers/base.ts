import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { TokenManager } from "../auth/token_manager";
import { OAuthService } from "../auth/oauth-client";
import type { AuthConfig, TokenResponse } from "../auth/oauth-client";
import { logger } from "../logger";
import { fetchWithRetry, HTTPError } from "../http";

import { IdentityResolver } from "../auth/identity-resolver";

export interface ChatRequest {
  messages?: any[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system?: any;
  stream?: boolean;
  [key: string]: any;
}

export interface RequestInterceptor {
  name: string;
  transform: (
    body: ChatRequest,
    headers: Record<string, string>,
  ) => Promise<{ body: any; headers: Record<string, string> }>;
}

export abstract class BaseProvider {
  protected abstract providerId: string;
  protected abstract authConfig: AuthConfig;
  protected abstract endpoint: string;

  protected requestPipeline: RequestInterceptor[] = [];
  protected oauthService!: OAuthService;
  public router: Hono;

  constructor() {
    this.router = new Hono();
    // 延迟初始化 oauthService 以允许子类先定义 authConfig
  }

  protected init() {
    this.oauthService = new OAuthService(this.authConfig);
    this.setupRoutes();
  }

  protected setupRoutes() {
    // 1. 认证 URL
    this.router.get("/auth/url", (c) => this.handleAuthUrl(c));

    // 2. 回调
    this.router.get("/callback", (c) => this.handleCallback(c));

    // 3. 聊天补全 (标准 OpenAI 接口)
    this.router.post("/v1/chat/completions", (c) =>
      this.handleChatCompletion(c),
    );

    // 4. 设备流轮询 (可选)
    this.router.post("/auth/poll", (c) => this.handleDevicePoll(c));

    // 5. 手动回调 (SSH/远程的后备方案)
    this.router.post("/auth/callback/manual", (c) =>
      this.handleManualCallback(c),
    );

    // 6. 遗留/特定端点 (可选覆盖)
    this.setupAdditionalRoutes(this.router);
  }

  protected setupAdditionalRoutes(router: Hono) {
    // 覆盖以添加特定于提供商的路由
  }

  // --- 自定义逻辑的模板方法 ---

  protected abstract getCustomHeaders(
    token: string,
    body: any,
    context?: any,
  ): Promise<Record<string, string>>;

  /**
   * @deprecated 使用 requestPipeline 进行原子转换。
   * 仍然可以用于复杂的遗留逻辑。
   */
  protected async transformRequest(
    body: ChatRequest,
    headers?: any,
    context?: any,
  ): Promise<any> {
    return body;
  }

  protected abstract transformResponse(response: Response): Promise<Response>;

  public async getModels(token: string): Promise<{ id: string; name: string; provider: string }[]> {
    return [];
  }

  protected async fetchUserInfo(token: string): Promise<any> {
    return null;
  }

  // --- Auth Handlers ---

  protected async handleAuthUrl(c: Context): Promise<Response> {
    const { url, state, verifier } = this.oauthService.generateAuthUrl();

    const isProd = process.env.NODE_ENV === "production";
    const secureFlag = isProd ? "; Secure" : "";

    // 设置 Cookies
    c.header(
      "Set-Cookie",
      `${this.providerId}_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secureFlag}`,
    );
    if (verifier) {
      c.header(
        "Set-Cookie",
        `${this.providerId}_verifier=${verifier}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secureFlag}`,
        { append: true },
      );
    }

    return c.json({ url });
  }

  protected async handleCallback(c: Context) {
    // ... (existing code) ...
    // 注意：我将新方法追加在 handleCallback 之后
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) return c.json({ error }, 400);
    if (!code) return c.json({ error: "No code provided" }, 400);

    // 验证 State
    const cookie = c.req.header("Cookie");
    const storedState = cookie?.match(
      new RegExp(`${this.providerId}_state=([^;]+)`),
    )?.[1];

    // 严格的 state 检查
    if (!storedState || state !== storedState) {
      return c.json({ error: "Invalid State (CSRF Protection)" }, 403);
    }

    // 如果是 PKCE 则获取 Verifier
    const verifier = cookie?.match(
      new RegExp(`${this.providerId}_verifier=([^;]+)`),
    )?.[1];

    try {
      const tokenData = await this.oauthService.exchangeCodeForToken(
        code,
        verifier,
      );
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      logger.error(`${this.providerId} Auth Failed: ${e.message}`);
      return c.json({ error: "Auth Failed", details: e.message }, 500);
    }
  }

  protected async handleManualCallback(c: Context) {
    const { url } = await c.req.json();
    if (!url) return c.json({ error: "No URL provided" }, 400);

    try {
      const parsed = new URL(
        url.startsWith("http") ? url : `http://localhost?${url}`,
      );
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");

      if (!code) throw new Error("Could not find 'code' in URL");

      // 对于手动回调，我们可能会跳过 CSRF 检查或假设用户知道他们在做什么。
      // 但如果是 PKCE，我们仍然需要 verifier。
      const cookie = c.req.header("Cookie");
      const verifier = cookie?.match(
        new RegExp(`${this.providerId}_verifier=([^;]+)`),
      )?.[1];

      const tokenData = await this.oauthService.exchangeCodeForToken(
        code,
        verifier,
      );
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      return c.json(
        { error: "Manual Callback Failed", details: e.message },
        400,
      );
    }
  }

  protected async handleDevicePoll(c: Context): Promise<Response> {
    const { device_code } = await c.req.json();
    if (!device_code) return c.json({ error: "No device_code provided" }, 400);

    try {
      const tokenData = await this.pollDeviceToken(device_code);
      if (!tokenData) {
        // 轮询中... (标准的 400 'authorization_pending' 通常在 pollDeviceToken 内部处理或返回)
        // 如果我们返回 null，意味着继续等待？
        // 让我们假设 pollDeviceToken 抛出错误或返回成功数据。
        return c.json({ status: "pending" }, 202);
      }
      // 成功
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      if (e.message.includes("pending") || e.message.includes("slow_down")) {
        return c.json({ status: "pending", details: e.message }, 202);
      }
      return c.json({ error: e.message }, 400);
    }
  }

  protected async finalizeAuth(c: Context, tokenData: TokenResponse) {
    // 使用智能身份解析器提取用户信息
    const identity = await IdentityResolver.resolve(tokenData, (token) =>
      this.fetchUserInfo(token),
    );

    // 保存凭据
    await this.oauthService.saveCredentials(tokenData, identity.email, {
      ...identity,
      ...tokenData,
      attributes: identity.attributes || {},
    });

    if (c.req.path.includes("poll")) {
      return c.json({ success: true, user: identity.email });
    }
    return c.html(
      `<html><body><h1>Auth Successful</h1><p>${this.providerId} connected as ${identity.email || "User"}</p>
      <script>
        try {
          window.opener.postMessage({ type: "oauth-success", provider: "${this.providerId}" }, "*");
        } catch (e) {}
        setTimeout(() => window.close(), 2000);
      </script></body></html>`,
    );
  }

  protected async getEndpoint(token: string, context?: any): Promise<string> {
    return this.endpoint;
  }

  // --- 设备流钩子 (可选) ---

  protected async startDeviceFlow(): Promise<any> {
    throw new Error("Device Flow not supported by this provider");
  }

  protected async pollDeviceToken(deviceCode: string): Promise<any> {
    throw new Error("Device Flow polling not supported");
  }

  /**
   * 能力：自定义令牌刷新逻辑
   * 默认使用 OAuthService 标准流水。子类可覆盖以处理非标准逻辑（如 Copilot）。
   */
  protected async refreshToken(refreshToken: string): Promise<TokenResponse> {
    return await this.oauthService.refreshToken(refreshToken);
  }

  // --- 聊天处理程序 ---

  protected async handleChatCompletion(c: Context) {
    try {
      // 1. 获取令牌（自动刷新）
      // 使用 TokenManager（现在应使用 OAuthService 进行刷新）
      // 目前，我们将手动实施基于 fetch 的刷新逻辑或挂钩到 TokenManager
      // 在 token_manager.ts 中定义。理想情况下，TokenManager 应允许自定义刷新器。

      // 目前的临时方案：如果尚未注册，我们需要将此提供商的刷新器注册到 TokenManager
      // 或者我们在此处使用自定义刷新器回调调用 TokenManager。

      const refreshFn = async (rt: string) => {
        return await this.refreshToken(rt);
      };

      const cred = await TokenManager.getValidToken(this.providerId, refreshFn);

      if (!cred) {
        return c.json(
          { error: `No authenticated ${this.providerId} account` },
          401,
        );
      }

      const token = cred.accessToken;
      const authContext = cred.metadata;

      // 2. 通过管道转换请求
      let currentBody = (await c.req.json()) as ChatRequest;
      let currentHeaders = { ...c.req.header() };

      // 运行管道
      for (const interceptor of this.requestPipeline) {
        const result = await interceptor.transform(currentBody, currentHeaders);
        currentBody = result.body;
        currentHeaders = { ...currentHeaders, ...result.headers };
      }

      // 如果仍在使用，回退到遗留的 transformRequest
      // 如果需要，将 metadata 传递给 transformRequest
      const finalPayload = await this.transformRequest(
        currentBody,
        currentHeaders,
        authContext,
      );

      // 3. 获取标头
      const headers = await this.getCustomHeaders(
        token,
        finalPayload,
        authContext,
      );

      // 4. 获取端点
      const endpoint = await this.getEndpoint(token, authContext);

      // 5. 发送请求
      const response = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(finalPayload),
      });

      if (!response.ok) {
        // 检查 401 并可能强制清除令牌？
        if (response.status === 401) {
          // 使令牌失效？
        }
        const text = await response.text();
        return new Response(text, {
          status: response.status,
          headers: response.headers,
        });
      }

      // 5. 转换响应
      return await this.transformResponse(response);
    } catch (e: any) {
      logger.error(`${this.providerId} Chat Error: ${e.message}`);

      if (e instanceof HTTPError) {
        // 传递上游状态码和头部 (尤其是 Retry-After)
        return new Response(e.body, {
          status: e.status,
          headers: e.headers,
        });
      }

      return c.json({ error: e.message }, 500);
    }
  }
}
