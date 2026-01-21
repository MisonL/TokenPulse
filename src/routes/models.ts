import { Hono } from "hono";
import { logger } from "../lib/logger";
import { db } from "../db";
import { credentials } from "../db/schema";

// Dynamic Providers
import { getModels as getAiStudioModels } from "../lib/providers/aistudio";
import { getModels as getVertexModels } from "../lib/providers/vertex";
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

import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

// ... existing imports ...
const models = new Hono();

models.get(
  "/",
  zValidator(
    "query",
    z.object({
      provider: z.string().optional(),
    })
  ),
  async (c) => {
    const { provider } = c.req.valid("query");
    const targetProvider = provider;

  // 1. Fetch active credentials
  const activeCreds = await db
    .select()
    .from(credentials);

  // If specific provider requested
  if (targetProvider) {
    const cred = activeCreds.find(cr => cr.provider === targetProvider);
    const token = cred?.accessToken || "";
    const metadata = cred?.metadata ? (typeof cred.metadata === 'string' ? JSON.parse(cred.metadata) : cred.metadata) : {};
    
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
    } catch (e) {
      console.error(`[Models] Single fetch failed for ${targetProvider}:`, e);
    }
    
    return c.json({
      data: models,
      count: models.length,
      provider: targetProvider,
      connected: !!cred
    });
  }

  if (activeCreds.length === 0) {
    return c.json({
      data: [],
      count: 0,
      message: "No connected providers. Please connect at least one provider.",
    });
  }

  // 2. Fetch Dynamic Models from all connected providers (Parallel)
  const fetchPromises = activeCreds.map(async (cred): Promise<Model[]> => {
    try {
      if (cred.provider === "aistudio" && cred.accessToken) {
        return await getAiStudioModels(cred.accessToken, cred.metadata);
      }
      if (cred.provider === "vertex" && cred.metadata) {
        const meta = typeof cred.metadata === 'string' ? JSON.parse(cred.metadata) : cred.metadata;
        return await getVertexModels(meta);
      }
      
      // Use the exported provider instances (which have getModels)
      if (cred.accessToken) {
        switch (cred.provider) {
          case "claude": return await claudeProvider.getModels(cred.accessToken);
          case "codex": return await codexProvider.getModels(cred.accessToken);
          case "qwen": return await qwenProvider.getModels(cred.accessToken);
          case "iflow": return await iflowProvider.getModels(cred.accessToken);
          case "kiro": return await kiroProvider.getModels(cred.accessToken);
          case "antigravity": return await antigravityProvider.getModels(cred.accessToken);
          case "copilot": return await copilotProvider.getModels(cred.accessToken);
          case "gemini": return await antigravityProvider.getModels(cred.accessToken); // Gemini uses same models as Antigravity
        }
      }
      return [];
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      console.error(`[Models] Failed to fetch models for ${cred.provider}: ${errMsg}`);
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  
  // Debug: log what each provider returned
  activeCreds.forEach((cred, i) => {
    const list = results[i];
    const status = list && list.length > 0 ? `OK (${list.length})` : "FAILED/EMPTY";
    logger.info(`[Models] ${cred.provider}: ${status}`, "Models");
  });
  
  // 3. Merge all models, deduplicate by ID
  const allModelsMap = new Map<string, Model>();
  results.forEach(list => {
    list.forEach(m => {
      // Only add if not already present, or update if current has a better name
      if (!allModelsMap.has(m.id)) {
        allModelsMap.set(m.id, m);
      }
    });
  });

  const finalModels = Array.from(allModelsMap.values());
  
  // 4. Sort models
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
  
  activeCreds.forEach((cred, i) => {
    const list = results[i];
    if (!list) {
        errors[cred.provider] = "Failed to fetch (Error)";
    } else if (list.length === 0) {
        errors[cred.provider] = "Returned empty model list";
    }
  });

  return c.json({
    data: finalModels,
    count: finalModels.length,
    errors: errors,
  });
});

export default models;
