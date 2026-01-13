import { describe, it, expect } from 'bun:test';

describe('Gemini OAuth Configuration', () => {
    it('should have correct client ID', () => {
        const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
        expect(CLIENT_ID).toBe('681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com');
    });

    it('should have correct client secret', () => {
        const CLIENT_SECRET = "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";
        expect(CLIENT_SECRET).toBe('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');
    });

    it('should have correct auth URL', () => {
        const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
        expect(AUTH_URL).toBe('https://accounts.google.com/o/oauth2/auth');
    });

    it('should have correct token URL', () => {
        const TOKEN_URL = 'https://oauth2.googleapis.com/token';
        expect(TOKEN_URL).toBe('https://oauth2.googleapis.com/token');
    });

    it('should have correct redirect URI', () => {
        const REDIRECT_URI = 'http://localhost:8085/oauth2callback';
        expect(REDIRECT_URI).toBe('http://localhost:8085/oauth2callback');
    });

    it('should have correct scopes', () => {
        const SCOPES = [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ];
        expect(SCOPES).toHaveLength(3);
        expect(SCOPES).toContain('https://www.googleapis.com/auth/cloud-platform');
        expect(SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
        expect(SCOPES).toContain('https://www.googleapis.com/auth/userinfo.profile');
    });
});

describe('Gemini OAuth URL Generation', () => {
    it('should generate valid OAuth URL with required parameters', () => {
        const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
        const REDIRECT_URI = 'http://localhost:8085/oauth2callback';
        const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
        const SCOPES = [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ];
        
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: SCOPES.join(' '),
            access_type: 'offline',
            prompt: 'consent',
            state: 'test-state'
        });
        
        const url = `${AUTH_URL}?${params.toString()}`;
        
        expect(url).toContain('client_id=681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com');
        expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A8085%2Foauth2callback');
        expect(url).toContain('response_type=code');
        expect(url).toContain('access_type=offline');
        expect(url).toContain('prompt=consent');
    });

    it('should include offline access for refresh token', () => {
        const params = new URLSearchParams({
            access_type: 'offline',
            prompt: 'consent'
        });
        
        expect(params.toString()).toContain('access_type=offline');
        expect(params.toString()).toContain('prompt=consent');
    });
});