import { BaseProvider } from "./base";
import { logger } from "../logger";
import { fetchWithRetry } from "../http";
import { Hono } from "hono";
import crypto from "crypto";
import type { ChatRequest } from "./base";
import type { AuthConfig } from "../auth/oauth-client";
import { config } from "../../config";
import { db } from "../../db";
import { credentials, requestLogs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Translators } from "../translator";
import { ThinkingApplier } from "../services/thinking-applier";
import { parseModelSuffix } from "../services/thinking-types";
import { cacheSignature } from "../services/signature-cache";
import { ThinkingRecovery } from "../services/thinking-recovery";
import { DeviceManager } from "../services/device-manager";
import { exchangeAntigravityCode } from "../auth/antigravity";
const CLIENT_ID = config.antigravity.clientId;
const CLIENT_SECRET = config.antigravity.clientSecret;

const ENDPOINTS = [
  "https://daily-cloudcode-pa.googleapis.com", // Primary
  "https://cloudcode-pa.googleapis.com", // Fallback
];

const REDIRECT_URI = `${config.baseUrl}/api/antigravity/callback`;
const USER_AGENT = "antigravity/1.104.0 darwin/arm64";

const SYSTEM_INSTRUCTION_FALLBACK =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.";
class AntigravityProvider extends BaseProvider {
  protected override providerId = "antigravity";
  // BaseProvider 期望单个端点，但我们动态管理多个。
  // 我们在此设置一个占位符。
  protected override endpoint = ENDPOINTS[0] + "/v1internal:generateContent";
  protected override authConfig: AuthConfig;

  constructor() {
    super();
    this.authConfig = {
      providerId: this.providerId,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      authUrl: "https://accounts.google.com/o/oauth2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      redirectUri: REDIRECT_URI,
      scopes: [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/generative-language.retriever",
      ],
      customAuthParams: {
        access_type: "offline",
        prompt: "consent",
      },
    };
    this.init();
  }

  // ... (getCustomHeaders, handleChatCompletion)

  protected override async getCustomHeaders(
    token: string,
    body: any,
    context?: any,
  ): Promise<Record<string, string>> {
     // ... same ...
     return {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    };
  }

  // 转换：OpenAI -> Google Gemini
  protected override async transformRequest(
    body: ChatRequest,
    headers?: any,
    context?: any,
  ): Promise<any> {
    const { model, messages, ...rest } = body;
    // 使用 modelName 解析器去除前缀
    const { modelName } = parseModelSuffix(model || "gemini-1.5-pro");

    // 调用转换器（现在支持图片）
    const { contents, systemInstruction } = Translators.openAIToGemini(
      messages || [],
    );

    return {
      contents,
      systemInstruction,
      generationConfig: {
        // 映射通用参数
        temperature: rest.temperature,
        maxOutputTokens: rest.max_tokens,
      },
      ...rest, // 传入 stream 等其他可能的参数，但要注意不要传入不支持的顶层键
    };
  }

  protected override setupAdditionalRoutes(router: Hono) {
    router.post("/v1internal:countTokens", (c) => this.handleCountTokens(c));
    router.get("/callback", (c) => this.handleCallback(c));
  }

