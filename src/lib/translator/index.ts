export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string | any[];
};

export type GeminiContent = {
    role: 'user' | 'model'; // Gemini uses 'model' not 'assistant'
    parts: { text: string }[];
};

export class Translators {
    static openAIToGemini(messages: Message[]): { contents: GeminiContent[], systemInstruction?: { parts: { text: string }[] } } {
        const contents: GeminiContent[] = [];
        let systemParts: { text: string }[] = [];

        for (const m of messages) {
            if (m.role === 'system') {
                systemParts.push({ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
                continue;
            }
            
            contents.push({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
            });
        }
        
        // Gemini API structure for system instruction is separate from contents
        return { 
            contents, 
            ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {})
        };
    }

    static anthropicToGemini(messages: Message[], system?: string): { contents: GeminiContent[], systemInstruction?: { parts: { text: string }[] } } {
        // Anthropic: messages [{role: 'user', content: [...]}]
        // System is top-level param usually.
        
        const contents: GeminiContent[] = messages.map(m => {
            const role = m.role === 'user' ? 'user' : 'model';
            let parts: { text: string }[] = [];
            
            if (typeof m.content === 'string') {
                parts = [{ text: m.content }];
            } else if (Array.isArray(m.content)) {
                 parts = m.content.map(c => {
                    const typedC = c as { text?: string, type?: string };
                    return { text: typedC.text || JSON.stringify(c) };
                 });
            }

            return { role, parts };
        });

        return {
            contents,
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {})
        };
    }
}
