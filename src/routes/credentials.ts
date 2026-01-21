import { Hono } from "hono";
import { db } from "../db";
import { credentials } from "../db/schema";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { initiateQwenDeviceFlow, pollQwenToken } from "../lib/auth/qwen";
import { config } from "../config";
import { strictAuthMiddleware } from "../middleware/auth";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const api = new Hono();

// SECURITY: Global auth for all non-auth routes
api.use("*", async (c, next) => {
  // Whitelist: OAuth flow endpoints (public-facing or frontend-driven)
  if (c.req.path.includes("/auth/")) {
    await next();
    return;
  }
  
  // All other routes require authentication
  return strictAuthMiddleware(c, next);
});

/**
 * Sanitize credential metadata - remove sensitive fields
 */
function sanitizeMetadata(metadata: string | null): Record<string, any> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    // Remove sensitive fields - service account keys
    if (parsed.service_account) {
      delete parsed.service_account.private_key;
      delete parsed.service_account.private_key_id;
      // Keep only safe info
      parsed.service_account = {
        client_email: parsed.service_account.client_email,
        project_id: parsed.service_account.project_id,
        type: parsed.service_account.type,
      };
    }
    // Remove any raw private keys
    delete parsed.private_key;
    delete parsed.api_key;
    
    // SECURITY FIX: Remove OAuth tokens
    delete parsed.access_token;
    delete parsed.refresh_token;
    delete parsed.id_token;
    delete parsed.token;
    delete parsed.accessToken;
    delete parsed.refreshToken;
    delete parsed.idToken;
    
    return parsed;
  } catch {
    return null;
  }
}

// Get Status of all providers
api.get("/status", async (c) => {
  const all = await db.select().from(credentials);
  const statusMap: Record<string, boolean> = {};

  // Default all to false
  const SUPPORTED = [
    "kiro",
    "codex",
    "qwen",
    "iflow",
    "aistudio",
    "vertex",
    "claude",
    "gemini",
    "antigravity",
    "copilot",
  ];
  SUPPORTED.forEach((p) => (statusMap[p] = false));

  all.forEach((creds) => {
    statusMap[creds.provider] = true;
  });

  return c.json(statusMap);
});

// Get all credentials (SECURED + DESENSITIZED)
api.get("/", async (c) => {
  const all = await db.select().from(credentials);
  // Return safe list with desensitized metadata
  const safeList = all.map((cred) => ({
    id: cred.id,
    provider: cred.provider,
    email: cred.email,
    status: cred.status,
    lastRefresh: cred.lastRefresh,
    expiresAt: cred.expiresAt,
    metadata: sanitizeMetadata(cred.metadata as string),
  }));
  return c.json(safeList);
});

// Auth Routes (Generic Pattern could be applied later)

