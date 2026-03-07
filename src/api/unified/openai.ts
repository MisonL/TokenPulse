import { Hono } from "hono";
import { config } from "../../config";
import { resolveRequestedModel } from "../../lib/model-governance";
import crypto from "node:crypto";
import { getRequestTraceId } from "../../middleware/request-context";
import {
  extractRouteDecisionHeaders,
  withRouteDecisionHeaders,
} from "../../lib/routing/route-decision";
import {
  normalizeAgentLedgerResolvedModel,
  normalizeAgentLedgerRoutePolicy,
  recordAgentLedgerRuntimeEvent,
  resolveAgentLedgerProjectIdFromHeaders,
  resolveAgentLedgerTenantIdFromHeaders,
} from "../../lib/agentledger/runtime-events";

const openaiCompat = new Hono();

interface DispatchResult {
  response: Response;
  provider: string;
  targetModel: string;
  stream: boolean;
  decision: {
    provider?: string;
    routePolicy?: string;
    fallback?: string;
    selectedAccountId?: string;
    traceId?: string;
  };
}

function isGeminiStyleProvider(provider: string): boolean {
  return ["gemini", "antigravity", "aistudio"].includes(provider);
}

function resolveProviderAndModel(
  rawModel: string,
  requestedProvider?: string,
): { provider: string; targetModel: string } {
  const providerFromHeader = (requestedProvider || "").trim().toLowerCase();
  if (providerFromHeader) {
    return {
      provider: providerFromHeader,
      targetModel: rawModel.includes(":") ? rawModel.split(":").slice(1).join(":") : rawModel,
    };
  }

  if (rawModel.includes(":")) {
    const parts = rawModel.split(":");
    return {
      provider: (parts[0] || "gemini").trim().toLowerCase(),
      targetModel: parts.slice(1).join(":") || rawModel,
    };
  }

  const normalized = rawModel.toLowerCase();
  if (normalized.startsWith("claude")) {
    return { provider: "antigravity", targetModel: rawModel };
  }
  if (normalized.includes("gpt") || normalized.startsWith("o1") || normalized.startsWith("o3")) {
    return { provider: "codex", targetModel: rawModel };
  }
  return { provider: "gemini", targetModel: rawModel };
}

