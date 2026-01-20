
import { describe, it, expect } from 'bun:test';
import { ThinkingRecovery } from '../src/lib/services/thinking-recovery';

describe('ThinkingRecovery', () => {
    describe('stripThinking', () => {
        it('should remove xml thinking tags from string content', () => {
            const messages = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: '<thinking>thoughts...</thinking>Result' }
            ];
            const result = ThinkingRecovery.stripThinking(messages);
            expect(result[1].content).toBe('Result');
        });

        it('should remove thought parts from array content', () => {
            const messages = [
                { role: 'assistant', content: [
                    { type: 'thought', text: 'thinking' },
                    { type: 'text', text: 'final' }
                ]}
            ];
            const result = ThinkingRecovery.stripThinking(messages);
            expect(result[0].content).toEqual([{ type: 'text', text: 'final' }]);
        });

        it('should clean up thinking property', () => {
             const messages = [
                 { role: 'assistant', content: 'hi', thinking: 'bad' }
             ];
             const result = ThinkingRecovery.stripThinking(messages);
             expect(result[0].thinking).toBeUndefined();
        });
    });

    describe('isThinkingStripped', () => {
        it('should detect stripped marker', () => {
            expect(ThinkingRecovery.isThinkingStripped('...Thinking...')).toBe(true);
            expect(ThinkingRecovery.isThinkingStripped('Regular text')).toBe(false);
        });
    });
});
