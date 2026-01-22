import { Hono, type Context } from "hono";
import { logger } from "../lib/logger";
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

models.get(
  "/",
  zValidator("query", querySchema),
  async (c) => {
    const { provider } = c.req.valid("query");
    const targetProvider = provider;

    // 1. 获取所有凭证
    const allCreds = await db.select().from(credentials);
    const activeCreds = allCreds.filter((cr: Credential) => cr.status === "active");

    if (activeCreds.length === 0) {
      return c.json({
        data: [],
        count: 0,
        message: "No connected providers. Please connect at least one provider.",
      });
    }

    // 如果请求了特定提供商
    if (targetProvider) {
      const cred = activeCreds.find((cr: Credential) => cr.provider === targetProvider);
      
      if (!cred) {
        return c.json({
          data: [],
          count: 0,
          message: `Provider '${targetProvider}' not found or not active.`,
          connected: false
        });
      }

      // 必须先解密才能使用令牌和元数据
      const decrypted = decryptCredential(cred);
      const token = decrypted.accessToken || "";
      const metadata = safeJsonParse(decrypted.metadata);
      
      let models: Model[] = [];
      try {
        switch (targetProvider) {
          case "aistudio": models = await getAiStudioModels(token, metadata); break;
          case "vertex": models = await getVertexModels(metadata); break;
          case "claude": models = await claudeProvider.getModels(token); break;
          case "codex": models = await codexProvider.getModels(token); break;
          case "qwen": models = await qwenProvider.getModels(token); break;
          case "iflow": models = await iflowProvider.getModels(token); break;
          case "kiro": models = await kiroProvider.getModels(token); break;
          case "antigravity": models = await antigravityProvider.getModels(token); break;
          case "copilot": models = await copilotProvider.getModels(token); break;
          case "gemini": models = await antigravityProvider.getModels(token); break;
        }

        // 命名空间转换：确保 ID 体现渠道名称 (provider:id)
        models = models.map(m => ({
          ...m,
          id: m.id.includes(':') ? m.id : `${targetProvider}:${m.id}`
        }));
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[Models] Single fetch failed for ${targetProvider}: ${errMsg}`);
      }
      
      return c.json({
        data: models,
        count: models.length,
        provider: targetProvider,
        connected: true
      });
    }

    // 2. 从所有连接的提供商获取动态模型（并行）
    const fetchPromises = activeCreds.map(async (cred: Credential): Promise<Model[]> => {
      try {
        // 每个并行任务也需要解密
        const decrypted = decryptCredential(cred);
        const token = decrypted.accessToken || "";
        const metadata = safeJsonParse(decrypted.metadata);

        let providerModels: Model[] = [];

        if (cred.provider === "aistudio") {
          providerModels = await getAiStudioModels(token, metadata);
        } else if (cred.provider === "vertex") {
          providerModels = await getVertexModels(metadata);
        } else {
          switch (cred.provider) {
            case "claude": providerModels = await claudeProvider.getModels(token); break;
            case "codex": providerModels = await codexProvider.getModels(token); break;
            case "qwen": providerModels = await qwenProvider.getModels(token); break;
            case "iflow": providerModels = await iflowProvider.getModels(token); break;
            case "kiro": providerModels = await kiroProvider.getModels(token); break;
            case "antigravity": providerModels = await antigravityProvider.getModels(token); break;
            case "copilot": providerModels = await copilotProvider.getModels(token); break;
            case "gemini": providerModels = await antigravityProvider.getModels(token); break;
            default: providerModels = [];
          }
        }

        // 命名空间转换：确保 ID 体现渠道名称 (provider:id)
        return (providerModels || []).map(m => ({
          ...m,
          id: m.id.includes(':') ? m.id : `${cred.provider}:${m.id}`
        }));
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[Models] Failed to fetch models for ${cred.provider}: ${errMsg}`);
        return [];
      }
    });

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

    const errors: Record<string, string> = {};
    activeCreds.forEach((cred: Credential, i: number) => {
      if (!results[i] || results[i]!.length === 0) {
        errors[cred.provider] = "Failed to fetch or empty";
      }
    });

    return c.json({
      data: finalModels,
      count: finalModels.length,
      errors
    });
  }
);

export default models;
