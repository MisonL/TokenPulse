import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";

const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_SCOPE = "openid profile email model.completion";
const QWEN_DEVICE_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/device/code";
const QWEN_TOKEN_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/token";

export async function initiateQwenDeviceFlow() {
  // Generate PKCE (Simplified for now or skipped if not strictly enforced by device flow on this endpoint,
  // but upstream uses it. We should probably add it.)
  // Note: Upstream generates random verifier.

  // For MVP, we'll try without PKCE or simple PKCE if required.
  // Upstream sends code_challenge.

  const codeVerifier = generateRandomString(43);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const body = new URLSearchParams({
    client_id: QWEN_CLIENT_ID,
    scope: QWEN_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const resp = await fetch(QWEN_DEVICE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) throw new Error(`Qwen Init Failed: ${resp.status}`);

  const data = (await resp.json()) as Record<string, any>;
  return {
    ...data,
    code_verifier: codeVerifier, // Return this to frontend or store in session?
    // Better to return to frontend and have frontend poll with it.
  };
}

export async function pollQwenToken(deviceCode: string, codeVerifier: string) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: QWEN_CLIENT_ID,
    device_code: deviceCode,
    code_verifier: codeVerifier,
  });

  const resp = await fetch(QWEN_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (resp.status === 400) {
    const err = (await resp.json()) as { error: string };
    return { error: err.error, pending: true };
  }

  if (!resp.ok) throw new Error(`Token Poll Failed: ${resp.status}`);

  interface QwenTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    resource_url: string;
  }

  const tokens = (await resp.json()) as QwenTokenResponse;

  // SAVE TO DB
  await db
    .insert(credentials)
    .values({
      id: crypto.randomUUID(),
      provider: "qwen",
      email: "qwen-user", // Parsing JWT would give real email
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      lastRefresh: new Date().toISOString(),
      metadata: JSON.stringify({ resource_url: tokens.resource_url }),
    })
    .onConflictDoUpdate({
      target: credentials.provider,
      set: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        updatedAt: new Date().toISOString(),
      },
    });

  return { success: true };
}

// PKCE Utils
function generateRandomString(length: number) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    const val = randomValues[i];
    if (val !== undefined) {
      result += chars[val % chars.length];
    }
  }
  return result;
}

async function generateCodeChallenge(verifier: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
