import { BaseProvider } from './base';
import type { ChatRequest } from './base';
import type { AuthConfig, TokenResponse } from '../auth/oauth-client';
import type { Context } from 'hono';
import { logger } from '../logger';
import crypto from 'crypto';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_AUTH_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

export class CopilotProvider extends BaseProvider {
    protected providerId = 'copilot';
    protected endpoint = 'https://api.githubcopilot.com/chat/completions';
    
    protected authConfig: AuthConfig = {
        providerId: 'copilot',
        clientId: GITHUB_CLIENT_ID,
        authUrl: DEVICE_AUTH_URL,
        tokenUrl: TOKEN_URL,
        redirectUri: '',
        scopes: ['read:user', 'user:email', 'copilot'],
        customTokenParams: {
            client_id: GITHUB_CLIENT_ID
        }
    };

    constructor() {
        super();
        this.init();
    }

    protected override async getCustomHeaders(token: string, body: any, context?: any): Promise<Record<string, string>> {
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Editor-Version': 'vscode/1.96.2',
            'Editor-Plugin-Version': 'copilot/1.254.0',
            'User-Agent': 'GitHubCopilot/1.254.0',
            'Openai-Organization': 'github-copilot',
            'Openai-Intent': 'conversation-panel',
            'X-Request-Id': crypto.randomUUID()
        };
    }

    protected override async transformResponse(response: Response): Promise<Response> {
        return new Response(response.body, { status: response.status, headers: response.headers });
    }

    /**
     * 最优实现：在 finalizeAuth 中处理两阶段转换
     */
    protected override async finalizeAuth(c: Context, githubToken: TokenResponse) {
        try {
            const finalTokenData = await this.exchangeGithubForCopilot(githubToken);
            return await super.finalizeAuth(c, finalTokenData);
        } catch (e: any) {
            logger.error('Copilot Auth Finalization Failed:', e);
            return c.json({ error: e.message }, 500);
        }
    }

    /**
     * 能力：特有的刷新逻辑 (GitHub Access Token -> Copilot Access Token)
     */
    protected override async refreshToken(githubAccessToken: string): Promise<TokenResponse> {
        return await this.exchangeGithubForCopilot({ access_token: githubAccessToken } as TokenResponse);
    }

    private async exchangeGithubForCopilot(githubToken: TokenResponse): Promise<TokenResponse> {
        logger.info('Copilot: Exchanging GitHub token for Copilot token...');
        const resp = await fetch(COPILOT_TOKEN_URL, {
            headers: {
                'Authorization': `Bearer ${githubToken.access_token}`,
                'User-Agent': 'GitHubCopilot/1.254.0',
                'Accept': 'application/json'
            }
        });

        if (!resp.ok) throw new Error("Failed to get Copilot token: " + await resp.text());
        
        const copilotData = await resp.json() as any;
        
        return {
            access_token: copilotData.token,
            refresh_token: githubToken.access_token, // 保持 GitHub 令牌作为下次刷新的源
            expires_in: copilotData.expires_at - Math.floor(Date.now() / 1000),
            ...copilotData
        };
    }

    protected override async handleAuthUrl(c: Context) {
        try {
            const deviceResp = await this.oauthService.initiateDeviceFlow(DEVICE_AUTH_URL);
            return c.json({
                url: deviceResp.verification_uri_complete || deviceResp.verification_uri,
                code: deviceResp.user_code,
                device_code: deviceResp.device_code
            });
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    }

    protected override async handleDevicePoll(c: Context) {
        const { device_code } = await c.req.json();
        try {
            const tokenData = await this.oauthService.pollDeviceToken(device_code);
            return await this.finalizeAuth(c, tokenData);
        } catch (e: any) {
            if (e.message.includes('authorization_pending')) return c.json({ status: 'pending' }, 202);
            return c.json({ error: e.message }, 400);
        }
    }
    protected override async fetchUserInfo(token: string): Promise<{ email?: string; id?: string; metadata?: any }> {
        // Copilot tokens are JWTs containing the GitHub user login in 'sub'
        try {
            const { decodeJwt } = await import('./utils');
            const data = decodeJwt(token);
            if (data) {
                return {
                    id: data.sub, // GitHub Login
                    email: data.email, // Often missing in Copilot token, but 'sub' identifies the user
                    metadata: {
                        sku: data.sku,
                        tid: data.tid
                    }
                };
            }
        } catch (e) {
            // ignore
        }
        return {};
    }
}

const copilotProvider = new CopilotProvider();
export default copilotProvider.router;