async function dispatchChatCompletion(
  payload: Record<string, any>,
  authHeader: string,
  requestedProvider?: string,
  forwardingHeaders?: {
    traceId?: string;
    accountId?: string;
    selectionPolicy?: string;
    userKey?: string;
    tenantId?: string;
    projectId?: string;
  },
): Promise<{
  response: Response;
  provider: string;
  targetModel: string;
  stream: boolean;
  decision: DispatchResult["decision"];
}> {
  const startedAt = new Date().toISOString();
  let model =
    typeof payload.model === "string" && payload.model.trim()
      ? payload.model.trim()
      : "gemini-1.5-pro";
  const requestedModel = model;

  const governance = await resolveRequestedModel(model, requestedProvider);
  if (governance.excluded) {
    const candidate = resolveProviderAndModel(model, requestedProvider);
    await recordAgentLedgerRuntimeEvent({
      traceId: forwardingHeaders?.traceId || crypto.randomUUID(),
      tenantId: forwardingHeaders?.tenantId,
      projectId: forwardingHeaders?.projectId,
      provider: candidate.provider,
      model: requestedModel,
      resolvedModel: normalizeAgentLedgerResolvedModel(
        candidate.provider,
        candidate.targetModel,
        governance.resolvedModel,
      ),
      routePolicy: normalizeAgentLedgerRoutePolicy(
        forwardingHeaders?.selectionPolicy,
      ),
      accountId: forwardingHeaders?.accountId,
      status: "blocked",
      startedAt,
      finishedAt: new Date().toISOString(),
      errorCode: "model_excluded",
    });
    return {
      response: new Response(
        JSON.stringify({
          error: "该模型已被管理员禁用",
          model,
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      ),
      provider: "unknown",
      targetModel: model,
      stream: false,
      decision: {
        provider: "unknown",
        fallback: "none",
        traceId: forwardingHeaders?.traceId,
      },
    };
  }
  model = governance.resolvedModel;

  const { provider, targetModel } = resolveProviderAndModel(model, requestedProvider);
  const stream = Boolean(payload.stream);

  const upstreamPayload = isGeminiStyleProvider(provider)
    ? {
        model: targetModel,
        messages: payload.messages,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        stream,
      }
    : { ...payload, model: targetModel };

  const url = `http://localhost:${config.port}/api/${provider}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader || "",
      ...(forwardingHeaders?.traceId
        ? {
            "X-Request-Id": forwardingHeaders.traceId,
            "X-TokenPulse-Process-Id": forwardingHeaders.traceId,
          }
        : {}),
      ...(forwardingHeaders?.accountId
        ? { "X-TokenPulse-Account-Id": forwardingHeaders.accountId }
        : {}),
      ...(forwardingHeaders?.selectionPolicy
        ? { "X-TokenPulse-Selection-Policy": forwardingHeaders.selectionPolicy }
        : {}),
      ...(forwardingHeaders?.userKey
        ? { "X-TokenPulse-User": forwardingHeaders.userKey }
        : {}),
      ...(forwardingHeaders?.tenantId
        ? { "X-TokenPulse-Tenant": forwardingHeaders.tenantId }
        : {}),
      ...(forwardingHeaders?.projectId
        ? { "X-TokenPulse-Project": forwardingHeaders.projectId }
        : {}),
      "X-TokenPulse-Original-Model": requestedModel,
      "X-TokenPulse-Resolved-Model": normalizeAgentLedgerResolvedModel(
        provider,
        targetModel,
        model,
      ),
    },
    body: JSON.stringify(upstreamPayload),
  });
  const decision = extractRouteDecisionHeaders(response.headers, {
    provider,
    traceId: forwardingHeaders?.traceId,
  });

  if (!isGeminiStyleProvider(provider)) {
    return {
      response: withRouteDecisionHeaders(response, decision),
      provider,
      targetModel,
      stream,
      decision,
    };
  }

  if (stream && response.body) {
    const { GoogleToOpenAITranslator } = await import(
      "../../lib/translator/google_to_openai"
    );
    const googleStream = response.body as ReadableStream<Uint8Array>;
    const iterator = GoogleToOpenAITranslator.translateStream(
      googleStream,
      targetModel,
    );
    const streamBody = new ReadableStream({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(new TextEncoder().encode(value));
        }
      },
    });

    return {
      response: withRouteDecisionHeaders(
        new Response(streamBody, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        decision,
      ),
      provider,
      targetModel,
      stream,
      decision,
    };
  }

  if (!stream) {
    const googleJson = await response.json();
    const { GoogleToOpenAITranslator } = await import(
      "../../lib/translator/google_to_openai"
    );
    const openaiJson = GoogleToOpenAITranslator.translateResponse(
      googleJson,
      targetModel,
    );
    return {
      response: withRouteDecisionHeaders(
        new Response(JSON.stringify(openaiJson), {
          status: response.status,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }),
        decision,
      ),
      provider,
      targetModel,
      stream,
      decision,
    };
  }

  return {
    response: withRouteDecisionHeaders(response, decision),
    provider,
    targetModel,
    stream,
    decision,
  };
}

function extractAssistantText(choiceMessage: any): string {
  if (!choiceMessage) return "";
  if (typeof choiceMessage.content === "string") {
    return choiceMessage.content;
  }
  if (Array.isArray(choiceMessage.content)) {
    return choiceMessage.content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function buildMessagesFromResponsesInput(body: Record<string, any>) {
  const messages: Array<{ role: string; content: string }> = [];

  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions.trim() });
  }

  const input = body.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }

  if (!Array.isArray(input)) {
    return messages;
  }

  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    const role = typeof item.role === "string" ? item.role : "user";
    if (typeof item.content === "string") {
      messages.push({ role, content: item.content });
      continue;
    }

    if (Array.isArray(item.content)) {
      const text = item.content
        .map((part: any) => {
          if (typeof part === "string") return part;
          if (part?.type === "input_text" && typeof part?.text === "string") {
            return part.text;
          }
          if (typeof part?.text === "string") return part.text;
          return "";
        })
        .join("");
      if (text.trim()) {
        messages.push({ role, content: text });
      }
      continue;
    }

    if (item.type === "input_text" && typeof item.text === "string") {
      messages.push({ role: "user", content: item.text });
    }
  }

  return messages;
}

function toResponsesJson(
  completion: Record<string, any>,
  fallbackModel: string,
): Record<string, any> {
  const choice = Array.isArray(completion.choices) ? completion.choices[0] : null;
  const assistantText = extractAssistantText(choice?.message);
  const responseId = `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const createdAt = Math.floor(Date.now() / 1000);

  const usage = completion.usage
    ? {
        input_tokens:
          Number(completion.usage.prompt_tokens) ||
          Number(completion.usage.input_tokens) ||
          0,
        output_tokens:
          Number(completion.usage.completion_tokens) ||
          Number(completion.usage.output_tokens) ||
          0,
        total_tokens:
          Number(completion.usage.total_tokens) ||
          Number(completion.usage.input_tokens || 0) +
            Number(completion.usage.output_tokens || 0),
      }
    : undefined;

  return {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model: completion.model || fallbackModel,
    output: [
      {
        type: "message",
        id: messageId,
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: assistantText,
          },
        ],
      },
    ],
    output_text: assistantText,
    usage,
  };
}

