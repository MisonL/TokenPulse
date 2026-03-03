import type { Message } from "../translator";

/**
 * Thinking Recovery Service
 *
 * Handles edge cases for Claude/Gemini 3 models on Antigravity:
 * 1. Incomplete tool use loops.
 * 2. Missing thinking signatures in multi-turn.
 * 3. Conversation corruption needing 'let it crash' (stripping thinking).
 */

export interface RecoveryResult {
  messages: any[];
  wasModified: boolean;
  recoveryAction?: string;
}

export class ThinkingRecovery {
  /**
   * Analyze and potentially modify messages to ensure valid conversation state.
   */
  static recover(messages: any[]): RecoveryResult {
    if (!messages || messages.length === 0) {
      return { messages, wasModified: false };
    }

    const state = this.analyzeState(messages);

    if (state.endsInToolResult) {
    }

    if (state.needsThinkingStrip) {
      const stripped = this.stripThinking(messages);
      return {
        messages: stripped,
        wasModified: true,
        recoveryAction: "strip_thinking",
      };
    }

    return { messages, wasModified: false };
  }

    private static analyzeState(messages: any[]) {
        const last = messages[messages.length - 1];
        const endsInToolResult = (last.role === 'tool' || (last.role === 'assistant' && last.tool_calls));
        
        const tooLong = messages.length > 20;
        const potentialLoop = messages.filter(m => m.role === 'assistant').length > 5 && 
                             messages.slice(-4).some(m => m.role === 'assistant' && m.content && m.content.length < 50 && m.thinking);

        const needsThinkingStrip = tooLong || potentialLoop;

        return { endsInToolResult, needsThinkingStrip };
    }

  /**
   * Strips 'thinking' blocks and signatures from the entire history.
   * This forces the model to re-think or skip thinking for the next turn,
   * often resolving state corruption.
   */
  static stripThinking(messages: any[]): any[] {
    return messages.map((m) => {
      const newMsg = { ...m };
      if (newMsg.role === "assistant") {
        if (typeof newMsg.content === "string") {
          newMsg.content = newMsg.content
            .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
            .trim();
        } else if (Array.isArray(newMsg.content)) {
          newMsg.content = newMsg.content.filter(
            (p: any) => p.type !== "thought",
          );
        }
        delete newMsg.thinking;
      }
      return newMsg;
    });
  }

  /**
   * Heuristic to determine if a message contains stripped thinking.
   */
  static isThinkingStripped(content: any): boolean {
    const text =
      typeof content === "string" ? content : JSON.stringify(content);
    return (
      text.includes("[Thinking Stripped]") || text.includes("...Thinking...")
    );
  }
}
