import { Hono } from "hono";
import { db } from "../db";
import { credentials } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { strictAuthMiddleware } from "../middleware/auth";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { encryptCredential, decryptCredential } from "../lib/auth/crypto_helpers";
import { writeAuditEvent } from "../lib/admin/audit";
import { resolveAccountId } from "../lib/auth/account-id";
import { getRequestTraceId } from "../middleware/request-context";

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
  const accountCounts: Record<string, number> = {};

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
  SUPPORTED.forEach((p) => {
    statusMap[p] = false;
    accountCounts[p] = 0;
  });

  all.forEach((creds) => {
    const status = creds.status || "active";
    const isActive = status !== "revoked" && status !== "disabled";
    if (!isActive) return;
    statusMap[creds.provider] = true;
    accountCounts[creds.provider] = (accountCounts[creds.provider] || 0) + 1;
  });

  return c.json({
    ...statusMap,
    counts: accountCounts,
  });
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
      accountId: cred.accountId || "default",
      email: cred.email,
      status: cred.status,
      lastRefresh: cred.lastRefresh,
      expiresAt: cred.expiresAt,
      metadata: sanitizeMetadata(cred.metadata as string),
    };
  });
  return c.json(safeList);
});

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
          return c.json({ error: "服务账号 JSON 无效，必须包含 type、private_key、client_email。" }, 400);
        }
      } catch (parseError) {
        // 无效的 JSON 且不是 API Key
        return c.json({ error: "输入无效。请提供 API Key（以 AIza 开头）或有效的服务账号 JSON。" }, 400);
      }
    }

    const newCred = {
        id: `aistudio-${Date.now()}`,
        provider: "aistudio",
        accountId: resolveAccountId({
          provider: "aistudio",
          email,
          metadata,
        }),
        accessToken: accessToken,
        email: email,
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString(),
    };
    
    const encryptedCred = encryptCredential(newCred);

    await db
      .insert(credentials)
      .values(encryptedCred)
      .onConflictDoUpdate({
        target: [credentials.provider, credentials.accountId],
        set: {
          accessToken: encryptedCred.accessToken,
          email: encryptedCred.email,
          metadata: encryptedCred.metadata,
          updatedAt: new Date().toISOString(),
        },
      });

    await writeAuditEvent({
      action: "credential.upsert",
      resource: "aistudio",
      resourceId: `aistudio:${newCred.accountId}`,
      traceId: getRequestTraceId(c),
      details: { mode: metadata.mode },
    });

    return c.json({ success: true, mode: metadata.mode });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});


// 删除凭证 (断开连接)
api.delete("/:provider", async (c) => {
  const provider = c.req.param("provider");
  const accountId = (c.req.query("accountId") || "").trim();

  if (!provider) {
    return c.json({ error: "缺少 provider 参数" }, 400);
  }

  if (accountId) {
    await db
      .delete(credentials)
      .where(
        and(
          eq(credentials.provider, provider),
          eq(credentials.accountId, accountId),
        ),
      );
  } else {
    await db.delete(credentials).where(eq(credentials.provider, provider));
  }

  await writeAuditEvent({
    action: "credential.delete",
    resource: provider,
    resourceId: accountId ? `${provider}:${accountId}` : provider,
    traceId: getRequestTraceId(c),
  });

  return c.json({ success: true, provider, accountId: accountId || undefined });
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
      return c.json({ error: "JSON 格式无效" }, 400);
    }

    const projectId = parsed.project_id;
    const clientEmail = parsed.client_email;

    if (!projectId || !clientEmail) {
      return c.json(
        { error: "JSON 必须包含 project_id 和 client_email" },
        400,
      );
    }

    const vertexCred = {
        id: `vertex-${Date.now()}`,
        provider: "vertex",
        accountId: resolveAccountId({
          provider: "vertex",
          email: clientEmail,
          metadata: {
            project_id: projectId,
          },
        }),
        accessToken: "service-account", 
        email: clientEmail,
        metadata: JSON.stringify({
          service_account: parsed,
          project_id: projectId,
          location: "us-central1", // 默认值
        }),
        updatedAt: new Date().toISOString(),
    };

    const encryptedVertex = encryptCredential(vertexCred);

    await db
      .insert(credentials)
      .values(encryptedVertex)
      .onConflictDoUpdate({
        target: [credentials.provider, credentials.accountId],
        set: {
           metadata: encryptedVertex.metadata,
           email: encryptedVertex.email,
           updatedAt: new Date().toISOString(),
        },
      });

    await writeAuditEvent({
      action: "credential.upsert",
      resource: "vertex",
      resourceId: `vertex:${vertexCred.accountId}`,
      traceId: getRequestTraceId(c),
      details: { projectId },
    });

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default api;
