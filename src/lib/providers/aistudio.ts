import { Hono } from "hono";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { config } from "../../config";
import { Translators } from "../translator";
import { logger } from "../logger";

// AI Studio (Google Generative Language API) implementation.
// Original CLIProxyAPI uses a WS Relay, but the underlying protocol is REST-over-WS or direct REST.
// We implement robust REST here as it's the standard integration method.

const aistudio = new Hono();
const PROVIDER_ID = "aistudio";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

aistudio.post("/v1/chat/completions", async (c) => {
  // 1. Get Credentials
  const creds = await db
    .select()
    .from(credentials)
    .where(eq(credentials.provider, PROVIDER_ID))
    .limit(1);

  const cred = creds[0];
  if (!cred) {
    return c.json({ error: "No authenticated AI Studio account" }, 401);
  }

  let token = cred.accessToken;
  let isServiceAccount = false;
  let serviceAccount: ServiceAccount | null = null;

  try {
    const meta = typeof cred.metadata === 'string' ? JSON.parse(cred.metadata) : cred.metadata;
    if (meta?.mode === "service_account" && meta.service_account) {
      serviceAccount = meta.service_account;
      isServiceAccount = true;
    }
  } catch (e) {
    // ignore
  }

  // 2. Auth: API Key or Service Account Token
  if (isServiceAccount && serviceAccount) {
    try {
      token = await getGoogleAccessToken(serviceAccount, [
        "https://www.googleapis.com/auth/generative-language",
        "https://www.googleapis.com/auth/cloud-platform"
      ]);
    } catch (e: any) {
      return c.json({ error: "Failed to fetch Google Access Token: " + e.message }, 500);
    }
  }

  if (!token) {
    return c.json({ error: "No API Key or Service Account found" }, 401);
  }

  const inBody = await c.req.json();
  const model = inBody.model || "gemini-1.5-pro-latest";

  // 3. Payload Translation (OpenAI -> Gemini)
  const { contents, systemInstruction } = Translators.openAIToGemini(inBody.messages || []);

  const payload: any = {
    contents: contents,
    generationConfig: {
      temperature: inBody.temperature,
      maxOutputTokens: inBody.max_tokens,
      topP: inBody.top_p,
    },
  };

  if (systemInstruction) {
    payload.system_instruction = systemInstruction; // AI Studio standard is usually snake_case or camelCase depending on version, v1beta uses system_instruction
  }

  // 4. Thinking Mode (Gemini 2.0 Thinking Models)
  const modelLower = model.toLowerCase();
  if (modelLower.includes("thinking") || (inBody as any).reasoning_effort && (inBody as any).reasoning_effort !== "none") {
      const effort = (inBody as any).reasoning_effort || "medium";
      let budget = 4096;
      if (effort === "low") budget = 1024;
      else if (effort === "high") budget = 16384;

      payload.thinking_config = {
        include_thoughts: true,
        // budget_tokens is often inferred or set here depending on model
      };
      // For Gemini, some models handle thinking via generationConfig.thinking_config
      payload.generationConfig.thinking_config = {
          include_thoughts: true
      };
  }

  const stream = inBody.stream === true;
  const action = stream ? "streamGenerateContent" : "generateContent";

  // Endpoint configuration based on Auth mode
  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isServiceAccount) {
    url = `${BASE_URL}/models/${model}:${action}${stream ? "?alt=sse" : ""}`;
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    url = `${BASE_URL}/models/${model}:${action}?key=${token}${stream ? "&alt=sse" : ""}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload),
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});


import { getGoogleAccessToken, type ServiceAccount } from "../auth/google-sa";

export async function getModels(apiKeyOrJson: string, metadata?: any) {
  let token = apiKeyOrJson;
  let isServiceAccount = false;
  
  // Try to find service account in metadata or the token itself
  try {
    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const sa = meta?.service_account || (typeof apiKeyOrJson === 'string' && apiKeyOrJson.startsWith('{') ? JSON.parse(apiKeyOrJson) : null);
    
    if (sa && (sa.type === "service_account" || sa.service_account)) {
      const saData = sa.service_account || sa;
      token = await getGoogleAccessToken(saData as ServiceAccount, [
        "https://www.googleapis.com/auth/generative-language",
        "https://www.googleapis.com/auth/cloud-platform"
      ]);
      isServiceAccount = true;
    }
  } catch (e) {
    // continue
  }

  const headers: any = {};
  let url = `${BASE_URL}/models`;

  if (isServiceAccount) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    headers["x-goog-api-key"] = token;
  }

  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    logger.warn(`[AI Studio] API model list failed, using static fallback`);
    return [
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "google" },
        { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "google" },
        { id: "gemini-pro", name: "Gemini Pro", provider: "google" },
    ];
  }
  
  const data = (await response.json()) as any;
  if (!data.models) return [];

  return data.models
    .filter((m: any) => m.name.includes("gemini"))
    .map((m: any) => ({
      id: m.name.replace("models/", ""),
      name: m.displayName || m.name.replace("models/", ""),
      provider: "google",
    }));
}

export default aistudio;
