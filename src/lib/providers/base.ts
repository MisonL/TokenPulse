import { Hono } from "hono";
import type { Context } from "hono";
import { TokenManager } from "../auth/token_manager";
import { OAuthService } from "../auth/oauth-client";
import type { AuthConfig, TokenResponse } from "../auth/oauth-client";
import { logger } from "../logger";
import { fetchWithRetry, HTTPError } from "../http";
import { oauthSessionStore } from "../auth/oauth-session-store";
import {
  parseManualCallbackUrl,
  parseOAuthCallback,
} from "../auth/oauth-callback";
import { config } from "../../config";
import {
  getOAuthSelectionConfig,
  type TokenSelectionPolicy,
} from "../oauth-selection-policy";
import {
  getRequestTraceId,
  getRequestedAccountId,
  getRequestedSelectionPolicy,
  setSelectedAccountId,
} from "../../middleware/request-context";

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

function normalizeSelectionPolicy(value: string): TokenSelectionPolicy | null {
  const normalized = (value || "").trim().toLowerCase();
  if (
    normalized === "round_robin" ||
    normalized === "latest_valid" ||
    normalized === "sticky_user"
  ) {
    return normalized;
  }
  return null;
}

function shouldRetryWithAnotherAccount(status: number): boolean {
  if (!Number.isFinite(status)) return false;
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

interface ClaudeBridgeCircuitState {
  failures: number;
  openedAt: number;
}

const claudeBridgeCircuit: ClaudeBridgeCircuitState = {
  failures: 0,
  openedAt: 0,
};

function isClaudeBridgeFallbackError(status: number, bodyText: string): boolean {
  if (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  ) {
    return true;
  }

  const text = (bodyText || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("cloudflare") ||
    text.includes("cf-ray") ||
    text.includes("attention required") ||
    text.includes("just a moment") ||
    text.includes("captcha") ||
    text.includes("tls") ||
    text.includes("handshake")
  );
}

function isClaudeBridgeCircuitOpen(): boolean {
  if (!claudeBridgeCircuit.openedAt) return false;
  const cooldownMs = config.claudeTransport.bridgeCircuitCooldownSec * 1000;
  if (Date.now() - claudeBridgeCircuit.openedAt >= cooldownMs) {
    claudeBridgeCircuit.failures = 0;
    claudeBridgeCircuit.openedAt = 0;
    return false;
  }
  return true;
}

function markClaudeBridgeSuccess() {
  claudeBridgeCircuit.failures = 0;
  claudeBridgeCircuit.openedAt = 0;
}

function markClaudeBridgeFailure() {
  claudeBridgeCircuit.failures += 1;
  if (claudeBridgeCircuit.failures >= config.claudeTransport.bridgeCircuitThreshold) {
    claudeBridgeCircuit.openedAt = Date.now();
  }
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

  public async getModels(
    token: string,
    _context?: { attributes?: Record<string, string> },
  ): Promise<{ id: string; name: string; provider: string }[]> {
    return [];
  }

  protected async fetchUserInfo(token: string): Promise<any> {
    return null;
  }


  protected async handleAuthUrl(c: Context): Promise<Response> {
    const { url, state, verifier } = this.oauthService.generateAuthUrl();
    await oauthSessionStore.register(state, this.providerId, verifier);

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

  /**
   * 公开包装器：供统一 OAuth 路由复用
   */
  public async startOAuth(c: Context): Promise<Response> {
    return this.handleAuthUrl(c);
  }

  /**
   * 公开包装器：供统一 OAuth 路由复用
   */
  public async pollOAuth(c: Context): Promise<Response> {
    return this.handleDevicePoll(c);
  }

  /**
   * 公开包装器：供统一 OAuth 路由复用
   */
  public async completeOAuth(c: Context): Promise<Response> {
    return this.handleCallback(c);
  }

  /**
   * 公开包装器：供统一 OAuth 路由复用
   */
  public async completeOAuthManual(c: Context): Promise<Response> {
    return this.handleManualCallback(c);
  }

  protected async handleCallback(c: Context) {
    const rawCode = c.req.query("code");
    const rawState = c.req.query("state");
    const error = c.req.query("error");
    const { code, state } = parseOAuthCallback(rawCode, rawState);

    if (error) return c.json({ error }, 400);
    if (!code) return c.json({ error: "缺少授权码" }, 400);

    // 验证 State
    const cookie = c.req.header("Cookie");
    const storedState = cookie?.match(
      new RegExp(`${this.providerId}_state=([^;]+)`),
    )?.[1];

    // Cookie + 服务端会话双重校验，防止 CSRF 与伪造回调。
    if (!storedState || !state || state !== storedState) {
      return c.json({ error: "状态校验失败（CSRF 防护）" }, 403);
    }
    if (!(await oauthSessionStore.isPending(state, this.providerId))) {
      return c.json({ error: "授权会话不存在或已过期" }, 403);
    }

    // 如果是 PKCE 则获取 Verifier
    const verifierFromCookie = cookie?.match(
      new RegExp(`${this.providerId}_verifier=([^;]+)`),
    )?.[1];
    const session = await oauthSessionStore.get(state);
    const verifier = verifierFromCookie || session?.verifier;

    try {
      const tokenData = await this.oauthService.exchangeCodeForToken(
        code,
        verifier,
      );
      await oauthSessionStore.complete(state);
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      logger.error(`${this.providerId} 授权失败: ${e.message}`);
      await oauthSessionStore.markError(state, e.message);
      return c.json({ error: "授权失败", details: e.message }, 500);
    }
  }

  protected async handleManualCallback(c: Context) {
    const { url } = await c.req.json();
    if (!url) return c.json({ error: "缺少回调 URL" }, 400);

    try {
      const parsed = new URL(
        url.startsWith("http") ? url : `http://localhost?${url}`,
      );
      const { code, state } = parseManualCallbackUrl(parsed);

      if (!code) throw new Error("在 URL 中未找到 code 参数");

      const cookie = c.req.header("Cookie");
      const verifierFromCookie = cookie?.match(
        new RegExp(`${this.providerId}_verifier=([^;]+)`),
      )?.[1];
      let verifier = verifierFromCookie;
      if (state) {
        const session = await oauthSessionStore.get(state);
        if (!session || session.provider !== this.providerId) {
          throw new Error("授权会话不存在或已过期");
        }
        verifier = verifier || session.verifier;
      }

      const tokenData = await this.oauthService.exchangeCodeForToken(
        code,
        verifier,
      );
      if (state) await oauthSessionStore.complete(state);
      return await this.finalizeAuth(c, tokenData);
    } catch (e: any) {
      return c.json(
        { error: "手动回调处理失败", details: e.message },
        400,
      );
    }
  }

  protected async handleDevicePoll(c: Context): Promise<Response> {
    const { device_code } = await c.req.json();
    if (!device_code) return c.json({ error: "缺少 device_code" }, 400);

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

    const tokenAttributes =
      tokenData.attributes && typeof tokenData.attributes === "object"
        ? tokenData.attributes
        : {};
    const identityAttributes =
      identity.attributes && typeof identity.attributes === "object"
        ? identity.attributes
        : {};

    // 保存凭据
    await this.oauthService.saveCredentials(tokenData, identity.email, {
      ...identity,
      ...tokenData,
      attributes: {
        ...tokenAttributes,
        ...identityAttributes,
      },
    });

    if (c.req.path.includes("poll")) {
      return c.json({ success: true, user: identity.email });
    }
    return c.html(
      `<html><body><h1>授权成功</h1><p>${this.providerId} 已连接，账号：${identity.email || "用户"}</p>
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
    throw new Error("当前提供商不支持设备码流程");
  }

  protected async pollDeviceToken(deviceCode: string): Promise<any> {
    throw new Error("当前提供商不支持设备码轮询");
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
      const refreshFn = async (rt: string) => {
        return await this.refreshToken(rt);
      };
      const selectionConfig = await getOAuthSelectionConfig();
      const traceId = getRequestTraceId(c);
      const headerPolicy = normalizeSelectionPolicy(
        getRequestedSelectionPolicy(c) || "",
      );
      const canHeaderOverridePolicy =
        selectionConfig.allowHeaderOverride && config.trustProxy;
      const selectedPolicy = canHeaderOverridePolicy && headerPolicy
        ? headerPolicy
        : selectionConfig.defaultPolicy;
      const canHeaderOverrideAccount =
        selectionConfig.allowHeaderAccountOverride && config.trustProxy;
      const requestedAccountId = canHeaderOverrideAccount
        ? getRequestedAccountId(c)
        : undefined;
      const userKey =
        (c.req.header("x-tokenpulse-user") ||
          c.req.header("x-admin-user") ||
          "api-secret").trim() || "api-secret";
      const maxRetry = Math.max(
        0,
        Math.floor(selectionConfig.maxRetryOnAccountFailure || 0),
      );
      const skippedAccountIds: string[] = [];

      // 2. 通过管道转换请求
      let preparedBody = (await c.req.json()) as ChatRequest;
      let preparedHeaders = { ...c.req.header() };

      // 运行管道
      for (const interceptor of this.requestPipeline) {
        const result = await interceptor.transform(preparedBody, preparedHeaders);
        preparedBody = result.body;
        preparedHeaders = { ...preparedHeaders, ...result.headers };
      }

      for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
        const cred = await TokenManager.getValidToken(this.providerId, refreshFn, {
          policy: selectedPolicy,
          requestedAccountId,
          userKey,
          failureCooldownSec: selectionConfig.failureCooldownSec,
          skippedAccountIds,
        });

        if (!cred) {
          return c.json(
            { error: `No authenticated ${this.providerId} account` },
            401,
          );
        }

        const accountId = cred.accountId || "default";
        setSelectedAccountId(c, accountId);
        const token = cred.accessToken;
        const authMetadata = (cred.metadata || {}) as Record<string, any>;
        const authContext: Record<string, any> = {
          ...authMetadata,
          accountId,
          traceId,
        };

        const attemptBody = JSON.parse(JSON.stringify(preparedBody)) as ChatRequest;
        const attemptHeaders = { ...preparedHeaders };
        const finalPayload = await this.transformRequest(
          attemptBody,
          attemptHeaders,
          authContext,
        );

        const headers = await this.getCustomHeaders(
          token,
          finalPayload,
          authContext,
        );
        if (traceId) {
          headers["X-Request-Id"] = traceId;
          headers["X-TokenPulse-Process-Id"] = traceId;
        }

        const endpoint = await this.getEndpoint(token, authContext);
        let response = await fetchWithRetry(endpoint, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(finalPayload),
        });

        if (!response.ok) {
          // Claude 兼容回退：Bearer 失败时，若存在 attributes.api_key，则自动重试一次 x-api-key
          const fallbackApiKey = authContext?.attributes?.api_key;
          const hasBearerHeader =
            Boolean(headers.Authorization) || Boolean(headers.authorization);
          const hasApiKeyHeader =
            Boolean((headers as any)["x-api-key"]) ||
            Boolean((headers as any)["X-Api-Key"]) ||
            Boolean((headers as any)["X-API-Key"]);
          const shouldRetryWithApiKey =
            this.providerId === "claude" &&
            (response.status === 401 || response.status === 403) &&
            !hasApiKeyHeader &&
            hasBearerHeader &&
            typeof fallbackApiKey === "string" &&
            fallbackApiKey.length > 0;

          if (shouldRetryWithApiKey) {
            logger.warn(
              "[Claude] Bearer 调用失败，尝试使用 API Key 回退重试一次",
              "Provider",
            );
            const fallbackHeaders = { ...headers, "x-api-key": fallbackApiKey };
            delete (fallbackHeaders as any).Authorization;
            delete (fallbackHeaders as any).authorization;

            response = await fetchWithRetry(endpoint, {
              method: "POST",
              headers: fallbackHeaders,
              body: JSON.stringify(finalPayload),
            });
          }

          if (response.ok) {
            await TokenManager.clearFailureByCredentialId(cred.id);
            return await this.transformResponse(response);
          }

          const responseTextForFallback = await response
            .clone()
            .text()
            .catch(() => "");
          const fallbackEligible = isClaudeBridgeFallbackError(
            response.status,
            responseTextForFallback,
          );
          const circuitOpen = isClaudeBridgeCircuitOpen();

          // Claude 传输降级：strict 模式下遇到可降级错误时，自动尝试 bridge。
          const shouldRetryWithBridge =
            this.providerId === "claude" &&
            config.claudeTransport.tlsMode === "strict" &&
            typeof config.claudeTransport.bridgeUrl === "string" &&
            config.claudeTransport.bridgeUrl.length > 0 &&
            fallbackEligible &&
            !circuitOpen;

          if (
            this.providerId === "claude" &&
            config.claudeTransport.tlsMode === "strict" &&
            circuitOpen &&
            fallbackEligible
          ) {
            logger.warn(
              "[Claude] bridge 熔断器开启中，跳过降级重试",
              "Provider",
            );
          }

          if (shouldRetryWithBridge) {
            try {
              const bridgeBase = config.claudeTransport.bridgeUrl.replace(/\/$/, "");
              const bridgeEndpoint = `${bridgeBase}/v1/messages?beta=true`;
              const bridgeHeaders = {
                ...headers,
                "X-TokenPulse-Claude-Fallback": "bridge",
              };
              logger.warn(
                "[Claude] 严格链路调用失败，触发 bridge 端点回退",
                "Provider",
              );
              const bridgeResponse = await fetchWithRetry(bridgeEndpoint, {
                method: "POST",
                headers: bridgeHeaders,
                body: JSON.stringify(finalPayload),
                retries: config.claudeTransport.bridgeMaxRetries,
                signal: AbortSignal.timeout(config.claudeTransport.bridgeTimeoutMs),
              });
              if (bridgeResponse.ok) {
                markClaudeBridgeSuccess();
                await TokenManager.clearFailureByCredentialId(cred.id);
                return await this.transformResponse(bridgeResponse);
              }
              markClaudeBridgeFailure();
              response = bridgeResponse;
            } catch (bridgeError: any) {
              markClaudeBridgeFailure();
              logger.warn(
                `[Claude] bridge 回退失败: ${bridgeError?.message || "unknown error"}`,
                "Provider",
              );
              // ignore and fall through with original response
            }
          }
        }

        if (response.ok) {
          await TokenManager.clearFailureByCredentialId(cred.id);
          return await this.transformResponse(response);
        }

        await TokenManager.markFailureByCredentialId(
          cred.id,
          `upstream:${response.status}`,
        );

        const shouldRetry =
          !requestedAccountId &&
          attempt < maxRetry &&
          shouldRetryWithAnotherAccount(response.status);
        if (shouldRetry) {
          skippedAccountIds.push(accountId);
          continue;
        }

        const text = await response.text();
        const outgoingHeaders = new Headers(response.headers);
        if (traceId) {
          outgoingHeaders.set("X-Request-Id", traceId);
        }
        return new Response(text, {
          status: response.status,
          headers: outgoingHeaders,
        });
      }

      return c.json(
        { error: `No authenticated ${this.providerId} account` },
        401,
      );
    } catch (e: any) {
      logger.error(`${this.providerId} 聊天请求失败: ${e.message}`);

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
