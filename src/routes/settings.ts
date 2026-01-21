import { Hono } from "hono";
import { db } from "../db";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";
import { strictAuthMiddleware } from "../middleware/auth";
import { logger } from "../lib/logger";

const app = new Hono();

// 对所有设置路由应用认证
app.use("*", strictAuthMiddleware);

// GET /api/settings - 获取所有设置
app.get("/", async (c) => {
  try {
    const allSettings = await db.select().from(settings);
    // 转换为键值对对象供前端使用
    const settingsMap: Record<string, string> = {};
    allSettings.forEach((s) => {
      // 强制掩码敏感字段 (精确匹配 + 模式匹配)
      const sensitiveKeys = ["api_key", "api_secret", "client_secret", "access_token", "refresh_token", "id_token"];
      const isSensitive = sensitiveKeys.includes(s.key) 
        || s.key.endsWith("_secret") 
        || s.key.endsWith("_password")
        || (s.key.endsWith("_token") && s.key !== "token_expiry"); // *_token 但排除 token_expiry
      
      if (isSensitive) {
         settingsMap[s.key] = "****************";
      } else {
         settingsMap[s.key] = s.value;
      }
    });

    // 如果 DB 为空，确保存在默认值
    const defaults = {
      system_name: "TokenPulse Gateway",
      maintenance_mode: "false",
      log_level: "INFO",
      api_key: "****************", // 已掩码
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

// POST /api/settings - 更新设置
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
