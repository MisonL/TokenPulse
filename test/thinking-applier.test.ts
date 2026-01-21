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

        it('should remove thinkingConfig when mode is none', () => {
            const payload = { generationConfig: { thinkingConfig: { includeThoughts: true } } };
            const config: ThinkingConfig = { mode: 'none' };
            const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-2.0-flash');
            expect(result.generationConfig.thinkingConfig).toBeUndefined();
        });

        it('should apply auto mode correct defaults for Gemini 2.5', () => {
             const payload = {};
             const config: ThinkingConfig = { mode: 'auto' };
             const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-2.0-flash');
             expect(result.generationConfig.thinkingConfig).toEqual({
                 includeThoughts: true,
                 thinkingBudget: -1
             });
        });

        it('should apply auto mode correct defaults for Gemini 3', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'auto' };
            const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-3.0-pro');
            expect(result.generationConfig.thinkingConfig).toEqual({
                includeThoughts: true
            });
       });

       it('should apply budget mode correctly', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'budget', budget: 8192 };
            const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-2.0-flash');
            expect(result.generationConfig.thinkingConfig).toEqual({
                includeThoughts: true,
                thinkingBudget: 8192
            });
       });

       it('should map budget to level for Gemini 3', () => {
           const payload = {};
           const config: ThinkingConfig = { mode: 'budget', budget: 1024 }; 
           const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-3.0-pro');
           expect(result.generationConfig.thinkingConfig).toEqual({
               includeThoughts: true,
               thinkingLevel: 'low'
           });
       });

       it('should handle level mode with mapping for Gemini 2.5', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'level', level: 'high' };
            const result = ThinkingApplier.applyToGemini(payload, config, 'gemini-2.0-flash');
            expect(result.generationConfig.thinkingConfig.thinkingBudget).toBe(8192);
       });

       it('should map various budget levels for Gemini 3', () => {
            const p = {};
            expect(ThinkingApplier.applyToGemini(p, { mode: 'budget', budget: 5000 }, 'gemini-3').generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
            expect(ThinkingApplier.applyToGemini(p, { mode: 'budget', budget: 10000 }, 'gemini-3').generationConfig.thinkingConfig.thinkingLevel).toBe('high');
            expect(ThinkingApplier.applyToGemini(p, { mode: 'budget', budget: 1000 }, 'gemini-3').generationConfig.thinkingConfig.thinkingLevel).toBe('low');
       });

       it('should handle level mode for Gemini 3 directly', () => {
            const result = ThinkingApplier.applyToGemini({}, { mode: 'level', level: 'high' }, 'gemini-3');
            expect(result.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
       });
    });

    describe('applyToClaude', () => {
        it('should remove thinking when mode is none', () => {
            const payload = { thinking: { type: 'enabled' } };
            const config: ThinkingConfig = { mode: 'none' };
            const result = ThinkingApplier.applyToClaude(payload, config);
            expect(result.thinking).toBeUndefined();
        });

        it('should apply budget correctly', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'budget', budget: 12000 };
            const result = ThinkingApplier.applyToClaude(payload, config);
            expect(result.thinking).toEqual({
                type: 'enabled',
                budget_tokens: 12000
            });
        });

        it('should map level to budget for Claude', () => {
             const result = ThinkingApplier.applyToClaude({}, { mode: 'level', level: 'low' });
             expect(result.thinking.budget_tokens).toBe(2048);
             
             const result2 = ThinkingApplier.applyToClaude({}, { mode: 'level', level: 'xhigh' });
             expect(result2.thinking.budget_tokens).toBe(16384);
        });

        it('should handle auto mode with default budget for Claude', () => {
            const result = ThinkingApplier.applyToClaude({}, { mode: 'auto' });
            expect(result.thinking.budget_tokens).toBe(4096);
        });

        it('should enforce minimum budget', () => {
            const payload = {};
            const config: ThinkingConfig = { mode: 'budget', budget: 100 };
            const result = ThinkingApplier.applyToClaude(payload, config);
            expect(result.thinking.budget_tokens).toBe(1024);
        });
    });
});
