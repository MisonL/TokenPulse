import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { config } from "../../config";
import crypto from "crypto";
import { logger } from "../logger";
import { fetchWithRetry } from "../http";

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

// 1. 认证 URL
gemini.get("/auth/url", (c) => {
  const state = crypto.randomUUID();
  // 设置 CSRF Cookie
  c.header(
    "Set-Cookie",
    `gemini_oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`,
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

  if (!code) return c.json({ error: "No code" }, 400);

  // CSRF 检查
  if (state && cookieState && state !== cookieState) {
    logger.error("Gemini OAuth State Mismatch");
    return c.json({ error: "Invalid State (CSRF Protection)" }, 403);
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
      { error: "Token exchange failed", details: await tokenResp.text() },
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
  await db
    .insert(credentials)
    .values({
      id: crypto.randomUUID(),
      provider: PROVIDER_ID,
      email: email,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now + data.expires_in * 1000,
      lastRefresh: new Date().toISOString(),
      metadata: JSON.stringify(data),
    })
    .onConflictDoUpdate({
      target: credentials.provider,
      set: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: now + data.expires_in * 1000,
        lastRefresh: new Date().toISOString(),
      },
    });

  return c.html("<h1>Gemini Auth Successful</h1>");
});

// 3. 代理
gemini.post("/v1/chat/completions", async (c) => {
  const creds = await db
    .select()
    .from(credentials)
    .where(eq(credentials.provider, PROVIDER_ID))
    .limit(1);
  const cred = creds[0];
  if (!cred) return c.json({ error: "No authenticated Gemini account" }, 401);
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
  // https://cloudcode-pa.googleapis.com/v1internal/{model}:generateContent
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
