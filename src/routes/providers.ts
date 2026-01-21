import { Hono } from "hono";

/**
 * Dynamic Providers Endpoint
 * Returns a list of all supported AI providers with metadata for the frontend.
 */
const providers = new Hono();

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  authType: "oauth" | "device_code" | "api_key" | "service_account";
  icon: string;
  docsUrl?: string;
}

const SUPPORTED_PROVIDERS: ProviderInfo[] = [
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic AI",
    authType: "oauth",
    icon: "/assets/icons/claude.png",
    docsUrl: "https://console.anthropic.com/",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google DeepMind",
    authType: "oauth",
    icon: "/assets/icons/gemini.png",
    docsUrl: "https://ai.google.dev/",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    description: "Google DeepMind (Internal)",
    authType: "oauth",
    icon: "/assets/icons/antigravity.png",
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI",
    authType: "oauth",
    icon: "/assets/icons/codex.png",
    docsUrl: "https://platform.openai.com/",
  },
  {
    id: "qwen",
    name: "Qwen",
    description: "Alibaba Cloud",
    authType: "device_code",
    icon: "/assets/icons/qwen.png",
    docsUrl: "https://qwen.aliyun.com/",
  },
  {
    id: "kiro",
    name: "Kiro",
    description: "AWS Bedrock",
    authType: "device_code",
    icon: "/assets/icons/kiro.png",
    docsUrl: "https://aws.amazon.com/bedrock/",
  },
  {
    id: "iflow",
    name: "iFlow",
    description: "iFlow AI",
    authType: "oauth",
    icon: "/assets/icons/iflow.png",
    docsUrl: "https://iflow.cn/",
  },
  {
    id: "aistudio",
    name: "AI Studio",
    description: "Google Generative Language API",
    authType: "api_key",
    icon: "/assets/icons/aistudio.png",
    docsUrl: "https://aistudio.google.com/",
  },
  {
    id: "vertex",
    name: "Vertex AI",
    description: "Google Cloud Platform",
    authType: "service_account",
    icon: "/assets/icons/vertex.png",
    docsUrl: "https://cloud.google.dev/vertex-ai",
  },
  {
    id: "copilot",
    name: "Copilot",
    description: "GitHub Copilot",
    authType: "oauth",
    icon: "/assets/icons/copilot.png",
    docsUrl: "https://github.com/features/copilot",
  },
];

providers.get("/", (c) => {
  return c.json({
    data: SUPPORTED_PROVIDERS,
    count: SUPPORTED_PROVIDERS.length,
  });
});

export default providers;
