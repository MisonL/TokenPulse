import { db } from "../../db";
import { credentials } from "../../db/schema";
import crypto from "crypto";
import { logger } from "../logger";
import { eq } from "drizzle-orm";
import { config } from "../../config";

export interface AuthConfig {
  providerId: string;
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
  // Custom parameters for auth URL
  customAuthParams?: Record<string, string>;
  // Custom parameters for token exchange
  customTokenParams?: Record<string, string>;
  usePkce?: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  [key: string]: any;
}

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
  [key: string]: any;
}

export class OAuthService {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  private base64URLEncode(str: Buffer): string {
    return str
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  private sha256(buffer: Buffer): Buffer {
    return crypto.createHash("sha256").update(buffer).digest();
  }

  public generateAuthUrl(): { url: string; state: string; verifier?: string } {
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(" "),
      state: state,
      ...this.config.customAuthParams,
    });

    let verifier: string | undefined;

    if (this.config.usePkce) {
      verifier = this.base64URLEncode(crypto.randomBytes(32));
      const challenge = this.base64URLEncode(
        this.sha256(Buffer.from(verifier)),
      );
      params.append("code_challenge", challenge);
      params.append("code_challenge_method", "S256");
    }

    return {
      url: `${this.config.authUrl}?${params.toString()}`,
      state,
      verifier,
    };
  }

  public async generatePkcePair(): Promise<{
    verifier: string;
    challenge: string;
  }> {
    const verifier = this.base64URLEncode(crypto.randomBytes(32));
    const challenge = this.base64URLEncode(this.sha256(Buffer.from(verifier)));
    return { verifier, challenge };
  }

  public async exchangeCodeForToken(
    code: string,
    verifier?: string,
    authMethod: "body" | "basic" = "body",
  ): Promise<TokenResponse> {
    let body: Record<string, string> = {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: this.config.redirectUri,
      ...this.config.customTokenParams,
    };

    if (authMethod === "body") {
      body.client_id = this.config.clientId;
      if (this.config.clientSecret) {
        body.client_secret = this.config.clientSecret;
      }
    }

    if (this.config.usePkce && verifier) {
      body.code_verifier = verifier;
    }

    const headers: Record<string, string> = {
      "Content-Type":
        authMethod === "body"
          ? "application/json"
          : "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (authMethod === "basic" && this.config.clientSecret) {
      const authPrefix = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`,
      ).toString("base64");
      headers["Authorization"] = `Basic ${authPrefix}`;
    }

    return this.fetchWithRetry(this.config.tokenUrl, {
      method: "POST",
      headers,
      body:
        authMethod === "body"
          ? JSON.stringify(body)
          : new URLSearchParams(body).toString(),
    });
  }

  /**
   * 能力：发起设备流 (Device Flow)
   */
  public async initiateDeviceFlow(
    deviceAuthUrl: string,
    extraParams: any = {},
  ): Promise<DeviceAuthResponse> {
    const body = {
      client_id: this.config.clientId,
      scope: this.config.scopes.join(" "),
      ...extraParams,
    };

    return this.fetchWithRetry(deviceAuthUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }) as Promise<any>;
  }

  /**
   * 能力：轮询设备令牌
   */
  public async pollDeviceToken(
    deviceCode: string,
    extraParams: any = {},
  ): Promise<TokenResponse> {
    const body = {
      client_id: this.config.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      ...extraParams,
    };

    if (this.config.clientSecret) {
      (body as any).client_secret = this.config.clientSecret;
    }

    return this.fetchWithRetry(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  public async refreshToken(refreshToken: string): Promise<TokenResponse> {
    let body: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      ...this.config.customTokenParams,
    };

    if (this.config.clientSecret) {
      body.client_secret = this.config.clientSecret;
    }

    return this.fetchWithRetry(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries = 5,
    initialDelay = 1000,
  ): Promise<TokenResponse> {
    let lastError: any;

    for (let i = 0; i < retries; i++) {
      try {
        // TODO: Add proxy support here if needed via config
        const res = await fetch(url, options);

        if (!res.ok) {
          const text = await res.text();
          // Don't retry on 4xx errors (client errors) like 400 Bad Request, 401 Unauthorized
          // EXCEPT if it's a rate limit (429) or sometimes 408
          if (res.status === 429 || res.status >= 500) {
            throw new Error(`Auth request failed (${res.status}): ${text}`);
          }
          if (res.status >= 400 && res.status < 500) {
            throw new Error(
              `Auth client error (${res.status}): ${text} -- NO_RETRY`,
            );
          }
          throw new Error(`Auth request failed (${res.status}): ${text}`);
        }

        return (await res.json()) as TokenResponse;
      } catch (e: any) {
        lastError = e;
        if (e.message.includes("NO_RETRY")) throw e;

        // Exponential Backoff with Jitter: delay = initialDelay * 2^i + random_jitter
        if (i < retries - 1) {
          const backoff = initialDelay * Math.pow(2, i);
          const jitter = Math.random() * 500; // 0-500ms jitter
          const delay = Math.min(backoff + jitter, 10000); // Cap at 10s
          logger.warn(
            `Auth request failed (attempt ${i + 1}/${retries}). Retrying in ${Math.round(delay)}ms... Error: ${e.message}`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  public async saveCredentials(
    data: TokenResponse,
    email?: string,
    metadata: any = {},
  ) {
    const now = Date.now();
    const expiresAt = data.expires_in
      ? now + data.expires_in * 1000
      : undefined;

    await db
      .insert(credentials)
      .values({
        id: crypto.randomUUID(),
        provider: this.config.providerId,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: expiresAt,
        email: email, // Can be null if not provided
        lastRefresh: new Date().toISOString(),
        metadata: JSON.stringify(metadata),
        status: "active",
        attributes: JSON.stringify(metadata.attributes || {}),
        nextRefreshAfter: expiresAt
          ? now + data.expires_in * 1000 * 0.8
          : undefined,
      })
      .onConflictDoUpdate({
        target: credentials.provider,
        set: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: expiresAt,
          lastRefresh: new Date().toISOString(),
          email: email || undefined, // Only update email if provided
          metadata: JSON.stringify(metadata),
          updatedAt: new Date().toISOString(),
          status: "active",
          nextRefreshAfter: expiresAt
            ? now + data.expires_in * 1000 * 0.8
            : undefined, // Refresh at 80% lifetime
          attributes: JSON.stringify(metadata.attributes || {}),
        },
      });
  }
}
