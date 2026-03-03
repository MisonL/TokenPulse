import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { encryptCredential } from "./crypto_helpers";
import { config } from "../../config";
import { resolveAccountId } from "./account-id";

const QWEN_CLIENT_ID = config.oauth.qwenClientId;
const QWEN_SCOPE = "openid profile email model.completion";
const QWEN_DEVICE_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/device/code";
const QWEN_TOKEN_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/token";

export async function initiateQwenDeviceFlow() {


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

  const toSave = {
    id: crypto.randomUUID(),
    provider: "qwen",
    accountId: resolveAccountId({
      provider: "qwen",
      metadata: { resource_url: tokens.resource_url },
    }),
    email: "qwen-user",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    lastRefresh: new Date().toISOString(),
    metadata: JSON.stringify({ resource_url: tokens.resource_url }),
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

  return { success: true };
}

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
