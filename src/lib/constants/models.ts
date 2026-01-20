export interface Model {
  id: string;
  name: string;
  provider: "google" | "anthropic" | "openai" | "other"; // Added provider for future filtering if needed
}

export const SUPPORTED_MODELS: Model[] = [
  {
    id: "gemini-2.0-flash-thinking-exp-1219",
    name: "Gemini 2.0 Flash Thinking 1219",
    provider: "google",
  },
  {
    id: "gemini-2.0-flash-exp",
    name: "Gemini 2.0 Flash Exp",
    provider: "google",
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "google",
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "google",
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
  },
];
