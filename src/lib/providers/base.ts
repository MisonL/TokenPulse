import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';
import { credentials } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { TokenManager } from '../auth/token_manager';
import { OAuthService } from '../auth/oauth-client';
import type { AuthConfig, TokenResponse } from '../auth/oauth-client';
import { logger } from '../logger';

import { IdentityResolver } from '../auth/identity-resolver';

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
    transform: (body: ChatRequest, headers: Record<string, string>) => Promise<{ body: any; headers: Record<string, string> }>;
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
        // Defer oauthService init to allow subclasses to define authConfig first
    }

    protected init() {
        this.oauthService = new OAuthService(this.authConfig);
        this.setupRoutes();
    }

    protected setupRoutes() {
        // 1. Auth URL
        this.router.get('/auth/url', (c) => this.handleAuthUrl(c));
        
        // 2. Callback
        this.router.get('/callback', (c) => this.handleCallback(c));
        
        // 3. Chat Completion (Standard OpenAI Interface)
        this.router.post('/v1/chat/completions', (c) => this.handleChatCompletion(c));
        
        // 4. Device Flow Poll (Optional)
        this.router.post('/auth/poll', (c) => this.handleDevicePoll(c));

        // 5. Manual Callback (Fallback for SSH/Remote)
        this.router.post('/auth/callback/manual', (c) => this.handleManualCallback(c));

        // 6. Legacy/Specific endpoints (Optional override)
        this.setupAdditionalRoutes(this.router);
    }

    protected setupAdditionalRoutes(router: Hono) {
        // Override to add provider-specific routes
    }

    // --- Template Methods for Custom Logic ---

    protected abstract getCustomHeaders(token: string, body: any, context?: any): Promise<Record<string, string>>;
    
    /**
     * @deprecated Use requestPipeline for atomic transformations. 
     * Still available for complex legacy logic.
     */
    protected async transformRequest(body: ChatRequest, headers?: any, context?: any): Promise<any> {
        return body;
    }
    
    protected abstract transformResponse(response: Response): Promise<Response>;
    
    protected async fetchUserInfo(token: string): Promise<any> {
        return null;
    }

    // --- Auth Handlers ---

    protected async handleAuthUrl(c: Context): Promise<Response> {
        const { url, state, verifier } = this.oauthService.generateAuthUrl();
        
        // Set cookies
        c.header('Set-Cookie', `${this.providerId}_state=${state}; HttpOnly; Path=/; Max-Age=600`);
        if (verifier) {
             // To set multiple cookies, we might need access to res directly or use append
             // Hono's c.header(key, val, { append: true }) works in v3+ but if TS complains, 
             // we can try using c.res.headers.append if available or just simpler approach: use `c.header` safely.
            c.header('Set-Cookie', `${this.providerId}_verifier=${verifier}; HttpOnly; Path=/; Max-Age=600`, { append: true });
        }
        
        return c.json({ url });
    }

    protected async handleCallback(c: Context) {
        // ... (existing code) ...
        // Note: I am appending the new method after handleCallback
        const code = c.req.query('code');
        const state = c.req.query('state');
        const error = c.req.query('error');
        
        if (error) return c.json({ error }, 400);
        if (!code) return c.json({ error: 'No code provided' }, 400);

        // Verify State
        const cookie = c.req.header('Cookie');
        const storedState = cookie?.match(new RegExp(`${this.providerId}_state=([^;]+)`))?.[1];
        
        // Strict state check
        if (!storedState || state !== storedState) {
            return c.json({ error: 'Invalid State (CSRF Protection)' }, 403);
        }

        // Get Verifier if PKCE
        const verifier = cookie?.match(new RegExp(`${this.providerId}_verifier=([^;]+)`))?.[1];

        try {
            const tokenData = await this.oauthService.exchangeCodeForToken(code, verifier);
            return await this.finalizeAuth(c, tokenData);
        } catch (e: any) {
            logger.error(`${this.providerId} Auth Failed: ${e.message}`);
            return c.json({ error: 'Auth Failed', details: e.message }, 500);
        }
    }

    protected async handleManualCallback(c: Context) {
        const { url } = await c.req.json();
        if (!url) return c.json({ error: 'No URL provided' }, 400);

        try {
            const parsed = new URL(url.startsWith('http') ? url : `http://localhost?${url}`);
            const code = parsed.searchParams.get('code');
            const state = parsed.searchParams.get('state');
            
            if (!code) throw new Error("Could not find 'code' in URL");

            // For manual callback, we might skip CSRF check or assume user knows what they are doing.
            // But we still need a verifier if it was PKCE.
            const cookie = c.req.header('Cookie');
            const verifier = cookie?.match(new RegExp(`${this.providerId}_verifier=([^;]+)`))?.[1];

            const tokenData = await this.oauthService.exchangeCodeForToken(code, verifier);
            return await this.finalizeAuth(c, tokenData);
        } catch (e: any) {
            return c.json({ error: 'Manual Callback Failed', details: e.message }, 400);
        }
    }

    protected async handleDevicePoll(c: Context): Promise<Response> {
        const { device_code } = await c.req.json();
        if (!device_code) return c.json({ error: 'No device_code provided' }, 400);

        try {
            const tokenData = await this.pollDeviceToken(device_code);
            if (!tokenData) {
                // Polling... (standard 400 'authorization_pending' usually handled inside pollDeviceToken or ret)
                // If we return null, it means keep waiting? 
                // Let's assume pollDeviceToken throws if error or returns success data.
                return c.json({ status: 'pending' }, 202);
            }
            // Success
            return await this.finalizeAuth(c, tokenData);
        } catch (e: any) {
             if (e.message.includes('pending') || e.message.includes('slow_down')) {
                 return c.json({ status: 'pending', details: e.message }, 202);
             }
             return c.json({ error: e.message }, 400);
        }
    }

    protected async finalizeAuth(c: Context, tokenData: TokenResponse) {
        // 使用智能身份解析器提取用户信息
        const identity = await IdentityResolver.resolve(tokenData, (token) => this.fetchUserInfo(token));
        
        // 保存凭据
        await this.oauthService.saveCredentials(tokenData, identity.email, {
            ...identity,
            ...tokenData,
            attributes: identity.attributes || {}
        });

        if (c.req.path.includes('poll')) {
            return c.json({ success: true, user: identity.email });
        }
        return c.html(`<h1>Auth Successful</h1><p>${this.providerId} connected as ${identity.email || 'User'}</p><script>setTimeout(() => window.close(), 2000)</script>`);
    }

    protected async getEndpoint(token: string, context?: any): Promise<string> {
        return this.endpoint;
    }

    // --- Device Flow Hooks (Optional) ---

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

    // --- Chat Handler ---

    protected async handleChatCompletion(c: Context) {
        try {
            // 1. Get Token (Auto Refresh)
            // Use TokenManager which should now use OAuthService for refreshing
            // For now, we'll manually implement fetch-based refresh logic or hook into TokenManager
            // defined in token_manager.ts. Ideally TokenManager should allow custom refreshers.
            
            // Hack for now: We need to register this provider's refresher to TokenManager if not already
            // OR we invoke TokenManager with a custom refresher callback here.
            
            const refreshFn = async (rt: string) => {
                return await this.refreshToken(rt);
            };

            const cred = await TokenManager.getValidToken(this.providerId, refreshFn);

            if (!cred) {
                return c.json({ error: `No authenticated ${this.providerId} account` }, 401);
            }

            const token = cred.accessToken;
            const authContext = cred.metadata;

            // 2. Transform Request via Pipeline
            let currentBody = await c.req.json() as ChatRequest;
            let currentHeaders = { ...c.req.header() };

            // Run through pipeline
            for (const interceptor of this.requestPipeline) {
                const result = await interceptor.transform(currentBody, currentHeaders);
                currentBody = result.body;
                currentHeaders = { ...currentHeaders, ...result.headers };
            }

            // Fallback to legacy transformRequest if still used
            // Pass metadata to transformRequest if needed
            const finalPayload = await this.transformRequest(currentBody, currentHeaders, authContext);
            
            // 3. Get Headers
            const headers = await this.getCustomHeaders(token, finalPayload, authContext);
            
            // 4. Get Endpoint
            const endpoint = await this.getEndpoint(token, authContext);

            // 5. Send Request
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(finalPayload)
            });
            
            if (!response.ok) {
                 // Check 401 and maybe force purge token?
                 if (response.status === 401) {
                     // Invalidate token?
                 }
                 const text = await response.text();
                 return new Response(text, { status: response.status, headers: response.headers });
            }

            // 5. Transform Response
            return await this.transformResponse(response);

        } catch (e: any) {
            logger.error(`${this.providerId} Chat Error: ${e.message}`);
            return c.json({ error: e.message }, 500);
        }
    }
}
