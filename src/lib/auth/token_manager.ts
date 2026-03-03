import { db } from "../../db";
import { credentials } from "../../db/schema";
import { logger } from "../logger";
import { eq } from "drizzle-orm";
import { decryptCredential } from "./crypto_helpers";
import { encrypt } from "../crypto";
import crypto from "node:crypto";
import type { TokenSelectionPolicy } from "../oauth-selection-policy";

export interface FullCredential {
  id?: string;
  accountId?: string;
  accessToken: string;
  refreshToken: string | null;
  email: string | null;
  metadata?: Record<string, any>;
}

export interface TokenSelectionContext {
  policy?: TokenSelectionPolicy;
  requestedAccountId?: string;
  userKey?: string;
  failureCooldownSec?: number;
  skippedAccountIds?: string[];
}

export class TokenManager {
  private static providerCursor = new Map<string, number>();

  private static parseJsonRecord(m?: string | null): Record<string, any> {
    try {
      return m ? JSON.parse(m) : {};
    } catch {
      return {};
    }
  }

  private static normalizeCredential(cred: any): FullCredential {
    const parsedMetadata = this.parseJsonRecord(cred.metadata);
    const parsedAttributes = this.parseJsonRecord(cred.attributes);
    return {
      id: cred.id,
      accountId: cred.accountId || "default",
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      email: cred.email,
      metadata: {
        ...parsedMetadata,
        attributes: {
          ...(parsedMetadata.attributes || {}),
          ...parsedAttributes,
        },
      },
    };
  }

  private static pickByStableHash(
    providerId: string,
    candidates: any[],
    userKey: string,
  ): any | null {
    if (candidates.length === 0) return null;
    const digest = crypto
      .createHash("sha256")
      .update(`${providerId}:${userKey}`)
      .digest("hex");
    const seed = Number.parseInt(digest.slice(0, 8), 16);
    const index = Number.isFinite(seed) ? seed % candidates.length : 0;
    return candidates[index] || null;
  }

  private static selectCandidate(
    providerId: string,
    candidates: any[],
    policy: TokenSelectionPolicy,
    userKey?: string,
  ): any | null {
    if (candidates.length === 0) return null;

    if (policy === "latest_valid") {
      return candidates[0] || null;
    }

    if (policy === "sticky_user") {
      const normalizedUser = (userKey || "").trim().toLowerCase();
      if (normalizedUser) {
        const sticky = this.pickByStableHash(providerId, candidates, normalizedUser);
        if (sticky) return sticky;
      }
    }

    const cursor = this.providerCursor.get(providerId) || 0;
    const index = cursor % candidates.length;
    const chosen = candidates[index];
    this.providerCursor.set(providerId, (index + 1) % candidates.length);
    return chosen || null;
  }

  private static parseMillis(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private static isCoolingDown(cred: any, cooldownSec: number): boolean {
    if (!cooldownSec || cooldownSec <= 0) return false;
    const failureCount = Number(cred.consecutiveFailures || 0);
    if (failureCount < 3) return false;
    const failedAt = this.parseMillis(cred.lastFailureAt);
    if (failedAt <= 0) return false;
    return Date.now() - failedAt < cooldownSec * 1000;
  }

  static async markFailureByCredentialId(id?: string, reason?: string) {
    if (!id) return;
    try {
      const rows = await db
        .select({
          id: credentials.id,
          consecutiveFailures: credentials.consecutiveFailures,
        })
        .from(credentials)
        .where(eq(credentials.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return;
      const nowIso = new Date().toISOString();
      const now = Date.now();
      const nextFailures = Number(row.consecutiveFailures || 0) + 1;
      await db
        .update(credentials)
        .set({
          consecutiveFailures: nextFailures,
          lastFailureAt: now,
          lastFailureReason: (reason || "").slice(0, 512) || null,
          updatedAt: nowIso,
        })
        .where(eq(credentials.id, id));
    } catch {
      // ignore
    }
  }

  static async clearFailureByCredentialId(id?: string) {
    if (!id) return;
    try {
      await db
        .update(credentials)
        .set({
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureReason: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(credentials.id, id));
    } catch {
      // ignore
    }
  }

  static async getValidToken(
    providerId: string,
    refreshFn: (refreshToken: string) => Promise<any>,
    context: TokenSelectionContext = {},
  ): Promise<FullCredential | null> {
    const rows = await db
      .select()
      .from(credentials)
      .where(eq(credentials.provider, providerId));
    if (rows.length === 0) return null;

    const policy = context.policy || "round_robin";
    const requestedAccountId = (context.requestedAccountId || "").trim();
    const skippedAccountIds = new Set(
      (context.skippedAccountIds || [])
        .map((item) => (item || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const failureCooldownSec = Math.max(0, Math.floor(context.failureCooldownSec || 0));

    const candidates = rows
      .map((row) => decryptCredential(row))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.status !== "revoked" && item.status !== "disabled")
      .filter((item) => Boolean(item.accessToken))
      .filter((item) => {
        if (!requestedAccountId) return true;
        return (item.accountId || "default") === requestedAccountId;
      })
      .filter((item) => {
        const accountId = (item.accountId || "default").toLowerCase();
        if (!skippedAccountIds.size) return true;
        return !skippedAccountIds.has(accountId);
      })
      .filter((item) => !this.isCoolingDown(item, failureCooldownSec))
      .sort((a, b) => {
        if (policy === "latest_valid") {
          return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        }
        return Number(b.expiresAt || 0) - Number(a.expiresAt || 0);
      });

    if (candidates.length === 0) return null;

    const cred = this.selectCandidate(
      providerId,
      candidates,
      policy,
      context.userKey,
    );
    if (!cred || !cred.accessToken) return null;
    const now = Date.now();
    const normalized = this.normalizeCredential(cred);

    // 检查是否过期（带有 5 分钟缓冲）
    if (cred.expiresAt && cred.expiresAt > now + 5 * 60 * 1000) {
      return normalized;
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
        throw new Error("刷新响应无效：缺少 access_token");
      }

      const expiresIn = Number(newData.expires_in);
      const validExpiresIn = isNaN(expiresIn) ? 3600 : expiresIn; // Default 1 hour

      const newMetadata =
        newData.id_token || newData.email || (newData as any).account
          ? { ...(normalized.metadata || {}), ...newData }
          : cred.metadata;

      const encryptedAccessToken = encrypt(newData.access_token);
      let encryptedRefreshToken = undefined;
      if (newData.refresh_token) {
          encryptedRefreshToken = encrypt(newData.refresh_token);
      }

      await db
        .update(credentials)
        .set({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken || cred.refreshToken, // 保持已加密的旧值或更新为新加密值
          expiresAt: now + validExpiresIn * 1000,
          lastRefresh: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureReason: null,
        })
        .where(eq(credentials.id, cred.id));

      return {
        id: cred.id,
        accountId: cred.accountId || "default",
        accessToken: newData.access_token,
        refreshToken: newData.refresh_token || cred.refreshToken,
        email: cred.email,
        metadata:
          typeof newMetadata === "string"
            ? this.parseJsonRecord(newMetadata)
            : newMetadata,
      };
    } catch (e) {
      console.error(
        `[TokenManager] 刷新 ${providerId} 令牌失败:`,
        e,
      );
      return null;
    }
  }
}
