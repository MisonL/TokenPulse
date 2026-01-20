
import { describe, it, expect } from 'bun:test';
import { DeviceManager } from '../src/lib/services/device-manager';

describe('DeviceManager', () => {
    it('should generate consistent profile structure', async () => {
        // Mock DB implementation might be tricky, so we test generateProfile which is private
        // Or we test behavior via public API if we mock DB
        // For simplicity in this env, let's access the private method via 'any' casting 
        // to strictly test the generation logic first.
        
        const seed = 'test@example.com';
        const profile = (DeviceManager as any).generateProfile(seed);
        
        expect(profile.machineId).toBeDefined();
        expect(profile.userAgent).toContain('antigravity');
        expect(profile.sqmId).toMatch(/\{[A-F0-9-]+\}/);
    });

    it('should inject headers correctly', () => {
        const profile = {
            machineId: 'm1',
            devDeviceId: 'd1',
            sqmId: 's1',
            userAgent: 'ua1'
        };
        const headers = { 'Content-Type': 'application/json' };
        
        const newHeaders = DeviceManager.injectHeaders(headers, profile);
        
        expect(newHeaders['X-Antigravity-Machine-Id']).toBe('m1');
        expect(newHeaders['User-Agent']).toBe('ua1');
        expect(newHeaders['Content-Type']).toBe('application/json');
    });
});
