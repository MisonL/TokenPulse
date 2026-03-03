import { Hono } from "hono";
import { listProviderCapabilities, type OAuthFlowType } from "../lib/routing/capability-map";

/**
 * 动态提供商端点
 * 返回所有支持的 AI 提供商列表及其前端元数据。
 */
const providers = new Hono();

interface ProviderMetadata {
  name: string;
  description: string;
  icon: string;
  docsUrl?: string;
}

interface ProviderInfo extends ProviderMetadata {
  id: string;
  authType: "oauth" | "device_code" | "api_key" | "service_account";
  flow: OAuthFlowType;
  flows: OAuthFlowType[];
  supportsChat: boolean;
  supportsModelList: boolean;
  supportsStream: boolean;
  supportsManualCallback: boolean;
}

const PROVIDER_METADATA_MAP: Record<string, ProviderMetadata> = {
  claude: {
    name: "Claude",
    description: "Anthropic AI",
    icon: "/assets/icons/claude.png",
    docsUrl: "https://console.anthropic.com/",
  },
  gemini: {
    name: "Gemini",
    description: "Google DeepMind",
    icon: "/assets/icons/gemini.png",
    docsUrl: "https://ai.google.dev/",
  },
  antigravity: {
    name: "Antigravity",
    description: "Google DeepMind (Internal)",
    icon: "/assets/icons/antigravity.png",
  },
  codex: {
    name: "Codex",
    description: "OpenAI",
    icon: "/assets/icons/codex.png",
    docsUrl: "https://platform.openai.com/",
  },
  qwen: {
    name: "Qwen",
    description: "Alibaba Cloud",
    icon: "/assets/icons/qwen.png",
    docsUrl: "https://qwen.aliyun.com/",
  },
  kiro: {
    name: "Kiro",
    description: "AWS Bedrock",
    icon: "/assets/icons/kiro.png",
    docsUrl: "https://aws.amazon.com/bedrock/",
  },
  iflow: {
    name: "iFlow",
    description: "iFlow AI",
    icon: "/assets/icons/iflow.png",
    docsUrl: "https://iflow.cn/",
  },
  aistudio: {
    name: "AI Studio",
    description: "Google Generative Language API",
    icon: "/assets/icons/aistudio.png",
    docsUrl: "https://aistudio.google.com/",
  },
  vertex: {
    name: "Vertex AI",
    description: "Google Cloud Platform",
    icon: "/icon.png",
    docsUrl: "https://cloud.google.dev/vertex-ai",
  },
  copilot: {
    name: "Copilot",
    description: "GitHub Copilot",
    icon: "/icon.png",
    docsUrl: "https://github.com/features/copilot",
  },
};

function resolveAuthType(flows: OAuthFlowType[]): ProviderInfo["authType"] {
  if (flows.includes("manual_key")) return "api_key";
  if (flows.includes("service_account")) return "service_account";
  if (flows.includes("device_code")) return "device_code";
  return "oauth";
}

function humanizeProviderId(providerId: string) {
  return providerId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

providers.get("/", async (c) => {
  const capabilities = await listProviderCapabilities();
  const data: ProviderInfo[] = capabilities.map((item) => {
    const metadata = PROVIDER_METADATA_MAP[item.provider] || {
      name: humanizeProviderId(item.provider),
      description: `${humanizeProviderId(item.provider)} Provider`,
      icon: "/icon.png",
    };
    return {
      id: item.provider,
      name: metadata.name,
      description: metadata.description,
      icon: metadata.icon,
      docsUrl: metadata.docsUrl,
      authType: resolveAuthType(item.flows),
      flow: item.flows[0] || "auth_code",
      flows: item.flows,
      supportsChat: item.supportsChat,
      supportsModelList: item.supportsModelList,
      supportsStream: item.supportsStream,
      supportsManualCallback: item.supportsManualCallback,
    };
  });

  return c.json({
    data,
    count: data.length,
  });
});

export default providers;
