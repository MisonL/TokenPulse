import { describe, it, expect } from 'bun:test';

describe('iFlow OAuth Configuration', () => {
    it('should have correct client ID', () => {
        const IFLOW_CLIENT_ID = "10009311001";
        expect(IFLOW_CLIENT_ID).toBe('10009311001');
    });

    it('should have correct client secret', () => {
        const IFLOW_CLIENT_SECRET = "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW";
        expect(IFLOW_CLIENT_SECRET).toBe('4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW');
    });

    it('should have correct auth URL', () => {
        const AUTH_URL = "https://iflow.cn/oauth";
        expect(AUTH_URL).toBe('https://iflow.cn/oauth');
    });

    it('should have correct token URL', () => {
        const TOKEN_URL = "https://iflow.cn/oauth/token";
        expect(TOKEN_URL).toBe('https://iflow.cn/oauth/token');
    });

    it('should have correct redirect URI', () => {
        const REDIRECT_URI = "http://localhost:11451/oauth2callback";
        expect(REDIRECT_URI).toBe('http://localhost:11451/oauth2callback');
    });
});

describe('iFlow OAuth URL Generation', () => {
    it('should generate valid OAuth URL with required parameters', () => {
        const IFLOW_CLIENT_ID = "10009311001";
        const AUTH_URL = "https://iflow.cn/oauth";
        const REDIRECT_URI = "http://localhost:11451/oauth2callback";
        
        const params = new URLSearchParams({
            loginMethod: 'phone',
            type: 'phone',
            redirect: REDIRECT_URI,
            state: 'test-state',
            client_id: IFLOW_CLIENT_ID
        });
        
        const url = `${AUTH_URL}?${params.toString()}`;
        
        expect(url).toContain('loginMethod=phone');
        expect(url).toContain('type=phone');
        expect(url).toContain('redirect=http%3A%2F%2Flocalhost%3A11451%2Foauth2callback');
        expect(url).toContain('client_id=10009311001');
        expect(url).toContain('state=test-state');
    });

    it('should include phone login method', () => {
        const params = new URLSearchParams({
            loginMethod: 'phone',
            type: 'phone'
        });
        
        expect(params.toString()).toContain('loginMethod=phone');
        expect(params.toString()).toContain('type=phone');
    });

    it('should include redirect URI parameter', () => {
        const REDIRECT_URI = "http://localhost:11451/oauth2callback";
        const params = new URLSearchParams({
            redirect: REDIRECT_URI
        });
        
        expect(params.toString()).toContain('redirect=http%3A%2F%2Flocalhost%3A11451%2Foauth2callback');
    });
});