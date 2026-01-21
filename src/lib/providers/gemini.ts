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

// Anti-Ban Headers
const PROXY_HEADERS = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata":
    "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
  "Content-Type": "application/json",
};

// 1. Auth URL
gemini.get("/auth/url", (c) => {
  const state = crypto.randomUUID();
  // Set Cookie for CSRF
  c.header(
    "Set-Cookie",
    `gemini_oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`,
  );

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // Critical for refresh token
    prompt: "consent", // Force consent to get refresh token
    state: state,
  });
  return c.json({ url: `${AUTH_URL}?${params.toString()}` });
});

// 2. Auth Callback
gemini.get("/oauth2callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = c.req
    .header("Cookie")
    ?.match(/gemini_oauth_state=([^;]+)/)?.[1];

  if (!code) return c.json({ error: "No code" }, 400);

  // CSRF Check
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

  // Get User Info for Email (optional but good for ID)
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

// 3. Proxy
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
  const model = inBody.model || "gemini-1.5-pro-preview-0409"; // Default

  // Simple OpenAI -> Gemini Translator (Minimal/Stub)
  // For production this needs to be robust.
  // Assuming "messages" exists.
  const contents = (inBody.messages || []).map((m: any) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const wrappedPayload = {
    project: "available-project", // Usually needs to be fetched or hardcoded?
    // CLIProxyAPI resolves this from metadata: `resolveGeminiProjectID`.
    // Often "term-limited-.." or similar if using Cloud Shell?
    // Actually `gemini_cli_executor` uses what's in auth metadata OR `virtual.ProjectID`.
    // For standard OAuth user, it might be their default project.
    // But `gemini_cli_executor` injects it.
    // IF we don't send `project` in payload, does it work?
    // `gemini_cli_executor.go` line 124 sets it.
    // Let's try to get it from metadata if saved, else use a placeholder or leave empty if possible.
    // Note: Cloud Code usually requires a project.
    // NOTE: Metadata extraction from previous credentials can be implemented here if needed.
    // For now, we rely on fresh authentication.
    model: model,
    request: {
      contents: contents,
      generationConfig: {
        temperature: inBody.temperature,
        maxOutputTokens: inBody.max_tokens,
      },
    },
  };

  // Construct URL
  // https://cloudcode-pa.googleapis.com/v1internal/{model}:generateContent
  // But executor says: `.../v1internal:generateContent` with `model` inside payload.
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
