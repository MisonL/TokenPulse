import { BaseProvider } from "./base";
import type { ChatRequest } from "./base";
import type { AuthConfig } from "../auth/oauth-client";
import { config } from "../../config";
import { logger } from "../logger";
import { fetchWithRetry } from "../http";
import { shortenToolName } from "./utils";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = `${config.baseUrl}/api/codex/callback`;

class CodexProvider extends BaseProvider {
  protected override providerId = "codex";
  protected override endpoint = "https://api.openai.com/v1/chat/completions";
  protected override authConfig: AuthConfig;

  constructor() {
    super();
    this.authConfig = {
      providerId: this.providerId,
      clientId: OPENAI_CLIENT_ID,
      authUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      redirectUri: REDIRECT_URI,
      scopes: ["openid", "email", "profile", "offline_access", "api.model.read", "model.read"],
      usePkce: true,
      customAuthParams: {
        prompt: "login",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        code_challenge_method: "S256",
      },
    };
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
    };
  }

  protected override async transformRequest(
    body: ChatRequest,
    headers?: any,
    context?: any,
  ): Promise<any> {

    const payload: any = {};

    payload.stream = body.stream ?? true;
    payload.model = body.model;
    payload.parallel_tool_calls = true;

    const effort = (body as any).reasoning_effort || "medium";
    if (effort !== "none") {
      payload.reasoning = {
        effort: effort,
        summary: "auto",
      };
      payload.include = ["reasoning.encrypted_content"];
    }

    let instructions = "";
    const messages = body.messages || [];
    const systemMsg = messages.find((m) => m.role === "system");
    if (systemMsg) {
      instructions = typeof systemMsg.content === "string" ? systemMsg.content : JSON.stringify(systemMsg.content);
    }
    
    if (effort !== "none" && effort !== "auto") {
       const hint = `\n[INSTRUCTION: Thinking Mode Enabled (Effort: ${effort}). Please reason step-by-step before answering.]`;
       instructions = instructions ? instructions + hint : hint;
    }

    if (instructions) {
      payload.instructions = instructions;
    }


    const input: any[] = [];

    for (const msg of messages) {
      const role = msg.role;

      if (role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: (msg as any).tool_call_id,
          output: msg.content,
        });
        continue;
      }

      const newRole = role === "system" ? "user" : role;
      const inputMsg: any = {
        type: "message",
        role: newRole,
        content: [],
      };

      if (typeof msg.content === "string") {
        const partType = newRole === "assistant" ? "output_text" : "input_text";
        inputMsg.content.push({
          type: partType,
          text: msg.content,
        });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            const partType =
              newRole === "assistant" ? "output_text" : "input_text";
            inputMsg.content.push({
              type: partType,
              text: part.text,
            });
          } else if (part.type === "image_url") {
            if (newRole === "user") {
              inputMsg.content.push({
                type: "input_image",
                image_url: part.image_url?.url,
              });
            }
          }
        }
      }

      if (newRole === "assistant" && (msg as any).tool_calls) {
        const toolCalls = (msg as any).tool_calls;
        for (const tc of toolCalls) {
          if (tc.type === "function") {
            input.push({
              type: "function_call",
              call_id: tc.id,
              name: shortenToolName(tc.function.name),
              arguments: tc.function.arguments,
            });
          }
        }
      }

      if (inputMsg.content.length > 0) {
        input.push(inputMsg);
      }
    }
    payload.input = input;

    if (body.tools && body.tools.length > 0) {
      payload.tools = body.tools.map((t: any) => {
        if (t.type === "function") {
          return {
            type: "function",
            name: shortenToolName(t.function.name),
            description: t.function.description,
            parameters: t.function.parameters,
            strict: t.function.strict,
          };
        }
        return t;
      });
    }

    if (body.tool_choice) {
      if (typeof body.tool_choice === "string") {
        payload.tool_choice = body.tool_choice;
      } else if (typeof body.tool_choice === "object") {
        const tc = body.tool_choice as any;
        if (tc.type === "function") {
          payload.tool_choice = {
            type: "function",
            name: shortenToolName(tc.function.name),
          };
        }
      }
    }

    payload.store = false;

    return payload;
  }

  public override async getModels(token: string): Promise<{ id: string; name: string; provider: string }[]> {
    try {
      const resp = await fetchWithRetry("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        return (data.data || [])
          .filter((m: any) => m.id.startsWith("gpt") || m.id.startsWith("o1") || m.id.startsWith("o3"))
          .map((m: any) => ({
            id: m.id,
            name: m.id,
            provider: "openai"
          }));
      }
    } catch (e) {
    }

    logger.warn(`[Codex] API model list failed, using static fallback`);
    return [
      { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "openai" },
      { id: "o1", name: "o1", provider: "openai" },
      { id: "o1-mini", name: "o1 Mini", provider: "openai" },
      { id: "o3-mini", name: "o3 Mini", provider: "openai" },
    ];
  }

  protected override async transformResponse(
    response: Response,
  ): Promise<Response> {
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  protected override async fetchUserInfo(token: string): Promise<any> {
    try {
      const resp = await fetchWithRetry(`https://auth.openai.com/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        return {
          email: data.email,
          id: data.sub,
          metadata: {
            email_verified: data.email_verified,
            name: data.name,
          },
          attributes: {
            orgs: data.https_openai_com_claims_orgs,
            name: data.name,
          },
        };
      }
    } catch (e) {
    }
    return {};
  }
}


const codexProvider = new CodexProvider();
export { codexProvider };
export default codexProvider.router;
