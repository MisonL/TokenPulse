import { logger } from "../logger";
import type { TokenResponse } from "./oauth-client";

export interface UserIdentity {
  email?: string;
  id?: string;
  name?: string;
  [key: string]: any;
}

export type UserInfoFetcher = (token: string) => Promise<UserIdentity | null>;

/**
 * 智能身份解析器 (Identity Resolver)
 * 能够从多种来源（JWT, UserInfo API, Metadata）中智能提取身份信息。
 */
export class IdentityResolver {
  /**
   * 解析身份
   * 优先级：UserInfo 回调 > JWT payload (id_token > access_token) > Token 响应字段
   */
  static async resolve(
    tokenData: TokenResponse,
    fetcher?: UserInfoFetcher,
  ): Promise<UserIdentity> {
    let identity: UserIdentity = {};

    // 1. 尝试 UserInfo API 回调 (优先级最高，因为它是实时的)
    if (fetcher) {
      try {
        const fetchedIdentity = await fetcher(tokenData.access_token);
        if (fetchedIdentity) {
          identity = { ...identity, ...fetchedIdentity };
        }
      } catch (e: any) {
        logger.warn(`IdentityResolver: UserInfo fetcher failed: ${e.message}`);
      }
    }

    // 2. 尝试解析 id_token (JWT)
    if (tokenData.id_token) {
      const jwtPayload = this.decodeJWT(tokenData.id_token);
      if (jwtPayload) {
        identity.email = identity.email || jwtPayload.email || jwtPayload.upn;
        identity.id = identity.id || jwtPayload.sub;
        identity.name =
          identity.name || jwtPayload.name || jwtPayload.preferred_username;
      }
    }

    // 3. 尝试解析 access_token (如果它也是 JWT)
    if (!identity.email && tokenData.access_token) {
      const jwtPayload = this.decodeJWT(tokenData.access_token);
      if (jwtPayload) {
        identity.email = identity.email || jwtPayload.email || jwtPayload.upn;
        identity.id = identity.id || jwtPayload.sub;
      }
    }

    // 4. 尝试从 TokenResponse 的其他字段猜测
    identity.email =
      identity.email || tokenData.email || tokenData.account?.email_address;
    identity.id = identity.id || tokenData.user_id || tokenData.sub;

    return identity;
  }

  /**
   * 安全地解码 JWT Payload
   */
  private static decodeJWT(token: string): any {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      // 处理 Base64URL 编码
      const payloadPart = parts[1];
      if (!payloadPart) return null;
      const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = Buffer.from(base64, "base64").toString("utf8");
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  }
}
