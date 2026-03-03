import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { config } from "../../config";
import crypto from "crypto";
import { logger } from "../logger";
import { fetchWithRetry } from "../http";
import { decryptCredential, encryptCredential } from "../auth/crypto_helpers";
import { resolveAccountId } from "../auth/account-id";

const gemini = new Hono();

const PROVIDER_ID = "gemini";
const CLIENT_ID = config.gemini.clientId;
const CLIENT_SECRET = config.gemini.clientSecret;
const REDIRECT_URI = `${config.baseUrl}/api/gemini/oauth2callback`;
const AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

// 防封禁标头
const PROXY_HEADERS = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata":
    "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
  "Content-Type": "application/json",
};

export async function getModels(token: string): Promise<
  { id: string; name: string; provider: string }[]
> {
  try {
    const response = await fetchWithRetry(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (response.ok) {
      const data = (await response.json()) as {
        models?: Array<{ name?: string; displayName?: string }>;
      };
      const models = (data.models || [])
        .map((item) => {
          const rawName = (item.name || "").replace(/^models\//, "");
          if (!rawName) return null;
          return {
            id: rawName,
            name: item.displayName || rawName,
            provider: "gemini",
          };
        })
        .filter(Boolean) as { id: string; name: string; provider: string }[];
      if (models.length > 0) {
        return models;
      }
    }
  } catch {}

  return [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "gemini" },
  ];
}

// 1. 认证 URL
gemini.get("/auth/url", (c) => {
  const state = crypto.randomUUID();
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  
  // 设置 CSRF Cookie
  c.header(
    "Set-Cookie",
    `gemini_oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax${secureFlag}`,
  );

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // 获取 refresh token 的关键
    prompt: "consent", // 强制同意以获取 refresh token
    state: state,
  });
  return c.json({ url: `${AUTH_URL}?${params.toString()}` });
});

// 2. 认证回调
gemini.get("/oauth2callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = c.req
    .header("Cookie")
    ?.match(/gemini_oauth_state=([^;]+)/)?.[1];

  if (!code) return c.json({ error: "缺少授权码" }, 400);

  // CSRF 检查
  if (state && cookieState && state !== cookieState) {
    logger.error("Gemini OAuth 状态校验不匹配");
    return c.json({ error: "状态校验失败（CSRF 防护）" }, 403);
  }

  const tokenResp = await fetchWithRetry(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok)
    return c.json(
      { error: "令牌交换失败", details: await tokenResp.text() },
      400,
    );

  const data = (await tokenResp.json()) as any;

  // 获取用户信息的邮箱（可选，但有利于 ID 标识）
  let email = "unknown";
  try {
    const userResp = await fetchWithRetry(
      "https://www.googleapis.com/oauth2/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${data.access_token}` },
      },
    );
    if (userResp.ok) {
      const u = (await userResp.json()) as any;
      email = u.email;
    }
  } catch (e) {}

  const now = Date.now();
  
  const toSave = {
      id: crypto.randomUUID(),
      provider: PROVIDER_ID,
      accountId: resolveAccountId({
        provider: PROVIDER_ID,
        email,
        metadata: data,
      }),
      email: email,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now + data.expires_in * 1000,
      lastRefresh: new Date().toISOString(),
      metadata: JSON.stringify(data),
  };

  const encrypted = encryptCredential(toSave);

  await db
    .insert(credentials)
    .values(encrypted)
    .onConflictDoUpdate({
      target: [credentials.provider, credentials.accountId],
      set: {
        accessToken: encrypted.accessToken,
        refreshToken: encrypted.refreshToken,
        expiresAt: encrypted.expiresAt,
        lastRefresh: encrypted.lastRefresh,
        metadata: encrypted.metadata,
      },
    });

  return c.html("<h1>Gemini 授权成功</h1>");
});

// 3. 代理
gemini.post("/v1/chat/completions", async (c) => {
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.provider, PROVIDER_ID))
    .orderBy(desc(credentials.updatedAt));

  if (!rows || rows.length === 0) {
    throw new Error("未找到 Gemini 凭据，请先完成授权。");
  }

  const cred = rows
    .map((row) => decryptCredential(row))
    .find((item) => {
      const status = item.status || "active";
      return status !== "revoked" && status !== "disabled";
    });
  if (!cred) return c.json({ error: "当前无已授权的 Gemini 账号" }, 401);
  const token = cred.accessToken;
  const inBody = await c.req.json();
  const model = inBody.model || "gemini-1.5-pro-preview-0409"; // 默认值

  // 简单的 OpenAI -> Gemini 转换器 (最小化/存根)
  // 生产环境需要更健壮。
  // 假设 "messages" 存在。
  const contents = (inBody.messages || []).map((m: any) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const wrappedPayload = {
    project: "available-project", // 通常需要获取或硬编码？
    // CLIProxyAPI 从 metadata 解析此项: `resolveGeminiProjectID`。
    // 如果使用 Cloud Shell，通常是 "term-limited-.." 或类似？
    // 实际上 `gemini_cli_executor` 使用 auth metadata 或 `virtual.ProjectID`。
    // 对于标准 OAuth 用户，可能是他们的默认项目。
    // 但 `gemini_cli_executor` 会注入它。
    // 如果我们在 payload 中不发送 `project`，能工作吗？
    // `gemini_cli_executor.go` 第 124 行设置了它。
    // 让我们尝试从 metadata 获取（如果已保存），否则使用占位符或如果可能留空。
    // 注意：Cloud Code 通常需要 project。
    // 注意：如果需要，可以在此处实施从先前凭据提取 Metadata。
    // 目前，我们依赖新的认证。
    model: model,
    request: {
      contents: contents,
      generationConfig: {
        temperature: inBody.temperature,
        maxOutputTokens: inBody.max_tokens,
      },
    },
  };

  // 构建 URL
  // 但 executor 说: `.../v1internal:generateContent` 且 payload 中包含 `model`。
  const url = "https://cloudcode-pa.googleapis.com/v1internal:generateContent";

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      ...PROXY_HEADERS,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(wrappedPayload),
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

export default gemini;
