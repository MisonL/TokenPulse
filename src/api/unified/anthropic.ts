import { Hono } from "hono";
import { config } from "../../config";
import { resolveRequestedModel } from "../../lib/model-governance";
import { getRequestTraceId } from "../../middleware/request-context";
import {
  extractRouteDecisionHeaders,
  withRouteDecisionHeaders,
} from "../../lib/routing/route-decision";

const anthropicCompat = new Hono();

anthropicCompat.post("/messages", async (c) => {
  const body = await c.req.json();
  let model = typeof body.model === "string" ? body.model.trim() : "";


  let provider = c.req.header("X-TokenPulse-Provider");
  let targetModel = model;

  if (model) {
    const governance = await resolveRequestedModel(model, provider);
    if (governance.excluded) {
      return c.json(
        {
          error: "该模型已被管理员禁用",
          model,
        },
        403,
      );
    }
    model = governance.resolvedModel;
    targetModel = model;
  }

  if (!provider && model.includes(":")) {
    const parts = model.split(":");
    provider = parts[0];
    targetModel = parts.slice(1).join(":");
  }

  provider = provider || "antigravity";


  const newMessages = [];

  if (body.system) {
    newMessages.push({ role: "system", content: body.system });
  }

  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      newMessages.push({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((b: any) => b.text).join("\n")
              : String(m.content),
      });
    }
  }

  const upstreamPayload = {
    model: targetModel, // Antigravity (Google) handles Claude model names natively usually?
    messages: newMessages,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    stream: body.stream,
  };

  const url = `http://localhost:${config.port}/api/${provider}/v1/chat/completions`;

  try {
    const traceId = getRequestTraceId(c);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const authHeader = c.req.header("Authorization");
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    if (traceId) {
      headers["X-Request-Id"] = traceId;
      headers["X-TokenPulse-Process-Id"] = traceId;
    }
    const accountId = c.req.header("X-TokenPulse-Account-Id");
    if (accountId) {
      headers["X-TokenPulse-Account-Id"] = accountId;
    }
    const selectionPolicy = c.req.header("X-TokenPulse-Selection-Policy");
    if (selectionPolicy) {
      headers["X-TokenPulse-Selection-Policy"] = selectionPolicy;
    }
    const userKey = c.req.header("X-TokenPulse-User");
    if (userKey) {
      headers["X-TokenPulse-User"] = userKey;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamPayload),
    });
    const decision = extractRouteDecisionHeaders(resp.headers, {
      provider,
      traceId,
    });






    if (provider === "antigravity" || provider === "gemini") {
      if (body.stream) {
        const { GoogleToAnthropicTranslator } =
          await import("../../lib/translator/google_to_anthropic");

        if (resp.body) {

          const googleStream = resp.body as ReadableStream<Uint8Array>;
          const iterator =
            GoogleToAnthropicTranslator.translateStream(googleStream);

          const stream = new ReadableStream({
            async pull(controller) {
              const { value, done } = await iterator.next();
              if (done) {
                controller.close();
              } else {
                controller.enqueue(new TextEncoder().encode(value));
              }
            },
          });

          return withRouteDecisionHeaders(
            new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            }),
            decision,
          );
        }
      } else {
        const googleJson = await resp.json();
        const { GoogleToAnthropicTranslator } =
          await import("../../lib/translator/google_to_anthropic");
        const anthropicJson =
          GoogleToAnthropicTranslator.translateResponse(googleJson);
        return withRouteDecisionHeaders(
          c.json(anthropicJson),
          decision,
        );
      }
    }

    return withRouteDecisionHeaders(
      new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      }),
      decision,
    );
  } catch (e) {
    return c.json(
      { error: `Anthropic Gateway dispatch failed`, details: String(e) },
      502,
    );
  }
});

export default anthropicCompat;
