import { Hono } from "hono";
import { db } from "../db";
import { credentials } from "../db/schema";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { initiateQwenDeviceFlow, pollQwenToken } from "../lib/auth/qwen";
import { config } from "../config";
import { strictAuthMiddleware } from "../middleware/auth";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { encryptCredential, decryptCredential } from "../lib/auth/crypto_helpers";

const api = new Hono();

// 安全性：对所有非认证路由进行全局认证
api.use("*", async (c, next) => {
  // 白名单：OAuth 流程端点（面向公共或前端驱动）
  if (c.req.path.includes("/auth/") || c.req.path.endsWith("/status")) {
    await next();
    return;
  }
  
  // 所有其他路由都需要认证
  return strictAuthMiddleware(c, next);
});

/**
 * 净化凭证元数据 - 移除敏感字段
 */
function sanitizeMetadata(metadata: string | null): Record<string, any> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    // 移除敏感字段 - 服务账号密钥
    if (parsed.service_account) {
      delete parsed.service_account.private_key;
      delete parsed.service_account.private_key_id;
      // 仅保留安全信息
      parsed.service_account = {
        client_email: parsed.service_account.client_email,
        project_id: parsed.service_account.project_id,
        type: parsed.service_account.type,
      };
    }
    // 移除任何原始私钥
    delete parsed.private_key;
    delete parsed.api_key;
    
    // 安全修复：移除 OAuth 令牌
    delete parsed.access_token;
    delete parsed.refresh_token;
    delete parsed.id_token;
    delete parsed.token;
    delete parsed.accessToken;
    delete parsed.refreshToken;
    delete parsed.idToken;
    
    return parsed;
  } catch {
    return null;
  }
}

// 获取所有提供商的状态
api.get("/status", async (c) => {
  const all = await db.select().from(credentials);
  const statusMap: Record<string, boolean> = {};

  // 默认为 false
  const SUPPORTED = [
    "kiro",
    "codex",
    "qwen",
    "iflow",
    "aistudio",
    "vertex",
    "claude",
    "gemini",
    "antigravity",
    "copilot",
  ];
  SUPPORTED.forEach((p) => (statusMap[p] = false));

  all.forEach((creds) => {
    statusMap[creds.provider] = true;
  });

  return c.json(statusMap);
});

// 获取所有凭证（已加密 + 脱敏）
api.get("/", async (c) => {
  const all = await db.select().from(credentials);
  // 返回脱敏后的安全列表
  const safeList = all.map((c) => {
    // 先解密
    const cred = decryptCredential(c);
    return {
      id: cred.id,
      provider: cred.provider,
      email: cred.email,
      status: cred.status,
      lastRefresh: cred.lastRefresh,
      expiresAt: cred.expiresAt,
      metadata: sanitizeMetadata(cred.metadata as string),
    };
  });
  return c.json(safeList);
});

// 认证路由（通用模式可稍后应用）

