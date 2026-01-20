// Google (Gemini/Antigravity) -> OpenAI Response Translator

export class GoogleToOpenAITranslator {
  // Convert a single non-streaming response body
  static translateResponse(googleBody: any, model: string): any {
    const candidate = googleBody.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || "";

    return {
      id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  // Convert an SSE Stream
  static async *translateStream(
    googleStream: ReadableStream<Uint8Array>,
    model: string,
  ): AsyncGenerator<string> {
    const reader = googleStream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const completionId = `chatcmpl-${Math.random().toString(36).substr(2, 9)}`;
    const created = Math.floor(Date.now() / 1000);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const googleChunk = JSON.parse(dataStr);
              const text =
                googleChunk.candidates?.[0]?.content?.parts?.[0]?.text;

              if (text) {
                const openaiChunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: created,
                  model: model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: text },
                      finish_reason: null,
                    },
                  ],
                };
                yield `data: ${JSON.stringify(openaiChunk)}\n\n`;
              }
            } catch (e) {}
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield "data: [DONE]\n\n";
  }
}
