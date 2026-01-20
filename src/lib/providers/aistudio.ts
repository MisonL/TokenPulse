import { Hono } from "hono";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { config } from "../../config";

// AI Studio (Google Generative Language API) implementation.
// Original CLIProxyAPI uses a WS Relay, but the underlying protocol is REST-over-WS or direct REST.
// We implement robust REST here as it's the standard integration method.

const aistudio = new Hono();
const PROVIDER_ID = "aistudio";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

aistudio.post("/v1/chat/completions", async (c) => {
  // Auth: API Key only usually.
  // Check credentials for API Key.
  const creds = await db
    .select()
    .from(credentials)
    .where(eq(credentials.provider, PROVIDER_ID))
    .limit(1);

  // In original schema, API Key might be in 'accessToken' col or metadata?
  // User Instructions: "tokens will be stored in SQLite... replicate...".
  // I'll assume accessToken column holds the API Key for AI Studio.

  let apiKey = creds[0]?.accessToken;
  if (!apiKey) {
    // Also check Attributes if passed via header?
    // For now, strict DB.
    return c.json({ error: "No authenticated AI Studio account" }, 401);
  }

  const inBody = await c.req.json();
  const model = inBody.model || "gemini-1.5-pro-latest";

  // Payload Translation: OpenAI -> Gemini
  // Same as `gemini` provider in `src/lib/providers/gemini.ts` but target is public API.
  // Public API uses `contents` array.

  const contents = (inBody.messages || []).map((m: any) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const payload = {
    contents: contents,
    generationConfig: {
      temperature: inBody.temperature,
      maxOutputTokens: inBody.max_tokens,
    },
    // Valid for AI Studio: safetySettings, etc.
  };

  // Action: generateContent or streamGenerateContent
  // If stream=true in body?
  const stream = inBody.stream === true;
  const action = stream ? "streamGenerateContent" : "generateContent";

  const url = `${BASE_URL}/models/${model}:${action}?key=${apiKey}${stream ? "&alt=sse" : ""}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

export default aistudio;
