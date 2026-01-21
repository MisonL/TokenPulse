import { BaseProvider } from "./base";
import { fetchWithRetry } from "../http";
import type { ChatRequest } from "./base";
import { logger } from "../logger";
import { config } from "../../config";
import type { AuthConfig } from "../auth/oauth-client";
import crypto from "crypto";

const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"; // Hardcoded default from reference project if config missing
const AUTH_URL_BASE = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = `${config.baseUrl}/api/claude/callback`;

const PROXY_HEADERS = {
  "User-Agent": "claude-cli/1.0.83 (external, cli)",
  "X-App": "cli",
  "Anthropic-Version": "2023-06-01",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Runtime-Version": "v24.3.0",
  "X-Stainless-Package-Version": "0.55.1",
  "X-Stainless-Os": "MacOS",
  "X-Stainless-Arch": "arm64",
  "X-Stainless-Lang": "js",
  Connection: "keep-alive",
};

const BASE_BETAS =
  "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";
const CLAIM = "You are Claude Code, Anthropic's official CLI for Claude.";

class ClaudeProvider extends BaseProvider {
  protected providerId = "claude";
  protected endpoint = "https://api.anthropic.com/v1/messages?beta=true";
  protected authConfig: AuthConfig;

  constructor() {
    super();
    this.authConfig = {
      providerId: this.providerId,
      clientId: CLAUDE_CLIENT_ID,
      authUrl: AUTH_URL_BASE,
      tokenUrl: TOKEN_URL,
      redirectUri: REDIRECT_URI,
      scopes: ["org:create_api_key", "user:profile", "user:inference"],
      usePkce: true,
      customAuthParams: {
        code_challenge_method: "S256",
        code: "true",
      },
    };
    this.init();
  }

  protected override async getCustomHeaders(
    token: string,
    body: any,
    context?: any,
  ): Promise<Record<string, string>> {
    let betas = BASE_BETAS;
    // 如果请求包含 betas，合并它们（尽管下面的逻辑会处理 body 转换，这里我们只是设置标头）
    // 这里访问 body 是为了检查 betas（如果我们想提取它们），但通常我们在 transformRequest 中处理

    return {
      ...PROXY_HEADERS,
      Authorization: `Bearer ${token}`,
      "Anthropic-Beta": betas, // 我们只使用基础 betas + 动态 betas（如果有办法传出它们），目前硬编码基础 betas
      "Content-Type": "application/json",
    };
  }

