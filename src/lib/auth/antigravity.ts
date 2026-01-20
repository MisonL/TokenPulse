import { config } from "../../config";
import crypto from "crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REDIRECT_URI = `${config.baseUrl}/api/antigravity/callback`;

// Scopes for Antigravity (Google Internal Cloud Code)
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export function generateAntigravityAuthUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: config.antigravity.clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeAntigravityCode(code: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.antigravity.clientId,
    client_secret: config.antigravity.clientSecret,
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
    throw new Error(`Token exchange failed: ${text}`);
  }

  return res.json();
}
