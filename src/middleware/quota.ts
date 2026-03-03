import type { Context, Next } from "hono";
import { checkAndConsumeQuota } from "../lib/admin/quota";
import { writeAuditEvent } from "../lib/admin/audit";
import { getRequestTraceId } from "./request-context";

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
  const traceId = getRequestTraceId(c);

  const provider = inferProvider(
    typeof payload.model === "string" ? payload.model : "",
    c.req.header("x-tokenpulse-provider") || "",
    c.req.path,
  );
  const model = inferModel(payload.model);
  const estimatedTokens = estimateTokens(payload);
  const tenantId = c.req.header("x-tokenpulse-tenant") || undefined;
  const roleKey = c.req.header("x-tokenpulse-role") || undefined;
  const userKey = c.req.header("x-tokenpulse-user") || "api-secret";

  const result = await checkAndConsumeQuota({
    provider,
    model,
    estimatedTokens,
    tenantId,
    roleKey,
    userKey,
  });

  if (!result.allowed) {
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
        roleKey: roleKey || null,
        userKey,
        reason: result.reason,
        policyId: result.policyId,
      },
      ip: c.req.header("x-forwarded-for") || undefined,
      userAgent: c.req.header("user-agent") || undefined,
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
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Request-Id": traceId,
        },
      },
    );
  }

  await next();
}
