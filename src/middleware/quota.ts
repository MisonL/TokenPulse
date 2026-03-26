import type { Context, Next } from "hono";
import {
  checkAndConsumeQuota,
  QUOTA_METERING_MODE,
  reconcileQuotaUsage,
} from "../lib/admin/quota";
import { writeAuditEvent } from "../lib/admin/audit";
import {
  getRequestTraceId,
  getRequestedAccountId,
  getRequestedSelectionPolicy,
} from "./request-context";
import { config } from "../config";
import {
  normalizeAgentLedgerResolvedModel,
  normalizeAgentLedgerRoutePolicy,
  recordAgentLedgerRuntimeEvent,
  resolveAgentLedgerProjectIdFromHeaders,
  resolveAgentLedgerTenantIdFromHeaders,
} from "../lib/agentledger/runtime-events";

function inferProvider(model: string, headerProvider?: string, path?: string): string {
  const forced = (headerProvider || "").trim().toLowerCase();
  if (forced) return forced;

  if (model.includes(":")) {
    return model.split(":")[0]!.trim().toLowerCase();
  }

  const normalizedModel = model.toLowerCase();
  if (path?.includes("/messages")) return "claude";
  if (normalizedModel.startsWith("claude")) return "antigravity";
  if (normalizedModel.includes("gpt") || normalizedModel.startsWith("o1") || normalizedModel.startsWith("o3")) {
    return "codex";
  }
  return "gemini";
}

function inferModel(rawModel: unknown): string {
  if (typeof rawModel !== "string") return "unknown";
  const value = rawModel.trim();
  if (!value) return "unknown";
  if (value.includes(":")) {
    return value.split(":").slice(1).join(":") || "unknown";
  }
  return value;
}

function estimateTokens(payload: Record<string, any>): number {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const input = messages
    .map((item) => {
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) {
        return item.content
          .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
          .join(" ");
      }
      return "";
    })
    .join(" ");

  const promptChars = input.length;
  const promptTokens = Math.ceil(promptChars / 4);
  const maxTokens =
    typeof payload.max_tokens === "number"
      ? Math.max(0, Math.floor(payload.max_tokens))
      : typeof payload.maxTokens === "number"
        ? Math.max(0, Math.floor(payload.maxTokens))
        : 0;

  return Math.max(1, promptTokens + Math.min(maxTokens, 8192));
}

function extractActualTokensFromUsagePayload(payload: Record<string, any>): number | null {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;

  const usageRecord = usage as Record<string, unknown>;
  const totalDirect = Number(usageRecord.total_tokens);
  if (Number.isFinite(totalDirect) && totalDirect >= 0) {
    return Math.floor(totalDirect);
  }

  const inputTokens = Number(usageRecord.input_tokens ?? usageRecord.prompt_tokens);
  const outputTokens = Number(usageRecord.output_tokens ?? usageRecord.completion_tokens);
  if (
    Number.isFinite(inputTokens) &&
    inputTokens >= 0 &&
    Number.isFinite(outputTokens) &&
    outputTokens >= 0
  ) {
    return Math.floor(inputTokens + outputTokens);
  }

  const totalFallback = Number(usageRecord.tokens);
  if (Number.isFinite(totalFallback) && totalFallback >= 0) {
    return Math.floor(totalFallback);
  }
  return null;
}

async function resolveActualTokensFromResponse(response: Response): Promise<number | null> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }
  try {
    const json = (await response.clone().json()) as Record<string, any>;
    return extractActualTokensFromUsagePayload(json);
  } catch {
    return null;
  }
}

function resolveQuotaIdentity(c: Context): {
  tenantId?: string;
  projectId?: string;
  roleKey?: string;
  userKey: string;
  source: "trusted_headers" | "default";
} {
  if (!config.trustProxy) {
    return {
      userKey: "api-secret",
      source: "default",
    };
  }

  const normalizeIdentityToken = (value: string | undefined | null): string | undefined => {
    const normalized = (value || "").trim().toLowerCase();
    return normalized ? normalized : undefined;
  };

  const tenantId = normalizeIdentityToken(c.req.header("x-tokenpulse-tenant"));
  const projectId =
    normalizeIdentityToken(c.req.header("x-tokenpulse-project")) ||
    normalizeIdentityToken(c.req.header("x-tokenpulse-project-id")) ||
    normalizeIdentityToken(c.req.header("x-project-id"));
  const roleKey = normalizeIdentityToken(c.req.header("x-tokenpulse-role"));
  const headerUser = normalizeIdentityToken(c.req.header("x-tokenpulse-user"));
  const adminUser = normalizeIdentityToken(c.req.header("x-admin-user"));
  const userKey = headerUser || adminUser || "api-secret";
  const source = headerUser || adminUser || tenantId || projectId || roleKey
    ? "trusted_headers"
    : "default";

  return {
    tenantId,
    projectId,
    roleKey,
    userKey,
    source,
  };
}

