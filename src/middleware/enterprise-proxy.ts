import type { Context, Next } from "hono";
import { config } from "../config";
import { getEditionFeatures } from "../lib/edition";
import { buildAdvancedDisabledResponse } from "./advanced";

interface EnterpriseProbeResult {
  configured: boolean;
  reachable: boolean;
  baseUrl?: string;
  error?: string;
}

const PROBE_CACHE_TTL_MS = 10_000;

let probeCache: {
  expiresAt: number;
  value: EnterpriseProbeResult;
} | null = null;

function resolveEnterpriseBaseUrl(): string {
  return (config.enterprise.baseUrl || "").trim();
}

async function probeEnterpriseBackend(force = false): Promise<EnterpriseProbeResult> {
  const baseUrl = resolveEnterpriseBaseUrl();
  const configured = baseUrl.length > 0;

  if (!config.enableAdvanced) {
    return {
      configured,
      reachable: false,
      baseUrl: configured ? baseUrl : undefined,
    };
  }

  if (!configured) {
    return {
      configured: false,
      reachable: false,
      error: "enterprise 后端未配置",
    };
  }

  if (
    !force &&
    probeCache &&
    probeCache.expiresAt > Date.now() &&
    probeCache.value.baseUrl === baseUrl
  ) {
    return probeCache.value;
  }

  try {
    const healthUrl = new URL("/health", baseUrl);
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: {
        "x-tokenpulse-internal-key": config.enterprise.internalSharedKey,
      },
      signal: AbortSignal.timeout(config.enterprise.proxyTimeoutMs),
    });

    const value: EnterpriseProbeResult = {
      configured: true,
      reachable: response.ok,
      baseUrl,
      error: response.ok ? undefined : `health 状态码 ${response.status}`,
    };
    probeCache = {
      expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
      value,
    };
    return value;
  } catch (error: any) {
    const value: EnterpriseProbeResult = {
      configured: true,
      reachable: false,
      baseUrl,
      error: error?.message || "enterprise 后端不可达",
    };
    probeCache = {
      expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
      value,
    };
    return value;
  }
}

export async function adminFeaturesHandler(c: Context) {
  const feature = getEditionFeatures();
  const backend = await probeEnterpriseBackend();
  return c.json({
    ...feature,
    enterpriseBackend: backend,
  });
}

function buildEnterpriseUnavailableResponse(
  c: Context,
  code: string,
  details: string,
) {
  return c.json(
    {
      error: "企业后端不可用",
      code,
      details,
    },
    503,
  );
}

export async function enterpriseProxyMiddleware(c: Context, next: Next) {
  if (c.req.path === "/api/admin/features") {
    await next();
    return;
  }

  if (!config.enableAdvanced) {
    return buildAdvancedDisabledResponse(c);
  }

  const baseUrl = resolveEnterpriseBaseUrl();
  if (!baseUrl) {
    return buildEnterpriseUnavailableResponse(
      c,
      "ENTERPRISE_BACKEND_UNCONFIGURED",
      "请设置 ENTERPRISE_BASE_URL 并启动 enterprise 服务。",
    );
  }

  let targetUrl: URL;
  try {
    const incoming = new URL(c.req.url);
    targetUrl = new URL(`${incoming.pathname}${incoming.search}`, baseUrl);
  } catch {
    return buildEnterpriseUnavailableResponse(
      c,
      "ENTERPRISE_BACKEND_URL_INVALID",
      "ENTERPRISE_BASE_URL 配置无效。",
    );
  }

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.set("x-tokenpulse-forwarded-by", "core");
  if (config.enterprise.internalSharedKey) {
    headers.set("x-tokenpulse-internal-key", config.enterprise.internalSharedKey);
  }

  try {
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: c.req.method === "GET" || c.req.method === "HEAD"
        ? undefined
        : c.req.raw.body,
      redirect: "manual",
      signal: AbortSignal.timeout(config.enterprise.proxyTimeoutMs),
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("x-tokenpulse-admin-proxy", "core");
    responseHeaders.set("x-tokenpulse-enterprise-proxy", "core");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    return buildEnterpriseUnavailableResponse(
      c,
      "ENTERPRISE_BACKEND_UNREACHABLE",
      error?.message || "无法连接 enterprise 后端。",
    );
  }
}
