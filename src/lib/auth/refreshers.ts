import { config } from "../../config";
import { logger } from "../logger";
import { fetchWithRetry } from "../http";

const QWEN_TOKEN_ENDPOINT = "https://chat.qwen.ai/api/v1/oauth2/token";
const IFLOW_TOKEN_ENDPOINT = "https://iflow.cn/oauth/token";
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export const RefreshHandlers: Record<string, (cred: any) => Promise<any>> = {
  gemini: async (cred: any) => googleRefresh(cred, (config as any).gemini),
  antigravity: async (cred: any) =>
    googleRefresh(cred, (config as any).antigravity),
  claude: async (cred: any) => claudeRefresh(cred),
  kiro: async (cred: any) => null, // Manual key for now
  codex: async (cred: any) => null, // Manual key for now
  qwen: async (cred: any) => qwenRefresh(cred),
  iflow: async (cred: any) => iflowRefresh(cred),
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

async function qwenRefresh(cred: any) {
  if (!cred.refreshToken) {
    logger.info("[刷新器] Qwen 跳过刷新：缺少 refresh_token", "刷新器");
    return null;
  }

  logger.info(
    `[刷新器] 正在为 ${cred.email || "未知账号"} 刷新 Qwen 令牌...`,
    "刷新器",
  );

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cred.refreshToken,
      client_id: config.oauth.qwenClientId,
    });

    const resp = await fetchWithRetry(QWEN_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!resp.ok) {
      const detail = await readResponseDetail(resp);
      logger.warn(
        `[刷新器] Qwen 刷新失败（HTTP ${resp.status}）：${detail}`,
        "刷新器",
      );
      return null;
    }

    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      resource_url?: string;
    };

    if (!data.access_token) {
      logger.warn("[刷新器] Qwen 刷新失败：响应缺少 access_token", "刷新器");
      return null;
    }

    const parsedMeta = parseMetadata(cred.metadata);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: normalizeExpiresIn(data.expires_in),
      metadata: {
        ...parsedMeta,
        ...(data.resource_url ? { resource_url: data.resource_url } : {}),
      },
    };
  } catch (e) {
    logger.error("[刷新器] Qwen 刷新异常", e, "刷新器");
  }

  return null;
}

async function iflowRefresh(cred: any) {
  if (!cred.refreshToken) {
    logger.info("[刷新器] iFlow 跳过刷新：缺少 refresh_token", "刷新器");
    return null;
  }

  logger.info(
    `[刷新器] 正在为 ${cred.email || "未知账号"} 刷新 iFlow 令牌...`,
    "刷新器",
  );

  const basicResult = await requestIflowRefresh(cred.refreshToken, "basic");
  if (basicResult?.access_token) {
    return mapIflowRefreshResult(cred, basicResult);
  }

  logger.warn(
    `[刷新器] iFlow Basic 模式刷新失败，改用 body 模式重试：${basicResult?.errorDetail || "无详情"}`,
    "刷新器",
  );

  const bodyResult = await requestIflowRefresh(cred.refreshToken, "body");
  if (bodyResult?.access_token) {
    return mapIflowRefreshResult(cred, bodyResult);
  }

  logger.error(
    `[刷新器] iFlow 刷新失败：Basic 与 body 模式均未成功。最后错误：${bodyResult?.errorDetail || basicResult?.errorDetail || "无详情"}`,
    undefined,
    "刷新器",
  );
  return null;
}

async function requestIflowRefresh(
  refreshToken: string,
  mode: "basic" | "body",
): Promise<{
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  errorDetail?: string;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  if (mode === "basic") {
    const encoded = Buffer.from(
      `${config.iflow.clientId}:${config.iflow.clientSecret}`,
    ).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else {
    body.set("client_id", config.iflow.clientId);
    body.set("client_secret", config.iflow.clientSecret);
  }

  try {
    const resp = await fetchWithRetry(IFLOW_TOKEN_ENDPOINT, {
      method: "POST",
      headers,
      body,
    });

    if (!resp.ok) {
      const detail = await readResponseDetail(resp);
      return {
        errorDetail: `HTTP ${resp.status}（${mode}）${detail ? `: ${detail}` : ""}`,
      };
    }

    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!data.access_token) {
      return {
        errorDetail: `响应缺少 access_token（${mode}）`,
      };
    }

    return data;
  } catch (e: any) {
    return {
      errorDetail: `请求异常（${mode}）: ${e?.message || String(e)}`,
    };
  }
}

function mapIflowRefreshResult(
  cred: any,
  data: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  },
) {
  const parsedMeta = parseMetadata(cred.metadata);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: normalizeExpiresIn(data.expires_in),
    metadata: {
      ...parsedMeta,
      ...(data.scope ? { scope: data.scope } : {}),
    },
  };
}

async function readResponseDetail(resp: Response): Promise<string> {
  try {
    const text = (await resp.text()).trim();
    if (!text) return "";
    return text.slice(0, 240);
  } catch {
    return "";
  }
}

function normalizeExpiresIn(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EXPIRES_IN_SECONDS;
  }
  return parsed;
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
