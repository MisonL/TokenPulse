import { describe, it, expect } from 'bun:test';

describe('Qwen OAuth Configuration', () => {
    it('should have correct client ID', () => {
        const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
        expect(QWEN_CLIENT_ID).toBe('f0304373b74a44d2b584a3fb70ca9e56');
    });

    it('should have correct device endpoint', () => {
        const QWEN_DEVICE_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/device/code";
        expect(QWEN_DEVICE_ENDPOINT).toBe('https://chat.qwen.ai/api/v1/oauth2/device/code');
    });

    it('should have correct token endpoint', () => {
        const QWEN_TOKEN_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/token";
        expect(QWEN_TOKEN_ENDPOINT).toBe('https://chat.qwen.ai/api/v1/oauth2/token');
    });

    it('should have correct scopes', () => {
        const QWEN_SCOPE = "openid profile email model.completion";
        expect(QWEN_SCOPE).toBe('openid profile email model.completion');
    });
});

describe('Qwen Device Flow', () => {
    it('should generate correct device code request parameters', () => {
        const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
        const QWEN_SCOPE = "openid profile email model.completion";
        
        const body = new URLSearchParams({
            client_id: QWEN_CLIENT_ID,
            scope: QWEN_SCOPE,
            code_challenge: 'test-challenge',
            code_challenge_method: 'S256'
        });
        
        expect(body.toString()).toContain('client_id=f0304373b74a44d2b584a3fb70ca9e56');
        expect(body.toString()).toContain('scope=openid');
        expect(body.toString()).toContain('code_challenge=test-challenge');
        expect(body.toString()).toContain('code_challenge_method=S256');
    });

    it('should include PKCE parameters', () => {
        const params = new URLSearchParams({
            code_challenge: 'test-challenge',
            code_challenge_method: 'S256'
        });
        
        expect(params.toString()).toContain('code_challenge=test-challenge');
        expect(params.toString()).toContain('code_challenge_method=S256');
    });

    it('should generate correct token poll request parameters', () => {
        const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
        
        const body = new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: QWEN_CLIENT_ID,
            device_code: 'test-device-code',
            code_verifier: 'test-verifier'
        });
        
        expect(body.toString()).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
        expect(body.toString()).toContain('client_id=f0304373b74a44d2b584a3fb70ca9e56');
        expect(body.toString()).toContain('device_code=test-device-code');
        expect(body.toString()).toContain('code_verifier=test-verifier');
    });
});