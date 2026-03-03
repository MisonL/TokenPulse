import { Hono } from "hono";
import { db } from "../db";
import { credentials, type Credential } from "../db/schema";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { safeJsonParse } from "../lib/utils.ts";

// 动态提供商
import { getModels as getAiStudioModels } from "../lib/providers/aistudio";
import { getModels as getVertexModels } from "../lib/providers/vertex";
import { decryptCredential } from "../lib/auth/crypto_helpers";
import { claudeProvider } from "../lib/providers/claude";
import { codexProvider } from "../lib/providers/codex";
import { qwenProvider } from "../lib/providers/qwen";
import { iflowProvider } from "../lib/providers/iflow";
import { kiroProvider } from "../lib/providers/kiro";
import { antigravityProvider } from "../lib/providers/antigravity";
import { copilotProvider } from "../lib/providers/copilot";
import { getModels as getGeminiModels } from "../lib/providers/gemini";
import { filterExcludedModels } from "../lib/model-governance";

interface Model {
  id: string;
  name: string;
  provider: string;
}

const querySchema = z.object({
  provider: z.string().optional(),
});

const models = new Hono<{
  Variables: {};
}>();

function isCredentialActive(cred: Credential): boolean {
  const status = cred.status || "active";
  return status !== "revoked" && status !== "disabled";
}

async function fetchModelsForCredential(cred: Credential): Promise<Model[]> {
  try {
    const decrypted = decryptCredential(cred);
    const token = decrypted.accessToken || "";
    const metadata = safeJsonParse(decrypted.metadata);
    const attributes = safeJsonParse(decrypted.attributes);
    const claudeContext = {
      attributes: {
        ...(metadata?.attributes || {}),
        ...(attributes || {}),
      },
    };

    let providerModels: Model[] = [];

    if (cred.provider === "aistudio") {
      providerModels = await getAiStudioModels(token, metadata);
    } else if (cred.provider === "vertex") {
      providerModels = await getVertexModels(metadata);
    } else {
      switch (cred.provider) {
        case "claude":
          providerModels = await claudeProvider.getModels(token, claudeContext);
          break;
        case "codex":
          providerModels = await codexProvider.getModels(token);
          break;
        case "qwen":
          providerModels = await qwenProvider.getModels(token);
          break;
        case "iflow":
          providerModels = await iflowProvider.getModels(token);
          break;
        case "kiro":
          providerModels = await kiroProvider.getModels(token);
          break;
        case "antigravity":
          providerModels = await antigravityProvider.getModels(token);
          break;
        case "copilot":
          providerModels = await copilotProvider.getModels(token);
          break;
        case "gemini":
          providerModels = await getGeminiModels(token);
          break;
        default:
          providerModels = [];
      }
    }

    // 命名空间转换：确保 ID 体现渠道名称 (provider:id)
    return (providerModels || []).map((m) => ({
      ...m,
      id: m.id.includes(":") ? m.id : `${cred.provider}:${m.id}`,
    }));
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[Models] 获取 ${cred.provider} 模型失败: ${errMsg}`);
    return [];
  }
}

models.get(
  "/",
  zValidator("query", querySchema),
  async (c) => {
    const { provider } = c.req.valid("query");
    const targetProvider = provider;

    // 1. 获取所有凭证
    const allCreds = await db.select().from(credentials);
    const activeCreds = allCreds.filter((cr: Credential) =>
      isCredentialActive(cr),
    );

    if (activeCreds.length === 0) {
      return c.json({
        data: [],
        count: 0,
        message: "当前没有已连接的渠道，请至少连接一个渠道。",
      });
    }

    // 如果请求了特定提供商
    if (targetProvider) {
      const providerCreds = activeCreds.filter(
        (cr: Credential) => cr.provider === targetProvider,
      );

      if (providerCreds.length === 0) {
        return c.json({
          data: [],
          count: 0,
          message: `渠道 '${targetProvider}' 不存在或未激活。`,
          connected: false,
        });
      }

      const results = await Promise.all(
        providerCreds.map((cred) => fetchModelsForCredential(cred)),
      );
      const providerModelMap = new Map<string, Model>();
      for (const list of results) {
        for (const item of list) {
          if (!providerModelMap.has(item.id)) {
            providerModelMap.set(item.id, item);
          }
        }
      }

      const models = await filterExcludedModels(
        Array.from(providerModelMap.values()),
      );

      return c.json({
        data: models,
        count: models.length,
        provider: targetProvider,
        connected: true,
        accountCount: providerCreds.length,
        accountIds: providerCreds.map((item) => item.accountId || "default"),
      });
    }

    // 2. 从所有连接的提供商获取动态模型（并行）
    const fetchPromises = activeCreds.map((cred: Credential) =>
      fetchModelsForCredential(cred),
    );

    const results = await Promise.all(fetchPromises);
    
    // 3. 合并与去重
    const allModelsMap = new Map<string, Model>();
    results.forEach((list: Model[]) => {
      if (!list) return;
      list.forEach((m: Model) => {
        if (!allModelsMap.has(m.id)) {
          allModelsMap.set(m.id, m);
        }
      });
    });

    const finalModels = Array.from(allModelsMap.values());
    
    // 4. 对模型排序
    finalModels.sort((a, b) => {
      const providerOrder: Record<string, number> = {
        google: 0,
        anthropic: 1,
        openai: 2,
        aws: 3,
        alibaba: 4,
      };
      const orderA = providerOrder[a.provider] ?? 99;
      const orderB = providerOrder[b.provider] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });

    const governedModels = await filterExcludedModels(finalModels);

    const errors: Record<string, string> = {};
    activeCreds.forEach((cred: Credential, i: number) => {
      if (!results[i] || results[i]!.length === 0) {
        errors[cred.provider] = "获取失败或结果为空";
      }
    });

    return c.json({
      data: governedModels,
      count: governedModels.length,
      errors
    });
  }
);

export default models;