function buildResponsesStreamFromChatSse(
  source: ReadableStream<Uint8Array>,
  responseId: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = source.getReader();

  return new ReadableStream({
    async start(controller) {
      const emit = (payload: Record<string, any>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      emit({
        type: "response.created",
        response: {
          id: responseId,
          object: "response",
          status: "in_progress",
        },
      });

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.replace(/^data:\s*/, "");
          if (!data) continue;

          if (data === "[DONE]") {
            emit({
              type: "response.completed",
              response: {
                id: responseId,
                object: "response",
                status: "completed",
              },
            });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          try {
            const parsed = JSON.parse(data) as Record<string, any>;
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              emit({
                type: "response.output_text.delta",
                response_id: responseId,
                output_index: 0,
                content_index: 0,
                delta,
              });
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }

      emit({
        type: "response.completed",
        response: {
          id: responseId,
          object: "response",
          status: "completed",
        },
      });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

openaiCompat.get("/models", async (c) => {
  try {
    const provider = (c.req.query("provider") || "").trim();
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    const response = await fetch(
      `http://localhost:${config.port}/api/models${query}`,
      {
        headers: {
          Authorization: c.req.header("Authorization") || "",
        },
      },
    );

    if (!response.ok) {
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    }

    const payload = (await response.json()) as {
      data?: Array<{ id: string; provider?: string }>;
    };
    const now = Math.floor(Date.now() / 1000);
    const data = Array.isArray(payload.data) ? payload.data : [];
    return c.json({
      object: "list",
      data: data.map((model) => ({
        id: model.id,
        object: "model",
        created: now,
        owned_by: model.provider || "tokenpulse",
      })),
    });
  } catch (error) {
    return c.json(
      { error: "获取模型列表失败", details: String(error) },
      502,
    );
  }
});

openaiCompat.post("/chat/completions", async (c) => {
  const body = (await c.req.json()) as Record<string, any>;
  const requestedProvider = c.req.header("X-TokenPulse-Provider") || "";
  const traceId = getRequestTraceId(c);
  try {
    const result = await dispatchChatCompletion(
      body,
      c.req.header("Authorization") || "",
      requestedProvider,
      {
        traceId,
        accountId: c.req.header("X-TokenPulse-Account-Id") || undefined,
        selectionPolicy:
          c.req.header("X-TokenPulse-Selection-Policy") || undefined,
        userKey: c.req.header("X-TokenPulse-User") || undefined,
        tenantId: resolveAgentLedgerTenantIdFromHeaders(c.req.raw.headers),
        projectId: resolveAgentLedgerProjectIdFromHeaders(c.req.raw.headers),
      },
    );
    return result.response;
  } catch (error) {
    await recordAgentLedgerRuntimeEvent({
      traceId,
      tenantId: resolveAgentLedgerTenantIdFromHeaders(c.req.raw.headers),
      projectId: resolveAgentLedgerProjectIdFromHeaders(c.req.raw.headers),
      provider:
        resolveProviderAndModel(
          typeof body.model === "string" ? body.model.trim() : "unknown",
          c.req.header("X-TokenPulse-Provider") || "",
        ).provider,
      model:
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : "gemini-1.5-pro",
      resolvedModel:
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : "gemini-1.5-pro",
      routePolicy: normalizeAgentLedgerRoutePolicy(
        c.req.header("X-TokenPulse-Selection-Policy") || undefined,
      ),
      accountId: c.req.header("X-TokenPulse-Account-Id") || undefined,
      status:
        String((error as any)?.name || "").includes("Abort") ? "timeout" : "failure",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      errorCode:
        String((error as any)?.name || "").includes("Abort")
          ? "gateway_timeout"
          : "gateway_dispatch_failed",
    });
    return c.json(
      { error: "网关转发失败", details: String(error) },
      502,
    );
  }
});

openaiCompat.post("/responses", async (c) => {
  const body = (await c.req.json()) as Record<string, any>;
  const messages = buildMessagesFromResponsesInput(body);
  const requestedProvider = c.req.header("X-TokenPulse-Provider") || "";
  const traceId = getRequestTraceId(c);

  const chatPayload: Record<string, any> = {
    model:
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : "gemini-1.5-pro",
    messages,
    stream: Boolean(body.stream),
  };
  if (typeof body.temperature === "number") {
    chatPayload.temperature = body.temperature;
  }
  if (typeof body.max_output_tokens === "number") {
    chatPayload.max_tokens = body.max_output_tokens;
  } else if (typeof body.max_tokens === "number") {
    chatPayload.max_tokens = body.max_tokens;
  }
  if (body.reasoning && typeof body.reasoning === "object") {
    const effort = (body.reasoning as Record<string, any>).effort;
    if (typeof effort === "string" && effort.trim()) {
      chatPayload.reasoning_effort = effort;
    }
  }

  try {
    const result = await dispatchChatCompletion(
      chatPayload,
      c.req.header("Authorization") || "",
      requestedProvider,
      {
        traceId,
        accountId: c.req.header("X-TokenPulse-Account-Id") || undefined,
        selectionPolicy:
          c.req.header("X-TokenPulse-Selection-Policy") || undefined,
        userKey: c.req.header("X-TokenPulse-User") || undefined,
        tenantId: resolveAgentLedgerTenantIdFromHeaders(c.req.raw.headers),
        projectId: resolveAgentLedgerProjectIdFromHeaders(c.req.raw.headers),
      },
    );

    if (!result.response.ok) {
      return withRouteDecisionHeaders(
        new Response(result.response.body, {
          status: result.response.status,
          headers: result.response.headers,
        }),
        result.decision,
      );
    }

    if (chatPayload.stream) {
      if (!result.response.body) {
        return c.json({ error: "流式响应不可用" }, 502);
      }
      const responseId = `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const stream = buildResponsesStreamFromChatSse(result.response.body, responseId);
      return withRouteDecisionHeaders(
        new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
        result.decision,
      );
    }

    const completion = (await result.response.json()) as Record<string, any>;
    return withRouteDecisionHeaders(
      new Response(
        JSON.stringify(toResponsesJson(completion, result.targetModel)),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      ),
      result.decision,
    );
  } catch (error) {
    await recordAgentLedgerRuntimeEvent({
      traceId,
      tenantId: resolveAgentLedgerTenantIdFromHeaders(c.req.raw.headers),
      projectId: resolveAgentLedgerProjectIdFromHeaders(c.req.raw.headers),
      provider:
        resolveProviderAndModel(chatPayload.model as string, requestedProvider).provider,
      model: String(chatPayload.model || "gemini-1.5-pro"),
      resolvedModel: String(chatPayload.model || "gemini-1.5-pro"),
      routePolicy: normalizeAgentLedgerRoutePolicy(
        c.req.header("X-TokenPulse-Selection-Policy") || undefined,
      ),
      accountId: c.req.header("X-TokenPulse-Account-Id") || undefined,
      status:
        String((error as any)?.name || "").includes("Abort") ? "timeout" : "failure",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      errorCode:
        String((error as any)?.name || "").includes("Abort")
          ? "gateway_timeout"
          : "gateway_dispatch_failed",
    });
    return c.json(
      { error: "Responses 兼容接口调用失败", details: String(error) },
      502,
    );
  }
});

export default openaiCompat;
