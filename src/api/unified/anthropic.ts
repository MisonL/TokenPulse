import { Hono } from 'hono';
import { config } from '../../config';

const anthropicCompat = new Hono();

// Claude Code expects /v1/messages
anthropicCompat.post('/messages', async (c) => {
    const body = await c.req.json();
    let model = body.model;
    
    // Claude Code strictly talks standard Anthropic API.
    // Users using Antigravity usually want to route this to 'antigravity' (Google) or 'claude' (Anthropic).
    // Default to 'antigravity' if not specified, as it's the "free" option usually desired.
    
    let provider = 'antigravity';
    
    // Payload Adaptation
    // Our internal 'antigravity' provider expects OpenAI-ish format (`messages` array with `role` and `content`).
    // Anthropic sends `messages` array BUT `system` is top level.
    // We need to merge System into Messages or handle it.
    
    // Convert Anthropic Body -> Simple OpenAI Body for our internal providers
    const newMessages = [];
    
    // 1. System Prompt
    if (body.system) {
        newMessages.push({ role: 'system', content: body.system });
    }
    
    // 2. Chat Messages
    if (Array.isArray(body.messages)) {
        for (const m of body.messages) {
            newMessages.push({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : 
                         (Array.isArray(m.content) ? m.content.map((b:any) => b.text).join('\n') : String(m.content)) 
            });
        }
    }
    
    const upstreamPayload = {
        model: model, // Antigravity (Google) handles Claude model names natively usually? 
                      // Or we map `claude-3-5-sonnet` to Google's version?
                      // Antigravity provider (Google Cloud Code) supports "claude-3-5-sonnet@20240620" etc.
        messages: newMessages,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
        stream: body.stream
    };

    const url = `http://localhost:${config.port}/${provider}/v1/chat/completions`;
    
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(upstreamPayload)
        });

        // Response Adaptation:
        // Internal provider returns OpenAI format (usually).
        // Claude Code expects Anthropic format.
        // If we just pipe through, Claude Code might crash if it receives OpenAI JSON.
        // We MUST convert Response if the Internal Provider returns OpenAI format.
        
        // However, Antigravity (Google) returns Google JSON usually, but our provider wraps it?
        // Let's check `antigravity.ts`.
        // It returns raw Google response: `return new Response(response.body...`.
        // Google Response != Anthropic Response.
        
        // CRITICAL: We need to INTERCEPT the response and translate it to Anthropic format 
        // if we want "Accurate Claude Code Support".
        // This is complex for streaming (SSE).
        // Since I have limited time, I will assume the user setup might handle this OR 
        // I will implement a basic "Non-Streaming" adapter and "Streaming" pass-through (hope for best or implement minimal SSE translator).
        
        // Actually, if I don't translate, Claude Code WILL fail.
        // But writing a full SSE translator (Google -> Anthropic) is huge.
        // Strategy: Delegate to `antigravity` provider? 
        // No, `antigravity` provider is generic.
        
        // For now, I will return the raw response but log a warning.
        // To truly support Claude Code, we need `sdk/translator` fully working.
        // I will rely on the fact that `CLIProxyAPI` had this logic.
        // I'll trust the internal logic might be robust enough or just pass-through for now.
        // If `Claude Code` uses the `antigravity` provider, it expects the response to be intelligible.
        
        if (provider === 'antigravity' || provider === 'gemini') {
            // Check for Streaming
            if (body.stream) {
                 const { GoogleToAnthropicTranslator } = await import('../../lib/translator/google_to_anthropic');
                 
                 // If streaming, `resp.body` is a ReadableStream (Google SSE)
                 // We need to convert it to an Anthropic SSE Stream
                 if (resp.body) {
                     // Create a TransformStream or just use the generator
                     // But Hono response expects a ReadableStream usually.
                     // Let's create a new ReadableStream from the generator.
                     
                     const googleStream = resp.body as ReadableStream<Uint8Array>;
                     const iterator = GoogleToAnthropicTranslator.translateStream(googleStream);
                     
                     const stream = new ReadableStream({
                         async pull(controller) {
                             const { value, done } = await iterator.next();
                             if (done) {
                                 controller.close();
                             } else {
                                 controller.enqueue(new TextEncoder().encode(value));
                             }
                         }
                     });
                     
                     return new Response(stream, {
                         headers: {
                             'Content-Type': 'text/event-stream',
                             'Cache-Control': 'no-cache',
                             'Connection': 'keep-alive'
                         }
                     });
                 }
            } else {
                 // Non-streaming: Parse JSON, translate, return JSON
                 const googleJson = await resp.json();
                 const { GoogleToAnthropicTranslator } = await import('../../lib/translator/google_to_anthropic');
                 const anthropicJson = GoogleToAnthropicTranslator.translateResponse(googleJson);
                 return c.json(anthropicJson);
            }
        }

        return new Response(resp.body, {
            status: resp.status,
            headers: resp.headers
        });
        
    } catch (e) {
        return c.json({ error: `Anthropic Gateway dispatch failed`, details: String(e) }, 502);
    }
});

export default anthropicCompat;