// --- Qwen 认证 ---
api.post("/auth/qwen/start", async (c) => {
  try {
    const data = await initiateQwenDeviceFlow();
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

api.post(
  "/auth/qwen/poll",
  zValidator(
    "json",
    z.object({
      deviceCode: z.string().optional(),
      device_code: z.string().optional(),
      codeVerifier: z.string().optional(),
      code_verifier: z.string().optional(),
    }).transform(obj => ({
      // 归一化为 camelCase，优先 camelCase 输入但也接受 snake_case
      deviceCode: obj.deviceCode || obj.device_code,
      codeVerifier: obj.codeVerifier || obj.code_verifier,
    })).refine(obj => obj.deviceCode && obj.codeVerifier, {
        message: "Missing required parameters: deviceCode, codeVerifier"
    })
  ),
  async (c) => {
    const { deviceCode, codeVerifier } = c.req.valid("json");
    // deviceCode 和 codeVerifier 在这里通过 refine 检查保证为字符串（主要，虽然类型可能需要显式转换如果 TS 没有推断 refine）
    // 实际上 refine 不会在严格意义上自动收窄 "string | undefined" -> "string" 类型，这需要用户泛型，
    // 但我们可以信任它或使用管道。
    // 让我们为 TS 推断使用更简单的方法：
    
    if (!deviceCode || !codeVerifier) {
         return c.json({ error: "Missing required parameters" }, 400);
    }
  
  try {
    const result = await pollQwenToken(deviceCode, codeVerifier);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Kiro (AWS) Auth ---
import {
  initiateKiroDeviceFlow,
  pollKiroToken,
  registerKiroClient,
} from "../lib/auth/kiro";

api.post("/auth/kiro/start", async (c) => {
  try {
    // Kiro 每次都需要先注册还是缓存？上游在 LoginWithBuilderID 中每次都会做
    const reg = await registerKiroClient();
    const flow = await initiateKiroDeviceFlow(reg.clientId, reg.clientSecret);
    // 我们需要将 clientId/Secret 返回给前端以便在轮询时传回吗？
    // 或者我们应该临时存储它。无状态方法：将其发送给客户端。
    return c.json({
      ...flow,
      clientId: reg.clientId,
      clientSecret: reg.clientSecret,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

api.post(
  "/auth/kiro/poll",
  zValidator(
    "json",
    z.object({
      deviceCode: z.string(),
      clientId: z.string(),
      clientSecret: z.string(),
    })
  ),
  async (c) => {
    // 前端为 Kiro 轮询发送 camelCase 键
    const { deviceCode, clientId, clientSecret } = c.req.valid("json");

  try {
    const result = await pollKiroToken(deviceCode, clientId, clientSecret);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Codex Auth ---
import { generateCodexAuthUrl } from "../lib/auth/codex";

api.post("/auth/codex/url", (c) => {
  const url = generateCodexAuthUrl();
  return c.json({ url });
});

api.post("/auth/codex/poll", async (c) => {
  // Codex 不需要同样方式的轮询，窗口会关闭。
  // 前端应通过 refresh 或轮询 fetchCredentials() 检查状态。
  // 但如果需要我们可以提供检查端点，或者直接让前端刷新。
  return c.json({ success: true, message: "Use fetchCredentials" });
});

// --- iFlow Auth ---
import { generateIflowAuthUrl } from "../lib/auth/iflow";

api.post("/auth/iflow/url", (c) => {
  const url = generateIflowAuthUrl();
  return c.json({ url });
});

// --- Gemini Auth ---
import { generateGeminiAuthUrl } from "../lib/auth/gemini";
api.post("/auth/gemini/url", (c) => {
  return c.json({ url: generateGeminiAuthUrl() });
});

// --- Claude Auth ---
import { generateClaudeAuthUrl } from "../lib/auth/claude";
api.post("/auth/claude/url", (c) => {
  return c.json({ url: generateClaudeAuthUrl() });
});

// --- Antigravity 认证 (Google 内部) ---
import { generateAntigravityAuthUrl } from "../lib/auth/antigravity";
api.post("/auth/antigravity/url", (c) => {
  return c.json({ url: generateAntigravityAuthUrl() });
});

// --- AI Studio (Google Generative Language) ---
api.post(
  "/auth/aistudio/save",
  zValidator(
    "json",
    z.object({
      serviceAccountJson: z.union([z.string(), z.record(z.string(), z.any())]),
    })
  ),
  async (c) => {
    try {
      const { serviceAccountJson } = c.req.valid("json");

    let accessToken = "";
    let email = "aistudio-user";
    let metadata: Record<string, any> = {};

    // 检测输入类型：API Key (以 AIza 开头) 或服务账号 JSON
    if (typeof serviceAccountJson === 'string' && serviceAccountJson.trim().startsWith("AIza")) {
      // API Key 模式
      accessToken = serviceAccountJson.trim();
      metadata = { mode: "api_key" };
      email = "apikey-user";
    } else {
      // 尝试解析为服务账号 JSON
      try {
        const parsed = typeof serviceAccountJson === 'string' 
          ? JSON.parse(serviceAccountJson) 
          : serviceAccountJson;
        
        if (parsed.type === "service_account" && parsed.private_key && parsed.client_email) {
          // 有效的服务账号 JSON
          accessToken = "service-account"; // 占位符，我们直接使用 SA
          email = parsed.client_email;
          metadata = {
            mode: "service_account",
            service_account: parsed,
            project_id: parsed.project_id,
          };
        } else {
          return c.json({ error: "Invalid Service Account JSON. Ensure it contains 'type', 'private_key', and 'client_email'." }, 400);
        }
      } catch (parseError) {
        // 无效的 JSON 且不是 API Key
        return c.json({ error: "Invalid input. Provide an API Key (starts with AIza) or a valid Service Account JSON." }, 400);
      }
    }

    const newCred = {
        id: "aistudio",
        provider: "aistudio",
        accessToken: accessToken,
        email: email,
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString(),
    };
    
    // Encrypt before saving
    const encryptedCred = encryptCredential(newCred);

    // Save to DB
    await db
      .insert(credentials)
      .values(encryptedCred)
      .onConflictDoUpdate({
        target: credentials.provider,
        set: {
          accessToken: encryptedCred.accessToken,
          email: encryptedCred.email,
          metadata: encryptedCred.metadata,
          updatedAt: new Date().toISOString(),
        },
      });

    return c.json({ success: true, mode: metadata.mode });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});


// 删除凭证 (断开连接)
api.delete("/:provider", async (c) => {
  const provider = c.req.param("provider");

  if (!provider) {
    return c.json({ error: "Provider required" }, 400);
  }

  await db.delete(credentials).where(eq(credentials.provider, provider));

  return c.json({ success: true, provider });
});

// --- Vertex AI 认证 ---
api.post(
  "/auth/vertex/save",
  zValidator(
    "json",
    z.object({
      serviceAccountJson: z.union([z.string(), z.record(z.string(), z.any())]),
    })
  ),
  async (c) => {
    try {
      const { serviceAccountJson } = c.req.valid("json");

    let parsed: any;
    try {
      parsed =
        typeof serviceAccountJson === "string"
          ? JSON.parse(serviceAccountJson)
          : serviceAccountJson;
    } catch (e) {
      return c.json({ error: "Invalid JSON format" }, 400);
    }

    const projectId = parsed.project_id;
    const clientEmail = parsed.client_email;

    if (!projectId || !clientEmail) {
      return c.json(
        { error: "JSON must contain project_id and client_email" },
        400,
      );
    }

    // Build Credential Object
    const vertexCred = {
        id: "vertex",
        provider: "vertex",
        accessToken: "service-account", 
        email: clientEmail,
        metadata: JSON.stringify({
          service_account: parsed,
          project_id: projectId,
          location: "us-central1", // 默认值
        }),
        updatedAt: new Date().toISOString(),
    };

    // Encrypt
    const encryptedVertex = encryptCredential(vertexCred);

    // Save
    await db
      .insert(credentials)
      .values(encryptedVertex)
      .onConflictDoUpdate({
        target: credentials.provider,
        set: {
           metadata: encryptedVertex.metadata,
           email: encryptedVertex.email,
           updatedAt: new Date().toISOString(),
        },
      });

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default api;
