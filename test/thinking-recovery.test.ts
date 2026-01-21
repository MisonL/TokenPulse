
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

    describe('recover', () => {
        it('should strip thinking if conversation is too long (> 20)', () => {
            const messages = Array(21).fill({ role: 'user', content: 'msg' });
            messages.push({ role: 'assistant', content: '<thinking>Long thoughts</thinking>Response' });
            
            const result = ThinkingRecovery.recover(messages);
            expect(result.wasModified).toBe(true);
            expect(result.recoveryAction).toBe('strip_thinking');
            expect(result.messages[21].content).toBe('Response');
        });

        it('should detect potential loops and strip thinking', () => {
            const assistantMsg = { role: 'assistant', content: 'short', thinking: 'long thinking signature' };
            const messages = [
                { role: 'user', content: '1' }, assistantMsg,
                { role: 'user', content: '2' }, assistantMsg,
                { role: 'user', content: '3' }, assistantMsg,
                { role: 'user', content: '4' }, assistantMsg,
                { role: 'user', content: '5' }, assistantMsg,
                { role: 'user', content: '6' }, assistantMsg,
            ];
            
            const result = ThinkingRecovery.recover(messages);
            expect(result.wasModified).toBe(true);
            expect(result.recoveryAction).toBe('strip_thinking');
        });

        it('should return unmodified if state is healthy', () => {
            const messages = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' }
            ];
            const result = ThinkingRecovery.recover(messages);
            expect(result.wasModified).toBe(false);
        });
    });

    describe('isThinkingStripped', () => {
        it('should detect stripped marker', () => {
            expect(ThinkingRecovery.isThinkingStripped('...Thinking...')).toBe(true);
            expect(ThinkingRecovery.isThinkingStripped('Regular text')).toBe(false);
        });
    });
});
