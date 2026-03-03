import { config } from "../../config";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { logger } from "../logger";
import { eq } from "drizzle-orm";
import { TokenManager } from "./token_manager";
import { fetchWithRetry } from "../http";


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
    `[刷新器] 正在为 ${cred.email} 刷新 Google 令牌（${authConfig.clientId.substring(0, 10)}...）`,
    "刷新器",
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
    logger.error("[刷新器] Google 刷新失败", e, "刷新器");
  }
  return null;
}


async function claudeRefresh(cred: any) {
  if (!cred.refreshToken) return null;
  logger.info(
    `[刷新器] 正在为 ${cred.email} 刷新 Claude 令牌...`,
    "刷新器",
  );
  try {
    const resp = await fetchWithRetry("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
        client_id: config.oauth.claudeClientId,
      }),
    });
    const data = (await resp.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    if (data.access_token) {
      const parsedMeta = parseMetadata(cred.metadata);
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        metadata: {
          ...parsedMeta,
          access_token: data.access_token,
        },
      };
    }
  } catch (e) {
    logger.error("[刷新器] Claude 刷新失败", e, "刷新器");
  }
  return null;
}

function parseMetadata(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return {};
  }
}
