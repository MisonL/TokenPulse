import { Hono } from "hono";
import { db } from "../db";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";
import { strictAuthMiddleware } from "../middleware/auth";
import { logger } from "../lib/logger";

const app = new Hono();

// Apply authentication to all settings routes
app.use("*", strictAuthMiddleware);

// GET /api/settings - Fetch all settings
app.get("/", async (c) => {
  try {
    const allSettings = await db.select().from(settings);
    // Convert to key-value object for frontend
    const settingsMap: Record<string, string> = {};
    allSettings.forEach((s) => {
      settingsMap[s.key] = s.value;
    });

    // Ensure defaults exist if DB is empty
    const defaults = {
      system_name: "TokenPulse Gateway",
      maintenance_mode: "false",
      log_level: "INFO",
      api_key: "****************", // Masked
      token_expiry: "3600",
      allow_registration: "false",
      default_provider: "Antigravity",
      failure_fallback: "true",
      max_retries: "3",
    };

    return c.json({ ...defaults, ...settingsMap });
  } catch (e) {
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
});

import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

// POST /api/settings - Update a setting
app.post(
  "/", 
  zValidator(
    "json",
    z.object({
      key: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]).transform(String),
    })
  ),
  async (c) => {
    try {
      const { key, value } = c.req.valid("json");

    await db
      .insert(settings)
      .values({
        key,
        value: String(value),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: String(value),
          updatedAt: new Date().toISOString(),
        },
      });

    return c.json({ success: true });
  } catch (e) {
    console.error(e);
    return c.json({ error: "Failed to update setting" }, 500);
  }
});

export default app;
