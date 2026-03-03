import { db } from "../../db";
import { credentials } from "../../db/schema";
import crypto from "crypto";
import { logger } from "../logger";
import { encryptCredential } from "./crypto_helpers";
import { config } from "../../config";

const GEMINI_CLIENT_ID = config.gemini.clientId;
const GEMINI_CLIENT_SECRET = config.gemini.clientSecret;
const AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REDIRECT_URI = `${config.baseUrl}/api/gemini/oauth2callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");
const pendingStates = new Set<string>();
export function generateGeminiAuthUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const params = new URLSearchParams({
    client_id: GEMINI_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: state,
    access_type: "offline", // Important for refresh token
    prompt: "consent", // Force consent to get refresh token
  });
  return `${AUTH_URL}?${params.toString()}`;
}
export function startGeminiCallbackServer() {
  Bun.serve({
    port: 8085,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname !== "/oauth2callback") {
        return new Response("未找到页面", { status: 404 });
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        return new Response(`<h1>授权失败</h1><p>${error}</p>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (!code) {
        return new Response("<h1>缺少授权码</h1>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (state && !pendingStates.has(state)) {
      }
      if (state) pendingStates.delete(state);
      try {
        const params = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: GEMINI_CLIENT_ID,
          client_secret: GEMINI_CLIENT_SECRET,
          code: code,
          redirect_uri: REDIRECT_URI,
        });
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        if (!res.ok) {
          const text = await res.text();
          logger.error(`Gemini 令牌交换失败: ${text}`, "GeminiAuth");
          return new Response(`<h1>令牌交换失败</h1><p>${text}</p>`, {
            headers: { "Content-Type": "text/html" },
          });
        }
        interface GeminiTokenResponse {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          id_token: string;
          scope: string;
        }
        const data = (await res.json()) as GeminiTokenResponse;

        let email = "gemini-user@google";
        if (data.access_token) {
          try {
            const userRes = await fetch(
              "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
              {
                headers: { Authorization: `Bearer ${data.access_token}` },
              },
            );
            interface GoogleUserInfo {
              email: string;
            }
            const userData = (await userRes.json()) as GoogleUserInfo;
            if (userData.email) email = userData.email;
          } catch (e) {}
        }

        const toSave = {
            id: "gemini",
            provider: "gemini",
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
            email: email,
            metadata: JSON.stringify({
              scope: data.scope,
              idToken: data.id_token,
            }),
        };

        const encrypted = encryptCredential(toSave);

        await db
          .insert(credentials)
          .values(encrypted)
          .onConflictDoUpdate({
            target: credentials.provider,
            set: {
              accessToken: encrypted.accessToken,
              refreshToken: encrypted.refreshToken,
              expiresAt: encrypted.expiresAt,
              metadata: encrypted.metadata,
              email: encrypted.email,
            },
          });
        return new Response(
          `
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: green;">Gemini Connected!</h1>
                        <p>你已成功登录 Google Gemini。</p>
                        <p>现在可以关闭此窗口。</p>
                        <script>
                          try {
                            window.opener.postMessage({ type: 'oauth-success', provider: 'gemini' }, '*');
                          } catch(e) {}
                          setTimeout(() => window.close(), 1000);
                        </script>
                    </body>
                    </html>
                `,
          { headers: { "Content-Type": "text/html" } },
        );
      } catch (e: any) {
        return new Response(`<h1>内部错误</h1><p>${e.message}</p>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
    },
  });
  logger.info("Gemini 回调服务已启动，端口 8085", "GeminiAuth");
}
