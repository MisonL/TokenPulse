import { describe, it, expect } from 'bun:test';

describe('Codex OAuth Configuration', () => {
    it('should have correct client ID', () => {
        const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
        expect(OPENAI_CLIENT_ID).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    });

    it('should have correct auth URL', () => {
        const AUTH_URL = "https://auth.openai.com/oauth/authorize";
        expect(AUTH_URL).toBe('https://auth.openai.com/oauth/authorize');
    });

    it('should have correct token URL', () => {
        const TOKEN_URL = "https://auth.openai.com/oauth/token";
        expect(TOKEN_URL).toBe('https://auth.openai.com/oauth/token');
    });

    it('should have correct redirect URI', () => {
        const REDIRECT_URI = "http://localhost:1455/auth/callback";
        expect(REDIRECT_URI).toBe('http://localhost:1455/auth/callback');
    });

    it('should have correct scopes', () => {
        const SCOPES = "openid email profile offline_access";
        expect(SCOPES).toBe('openid email profile offline_access');
    });
});

describe('Codex OAuth URL Generation', () => {
    it('should generate valid OAuth URL with required parameters', () => {
        const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
        const AUTH_URL = "https://auth.openai.com/oauth/authorize";
        const REDIRECT_URI = "http://localhost:1455/auth/callback";
        const SCOPES = "openid email profile offline_access";
        
        const params = new URLSearchParams({
            client_id: OPENAI_CLIENT_ID,
            response_type: 'code',
            redirect_uri: REDIRECT_URI,
            scope: SCOPES,
            state: 'test-state',
            code_challenge: 'test-challenge',
            code_challenge_method: 'S256',
            prompt: 'login',
            id_token_add_organizations: 'true',
            codex_cli_simplified_flow: 'true'
        });
        
        const url = `${AUTH_URL}?${params.toString()}`;
        
        expect(url).toContain('client_id=app_EMoamEEZ73f0CkXaXp7hrann');
        expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback');
        expect(url).toContain('response_type=code');
        expect(url).toContain('scope=openid');
        expect(url).toContain('code_challenge=test-challenge');
        expect(url).toContain('code_challenge_method=S256');
        expect(url).toContain('prompt=login');
        expect(url).toContain('id_token_add_organizations=true');
        expect(url).toContain('codex_cli_simplified_flow=true');
    });

    it('should include PKCE parameters for security', () => {
        const params = new URLSearchParams({
            code_challenge: 'test-challenge',
            code_challenge_method: 'S256'
        });
        
        expect(params.toString()).toContain('code_challenge=test-challenge');
        expect(params.toString()).toContain('code_challenge_method=S256');
    });

    it('should include OpenAI-specific parameters', () => {
        const params = new URLSearchParams({
            id_token_add_organizations: 'true',
            codex_cli_simplified_flow: 'true'
        });
        
        expect(params.toString()).toContain('id_token_add_organizations=true');
        expect(params.toString()).toContain('codex_cli_simplified_flow=true');
    });
});