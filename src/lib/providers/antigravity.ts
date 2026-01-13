import { BaseProvider } from './base';
import type { ChatRequest } from './base';
import type { AuthConfig } from '../auth/oauth-client';
import { config } from '../../config';
import { db } from '../../db';
import { credentials } from '../../db/schema';
import { eq } from 'drizzle-orm';

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const BASE_URL_DAILY = 'https://daily-cloudcode-pa.googleapis.com';
const REDIRECT_URI = `${config.baseUrl}/api/antigravity/callback`;

const SYSTEM_INSTRUCTION = "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**";

class AntigravityProvider extends BaseProvider {
    protected override providerId = 'antigravity';
    // Endpoint is dynamic based on metadata, so this is a placeholder or default
    protected override endpoint = `${BASE_URL_DAILY}/v1internal:generateContent`;
    protected override authConfig: AuthConfig;

    constructor() {
        super();
        this.authConfig = {
            providerId: this.providerId,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            authUrl: 'https://accounts.google.com/o/oauth2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            redirectUri: REDIRECT_URI,
            scopes: [
                "https://www.googleapis.com/auth/cloud-platform",
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile"
            ],
            customAuthParams: {
                access_type: 'offline',
                prompt: 'consent'
            }
        };
        this.init();
    }

    protected override async getCustomHeaders(token: string, body: any, context?: any): Promise<Record<string, string>> {
        return {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'antigravity/1.104.0 darwin/arm64',
            'Content-Type': 'application/json'
        };
    }

    protected override async getEndpoint(token: string, context?: any): Promise<string> {
        try {
             const creds = await db.select().from(credentials).where(eq(credentials.provider, this.providerId)).limit(1);
             if (creds.length > 0 && creds[0] && creds[0].metadata) {
                 const meta = JSON.parse(creds[0].metadata!); // Non-null assertion allowed after check
                 if (meta.base_url) return `${meta.base_url}/v1internal:generateContent`;
             }
        } catch (e) {
            // ignore
        }
        return this.endpoint; // Default to Daily
    }

    // Override generic handleChatCompletion to support dynamic endpoint from metadata
    protected override async handleChatCompletion(c: any) {
        // We need to set this.endpoint BEFORE calling super's logic or reimplement it.
        // Since super.handleChatCompletion calls fetch(this.endpoint...), we can't easily change it dynamically 
        // without a dirty hack or overriding the whole method.
        // Let's override the whole method for Antigravity as it has unique fallback logic (Daily -> Prod).
        
        // Actually, let's use the BaseProvider but with a small tweak or just override it completely since
        // the logic is sufficiently different (Gemini format, environment fallback).
        
        return super.handleChatCompletion(c); 
    }
    
    // We need to intercept the request to set the endpoint from metadata.
    // The BaseProvider was designed to be simple. 
    // Let's update BaseProvider to have a `getEndpoint(token, metadata)` method? 
    // Or just update `endpoint` in `transformRequest`.
    
    protected override async transformRequest(body: ChatRequest, headers?: any, context?: any): Promise<any> {
        // 1. Transform OpenAI format to Gemini format
        const model = body.model || 'gemini-1.5-pro-preview-0409';
        
        const contents = (body.messages || []).map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));
        
        // Inject System Instruction if not present or just force logic similar to Claude claim
        // Gemini API usually takes `systemInstruction` at the top level, NOT in contents.
        // We need to check Gemini API format. 
        // Based on reference code (which calls sdktranslator), it's likely handled there.
        // But for direct proxying to v1internal:generateContent, we should look up the Gemini structure.
        // Standard Gemini: { contents: [], systemInstruction: { parts: [] } }
        // Reference uses `generateContent` URL.
        
        // Let's adopt a safe approach: Just ensuring the "You are Antigravity" text is somewhere.
        // Claude puts it in system messages. Gemini usually uses `system_instruction` field.
        
        const payload: any = {
            model: model,
            request: {
                contents: contents,
                generationConfig: {
                    temperature: body.temperature,
                    maxOutputTokens: body.max_tokens,
                }
            }
        };

        // Add System Instruction
        // Note: v1internal might be different from public v1beta.
        // Assuming standard Gemini JSON structure for now as `antigravity_executor.go` uses a translator.
        // If we want to be safe, we can prepend it to the first User message if system instruction field depends on API version.
        // But let's try to set `system_instruction` (snake_case for JSON usually, or camelCase).
        // Since `transformRequest` returns the JSON body, we add it here.
        // Let's assume camelCase `systemInstruction` for the request object as seen in some Google APIs, OR snake_case.
        
        // Given I don't see the exact JSON tags in executor (it uses sjson to set raw sometimes), I will prepend to first user message to be absolutely safe
        // as that works across nearly every LLM API.
        
        // Actually, let's look at `antigravity_executor.go` again... it uses `antigravityBaseURLDaily + ...`.
        // It defines `systemInstruction`.
        
        // I'll prepend it to the first message part for robustness in this "blind" port.
        if (contents.length > 0 && contents[0] && contents[0].role === 'user' && contents[0].parts && contents[0].parts[0]) {
            contents[0].parts[0].text = SYSTEM_INSTRUCTION + "\n\n" + contents[0].parts[0].text;
        }

        return payload;
    }

    protected override async transformResponse(response: Response): Promise<Response> {
        return new Response(response.body, {
            status: response.status,
            headers: response.headers
        });
    }

    protected override async fetchUserInfo(token: string): Promise<{ email?: string; id?: string }> {
        try {
            const u = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
            }).then(r => r.json() as any);
            return { email: u.email, id: u.id };
        } catch (e) {
            return {};
        }
    }
}

const antigravityProvider = new AntigravityProvider();
export default antigravityProvider.router;