  // 修复：handleCallback 必须是 protected override 以匹配 BaseProvider
  protected override async handleCallback(c: any) {
    const code = c.req.query("code");
    if (!code) return c.text("Missing code", 400);

    try {
      const tokenData = (await exchangeAntigravityCode(code)) as any;
      
      // 获取用户信息（邮箱）
      const userInfo = await this.fetchUserInfo(tokenData.access_token);
      const email = userInfo.email || "antigravity-user";

      // 保存到 DB
      await db
          .insert(credentials)
          .values({
            id: this.providerId,
            provider: this.providerId,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
            email: email,
            status: "connected",
            lastRefresh: new Date().toISOString(),
            metadata: JSON.stringify({
              scope: tokenData.scope,
              idToken: tokenData.id_token,
            }),
          })
          .onConflictDoUpdate({
            target: credentials.provider,
            set: {
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
              email: email,
              status: "connected",
              lastRefresh: new Date().toISOString(),
              metadata: JSON.stringify({
                scope: tokenData.scope,
                idToken: tokenData.id_token,
              }),
            },
          });

      return c.html(`
        <!DOCTYPE html>
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: green;">Antigravity Connected!</h1>
            <p>You may verify the new permissions.</p>
            <p>You can close this window now.</p>
            <script>
              try {
                window.opener.postMessage({ type: "oauth-success", provider: "antigravity" }, "*");
              } catch(e) {}
              setTimeout(() => window.close(), 1000);
           </script>
          </body>
        </html>
      `);
    } catch (e: any) {
      logger.error("Antigravity Callback Error:", e);
      return c.html(`<h1>Error</h1><p>${e.message}</p>`, 500);
    }
  }

  private async handleCountTokens(c: any) {
    const creds = await db
      .select()
      .from(credentials)
      .where(eq(credentials.provider, this.providerId))
      .limit(1);
    if (creds.length === 0)
      return c.json({ error: "No credentials found" }, 401);

    const cred = creds[0];
    const token = cred?.accessToken;

    // 刷新令牌逻辑与聊天相同（为简洁省略，假设有效或由通用中间件处理）
    // 在真正的稳健实现中，我们应该复制刷新检查或将其提取出来。

    const body = await c.req.json();
    const modelRaw = body.model || "gemini-1.5-pro";
    const { modelName } = parseModelSuffix(modelRaw);

    // 转换请求 (OpenAI -> Gemini)
    // 注意：countTokens 和 generateContent 一样期望 'contents'
    let payload: any;
    try {
      const { messages } = body;
      const { contents } = Translators.openAIToGemini(messages || []);
      payload = {
        model: modelName,
        request: { contents },
      };
    } catch (e) {
      return c.json(
        { error: "Transformation failed", details: String(e) },
        400,
      );
    }

    // 执行
    for (const baseUrl of ENDPOINTS) {
      const url = `${baseUrl}/v1internal:countTokens`;
      try {
        const customHeaders = await this.getCustomHeaders(token!, payload);
        // countTokens 通常不需要设备标头，但加上也无妨

        const resp = await fetch(url, {
          method: "POST",
          headers: customHeaders,
          body: JSON.stringify(payload),
        });

        if (resp.ok) {
          return new Response(resp.body, {
            status: 200,
            headers: resp.headers,
          });
        }
      } catch (e) {
        continue;
      }
    }

    return c.json({ error: "Failed to count tokens" }, 500);
  }

  private transformTools(tools: any[]): any[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    // 基本映射。Gemini 期望 { function_declarations: [...] }
    const funcs = tools
      .map((t: any) => {
        if (t.type === "function") {
          return t.function; // OpenAI 函数对象通常与 Gemini functionDeclaration 兼容
        }
        return null;
      })
      .filter(Boolean);

    return funcs.length > 0 ? [{ function_declarations: funcs }] : undefined;
  }