  protected override async transformRequest(
    body: ChatRequest,
    headers: any,
    context?: any,
  ): Promise<any> {
    // 将 OpenAI 格式转换为 Claude 格式

    // 1. 提取系统提示词
    let system = "";
    const messages = body.messages || [];
    const systemMsgs = messages.filter((m) => m.role === "system");
    if (systemMsgs.length > 0) {
      system = systemMsgs.map((m) => m.content).join("\n");
    }
    // 如果需要，合并 CLAIM
    if (system) {
      system = `${CLAIM}\n${system}`;
    } else {
      system = CLAIM;
    }

    // 2. 转换消息
    const claudeMessages: any[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        // 在参考实现中，messages 数组中的系统消息由于角色限制被转换为 'user' 角色
        claudeMessages.push({
          role: "user",
          content: [{ type: "text", text: msg.content }],
        });
        continue;
      }

      // 映射角色
      // 流程: (User) -> (Assistant w/ tool_use) -> (User w/ tool_result) -> (Assistant)

      if (msg.role === "tool") {
        // OpenAI 'tool' 角色映射到 Claude 'user' 角色，带有 'tool_result' 内容块
        claudeMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: (msg as any).tool_call_id,
              content: msg.content,
            },
          ],
        });
        continue;
      }

      if (msg.role === "assistant") {
        // 检查 tool_calls
        const toolCalls = (msg as any).tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          // 带有工具使用的 Assistant
          // 内容可以是混合的文本和 tool_use
          const content: any[] = [];

          // 文本内容在先？
          if (msg.content) {
            content.push({ type: "text", text: msg.content });
          } else {
            // Claude 通常期望 assistant 有非空内容，
            // 但对于工具使用，它可能只需要 tool use 块？
            // 如果文本为空，也许不应该推送文本块。
          }

          for (const tc of toolCalls) {
            if (tc.type === "function") {
              content.push({
                type: "tool_use",
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
              });
            }
          }

          claudeMessages.push({
            role: "assistant",
            content: content,
          });
          continue;
        }
      }

      // 普通 User/Assistant 消息 (文本/图片)
      const claudeMsg: any = {
        role: msg.role === "assistant" ? "assistant" : "user",
        content: [],
      };

      if (typeof msg.content === "string") {
        claudeMsg.content.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            claudeMsg.content.push({ type: "text", text: part.text });
          } else if (part.type === "image_url") {
            const url = part.image_url?.url || "";
            if (url.startsWith("data:")) {
              const match = url.match(/^data:(.+);base64,(.+)$/);
              if (match) {
                claudeMsg.content.push({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: match[1],
                    data: match[2],
                  },
                });
                continue;
              }
            }
            // 回退
            claudeMsg.content.push({ type: "text", text: "[Image]" });
          }
        }
      }
      claudeMessages.push(claudeMsg);
    }

    // 3. 工具定义
    let tools: any[] | undefined = undefined;
    if (body.tools && body.tools.length > 0) {
      tools = body.tools
        .map((t: any) => {
          if (t.type === "function") {
            return {
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters,
            };
          }
          return null;
        })
        .filter((t: any) => t !== null);
    }

    // 3. 构建 Payload
    const payload: any = {
      model: body.model,
      messages: claudeMessages,
      system: system,
      max_tokens: body.max_tokens || 32000,
      temperature: body.temperature,
      top_p: body.top_p,
      stream: body.stream,
    };

    if (tools) {
      payload.tools = tools;
      // 映射 tool_choice
      if (body.tool_choice) {
        if (body.tool_choice === "auto") {
          payload.tool_choice = { type: "auto" };
        } else if (body.tool_choice === "required") {
          // 'required' -> Claude 中的 'any'
          payload.tool_choice = { type: "any" };
        } else if (
          typeof body.tool_choice === "object" &&
          (body.tool_choice as any).type === "function"
        ) {
          payload.tool_choice = {
            type: "tool",
            name: (body.tool_choice as any).function.name,
          };
        }
      }
    }

    // 4. Metadata (CLI Proxy API 格式)
    // 格式: user_{sha256}_account_{uuid}_session_{uuid}
    const account = (context as any)?.accountId || "default_account";
    const session = (context as any)?.sessionId || crypto.randomUUID();
    const userHash = crypto
      .createHash("sha256")
      .update(account + session)
      .digest("hex")
      .substring(0, 16);
    payload.metadata = {
      user_id: `user_${userHash}_account_${account}_session_${session}`,
    };

    // 5. 思维模式 (Thinking Mode)
    const thinkingEnabled = this.checkThinkingEnabled(body, headers);
    if (thinkingEnabled) {
      let budget = 4096; // Default medium
      const effort = (body as any).reasoning_effort || "medium";

      if (effort === "low") budget = 2048;
      else if (effort === "medium") budget = 8192;
      else if (effort === "high") budget = 32000;
      else if (effort === "auto") budget = 8192;

      payload.thinking = {
        type: "enabled",
        budget_tokens: budget,
      };
    }

    // 6. 停止序列
    if (body.stop) {
      payload.stop_sequences = Array.isArray(body.stop)
        ? body.stop
        : [body.stop];
    }

    return payload;
  }

  public override async getModels(token: string): Promise<{ id: string; name: string; provider: string }[]> {
    const headers: any = {
        "anthropic-version": "2023-06-01"
    };

    try {
        // 首先尝试作为 API Key
        const resp = await fetchWithRetry("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": token,
            "anthropic-version": "2023-06-01"
          }
        });
        
        if (resp.ok) {
           const data = await resp.json() as any;
           return (data.data || []).map((m: any) => ({
             id: m.id,
             name: m.display_name || m.id,
             provider: "anthropic"
           }));
        }

        // 如果失败，尝试作为 Bearer (OAuth)
        const oauthResp = await fetchWithRetry("https://api.anthropic.com/v1/models", {
            headers: {
                ...headers,
                "Authorization": `Bearer ${token}`
            }
        });
        if (oauthResp.ok) {
            const data = await oauthResp.json() as any;
            return (data.data || []).map((m: any) => ({
                id: m.id,
                name: m.display_name || m.id,
                provider: "anthropic"
            }));
        }
    } catch (e) {
        // continue
    }

    // 回退到静态列表
    logger.warn(`[Claude] API model list failed, using static fallback`);
    return [
      { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet", provider: "anthropic" },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus", provider: "anthropic" },
      { id: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet", provider: "anthropic" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", provider: "anthropic" },
      { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", provider: "anthropic" }, 
    ];
  }

  private checkThinkingEnabled(body: any, headers: any): boolean {
    const model = (body.model || "").toLowerCase();
    
    // 1. 检查 Anthropic-Beta 标头是否包含 thinking
    const betaHeader = (headers?.["anthropic-beta"] || "").toLowerCase();
    if (betaHeader.includes("thinking")) return true;

    // 2. 检查 reasoning_effort (OpenAI 兼容)
    if (body.reasoning_effort && body.reasoning_effort !== "none") return true;

    // 3. 检查模型名称提示
    if (model.includes("thinking") || model.includes("-reason")) return true;
    
    // 4. Claude 3.7 Sonnet 特定检查 (可以是 reasoning 或非 reasoning)
    if (model.includes("claude-3-7-sonnet") && body.thinking?.type === "enabled") return true;

    return false;
  }

  protected override async transformResponse(
    response: Response,
  ): Promise<Response> {
    // 透明透传
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  protected override async finalizeAuth(c: any, tokenData: any) {
    // 尝试获取 API Key 或提取它
    let apiKey = tokenData.api_key;

    if (!apiKey) {
      // 如果不在 token 响应中，尝试使用我们请求的 scope 获取它
      try {
        // 假设：POST /v1/organizations/{org_id}/api_keys
        // 但我们要先获取 Org ID。
        // 让我们先获取用户信息，其中可能包含 Org 信息。
      } catch (e) {
        // ignore
      }
    }

    // 仅使用标准 finalize，但确保如果存在 api_key 则映射它
    // BaseProvider finalizeAuth 使用 IdentityResolver，它调用 fetchUserInfo。
    // 我可以在 fetchUserInfo 的 metadata/attributes 结果中返回 api_key。
    return super.finalizeAuth(c, tokenData);
  }

  protected override async fetchUserInfo(
    token: string,
  ): Promise<{ email?: string; id?: string; attributes?: any }> {
    // 1. 获取用户/组织信息
    let email = undefined;
    let id = undefined;
    let apiKey = undefined;

    try {
      // 注意：CLI 的参考实现使用特定端点或者仅仅期望在 token 响应中？
      // AuthBundle 中的 "api_key" 字段。

      // 让我们尝试访问 users 端点，至少获取电子邮件
      const resp = await fetchWithRetry("https://api.anthropic.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Anthropic-Beta": "claude-code-20250219",
        },
      });

      if (resp.ok) {
        const data = (await resp.json()) as any;
        email = data.email || data.email_address;
        id = data.id || data.user_id;
      }
    } catch (e) {
      // ignore
    }

    return {
      email,
      id,
      attributes: {
        api_key: apiKey, // 如果没找到则为 undefined，但结构存在
      },
    };
  }

  // 覆盖 handleCallback 以正确从令牌响应中提取电子邮件
  protected override async handleCallback(c: any) {
    return super.handleCallback(c);
  }
}

// 实例化并导出 router
const claudeProvider = new ClaudeProvider();
export { claudeProvider };
export default claudeProvider.router;
