
import { describe, it, expect } from 'bun:test';
import { ThinkingApplier } from '../src/lib/services/thinking-applier';
import type { ThinkingConfig } from '../src/lib/services/thinking-types';

describe('ThinkingApplier', () => {
    describe('applyToGemini', () => {
        it('should return payload unchanged if no config', () => {
            const payload = { generationConfig: {} };
            const result = ThinkingApplier.applyToGemini(payload, null as any, 'gemini-2.0-flash');
            expect(result).toEqual(payload);
        });

        it('should remove thinkingConfig when mode is NONE', () => {
            const payload = { generationConfig: { thinkingConfig: { includeThoughts: true } } };
            const config: ThinkingConfig = { mode: 'none' };
            const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-2.0-flash');
            expect(result.generationConfig.thinkingConfig).toBeUndefined();
        });

        it('should apply AUTO mode correct defaults for Gemini 2.5', () => {
             const payload = {};
             const config: ThinkingConfig = { mode: 'auto' };
             const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-2.0-flash');
             expect(result.generationConfig.thinkingConfig).toEqual({
                 includeThoughts: true,
                 thinkingBudget: -1
             });
        });

        it('should apply AUTO mode correct defaults for Gemini 3', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'auto' };
            const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-3.0-pro');
            expect(result.generationConfig.thinkingConfig).toEqual({
                includeThoughts: true
            });
       });

       it('should apply BUDGET mode correctly', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'budget', budget: 8192 };
            const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-2.0-flash');
            expect(result.generationConfig.thinkingConfig).toEqual({
                includeThoughts: true,
                thinkingBudget: 8192
            });
       });

       it('should map BUDGET to LEVEL for Gemini 3', () => {
           const payload = {};
           const config: ThinkingConfig = { mode: 'budget', budget: 1024 }; // Should be low
           const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-3.0-pro');
           expect(result.generationConfig.thinkingConfig).toEqual({
               includeThoughts: true,
               thinkingLevel: 'low'
           });
       });
    });

    describe('applyToClaude', () => {
        it('should remove thinking when mode is NONE', () => {
            const payload = { thinking: { type: 'enabled' } };
            const config: ThinkingConfig = { mode: 'none' };
            const result = ThinkingApplier.applyToClaude(payload, config);
            expect(result.thinking).toBeUndefined();
        });

        it('should apply BUDGET correctly', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'budget', budget: 12000 };
            const result = ThinkingApplier.applyToClaude(payload, config);
            expect(result.thinking).toEqual({
                type: 'enabled',
                budget_tokens: 12000
            });
        });

        it('should enforce minimum budget', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'budget', budget: 100 };
            const result = ThinkingApplier.applyToClaude(payload, config);
            expect(result.thinking.budget_tokens).toBe(1024);
        });
    });
});