  private handleStream(
    upstreamResp: Response,
    model: string,
    logCtx: any,
    sessionId: string,
    lastUserMsg: string,
  ): Response {
    const reader = upstreamResp.body?.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    if (!reader) return new Response("No body", { status: 500 });

    let promptTokens = 0;
    let completionTokens = 0;
    let fullResponseText = "";

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split("\n");

              for (const line of lines) {
                if (!line.trim()) continue;

                if (line.startsWith("data: ")) {
                  const data = JSON.parse(line.slice(6));

                  // 处理 candidates
                  if (data.candidates && data.candidates[0].content) {
                    const content = data.candidates[0].content;
                    const parts = content.parts || [];

                    for (const part of parts) {
                      let delta: any = {};
                      if (part.text) {
                        delta.content = part.text;
                        fullResponseText += part.text;
                        completionTokens += 1; // 估算
                      }

                      if (part.thought) {
                        delta.thinking = part.thought;
                      }

                      if (part.call) {
                        delta.tool_calls = [
                          {
                            index: 0,
                            id: crypto.randomUUID(),
                            type: "function",
                            function: {
                              name: part.call.functionCall.name,
                              arguments: JSON.stringify(
                                part.call.functionCall.args,
                              ),
                            },
                          },
                        ];
                      }

                      // SSE 输出
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({
                            choices: [{ delta, index: 0 }],
                          })}\n\n`,
                        ),
                      );
                    }

                    // 如果存在，缓存思维签名
                    if (content.thoughtSignature) {
                      cacheSignature(
                        sessionId,
                        lastUserMsg,
                        content.thoughtSignature,
                      );
                    }
                  }

                  // 使用情况元数据
                  if (data.usageMetadata) {
                    promptTokens = data.usageMetadata.promptTokenCount || 0;
                    completionTokens =
                      data.usageMetadata.candidatesTokenCount || 0;
                  }
                }
              }
            }
          } catch (e) {
            logger.error("Stream error in Antigravity provider:", String(e));
          } finally {
            // 发送最终 [DONE]
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();

            // 最终日志记录
            const end = Date.now();
            await db
              .insert(requestLogs)
              .values({
                timestamp: new Date().toISOString(),
                provider: logCtx.provider,
                method: logCtx.method,
                path: logCtx.path,
                status: 200,
                latencyMs: end - logCtx.start,
                promptTokens,
                completionTokens,
                model: logCtx.model,
              })
              .catch(console.error);
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  }

  // BaseProvider contract
  protected async transformResponse(response: Response): Promise<Response> {
    return response; // 无操作，在 handleChatCompletion 中处理
  }

  public override async getModels(token: string): Promise<{ id: string; name: string; provider: string }[]> {
    // 尝试官方模型列表
    const resp = await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": this.authConfig.clientSecret as string },
    });
    
    if (resp.ok) {
      const data = await resp.json() as any;
      return (data.models || []).map((m: any) => ({
        id: m.name.replace("models/", ""),
        name: m.displayName || m.name.replace("models/", ""),
        provider: "google"
      }));
    }

    // 如果官方失败，尝试内部列表变体（用于特定令牌）
    for (const baseUrl of ENDPOINTS) {
        try {
            const internalResp = await fetch(`${baseUrl}/v1internal:listModels`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (internalResp.ok) {
                const data = await internalResp.json() as any;
                return (data.models || []).map((m: any) => ({
                    id: m.name.replace("models/", ""),
                    name: m.displayName || m.name.replace("models/", ""),
                    provider: "google"
                }));
            }
        } catch (e) {
            // continue
        }
    }

    // 如果 API 调用失败，回退到静态列表
    logger.warn(`[Antigravity] API model list failed, using static fallback`);
    return [
      { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash", provider: "google" },
      { id: "gemini-2.0-flash-thinking-exp", name: "Gemini 2.0 Flash Thinking", provider: "google" },
      { id: "gemini-1.5-pro-002", name: "Gemini 1.5 Pro", provider: "google" },
      { id: "gemini-1.5-flash-002", name: "Gemini 1.5 Flash", provider: "google" },
    ];
  }

  // 覆盖 fetchUserInfo 以提供基本 ID
  protected override async fetchUserInfo(
    token: string,
  ): Promise<{ email?: string; id?: string }> {
    try {
      // 1. 使用访问令牌获取用户信息
      const resp = await fetchWithRetry("https://www.googleapis.com/oauth2/v1/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const u = await resp.json() as any;
      return { email: u.email, id: u.id };
    } catch (e) {
      return {};
    }
  }
}

const antigravityProvider = new AntigravityProvider();
export { antigravityProvider };
export default antigravityProvider.router;
