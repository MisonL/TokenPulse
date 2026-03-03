import { config } from "../../config";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { randomBytes } from "crypto";
import { encryptCredential } from "./crypto_helpers";

const KIRO_ENDPOINT = config.kiro.endpoint;
const START_URL = config.kiro.startUrl;
const USER_AGENT = config.kiro.userAgent;

interface RegisterClientResponse {
  clientId: string;
  clientSecret: string;
  clientIdIssuedAt: number;
  clientSecretExpiresAt: number;
}

interface DeviceAuthResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  idToken?: string;
}

import { initiateQwenDeviceFlow, pollQwenToken } from "./qwen";

export async function registerKiroClient(): Promise<RegisterClientResponse> {
  const payload = {
    clientName: "Kiro IDE",
    clientType: "public",
    scopes: [
      "codewhisperer:completions",
      "codewhisperer:analysis",
      "codewhisperer:conversations",
      "codewhisperer:transformations",
      "codewhisperer:taskassist",
    ],
    grantTypes: [
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ],
  };

  const res = await fetch(`${KIRO_ENDPOINT}/client/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`注册 Kiro 客户端失败: ${res.statusText}`);
  }

  return (await res.json()) as RegisterClientResponse;
}

export async function initiateKiroDeviceFlow(
  clientId: string,
  clientSecret: string,
): Promise<DeviceAuthResponse> {
  const payload = {
    clientId,
    clientSecret,
    startUrl: START_URL,
  };

  const res = await fetch(`${KIRO_ENDPOINT}/device_authorization`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`初始化设备码流程失败: ${res.statusText}`);
  }

  return (await res.json()) as DeviceAuthResponse;
}

export async function pollKiroToken(
  deviceCode: string,
  clientId: string,
  clientSecret: string,
): Promise<{
  success: boolean;
  accessToken?: string;
  pending?: boolean;
  error?: string;
}> {
  const payload = {
    clientId,
    clientSecret,
    deviceCode,
    grantType: "urn:ietf:params:oauth:grant-type:device_code",
  };

  const res = await fetch(`${KIRO_ENDPOINT}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 400) {
    const errData = (await res.json()) as { error?: string };
    if (errData.error === "authorization_pending") {
      return { success: false, pending: true };
    }
    if (errData.error === "slow_down") {
      return { success: false, pending: true };
    }
    return { success: false, error: errData.error || "获取令牌失败" };
  }

  if (!res.ok) {
    const txt = await res.text();
    return { success: false, error: txt };
  }

  const data = (await res.json()) as TokenResponse;

  const toSave = {
    id: "kiro",
    provider: "kiro",
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
    lastRefresh: new Date().toISOString(),
    metadata: JSON.stringify({
      clientId,
      clientSecret,
      authMethod: "builder-id",
    }),
  };
  const encrypted = encryptCredential(toSave);

  await db
    .insert(credentials)
    .values(encrypted)
    .onConflictDoUpdate({
      target: credentials.provider,
      set: {
        accessToken: encrypted.accessToken,
        refreshToken: encrypted.refreshToken,
        expiresAt: encrypted.expiresAt,
        lastRefresh: encrypted.lastRefresh,
        metadata: encrypted.metadata,
      },
    });

  return { success: true, accessToken: data.accessToken };
}
