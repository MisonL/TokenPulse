/**
 * Thinking Configuration Types
 * Unified interface for parsing and validating thinking configs across providers.
 */

// Thinking Mode: How thinking is configured
export type ThinkingMode = "budget" | "level" | "none" | "auto";

// Thinking Level: Discrete levels for Gemini 3+
export type ThinkingLevel =
  | "none"
  | "auto"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface ThinkingConfig {
  mode: ThinkingMode;

  // Budget in tokens (for Claude / Gemini 2.5)
  // 0 = disabled, -1 = auto
  budget?: number;

  // Discrete level (for Gemini 3)
  level?: ThinkingLevel;
}

export interface ModelSuffixResult {
  modelName: string;
  hasSuffix: boolean;
  config?: ThinkingConfig;
  rawSuffix?: string;
}

/**
 * Parse a model name with thinking suffix.
 * Format: model-name(value)
 * Examples:
 *  - gemini-3-pro(high)
 *  - claude-3-7-sonnet(16000)
 *  - claude-3-5-sonnet(auto)
 */
export function parseModelSuffix(fullModelName: string): ModelSuffixResult {
  const match = fullModelName.match(/^(.*?)\(([^)]+)\)$/);

  if (!match) {
    return {
      modelName: fullModelName,
      hasSuffix: false,
    };
  }

  const baseName = match[1] || fullModelName;
  const suffix = match[2] || "";
  const lowerSuffix = suffix.toLowerCase().trim();
  let config: ThinkingConfig;

  if (lowerSuffix === "auto") {
    config = { mode: "auto", budget: -1, level: "auto" };
  } else if (
    lowerSuffix === "none" ||
    lowerSuffix === "disabled" ||
    lowerSuffix === "0"
  ) {
    config = { mode: "none", budget: 0, level: "none" };
  } else if (/^\d+$/.test(lowerSuffix)) {
    // Numeric -> Budget
    const budget = parseInt(lowerSuffix, 10);
    config = {
      mode: budget > 0 ? "budget" : "none",
      budget: budget,
      level: "auto", // Default level fallback
    };
  } else {
    // String -> Level
    config = {
      mode: "level",
      level: isValidLevel(lowerSuffix)
        ? (lowerSuffix as ThinkingLevel)
        : "medium",
    };
  }

  return {
    modelName: baseName,
    hasSuffix: true,
    config: config,
    rawSuffix: suffix,
  };
}

function isValidLevel(l: string): boolean {
  const levels = ["none", "auto", "minimal", "low", "medium", "high", "xhigh"];
  return levels.includes(l);
}
