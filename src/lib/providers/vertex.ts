import { Hono } from "hono";
import { db } from "../../db";
import { credentials } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getGoogleAccessToken, type ServiceAccount } from "../auth/google-sa";
import { logger } from "../logger";
import { Translators } from "../translator";
import { fetchWithRetry } from "../http";

const vertex = new Hono();
const PROVIDER_ID = "vertex";

// Helper to get fresh token
// Simple In-memory cache for Vertex tokens
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getVertexToken(serviceAccount: ServiceAccount): Promise<string> {
  const cacheKey = serviceAccount.client_email;
  const cached = tokenCache.get(cacheKey);
  
  // Tokens are valid for 1h, we cache for 50 min to be safe
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const token = await getGoogleAccessToken(serviceAccount);
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + 50 * 60 * 1000
  });
  
  return token;
}

vertex.post("/v1/chat/completions", async (c) => {
  // 1. Get Credentials
  const creds = await db
    .select()
    .from(credentials)
    .where(eq(credentials.provider, PROVIDER_ID))
    .limit(1);

  const cred = creds[0];
  if (!cred || !cred.metadata) {
    return c.json({ error: "No Vertex AI credentials found" }, 401);
  }

  let serviceAccount: ServiceAccount;
  let projectId: string;
  let location = "us-central1";

  try {
    const meta = JSON.parse(cred.metadata as string);
    serviceAccount = meta.service_account;
    projectId = meta.project_id;
    if (meta.location) location = meta.location;
  } catch (e) {
    return c.json({ error: "Invalid credential metadata" }, 500);
  }

  // 2. Refresh Token
  let token: string;
  try {
    token = await getVertexToken(serviceAccount);
  } catch (e: any) {
    logger.error("Vertex Token Error", e);
    return c.json({ error: "Failed to authenticate with Vertex AI: " + e.message }, 500);
  }

  const inBody = await c.req.json();
  const model = inBody.model || "gemini-1.5-pro-preview-0409"; 

  // 3. Translate Request (OpenAI -> Vertex Gemini)
  const { contents, systemInstruction } = (typeof (Translators as any).openAIToGemini === 'function') 
    ? (Translators as any).openAIToGemini(inBody.messages || [])
    : { 
        contents: (inBody.messages || []).map((m: any) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }],
        })),
        systemInstruction: (inBody.messages || []).find((m: any) => m.role === "system")?.content
      };

  const payload: any = {
    contents: contents,
    generationConfig: {
      temperature: inBody.temperature,
      maxOutputTokens: inBody.max_tokens,
      topP: inBody.top_p,
    },
    safetySettings: [
       { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
       { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
       { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
       { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
    ]
  };

  if (systemInstruction) {
    payload.system_instruction = typeof systemInstruction === 'string' 
      ? { parts: [{ text: systemInstruction }] }
      : systemInstruction;
  }

  // 4. Thinking Mode
  if (model.toLowerCase().includes("thinking") || (inBody as any).reasoning_effort && (inBody as any).reasoning_effort !== "none") {
      payload.generationConfig.thinking_config = {
          include_thoughts: true
      };
  }

  const stream = inBody.stream === true;
  const action = stream ? "streamGenerateContent" : "generateContent";
  
  // Clean model name if it has prefixes like "google/" or "vertex/"
  const cleanModel = model.replace("google/", "").replace("vertex/", "");
  
  // Endpoint: https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{LOCATION}/publishers/google/models/{MODEL}:{ACTION}
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${cleanModel}:${action}?alt=sse`;

  try {
    const response = await fetchWithRetry(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });
    
    // Pass through response (SSE or JSON)
    return new Response(response.body, {
        status: response.status,
        headers: {
            "Content-Type": response.headers.get("Content-Type") || "application/json",
            // Remove transfer-encoding if present to avoid conflicts
        }
    });

  } catch (e: any) {
      return c.json({ error: e.message }, 500);
  }
});

export async function getModels(metadata: any) {
  try {
    const serviceAccount = metadata.service_account;
    const projectId = metadata.project_id;
    const location = metadata.location || "us-central1";

    const token = await getVertexToken(serviceAccount);

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models`;
    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) throw new Error("API Response not OK");
    
    const data = (await response.json()) as any;
    const modelList = data.models || data.publisherModels || [];
    
    if (modelList.length > 0) {
        return modelList.map((m: any) => ({
        id: m.name.split('/').pop(), // vertex models often full path
        name: m.displayName || m.name.split('/').pop(),
        provider: "google",
        }));
    } else {
        throw new Error("Empty model list");
    }

  } catch (e: any) {
    logger.warn("Vertex getModels failed, using fallback:", e?.message);
    return [
        { id: "gemini-1.5-pro-001", name: "Gemini 1.5 Pro (Vertex)", provider: "google" },
        { id: "gemini-1.5-flash-001", name: "Gemini 1.5 Flash (Vertex)", provider: "google" },
        { id: "claude-3-5-sonnet@20240620", name: "Claude 3.5 Sonnet (Vertex)", provider: "anthropic" },
    ];
  }
}

export default vertex;
