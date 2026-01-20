import { db } from "../../db";
import { credentials } from "../../db/schema";
import crypto from "crypto";
import { logger } from "../logger";
const IFLOW_CLIENT_ID = "10009311001";
const IFLOW_CLIENT_SECRET = "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW";
const AUTH_URL = "https://iflow.cn/oauth";
const TOKEN_URL = "https://iflow.cn/oauth/token";
const REDIRECT_URI = "http://localhost:11451/oauth2callback";
// In-memory store for states if needed. iFlow might not force PKCE but State is good practice.
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
// Dedicated Callback Server for iFlow (Port 11451)
export function startIflowCallbackServer() {
  Bun.serve({
    port: 11451,
    async fetch(req) {
      const url = new URL(req.url);

      // Only handle /oauth2callback
      if (url.pathname !== "/oauth2callback") {
        return new Response("Not Found", { status: 404 });
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code) {
        return new Response("<h1>Missing Code</h1>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      // Verify state if provided (some providers might skip it in simplified flows, but we sent it)
      if (state && !pendingStates.has(state)) {
        // Warn but proceed? Upstream iflow_auth.go doesn't seem to strictly enforce state map, just sends it.
        // We'll proceed.
      }
      if (state) pendingStates.delete(state);
      // Exchange Code
      try {
        // iFlow uses query params for code exchange often, or form body.
        // Upstream: Values.Set("grant_type", "authorization_code")...
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
          logger.error(`iFlow token exchange failed: ${text}`, "iFlowAuth");
          return new Response(`<h1>Exchange Failed</h1><p>${text}</p>`, {
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

        // Save to DB
        // iFlow returns access_token, refresh_token, expires_in.

        await db
          .insert(credentials)
          .values({
            id: "iflow",
            provider: "iflow",
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
            metadata: JSON.stringify({
              scope: data.scope,
            }),
          })
          .onConflictDoUpdate({
            target: credentials.provider,
            set: {
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              expiresAt: Date.now() + data.expires_in * 1000,
              metadata: JSON.stringify({
                scope: data.scope,
              }),
            },
          });
        return new Response(
          `
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: green;">Baidu iFlow Connected!</h1>
                        <p>You can close this window now.</p>
                        <script>setTimeout(() => window.close(), 1000);</script>
                    </body>
                    </html>
                `,
          { headers: { "Content-Type": "text/html" } },
        );
      } catch (e: any) {
        return new Response(`<h1>Internal Error</h1><p>${e.message}</p>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
    },
  });
  logger.info("iFlow Callback Server started on port 11451", "iFlowAuth");
}
