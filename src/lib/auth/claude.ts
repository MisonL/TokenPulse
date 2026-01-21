import { db } from "../../db";
import { credentials } from "../../db/schema";
import crypto from "crypto";
import { logger } from "../logger";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTH_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "http://localhost:54545/callback";
const SCOPES = "org:create_api_key user:profile user:inference";
// PKCE stores
const pendingStates = new Map<string, string>(); // State -> Verifier
function base64URLEncode(str: Buffer): string {
  return str
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
function sha256(buffer: Buffer): Buffer {
  return crypto.createHash("sha256").update(buffer).digest();
}
export function generateClaudeAuthUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = base64URLEncode(crypto.randomBytes(32));
  const challenge = base64URLEncode(sha256(Buffer.from(verifier)));
  pendingStates.set(state, verifier);
  const params = new URLSearchParams({
    client_id: CLAUDE_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}
// Dedicated Callback Server for Claude (Port 54545)
export function startClaudeCallbackServer() {
  Bun.serve({
    port: 54545,
    async fetch(req) {
      const url = new URL(req.url);

      // Only handle /callback
      if (url.pathname !== "/callback") {
        return new Response("Not Found", { status: 404 });
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state"); // May be embedded in code with #? Upstream parseCodeAndState splits by #.
      const error = url.searchParams.get("error");
      if (error) {
        return new Response(`<h1>Auth Failed</h1><p>${error}</p>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (!code) {
        return new Response("<h1>Missing Code</h1>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      // Upstream logic: `splits := strings.Split(code, "#")`
      // If code contains #state, parse it.
      let actualCode = code;
      let actualState = state || "";
      if (code.includes("#")) {
        const parts = code.split("#");
        actualCode = parts[0] || code;
        if (parts.length > 1) {
          actualState = parts[1] || "";
        }
      }

      // If we have state from query param check that too
      if (state && !actualState) actualState = state;
      const verifier = pendingStates.get(actualState);
      if (!verifier) {
        // Try finding any verifier if state is missing/mangled to be robust? No, unsafe.
        return new Response("<h1>Invalid or Expired State</h1>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      pendingStates.delete(actualState);
      // Exchange Code
      try {
        const reqBody = {
          client_id: CLAUDE_CLIENT_ID,
          grant_type: "authorization_code",
          code: actualCode,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
          state: actualState,
        };
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const text = await res.text();
          logger.error(`Claude token exchange failed: ${text}`, "ClaudeAuth");
          return new Response(`<h1>Exchange Failed</h1><p>${text}</p>`, {
            headers: { "Content-Type": "text/html" },
          });
        }

        interface ClaudeTokenResponse {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          token_type: string;
          organization?: string;
          account?: {
            email_address: string;
          };
        }
        const data = (await res.json()) as ClaudeTokenResponse;

        await db
          .insert(credentials)
          .values({
            id: "claude",
            provider: "claude",
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
            email: data.account?.email_address || "claude-user",
            metadata: JSON.stringify({
              organization: data.organization,
              account: data.account,
              tokenType: data.token_type,
            }),
          })
          .onConflictDoUpdate({
            target: credentials.provider,
            set: {
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              expiresAt: Date.now() + data.expires_in * 1000,
              metadata: JSON.stringify({
                organization: data.organization,
                account: data.account,
                tokenType: data.token_type,
              }),
              email: data.account?.email_address,
            },
          });
        return new Response(
          `
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: green;">Claude Connected!</h1>
                        <p>You can close this window now.</p>
                        <script>
                          try {
                            window.opener.postMessage({ type: 'oauth-success', provider: 'claude' }, '*');
                          } catch(e) {}
                          setTimeout(() => window.close(), 1000);
                        </script>
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
  logger.info("Claude Callback Server started on port 54545", "ClaudeAuth");
}
