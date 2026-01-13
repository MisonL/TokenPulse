import { BaseProvider } from './base';
import type { ChatRequest } from './base';
import type { AuthConfig } from '../auth/oauth-client';
import { config } from '../../config';
import { shortenToolName } from './utils';

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = `${config.baseUrl}/api/codex/callback`;

class CodexProvider extends BaseProvider {
    protected override providerId = 'codex';
    protected override endpoint = 'https://api.openai.com/v1/chat/completions';
    protected override authConfig: AuthConfig;

    constructor() {
        super();
        this.authConfig = {
            providerId: this.providerId,
            clientId: OPENAI_CLIENT_ID,
            authUrl: AUTH_URL,
            tokenUrl: TOKEN_URL,
            redirectUri: REDIRECT_URI,
            scopes: ["openid", "email", "profile", "offline_access"],
            usePkce: true,
            customAuthParams: {
                prompt: 'login',
                id_token_add_organizations: 'true',
                codex_cli_simplified_flow: 'true',
                code_challenge_method: 'S256'
            }
        };
        this.init();
    }

    protected override async getCustomHeaders(token: string, body: any, context?: any): Promise<Record<string, string>> {
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }

    protected override async transformRequest(body: ChatRequest, headers?: any, context?: any): Promise<any> {
        // Convert Chat Completions API format to OpenAI Responses API format (Codex)
        // See reference: CLIProxyAPIPlus/internal/translator/codex/openai/chat-completions/codex_openai_request.go

        const payload: any = {};

        // 1. Basic Fields
        payload.stream = body.stream ?? true;
        payload.model = body.model;
        payload.parallel_tool_calls = true;
        
        // 2. Reasoning Effort
        // Map reasoning_effort if present, default to 'medium' if not? 
        // Reference uses sjson.Set(out, "reasoning.effort", "medium") fallback.
        // We will assume 'medium' if not set, or pass through if in body?
        // Note: OpenAI Node SDK might not pass reasoning_effort in standard ChatRequest types yet, but we can check.
        // Let's set defaults as per reference.
        payload.reasoning = {
             effort: (body as any).reasoning_effort || 'medium',
             summary: 'auto',
             // encrypted_content included in reference
        };
        payload.include = ["reasoning.encrypted_content"];

        // 3. Instructions (System Prompt)
        let instructions = "";
        const messages = body.messages || [];
        const systemMsg = messages.find(m => m.role === 'system');
        if (systemMsg) {
            instructions = systemMsg.content as string; // Assume string for system prompt
        }
        // Ideally we should extract *all* system messages or handle them better.
        // Reference extracts first system message roughly?
        // Actually reference misc.CodexInstructionsForModel likely puts default instructions too.
        // For now, let's just use the system message.
        if (instructions) {
            payload.instructions = instructions;
        }

        // 4. Input (Messages)
        // Reference maps messages to 'input' array.
        // Roles: system -> user? Wait, Reference says: if role == "system" -> role = "user".
        // But system is also extracted to instructions?
        // Reference logic: 
        // Iterate messages:
        // Case tool: function_call_output
        // Default: message
        //   If system -> set role user.
        //   Content -> input_text / output_text / input_image
        
        const input: any[] = [];
        
        for (const msg of messages) {
            const role = msg.role;
            
            if (role === 'tool') {
                input.push({
                    type: "function_call_output",
                    call_id: (msg as any).tool_call_id,
                    output: msg.content
                });
                continue;
            }

            // Normal Message
            // Reference logic: if role == "system" { role = "user" }
            const newRole = role === 'system' ? 'user' : role;
            const inputMsg: any = {
                type: "message",
                role: newRole,
                content: []
            };

            // Content
            if (typeof msg.content === 'string') {
                const partType = newRole === 'assistant' ? 'output_text' : 'input_text';
                inputMsg.content.push({
                    type: partType,
                    text: msg.content
                });
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                         const partType = newRole === 'assistant' ? 'output_text' : 'input_text';
                         inputMsg.content.push({
                             type: partType,
                             text: part.text
                         });
                    } else if (part.type === 'image_url') {
                         if (newRole === 'user') {
                             inputMsg.content.push({
                                 type: "input_image",
                                 image_url: part.image_url?.url
                             });
                         }
                    }
                }
            }
            
            // Tool Calls (Assistant)
            if (newRole === 'assistant' && (msg as any).tool_calls) {
                 const toolCalls = (msg as any).tool_calls;
                 for (const tc of toolCalls) {
                     if (tc.type === 'function') {
                         input.push({
                             type: "function_call",
                             call_id: tc.id,
                             name: shortenToolName(tc.function.name),
                             arguments: tc.function.arguments
                         });
                     }
                 }
            }

            // Don't push empty content message if it was just tool calls? 
            // Reference pushes input.-1 = msg. 
            // But if assistant msg has ONLY tool_calls, content might be null/empty.
            // Reference creates `msg` then later handles `tool_calls`.
            // Check if msg content is empty?
            if (inputMsg.content.length > 0) {
                 input.push(inputMsg);
            }
        }
        payload.input = input;

        // 5. Tools
        if (body.tools && body.tools.length > 0) {
            payload.tools = body.tools.map((t: any) => {
                if (t.type === 'function') {
                    return {
                        type: 'function',
                        name: shortenToolName(t.function.name),
                        description: t.function.description,
                        parameters: t.function.parameters,
                        strict: t.function.strict
                    };
                }
                return t;
            });
        }

        // 6. Tool Choice
        if (body.tool_choice) {
             if (typeof body.tool_choice === 'string') {
                 payload.tool_choice = body.tool_choice;
             } else if (typeof body.tool_choice === 'object') {
                 const tc = body.tool_choice as any;
                 if (tc.type === 'function') {
                      payload.tool_choice = {
                          type: 'function',
                          name: shortenToolName(tc.function.name)
                      };
                 }
             }
        }
        
        // 7. Store
        payload.store = false;

        return payload;
    }

    protected override async transformResponse(response: Response): Promise<Response> {
        return new Response(response.body, {
            status: response.status,
            headers: response.headers
        });
    }

    protected override async fetchUserInfo(token: string): Promise<{ email?: string; id?: string; metadata?: any; attributes?: any }> {
        try {
            const resp = await fetch(`https://auth.openai.com/oauth/userinfo`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (resp.ok) {
                const data = await resp.json() as any;
                return { 
                    email: data.email, 
                    id: data.sub,
                    metadata: {
                        email_verified: data.email_verified,
                        name: data.name
                    },
                    attributes: {
                        orgs: data.https_openai_com_claims_orgs,
                        name: data.name
                    }
                };
            }
        } catch (e) {
            // ignore
        }
        return {};
    }
}

// We need to support ID Token decoding. 
// I will patch BaseProvider one last time to look for id_token and decode it if present.
// This benefits any OIDC provider.

const codexProvider = new CodexProvider();
export default codexProvider.router;