export async function quotaMiddleware(c: Context, next: Next) {
  if (c.req.method !== "POST") {
    await next();
    return;
  }

  if (!c.req.path.startsWith("/v1/")) {
    await next();
    return;
  }

  const payload = (await c.req.raw
    .clone()
    .json()
    .catch(() => ({}))) as Record<string, any>;
  const startedAt = new Date().toISOString();
  const traceId = getRequestTraceId(c);
  const rawModel =
    typeof payload.model === "string" && payload.model.trim()
      ? payload.model.trim()
      : "unknown";

  const provider = inferProvider(
    rawModel,
    c.req.header("x-tokenpulse-provider") || "",
    c.req.path,
  );
  const model = inferModel(rawModel);
  const estimatedTokens = estimateTokens(payload);
  const identity = resolveQuotaIdentity(c);
  const tenantId = identity.tenantId;
  const projectId = identity.projectId;
  const roleKey = identity.roleKey;
  const userKey = identity.userKey;

  const result = await checkAndConsumeQuota({
    provider,
    model,
    estimatedTokens,
    tenantId,
    projectId,
    roleKey,
    userKey,
  });

  if (!result.allowed) {
    const meteringMode = result.meteringMode || QUOTA_METERING_MODE;
    await writeAuditEvent({
      actor: userKey,
      action: "quota.reject",
      resource: "gateway.request",
      resourceId: result.policyId || undefined,
      result: "failure",
      traceId,
      details: {
        provider,
        model,
        path: c.req.path,
        method: c.req.method,
        tenantId: tenantId || null,
        projectId: projectId || null,
        roleKey: roleKey || null,
        userKey,
        identitySource: identity.source,
        reason: result.reason,
        policyId: result.policyId,
        meteringMode,
      },
      ip: c.req.header("x-forwarded-for") || undefined,
      userAgent: c.req.header("user-agent") || undefined,
    });
    await recordAgentLedgerRuntimeEvent({
      traceId,
      tenantId: resolveAgentLedgerTenantIdFromHeaders(c.req.raw.headers),
      projectId: resolveAgentLedgerProjectIdFromHeaders(c.req.raw.headers),
      provider,
      model: rawModel,
      resolvedModel: normalizeAgentLedgerResolvedModel(provider, model),
      routePolicy: normalizeAgentLedgerRoutePolicy(getRequestedSelectionPolicy(c)),
      accountId: getRequestedAccountId(c),
      status: "blocked",
      startedAt,
      finishedAt: new Date().toISOString(),
      errorCode: "quota_rejected",
    });

    const status = result.status || 429;
    return new Response(
      JSON.stringify({
        error: "请求超过配额限制",
        details: result.reason || "请稍后重试或联系管理员调整配额策略。",
        policyId: result.policyId || null,
        provider,
        model,
        traceId,
        meteringMode,
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Request-Id": traceId,
          "X-TokenPulse-Quota-Metering": meteringMode,
        },
      },
    );
  }

  await next();

  const meteringMode = result.meteringMode || QUOTA_METERING_MODE;
  c.header("X-TokenPulse-Quota-Metering", meteringMode);

  if (!result.matchedWindows || result.matchedWindows.length === 0) {
    return;
  }

  let actualTokens = await resolveActualTokensFromResponse(c.res);
  if (actualTokens === null) {
    if (c.res.status >= 400) {
      actualTokens = 0;
    } else {
      return;
    }
  }

  try {
    const records = await reconcileQuotaUsage({
      matchedWindows: result.matchedWindows,
      estimatedTokens,
      actualTokens,
    });
    const reconciledDelta = actualTokens - estimatedTokens;
    if (records.length > 0 && reconciledDelta !== 0) {
      await writeAuditEvent({
        actor: userKey,
        action: "quota.reconcile",
        resource: "gateway.request",
        result: "success",
        traceId,
        details: {
          provider,
          model,
          path: c.req.path,
          method: c.req.method,
          meteringMode,
          identitySource: identity.source,
          estimatedTokens,
          actualTokens,
          reconciledDelta,
          policies: records.map((item) => item.policyId),
        },
        ip: c.req.header("x-forwarded-for") || undefined,
        userAgent: c.req.header("user-agent") || undefined,
      });
    }
  } catch {
    // 配额校正失败不应影响主响应，避免对上游请求造成额外错误。
  }
}
