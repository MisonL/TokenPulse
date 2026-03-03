import type { ThinkingConfig, ThinkingMode } from "./thinking-types";

/**
 * Apply Thinking Configuration to Request Payload
 */
/**
 * ThinkingApplier handles the transformation of request payloads to enable 
 * thinking/reasoning features across different AI providers.
 */
export class ThinkingApplier {
  /**
   * Translates thinking configuration to Gemini's native format.
   * Handles version differences between Gemini 2.5 (budget) and Gemini 3 (level).
   * 
   * @param payload - The Gemini-compatible request body.
   * @param config - User's thinking configuration (mode, budget, level).
   * @param modelName - The target model string used to detect version logic.
   * @returns A new payload object with the reasoning config applied.
   */
  static applyToGemini(
    payload: any,
    config: ThinkingConfig,
    modelName: string,
  ): any {
    if (!payload || !config) return payload;

    const isGemini3 = modelName.toLowerCase().includes("gemini-3");
    const isFlash = modelName.toLowerCase().includes("flash");

    const newPayload = JSON.parse(JSON.stringify(payload));

    if (!newPayload.generationConfig) {
      newPayload.generationConfig = {};
    }

    const genConfig = newPayload.generationConfig;

    if (config.mode === "none") {
      delete genConfig.thinkingConfig;
      return newPayload;
    }

    if (config.mode === "auto") {

      if (isGemini3) {
        genConfig.thinkingConfig = {
          includeThoughts: true,
        };
      } else {
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: -1, // Dynamic
        };
      }
      return newPayload;
    }

    if (config.mode === "budget") {
      if (isGemini3) {
        const level = mapBudgetToLevel(config.budget || 4096);
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingLevel: level,
        };
      } else {
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: config.budget,
        };
      }
      return newPayload;
    }

    if (config.mode === "level") {
      if (isGemini3) {
        genConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingLevel: config.level,
        };
      } else {
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
   * Translates thinking configuration to Claude's native format.
   * Maps levels (low, medium, high) to specific token budgets.
   * 
   * @param payload - The Claude-compatible request body.
   * @param config - User's thinking configuration.
   * @returns A new payload object with the 'thinking' block applied.
   */
  static applyToClaude(payload: any, config: ThinkingConfig): any {
    if (!payload || !config) return payload;

    const newPayload = JSON.parse(JSON.stringify(payload));

    if (config.mode === "none") {
      delete newPayload.thinking;
      return newPayload;
    }

    let budget = 0;

    if (config.mode === "budget") {
      budget = config.budget || 4096;
    } else if (config.mode === "level") {
      budget = mapLevelToBudget(config.level || "medium");
    } else if (config.mode === "auto") {
      budget = 4096; // Default for auto
    }

    if (budget < 1024) budget = 1024; // Min

    newPayload.thinking = {
      type: "enabled",
      budget_tokens: budget,
    };

    return newPayload;
  }
}

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
