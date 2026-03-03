export type Message = {
  role: "user" | "assistant" | "system";
  content: string | any[];
};

export type GeminiContent = {
  role: "user" | "model" | "function";
  parts: any[]; // Extended to support text, functionCall, functionResponse
};

/**
 * Translators provides utility functions to convert payloads between 
 * different AI provider formats (OpenAI, Anthropic, Gemini, etc.).
 */
export class Translators {
  /**
   * Converts OpenAI-style chat messages to Gemini's content format.
   * Handles system instructions, text content, multi-modal parts, and tool calls/responses.
   * 
   * @param messages - Array of OpenAI-compatible messages.
   * @returns An object containing Gemini 'contents' and optional 'systemInstruction'.
   */
  static openAIToGemini(messages: Message[]): {
    contents: GeminiContent[];
    systemInstruction?: { parts: { text: string }[] };
  } {
    const contents: GeminiContent[] = [];
    let systemParts: { text: string }[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        const text =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (text) systemParts.push({ text });
        continue;
      }

      const role = m.role === "user" ? "user" : "model";
      let parts: any[] = [];

      if (typeof m.content === "string") {
        if (m.content) parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === "text") {
            parts.push({ text: c.text });
          } else if (c.type === "image_url") {
            if (c.image_url?.url?.startsWith("data:")) {
              const matches = c.image_url.url.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
              if (matches) {
                parts.push({
                  inlineData: {
                    mimeType: matches[1],
                    data: matches[2],
                  },
                });
              } else {
                parts.push({ text: "[Image: Invalid Data URI]" });
              }
            } else {
               parts.push({ text: `[Image: ${c.image_url?.url || "Unknown"}]` });
            }
          }
        }
      }

      const msg = m as any;
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.type === "function") {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments || "{}"),
              },
            });
          }
        }
      }


      if (m.role === ("tool" as any)) {
        contents.push({
          role: "function" as any, // Gemini uses 'function' role for responses
          parts: [
            {
              functionResponse: {
                name: "unknown_tool", // OpenAI doesn't send name in tool response, it links by ID.
                response: {
                  content:
                    typeof m.content === "string"
                      ? m.content
                      : JSON.stringify(m.content),
                },
              },
            },
          ],
        });
        continue;
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return {
      contents,
      ...(systemParts.length > 0
        ? { systemInstruction: { parts: systemParts } }
        : {}),
    };
  }

  static anthropicToGemini(
    messages: Message[],
    system?: string,
  ): {
    contents: GeminiContent[];
    systemInstruction?: { parts: { text: string }[] };
  } {

    const contents: GeminiContent[] = messages.map((m) => {
      const role = m.role === "user" ? "user" : "model";
      let parts: { text: string }[] = [];

      if (typeof m.content === "string") {
        parts = [{ text: m.content }];
      } else if (Array.isArray(m.content)) {
        parts = m.content.map((c) => {
          const typedC = c as { text?: string; type?: string };
          return { text: typedC.text || JSON.stringify(c) };
        });
      }

      return { role, parts };
    });

    return {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    };
  }
}
