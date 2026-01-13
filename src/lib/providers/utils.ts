
export const AgenticSystemPrompt = `You are an intelligent programming assistant.

When asked to write code, please follow these requirements:
1. **Understand the Goal**: deeply understand the user's requirements.
2. **Logic Design**: Design detailed logical steps and algorithms.
3. **Code Implementation**: Write high-quality, maintainable code.
4. **Testing & Verification**: Consider edge cases and error handling.

You have access to a set of tools. You must use these tools to accomplish the task.
If you need to read a file, use the read_file tool.
If you need to list a directory, use the list_dir tool.
If you need to execute a command, use the run_command tool.

Please think step-by-step.`;

export function shortenToolName(name: string): string {
    const limit = 64;
    if (name.length <= limit) {
        return name;
    }
    // For MCP tools, try to preserve prefix and last segment
    if (name.startsWith("mcp__")) {
        const idx = name.lastIndexOf("__");
        if (idx > 0) {
            const cand = "mcp__" + name.substring(idx + 2);
            if (cand.length > limit) {
                return cand.substring(0, limit);
            }
            return cand;
        }
    }
    return name.substring(0, limit);
}

export function checkThinkingMode(body: any, headers?: Record<string, string>): boolean {
    // Check Anthropic-Beta header first (Claude CLI uses this)
    if (headers) {
        // checks for 'anthropic-beta' case-insensitively
        const betaHeader = Object.keys(headers).find(key => key.toLowerCase() === 'anthropic-beta');
        if (betaHeader) {
            const val = headers[betaHeader];
            if (val && val.includes('interleaved-thinking')) {
                return true;
            }
        }
    }

    // Check OpenAI format: reasoning_effort parameter
    // Valid values: "low", "medium", "high", "auto" (not "none")
    if (body.reasoning_effort && body.reasoning_effort !== 'none') {
        return true;
    }

    // Check AMP/Cursor format: <thinking_mode>interleaved</thinking_mode> in system prompt
    // This requires checking the messages for a system prompt and scanning it, 
    // but the reference implementation checks the *raw body string* for this tag.
    // Since we are dealing with a parsed body object here, we might check known message locations 
    // or just rely on the other signals for now. 
    // If the input was raw JSON string bytes, we could string search it.
    // Let's iterate messages if present.
    if (body.messages && Array.isArray(body.messages)) {
        const systemMsg = body.messages.find((m: any) => m.role === 'system');
        if (systemMsg && typeof systemMsg.content === 'string') {
             if (systemMsg.content.includes('<thinking_mode>') && systemMsg.content.includes('</thinking_mode>')) {
                 const content = systemMsg.content as string;
                 const start = content.indexOf('<thinking_mode>');
                 const end = content.indexOf('</thinking_mode>');
                 if (start >= 0 && end > start) {
                     const val = content.substring(start + '<thinking_mode>'.length, end);
                     if (val === 'interleaved' || val === 'enabled') {
                         return true;
                     }
                 }
             }
        }
    }

    // Check model name for thinking hints
    if (body.model) {
        const modelLower = body.model.toLowerCase();
        if (modelLower.includes('thinking') || modelLower.includes('-reason')) {
            return true;
        }
    }

    return false;
}

export function decodeJwt(token: string): any {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = parts[1];
        if (!payload) return null;
        const padded = payload.padEnd(payload.length + (4 - payload.length % 4) % 4, '=');
        const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}
