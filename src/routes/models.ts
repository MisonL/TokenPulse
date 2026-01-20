import { Hono } from "hono";
import { SUPPORTED_MODELS } from "../lib/constants/models";
import { db } from "../db";
import { credentials } from "../db/schema";
import { eq, or } from "drizzle-orm";

const models = new Hono();

models.get("/", async (c) => {
  // 1. Fetch active credentials
  const activeCreds = await db
    .select({ provider: credentials.provider })
    .from(credentials);

  const activeProviders = new Set(activeCreds.map((c) => c.provider));

  // 2. Filter supported models
  const availableModels = SUPPORTED_MODELS.filter((model) => {
    // Map internal provider names to model provider tags
    // google -> gemini, antigravity, aistudio
    // anthropic -> claude
    if (model.provider === "google") {
      return (
        activeProviders.has("gemini") ||
        activeProviders.has("antigravity") ||
        activeProviders.has("aistudio")
      );
    }
    if (model.provider === "anthropic") {
      return activeProviders.has("claude");
    }
    return false;
  });

  return c.json({
    data: availableModels,
    count: availableModels.length,
  });
});

export default models;
