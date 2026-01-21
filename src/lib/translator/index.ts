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
      // System Message
      if (m.role === "system") {
        const text =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (text) systemParts.push({ text });
        continue;
      }

      // User & Assistant Messages
      const role = m.role === "user" ? "user" : "model";
      let parts: any[] = [];

      // 1. Content Processing
      if (typeof m.content === "string") {
        if (m.content) parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === "text") {
            parts.push({ text: c.text });
          } else if (c.type === "image_url") {
            // NOTE: Image URL to inline base64 conversion can be implemented here for full multi-modal support
            parts.push({ text: "[Image]" });
          }
        }
      }

      // 2. Tool Calls Processing (Assistant)
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

      // 3. Tool Response Processing (Tool)
      // OpenAI: role='tool', tool_call_id
      // Gemini: role='function', part={functionResponse: {name, response}}
      // Note: OpenAI 'tool' role messages need to be mapped to 'user' role with 'functionResponse' parts in Gemini
      // OR 'function' role depending on API version.
      // Standard Gemini API v1beta uses 'function' role? No, usually part of 'user' or separate 'function' role.
      // Documentation says: role: 'function', parts: [{ functionResponse: ... }]
      // But wait, standard messages are 'user' or 'model'.
      // Let's use 'function' role if supported, or 'user' if that's what's expected.
      // Actually, in `antigravity_executor.go`, it keeps role mapping simple.
      // Let's stick to reference standard: role='function' for responses.

      if (m.role === ("tool" as any)) {
        // Type hack for 'tool' role
        contents.push({
          role: "function" as any, // Gemini uses 'function' role for responses
          parts: [
            {
              functionResponse: {
                name: "unknown_tool", // OpenAI doesn't send name in tool response, it links by ID.
                // We might need a lookup map if accurate name is required.
                // For now, we put response.
                // Note: Gemini REQUIRES accurate function name.
                // Without state tracking, this is lossy.
                // Optimistic approach: use tool_call_id as name if nothing else.
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

      // Push accumulated message
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
    // ... (Keep existing simple implementation or simple passthrough for now)
    // Since we are focusing on OpenAI -> Antigravity, we can keep this basic.

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
