import { db } from "../../db";
import { credentials } from "../../db/schema";
import crypto from "crypto";
import { logger } from "../logger";
import { encryptCredential } from "./crypto_helpers";
import { config } from "../../config";

const IFLOW_CLIENT_ID = config.iflow.clientId;
const IFLOW_CLIENT_SECRET = config.iflow.clientSecret;
const AUTH_URL = "https://iflow.cn/oauth";
const TOKEN_URL = "https://iflow.cn/oauth/token";
const REDIRECT_URI = `${config.baseUrl}/api/iflow/callback`;
const pendingStates = new Set<string>();
export function generateIflowAuthUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const params = new URLSearchParams({
    loginMethod: "phone",
    type: "phone",
    redirect: REDIRECT_URI,
    state: state,
    client_id: IFLOW_CLIENT_ID,
  });
  return `${AUTH_URL}?${params.toString()}`;
}
export function startIflowCallbackServer() {
  Bun.serve({
    port: 11451,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname !== "/oauth2callback") {
        return new Response("未找到页面", { status: 404 });
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
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
          client_id: IFLOW_CLIENT_ID,
          client_secret: IFLOW_CLIENT_SECRET,
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
          logger.error(`iFlow 令牌交换失败: ${text}`, "iFlowAuth");
          return new Response(`<h1>令牌交换失败</h1><p>${text}</p>`, {
            headers: { "Content-Type": "text/html" },
          });
        }
        interface IFlowTokenResponse {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          scope: string;
        }
        const data = (await res.json()) as IFlowTokenResponse;


        const toSave = {
            id: "iflow",
            provider: "iflow",
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
            metadata: JSON.stringify({
              scope: data.scope,
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
            },
          });
        return new Response(
          `
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: green;">Baidu iFlow Connected!</h1>
                        <p>百度 iFlow 已连接成功，可关闭此窗口。</p>
                        <script>setTimeout(() => window.close(), 1000);</script>
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
  logger.info("iFlow 回调服务已启动，端口 11451", "iFlowAuth");
}
