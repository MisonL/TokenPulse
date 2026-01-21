import { db } from "../../db";
import { credentials } from "../../db/schema";
import crypto from "crypto";
import { logger } from "../logger";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPES = "openid email profile offline_access api.model.read model.read";

// In-memory store for PKCE verifiers: state -> verifier
// Prune this periodically in production, but fine for local single-user.
const pendingStates = new Map<string, string>();

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

export function generateCodexAuthUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = base64URLEncode(crypto.randomBytes(32));
  const challenge = base64URLEncode(sha256(Buffer.from(verifier)));

  pendingStates.set(state, verifier);

  const params = new URLSearchParams({
    client_id: OPENAI_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  });

  return `${AUTH_URL}?${params.toString()}`;
}

// Dedicated Callback Server for Codex (Port 1455)
export function startCodexCallbackServer() {
  Bun.serve({
    port: 1455,
    async fetch(req) {
      const url = new URL(req.url);

      // Only handle /auth/callback
      if (url.pathname !== "/auth/callback") {
        return new Response("Not Found", { status: 404 });
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        return new Response(`<h1>Auth Failed</h1><p>${error}</p>`, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (!code || !state) {
        return new Response("<h1>Missing Code or State</h1>", {
          headers: { "Content-Type": "text/html" },
        });
      }

      const verifier = pendingStates.get(state);
      if (!verifier) {
        return new Response("<h1>Invalid or Expired State</h1>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      pendingStates.delete(state); // Consume state

      // Exchange Code
      try {
        const params = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: OPENAI_CLIENT_ID,
          code: code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        });

        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });

        if (!res.ok) {
          const text = await res.text();
          logger.error(`Codex token exchange failed: ${text}`, "CodexAuth");
          return new Response(`<h1>Exchange Failed</h1><p>${text}</p>`, {
            headers: { "Content-Type": "text/html" },
          });
        }

        interface CodexTokenResponse {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          token_type: string;
          id_token: string;
          scope: string;
        }

        const data = (await res.json()) as CodexTokenResponse;

        // Save to DB
        // Parse ID Token to get email if possible, or use generic
        let email = "codex-user@openai";
        // Decoding JWT trivially (without verifying signature here, assuming direct response from OpenAI is safe enough for local tool)
        try {
          const parts = data.id_token.split(".");
          const payloadPart = parts[1];
          if (parts.length === 3 && payloadPart) {
            const payload = JSON.parse(
              Buffer.from(payloadPart, "base64").toString(),
            );
            if (payload.email) email = payload.email;
          }
        } catch {
          // Ignore decoding errors
        }

        await db
          .insert(credentials)
          .values({
            id: "codex",
            provider: "codex",
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
            email: email,
            metadata: JSON.stringify({
              idToken: data.id_token,
              scope: data.scope,
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
                idToken: data.id_token,
                scope: data.scope,
                tokenType: data.token_type,
              }),
            },
          });

        return new Response(
          `
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: green;">Authentication Successful!</h1>
                        <p>You have successfully logged in to OpenAI Codex.</p>
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
  logger.info(`Codex Callback Server started on port 1455`, "CodexAuth");
}
