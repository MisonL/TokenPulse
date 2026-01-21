import { Hono } from "hono";
import { config } from "../../config";
import { Translators } from "../../lib/translator";

const openaiCompat = new Hono();

openaiCompat.post("/chat/completions", async (c) => {
  const body = await c.req.json();
  let model = body.model || "gemini-1.5-pro";

  // Routing Logic: "provider:model" or default
  let provider = "gemini";
  let targetModel = model;

  if (model.includes(":")) {
    const parts = model.split(":");
    provider = parts[0];
    targetModel = parts.slice(1).join(":");
  } else if (model.startsWith("claude")) {
    provider = "antigravity"; // Common mapping: OpenAI client requesting Claude model -> Antigravity
  } else if (model.includes("gpt")) {
    provider = "codex"; // OpenAI model -> Codex (OpenAI Responses)
  }

  // Adapt Payload
  // If provider is Gemini family (gemini, antigravity, aistudio), we translate.
  // If provider is OpenAI family (codex, kiro-openai), we pass through.

  let upstreamPayload = body;

  if (["gemini", "antigravity", "aistudio"].includes(provider)) {
    const { contents, systemInstruction } = Translators.openAIToGemini(
      body.messages,
    );
    upstreamPayload = {
      model: targetModel,
      messages: body.messages, // Some providers in our lib still read 'messages' and translate internally
      // But 'gemini' and 'antigravity' providers in this codebase currently expect...
      // Let's check 'gemini.ts': It expects `messages` and does translation internally!
      // Line 110 of gemini.ts: `const contents = (inBody.messages...`.
      // So we DON'T need to translate here if our internal providers already accept OpenAI format!

      // Wait, Antigravity provider (antigravity.ts) ALSO expects `inBody.messages`.
      // So my internal providers are ALREADY "OpenAI Input Compatible" (mostly).
      // That simplifies things. I just need to route.
    };
    // Add specific config if needed
    if (body.temperature) upstreamPayload.temperature = body.temperature;
    if (body.max_tokens) upstreamPayload.max_tokens = body.max_tokens;
    if (body.stream) upstreamPayload.stream = body.stream;
  } else {
    upstreamPayload = { ...body, model: targetModel };
  }

  // Dispatch
  // Route to internal provider endpoints (mounted at /api/${provider})
  const url = `http://localhost:${config.port}/api/${provider}/v1/chat/completions`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: c.req.header("Authorization") || "",
        // Pass auth header? Or allow implicit?
        // Our providers usually look in DB.
        // Maybe we need to pass a specific header to trigger "use default creds"?
        // Currently they query DB based on provider name.
        // They fallback to Bearer token if DB fails or if passed.
      },
      body: JSON.stringify(upstreamPayload),
    });

    // Outbound Translation
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
