import { BaseProvider } from "./base";
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
    // If request had betas, merge them (though logic below handles body transformation, here we just set header)
    // Accessing body here to check for betas if we wanted to extract them, but typically we handle that in transformRequest

    return {
      ...PROXY_HEADERS,
      Authorization: `Bearer ${token}`,
      "Anthropic-Beta": betas, // We will just use base betas + dynamic ones if we had a way to pass them out, for now hardcode base
      "Content-Type": "application/json",
    };
  }

  protected override async transformRequest(
    body: ChatRequest,
    headers: any,
    context?: any,
  ): Promise<any> {
    // Convert OpenAI format to Claude format

    // 1. Extract System Prompt
    let system = "";
    const messages = body.messages || [];
    const systemMsgs = messages.filter((m) => m.role === "system");
    if (systemMsgs.length > 0) {
      system = systemMsgs.map((m) => m.content).join("\n");
    }
    // Incorporate CLAIM if needed
    if (system) {
      system = `${CLAIM}\n${system}`;
    } else {
      system = CLAIM;
    }

    // 2. Convert Messages
    const claudeMessages: any[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        // In reference, system messages in the messages array are converted to 'user' role
        claudeMessages.push({
          role: "user",
          content: [{ type: "text", text: msg.content }],
        });
        continue;
      }

      // Map roles
      // Function: (User) -> (Assistant w/ tool_use) -> (User w/ tool_result) -> (Assistant)

      if (msg.role === "tool") {
        // OpenAI 'tool' role maps to Claude 'user' role with 'tool_result' content block
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
        // Check for tool_calls
        const toolCalls = (msg as any).tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          // Assistant with tool use
          // Content can be mixed text and tool_use
          const content: any[] = [];

          // Text content first?
          if (msg.content) {
            content.push({ type: "text", text: msg.content });
          } else {
            // Claude typically expects non-empty content for assistant,
            // but for tool use it might just want tool use blocks?
            // If empty text, maybe don't push text block.
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

      // Normal User/Assistant message (Text/Image)
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
            // Fallback
            claudeMsg.content.push({ type: "text", text: "[Image]" });
          }
        }
      }
      claudeMessages.push(claudeMsg);
    }

    // 3. Tools Definition
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

    // 3. Construct Payload
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
      // Map tool_choice
      if (body.tool_choice) {
        if (body.tool_choice === "auto") {
          payload.tool_choice = { type: "auto" };
        } else if (body.tool_choice === "required") {
          // 'required' -> 'any' in Claude
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

    // 4. Metadata (CLI Proxy API format)
    // Format: user_{sha256}_account_{uuid}_session_{uuid}
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

    // 5. Thinking Mode
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

    // 6. Stop Sequences
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
        // Try as API Key first
        const resp = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
                ...headers,
                "x-api-key": token
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

        // If that fails, try as Bearer (OAuth)
        const oauthResp = await fetch("https://api.anthropic.com/v1/models", {
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

    // Fallback to static list
    logger.warn(`[Claude] API model list failed, using static fallback`);
    return [
      { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet", provider: "anthropic" },
      { id: "claude-3- opus-20240229", name: "Claude 3 Opus", provider: "anthropic" },
      { id: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet", provider: "anthropic" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", provider: "anthropic" },
      { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", provider: "anthropic" }, 
    ];
  }

  private checkThinkingEnabled(body: any, headers: any): boolean {
    const model = (body.model || "").toLowerCase();
    
    // 1. Check Anthropic-Beta header for thinking
    const betaHeader = (headers?.["anthropic-beta"] || "").toLowerCase();
    if (betaHeader.includes("thinking")) return true;

    // 2. Check reasoning_effort (OpenAI compatible)
    if (body.reasoning_effort && body.reasoning_effort !== "none") return true;

    // 3. Check model name hints
    if (model.includes("thinking") || model.includes("-reason")) return true;
    
    // 4. Claude 3.7 Sonnet specific check (can be reasoning or not)
    if (model.includes("claude-3-7-sonnet") && body.thinking?.type === "enabled") return true;

    return false;
  }

  protected override async transformResponse(
    response: Response,
  ): Promise<Response> {
    // Pass through transparently
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  protected override async finalizeAuth(c: any, tokenData: any) {
    // Try to fetch API Key or extract it
    let apiKey = tokenData.api_key;

    if (!apiKey) {
      // If not in token response, try to fetch it using the scope we requested
      try {
        // Hypothetically: POST /v1/organizations/{org_id}/api_keys
        // But we don't know the Org ID yet.
        // Let's first get user info which might contain Org info.
      } catch (e) {
        // ignore
      }
    }

    // Just use standard finalize but ensuring we map api_key if it existed
    // The BaseProvider finalizeAuth uses IdentityResolver which calls fetchUserInfo.
    // I can return api_key in fetchUserInfo's metadata/attributes result.
    return super.finalizeAuth(c, tokenData);
  }

  protected override async fetchUserInfo(
    token: string,
  ): Promise<{ email?: string; id?: string; attributes?: any }> {
    // 1. Get User/Org Info
    let email = undefined;
    let id = undefined;
    let apiKey = undefined;

    try {
      // Note: The reference implementation for CLI uses a specific endpoint or just expects it in the token response?
      // "api_key" field in AuthBundle.

      // Let's try to hit the users endpoint to get email at least
      const resp = await fetch("https://api.anthropic.com/v1/users/me", {
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
        api_key: apiKey, // Will be undefined if we didn't find it, but structure is there.
      },
    };
  }

  // Override handleCallback to extract email from token response properly
  protected override async handleCallback(c: any) {
    return super.handleCallback(c);
  }
}

// Instantiate and export router
const claudeProvider = new ClaudeProvider();
export { claudeProvider };
export default claudeProvider.router;