// --- Qwen Auth ---
api.post("/auth/qwen/start", async (c) => {
  try {
    const data = await initiateQwenDeviceFlow();
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

api.post(
  "/auth/qwen/poll",
  zValidator(
    "json",
    z.object({
      deviceCode: z.string().optional(),
      device_code: z.string().optional(),
      codeVerifier: z.string().optional(),
      code_verifier: z.string().optional(),
    }).transform(obj => ({
      // Normalize to camelCase, preferring camelCase input but accepting snake_case
      deviceCode: obj.deviceCode || obj.device_code,
      codeVerifier: obj.codeVerifier || obj.code_verifier,
    })).refine(obj => obj.deviceCode && obj.codeVerifier, {
        message: "Missing required parameters: deviceCode, codeVerifier"
    })
  ),
  async (c) => {
    const { deviceCode, codeVerifier } = c.req.valid("json");
    // deviceCode and codeVerifier are guaranteed strings here by the refine check (mostly, though types might need explicit cast if TS doesn't infer refine)
    // Actually refine doesn't narrow types automatically in strict sense for "string | undefined" -> "string" without user generic, 
    // but we can trust it or use a pipeline.
    // Let's use a simpler approach for TS inference:
    
    if (!deviceCode || !codeVerifier) {
         return c.json({ error: "Missing required parameters" }, 400);
    }
  
  try {
    const result = await pollQwenToken(deviceCode, codeVerifier);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Kiro (AWS) Auth ---
import {
  initiateKiroDeviceFlow,
  pollKiroToken,
  registerKiroClient,
} from "../lib/auth/kiro";

api.post("/auth/kiro/start", async (c) => {
  try {
    // Kiro needs registration first every time or cached? Upstream does it every time in LoginWithBuilderID
    const reg = await registerKiroClient();
    const flow = await initiateKiroDeviceFlow(reg.clientId, reg.clientSecret);
    // We need to return clientId/Secret to frontend so it can pass it back during poll?
    // Or we should store it temporarily. Stateless approach: send it to client.
    return c.json({
      ...flow,
      clientId: reg.clientId,
      clientSecret: reg.clientSecret,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

api.post(
  "/auth/kiro/poll",
  zValidator(
    "json",
    z.object({
      deviceCode: z.string(),
      clientId: z.string(),
      clientSecret: z.string(),
    })
  ),
  async (c) => {
    // Frontend sends camelCase keys for Kiro polling
    const { deviceCode, clientId, clientSecret } = c.req.valid("json");

  try {
    const result = await pollKiroToken(deviceCode, clientId, clientSecret);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Codex Auth ---
import { generateCodexAuthUrl } from "../lib/auth/codex";

api.post("/auth/codex/url", (c) => {
  const url = generateCodexAuthUrl();
  return c.json({ url });
});

api.post("/auth/codex/poll", async (c) => {
  // Codex doesn't need polling in the same way, the window closes.
  // Frontend should check status via refresh or polling fetchCredentials().
  // But we can provider a check endpoint if needed, or just let frontend refresh.
  return c.json({ success: true, message: "Use fetchCredentials" });
});

// --- iFlow Auth ---
import { generateIflowAuthUrl } from "../lib/auth/iflow";

api.post("/auth/iflow/url", (c) => {
  const url = generateIflowAuthUrl();
  return c.json({ url });
});

// --- Gemini Auth ---
import { generateGeminiAuthUrl } from "../lib/auth/gemini";
api.post("/auth/gemini/url", (c) => {
  return c.json({ url: generateGeminiAuthUrl() });
});

// --- Claude Auth ---
import { generateClaudeAuthUrl } from "../lib/auth/claude";
api.post("/auth/claude/url", (c) => {
  return c.json({ url: generateClaudeAuthUrl() });
});

// --- Antigravity Auth (Google Internal) ---
import { generateAntigravityAuthUrl } from "../lib/auth/antigravity";
api.post("/auth/antigravity/url", (c) => {
  return c.json({ url: generateAntigravityAuthUrl() });
});

// --- AI Studio (Google Generative Language) ---
api.post(
  "/auth/aistudio/save",
  zValidator(
    "json",
    z.object({
      serviceAccountJson: z.union([z.string(), z.record(z.any())]),
    })
  ),
  async (c) => {
    try {
      const { serviceAccountJson } = c.req.valid("json");

    let accessToken = "";
    let email = "aistudio-user";
    let metadata: Record<string, any> = {};

    // Detect input type: API Key (starts with AIza) or Service Account JSON
    if (typeof serviceAccountJson === 'string' && serviceAccountJson.trim().startsWith("AIza")) {
      // API Key Mode
      accessToken = serviceAccountJson.trim();
      metadata = { mode: "api_key" };
      email = "apikey-user";
    } else {
      // Try to parse as Service Account JSON
      try {
        const parsed = typeof serviceAccountJson === 'string' 
          ? JSON.parse(serviceAccountJson) 
          : serviceAccountJson;
        
        if (parsed.type === "service_account" && parsed.private_key && parsed.client_email) {
          // Valid Service Account JSON
          accessToken = "service-account"; // Placeholder, we use the SA directly
          email = parsed.client_email;
          metadata = {
            mode: "service_account",
            service_account: parsed,
            project_id: parsed.project_id,
          };
        } else {
          return c.json({ error: "Invalid Service Account JSON. Ensure it contains 'type', 'private_key', and 'client_email'." }, 400);
        }
      } catch (parseError) {
        // Not valid JSON and not an API key
        return c.json({ error: "Invalid input. Provide an API Key (starts with AIza) or a valid Service Account JSON." }, 400);
      }
    }

    // Save to database
    await db
      .insert(credentials)
      .values({
        id: "aistudio",
        provider: "aistudio",
        accessToken: accessToken,
        email: email,
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: credentials.provider,
        set: {
          accessToken: accessToken,
          email: email,
          metadata: JSON.stringify(metadata),
          updatedAt: new Date().toISOString(),
        },
      });

    return c.json({ success: true, mode: metadata.mode });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});


// Delete Credential (Disconnect)
api.delete("/:provider", async (c) => {
  const provider = c.req.param("provider");

  if (!provider) {
    return c.json({ error: "Provider required" }, 400);
  }

  await db.delete(credentials).where(eq(credentials.provider, provider));

  return c.json({ success: true, provider });
});

// --- Vertex AI Auth ---
api.post(
  "/auth/vertex/save",
  zValidator(
    "json",
    z.object({
      serviceAccountJson: z.union([z.string(), z.record(z.any())]),
    })
  ),
  async (c) => {
    try {
      const { serviceAccountJson } = c.req.valid("json");

    let parsed: any;
    try {
      parsed =
        typeof serviceAccountJson === "string"
          ? JSON.parse(serviceAccountJson)
          : serviceAccountJson;
    } catch (e) {
      return c.json({ error: "Invalid JSON format" }, 400);
    }

    const projectId = parsed.project_id;
    const clientEmail = parsed.client_email;

    if (!projectId || !clientEmail) {
      return c.json(
        { error: "JSON must contain project_id and client_email" },
        400,
      );
    }

    // Save
    await db
      .insert(credentials)
      .values({
        id: "vertex",
        provider: "vertex",
        accessToken: "service-account", 
        email: clientEmail,
        metadata: JSON.stringify({
          service_account: parsed,
          project_id: projectId,
          location: "us-central1", // Default
        }),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: credentials.provider,
        set: {
          metadata: JSON.stringify({
            service_account: parsed,
            project_id: projectId,
            location: "us-central1",
          }),
          email: clientEmail,
          updatedAt: new Date().toISOString(),
        },
      });

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default api;
