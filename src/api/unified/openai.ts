import { Hono } from "hono";
import { config } from "../../config";
import { resolveRequestedModel } from "../../lib/model-governance";

const openaiCompat = new Hono();

openaiCompat.post("/chat/completions", async (c) => {
  const body = await c.req.json();
  let model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "gemini-1.5-pro";

  const governance = await resolveRequestedModel(model);
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

  let provider = "gemini";
  let targetModel = model;

  if (c.req.header("X-TokenPulse-Provider")) {
    provider = c.req.header("X-TokenPulse-Provider")!;
  } else if (model.includes(":")) {
    const parts = model.split(":");
    provider = parts[0];
    targetModel = parts.slice(1).join(":");
  } else if (model.startsWith("claude")) {
    provider = "antigravity"; 
  } else if (model.includes("gpt")) {
    provider = "codex";
  }


  let upstreamPayload = body;

  if (["gemini", "antigravity", "aistudio"].includes(provider)) {
    upstreamPayload = {
      model: targetModel,
      messages: body.messages, // Some providers in our lib still read 'messages' and translate internally

    };
    if (body.temperature) upstreamPayload.temperature = body.temperature;
    if (body.max_tokens) upstreamPayload.max_tokens = body.max_tokens;
    if (body.stream) upstreamPayload.stream = body.stream;
  } else {
    upstreamPayload = { ...body, model: targetModel };
  }

  const url = `http://localhost:${config.port}/api/${provider}/v1/chat/completions`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: c.req.header("Authorization") || "",
      },
      body: JSON.stringify(upstreamPayload),
    });

    if (["gemini", "antigravity", "aistudio"].includes(provider)) {
      if (body.stream) {
        const { GoogleToOpenAITranslator } =
          await import("../../lib/translator/google_to_openai");
        if (resp.body) {
          const googleStream = resp.body as ReadableStream<Uint8Array>;
          const iterator = GoogleToOpenAITranslator.translateStream(
            googleStream,
            targetModel,
          );

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

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }
      } else {
        const googleJson = await resp.json();
        const { GoogleToOpenAITranslator } =
          await import("../../lib/translator/google_to_openai");
        const openaiJson = GoogleToOpenAITranslator.translateResponse(
          googleJson,
          targetModel,
        );
        return c.json(openaiJson);
      }
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch (e) {
    return c.json(
      { error: `Gateway dispatch failed to ${provider}`, details: String(e) },
      502,
    );
  }
});

export default openaiCompat;
