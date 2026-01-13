import { describe, it, expect, beforeEach } from 'bun:test';
import { generateClaudeAuthUrl } from '../src/lib/auth/claude';

describe('Claude OAuth', () => {
    beforeEach(() => {
        // Clear any pending states before each test
        const pendingStates = (global as any).__pendingStates;
        if (pendingStates) {
            pendingStates.clear();
        }
    });

    it('should generate valid OAuth URL with required parameters', () => {
        const url = generateClaudeAuthUrl();
        
        expect(url).toBeDefined();
        expect(url).toContain('https://claude.ai/oauth/authorize');
        expect(url).toContain('client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e');
        expect(url).toContain('response_type=code');
        expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback');
        expect(url).toContain('scope=org%3Acreate_api_key');
        expect(url).toContain('code_challenge=');
        expect(url).toContain('code_challenge_method=S256');
        expect(url).toContain('state=');
    });

    it('should include PKCE parameters for security', () => {
        const url = generateClaudeAuthUrl();
        
        expect(url).toContain('code_challenge=');
        expect(url).toContain('code_challenge_method=S256');
    });

    it('should generate unique state for each request', () => {
        const url1 = generateClaudeAuthUrl();
        const url2 = generateClaudeAuthUrl();
        
        const state1 = url1.match(/state=([a-f0-9]+)/)?.[1];
        const state2 = url2.match(/state=([a-f0-9]+)/)?.[1];
        
        expect(state1).toBeDefined();
        expect(state2).toBeDefined();
        expect(state1).not.toBe(state2);
    });

    it('should generate unique code challenge for each request', () => {
        const url1 = generateClaudeAuthUrl();
        const url2 = generateClaudeAuthUrl();
        
        const challenge1 = url1.match(/code_challenge=([a-zA-Z0-9_-]+)/)?.[1];
        const challenge2 = url2.match(/code_challenge=([a-zA-Z0-9_-]+)/)?.[1];
        
        expect(challenge1).toBeDefined();
        expect(challenge2).toBeDefined();
        expect(challenge1).not.toBe(challenge2);
    });

    it('should use correct client ID', () => {
        const url = generateClaudeAuthUrl();
        expect(url).toContain('client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    });

    it('should include all required scopes', () => {
        const url = generateClaudeAuthUrl();
        expect(url).toContain('org%3Acreate_api_key');
        expect(url).toContain('user%3Aprofile');
        expect(url).toContain('user%3Ainference');
    });
});