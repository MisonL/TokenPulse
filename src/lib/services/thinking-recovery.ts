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

    // Scenario 1: Unfinished Tool Use
    // If the last message is from a 'tool' (tool_result), but the model hasn't responded.
    // Antigravity (Claude) might expect a signature before the next model action.
    if (state.endsInToolResult) {
      // No direct action for now, but we could inject a "continue" user message
      // or ensure the last turn is clean.
    }

    // Scenario 2: Corruption Recovery (Let it crash)
    // If we detect that the model keeps failing or sending empty thoughts,
    // we strip the existing 'thinking' blocks from the history to reset the model session state.
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
        
        // Simple heuristic: if conversation has > 12 messages and 
        // the last 3 assistant messages have unusually short text but long thoughts,
        // it might be a loop. 
        // Or if we have > 20 messages, we strip to save context.
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
          // Strip the custom thinking tags if present
          newMsg.content = newMsg.content
            .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
            .trim();
        } else if (Array.isArray(newMsg.content)) {
          newMsg.content = newMsg.content.filter(
            (p: any) => p.type !== "thought",
          );
        }
        // Also remove the explicit 'thinking' property if used for Claude
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
