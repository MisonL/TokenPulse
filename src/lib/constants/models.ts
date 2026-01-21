export interface Model {
  id: string;
  name: string;
  provider: "google" | "anthropic" | "openai" | "aws" | "alibaba" | "other"; 
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
  // Qwen (Alibaba)
  {
    id: "qwen-max",
    name: "Qwen Max",
    provider: "alibaba",
  },
  {
    id: "qwen-plus",
    name: "Qwen Plus",
    provider: "alibaba",
  },
  {
    id: "qwen-turbo",
    name: "Qwen Turbo",
    provider: "alibaba",
  },
  // Codex (OpenAI)
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
  },
  {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "openai",
  },
  {
    id: "o1-preview",
    name: "O1 Preview",
    provider: "openai",
  },
  // Kiro (AWS / Bedrock)
  {
    id: "claude-3-5-sonnet-20240620",
    name: "Claude 3.5 Sonnet (AWS)",
    provider: "aws",
  },
  {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus (AWS)",
    provider: "aws",
  },
];
