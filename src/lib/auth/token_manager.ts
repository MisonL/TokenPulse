import { db } from "../../db";
import { credentials } from "../../db/schema";
import { logger } from "../logger";
import { eq } from "drizzle-orm";
import { config } from "../../config";

export interface FullCredential {
  accessToken: string;
  refreshToken: string | null;
  email: string | null;
  metadata?: any;
}

export class TokenManager {
  static async getValidToken(
    providerId: string,
    refreshFn: (refreshToken: string) => Promise<any>,
  ): Promise<FullCredential | null> {
    const creds = await db
      .select()
      .from(credentials)
      .where(eq(credentials.provider, providerId))
      .limit(1);
    if (creds.length === 0) return null;

    const cred = creds[0];
    if (!cred || !cred.accessToken) return null;
    const now = Date.now();

    const parseMetadata = (m?: string | null) => {
      try {
        return m ? JSON.parse(m) : {};
      } catch {
        return {};
      }
    };

    // 检查是否过期（带有 5 分钟缓冲）
    if (cred.expiresAt && cred.expiresAt > now + 5 * 60 * 1000) {
      return {
        accessToken: cred.accessToken as string,
        refreshToken: cred.refreshToken,
        email: cred.email,
        metadata: parseMetadata(cred.metadata),
      };
    }

    // 刷新
    if (!cred.refreshToken) return null;

    try {
      logger.info(
        `[TokenManager] Refreshing token for ${providerId}...`,
        "TokenManager",
      );
      const newData = await refreshFn(cred.refreshToken);
      if (!newData || !newData.access_token) {
        throw new Error("Invalid refresh response: missing access_token");
      }

      const expiresIn = Number(newData.expires_in);
      const validExpiresIn = isNaN(expiresIn) ? 3600 : expiresIn; // Default 1 hour

      const newMetadata =
        newData.id_token || newData.email || (newData as any).account
          ? { ...parseMetadata(cred.metadata), ...newData }
          : cred.metadata;

      await db
        .update(credentials)
        .set({
          accessToken: newData.access_token,
          refreshToken: newData.refresh_token || cred.refreshToken, // 如果没有轮换则保持旧值
          expiresAt: now + validExpiresIn * 1000,
          lastRefresh: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(credentials.id, cred.id));

      return {
        accessToken: newData.access_token,
        refreshToken: newData.refresh_token || cred.refreshToken,
        email: cred.email,
        metadata:
          typeof newMetadata === "string"
            ? parseMetadata(newMetadata)
            : newMetadata,
      };
    } catch (e) {
      console.error(
        `[TokenManager] Failed to refresh token for ${providerId}:`,
        e,
      );
      return null;
    }
  }
}
