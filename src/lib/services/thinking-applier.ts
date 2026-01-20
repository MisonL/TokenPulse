import type { ThinkingConfig, ThinkingMode } from "./thinking-types";

/**
 * Apply Thinking Configuration to Request Payload
 */
export class ThinkingApplier {
  /**
   * Apply thinking config to a Gemini-compatible request payload.
   * Note: This modifies the payload in place or returns a new one.
   */
  static applyToGemini(
    payload: any,
    config: ThinkingConfig,
    modelName: string,
  ): any {
    if (!payload || !config) return payload;

    const isGemini3 = modelName.toLowerCase().includes("gemini-3");
    const isFlash = modelName.toLowerCase().includes("flash");

    // Deep clone to avoid side effects
    const newPayload = JSON.parse(JSON.stringify(payload));

    // Ensure generationConfig exists
    if (!newPayload.generationConfig) {
      newPayload.generationConfig = {};
    }

    const genConfig = newPayload.generationConfig;

    // Mode: NONE
    if (config.mode === "none") {
      // Explicitly disable? Usually just omitting config disables it.
      // Some models might force it, but generally safe to do nothing or remove keys.
      delete genConfig.thinkingConfig;
      return newPayload;
    }

    // Mode: AUTO
    if (config.mode === "auto") {
      // For Gemini 3+, auto often means budget=-1 or auto level?
      // Reference: Gemini 2.5 uses thinkingBudget, Gemini 3 uses thinkingConfig{thinkingLevel} or thinkingBudget=-1

      // Strategy: Use generic compatible config if possible
      if (isGemini3) {
        genConfig.thinkingConfig = {
          includeThoughts: true,
        };
        // Auto might not set level, letting model decide.
      } else {
        // Gemini 2.5
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: -1, // Dynamic
        };
      }
      return newPayload;
    }

    // Mode: BUDGET (Numeric)
    if (config.mode === "budget") {
      if (isGemini3) {
        // Gemini 3 prefers levels, but maybe supports budget?
        // Reference says: "Legacy format for Gemini 3 - convert with deprecation warning"
        // Map budget to level
        const level = mapBudgetToLevel(config.budget || 4096);
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingLevel: level,
        };
      } else {
        // Gemini 2.5
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: config.budget,
        };
      }
      return newPayload;
    }

    // Mode: LEVEL (String)
    if (config.mode === "level") {
      if (isGemini3) {
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingLevel: config.level,
        };
      } else {
        // Gemini 2.5 might not support levels. Map level to budget.
        const budget = mapLevelToBudget(config.level || "medium");
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: budget,
        };
      }
      return newPayload;
    }

    return newPayload;
  }

  /**
   * Apply thinking config to a Claude-compatible request payload.
   */
  static applyToClaude(payload: any, config: ThinkingConfig): any {
    if (!payload || !config) return payload;

    const newPayload = JSON.parse(JSON.stringify(payload));

    if (config.mode === "none") {
      delete newPayload.thinking;
      return newPayload;
    }

    // Claude only supports Budget Token Count
    let budget = 0;

    if (config.mode === "budget") {
      budget = config.budget || 4096;
    } else if (config.mode === "level") {
      budget = mapLevelToBudget(config.level || "medium");
    } else if (config.mode === "auto") {
      budget = 4096; // Default for auto
    }

    // Sanity Check
    if (budget < 1024) budget = 1024; // Min
    // Max check?

    newPayload.thinking = {
      type: "enabled",
      budget_tokens: budget,
    };

    return newPayload;
  }
}

// Helpers
function mapBudgetToLevel(budget: number): string {
  if (budget <= 2048) return "low";
  if (budget <= 8192) return "medium";
  return "high";
}

function mapLevelToBudget(level: string): number {
  switch (level) {
    case "minimal":
      return 1024;
    case "low":
      return 2048;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    case "xhigh":
      return 16384;
    default:
      return 4096;
  }
}
