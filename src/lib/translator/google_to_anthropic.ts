// Google (Gemini/Antigravity) -> Anthropic Response Translator
// Critical for Claude Code compatibility.

export class GoogleToAnthropicTranslator {
  // Convert a single non-streaming response body
  static translateResponse(googleBody: any): any {
    // Google: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
    // Anthropic: { id: "msg_...", type: "message", role: "assistant", content: [{ type: "text", text: "..." }] }

    const candidate = googleBody.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || "";

    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: text }],
    };
  }

  // Convert an SSE Stream
  // Input: ReadableStream of Uint8Array (Google SSE)
  // Output: Generator/Stream of Anthropic SSE Strings
  static async *translateStream(
    googleStream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<string> {
    const reader = googleStream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Generate a consistent message ID for this stream
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Anthropic Stream Protocol Start
    yield `event: message_start\ndata: {"type":"message_start","message":{"id":"${messageId}","type":"message","role":"assistant","content":[]}}\n\n`;
    yield `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue; // Google doesn't usually send [DONE] but in case proxy does

            try {
              const googleChunk = JSON.parse(dataStr);
              const text =
                googleChunk.candidates?.[0]?.content?.parts?.[0]?.text;

              if (text) {
                // Anthropic Delta
                const anthropicChunk = {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: text },
                };
                yield `event: content_block_delta\ndata: ${JSON.stringify(anthropicChunk)}\n\n`;
              }
            } catch (e) {
              // Ignore parsing errors for non-JSON lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Anthropic Stream Protocol End
    yield `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`;
    yield `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n`;
    yield `event: message_stop\ndata: {"type":"message_stop"}\n\n`;
  }
}
