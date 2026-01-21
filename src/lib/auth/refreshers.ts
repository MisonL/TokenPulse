import { config } from "../../config";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { logger } from "../logger";
import { eq } from "drizzle-orm";
import { TokenManager } from "./token_manager";
import { fetchWithRetry } from "../http";

// Registry of Refresh Functions
// Each function takes a Credential Row and returns an Updated Token Data Object (or null if failed)

export const RefreshHandlers: Record<string, (cred: any) => Promise<any>> = {
  gemini: async (cred: any) => googleRefresh(cred, (config as any).gemini),
  antigravity: async (cred: any) =>
    googleRefresh(cred, (config as any).antigravity),
  claude: async (cred: any) => claudeRefresh(cred),
  kiro: async (cred: any) => null, // Manual key for now
  codex: async (cred: any) => null, // Manual key for now
  qwen: async (cred: any) => null, // Manual key / Generic OAuth placeholder
  iflow: async (cred: any) => null, // Manual key / Generic OAuth placeholder
  aistudio: async (cred: any) => null, // API Key (no refresh)
};

async function googleRefresh(
  cred: any,
  authConfig: { clientId: string; clientSecret: string },
) {
  if (!cred.refreshToken) return null;

  logger.info(
    `[Refresher] Refreshing Google Token for ${cred.email} using ${authConfig.clientId.substring(0, 10)}...`,
    "Refresher",
  );

  try {
    const params = new URLSearchParams({
      client_id: authConfig.clientId,
      client_secret: authConfig.clientSecret,
      refresh_token: cred.refreshToken,
      grant_type: "refresh_token",
    });

    const resp = await fetchWithRetry("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = (await resp.json()) as {
      access_token: string;
      expires_in: number;
    };
    if (data.access_token) {
      return {
        access_token: data.access_token,
        expires_in: data.expires_in,
        metadata: cred.metadata,
      };
    }
  } catch (e) {
    logger.error("[Refresher] Google Refresh Failed", e, "Refresher");
  }
  return null;
}


async function claudeRefresh(cred: any) {
  if (!cred.refreshToken) return null;
  logger.info(
    `[Refresher] Refreshing Claude Token for ${cred.email}...`,
    "Refresher",
  );
  try {
    const resp = await fetchWithRetry("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
        client_id: (config as any).claude.clientId,
      }),
    });
    const data = (await resp.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    if (data.access_token) {
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        metadata: cred.metadata,
      };
    }
  } catch (e) {
    logger.error("[Refresher] Claude Refresh Failed", e, "Refresher");
  }
  return null;
}
