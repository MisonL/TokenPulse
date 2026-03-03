import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db";
import { credentials } from "../db/schema";
import { initiateQwenDeviceFlow, pollQwenToken } from "../lib/auth/qwen";
import {
  initiateKiroDeviceFlow,
  pollKiroToken,
  registerKiroClient,
} from "../lib/auth/kiro";
import geminiRouter from "../lib/providers/gemini";
import { claudeProvider } from "../lib/providers/claude";
import { codexProvider } from "../lib/providers/codex";
import { iflowProvider } from "../lib/providers/iflow";
import { antigravityProvider } from "../lib/providers/antigravity";
import { copilotProvider } from "../lib/providers/copilot";
import { kiroProvider } from "../lib/providers/kiro";

const oauth = new Hono();

const providerSchema = z.object({
  provider: z.enum([
    "claude",
    "gemini",
    "codex",
    "qwen",
    "kiro",
    "iflow",
    "antigravity",
    "copilot",
    "aistudio",
    "vertex",
  ]),
});

async function delegateToRouter(
  c: Context,
  router: { fetch: (request: Request) => Response | Promise<Response> },
  method: string,
  path: string,
) {
  const headers = new Headers(c.req.raw.headers);
  const request = new Request(new URL(path, "http://local"), {
    method,
    headers,
    body: method === "GET" ? undefined : c.req.raw.body,
  });
  const response = await router.fetch(request);
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

oauth.get("/providers", (c) => {
  return c.json({
    data: [
      { id: "claude", flow: "auth_code" },
      { id: "gemini", flow: "auth_code" },
      { id: "codex", flow: "auth_code" },
      { id: "iflow", flow: "auth_code" },
      { id: "antigravity", flow: "auth_code" },
      { id: "qwen", flow: "device_code" },
      { id: "kiro", flow: "device_code" },
      { id: "copilot", flow: "device_code" },
      { id: "aistudio", flow: "manual_key" },
      { id: "vertex", flow: "service_account" },
    ],
  });
});

oauth.get("/status", async (c) => {
  const all = await db.select().from(credentials);
  const statusMap: Record<string, boolean> = {
    kiro: false,
    codex: false,
    qwen: false,
    iflow: false,
    aistudio: false,
    vertex: false,
    claude: false,
    gemini: false,
    antigravity: false,
    copilot: false,
  };
  all.forEach((item) => {
    statusMap[item.provider] = true;
  });
  return c.json(statusMap);
});

oauth.post(
  "/:provider/start",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider } = c.req.valid("param");

    switch (provider) {
      case "claude":
        return claudeProvider.startOAuth(c);
      case "codex":
        return codexProvider.startOAuth(c);
      case "iflow":
        return iflowProvider.startOAuth(c);
      case "antigravity":
        return antigravityProvider.startOAuth(c);
      case "copilot":
        return copilotProvider.startOAuth(c);
      case "kiro":
        return kiroProvider.startOAuth(c);
      case "gemini":
        return delegateToRouter(c, geminiRouter, "GET", "/auth/url");
      case "qwen": {
        const data = await initiateQwenDeviceFlow();
        return c.json(data);
      }
      case "aistudio":
        return c.json({
          mode: "manual_key",
          message: "请通过 /api/credentials/auth/aistudio/save 提交 API Key 或服务账号。",
        });
      case "vertex":
        return c.json({
          mode: "service_account",
          message: "请通过 /api/credentials/auth/vertex/save 提交服务账号 JSON。",
        });
      default:
        return c.json({ error: "不支持的 provider" }, 400);
    }
  },
);

oauth.post(
  "/:provider/poll",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider } = c.req.valid("param");

    if (provider === "qwen") {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
      const deviceCode = body.deviceCode || body.device_code;
      const codeVerifier = body.codeVerifier || body.code_verifier;
      if (!deviceCode || !codeVerifier) {
        return c.json({ error: "缺少 deviceCode/codeVerifier" }, 400);
      }
      const result = await pollQwenToken(deviceCode, codeVerifier);
      return c.json(result);
    }

    if (provider === "kiro") {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
      const deviceCode = body.deviceCode || body.device_code;
      const clientId = body.clientId || body.client_id;
      const clientSecret = body.clientSecret || body.client_secret;
      if (!deviceCode || !clientId || !clientSecret) {
        return c.json({ error: "缺少 deviceCode/clientId/clientSecret" }, 400);
      }
      const result = await pollKiroToken(deviceCode, clientId, clientSecret);
      return c.json(result);
    }

    if (provider === "copilot") {
      return copilotProvider.pollOAuth(c);
    }

    if (provider === "codex") {
      return c.json({ success: true, message: "请通过 /status 检查授权状态" });
    }

    return c.json({ error: `${provider} 不支持轮询流程` }, 400);
  },
);

oauth.post("/kiro/register", async (c) => {
  const reg = await registerKiroClient();
  const flow = await initiateKiroDeviceFlow(reg.clientId, reg.clientSecret);
  return c.json({
    ...flow,
    clientId: reg.clientId,
    clientSecret: reg.clientSecret,
  });
});

oauth.get(
  "/:provider/callback",
  zValidator("param", providerSchema),
  async (c) => {
    const { provider } = c.req.valid("param");
    const query = new URLSearchParams(c.req.query()).toString();
    const suffix = query ? `?${query}` : "";

    const targetMap: Record<string, string> = {
      claude: `/api/claude/callback${suffix}`,
      gemini: `/api/gemini/oauth2callback${suffix}`,
      codex: `/api/codex/callback${suffix}`,
      iflow: `/api/iflow/callback${suffix}`,
      antigravity: `/api/antigravity/callback${suffix}`,
      kiro: `/api/kiro/callback${suffix}`,
      copilot: `/api/copilot/callback${suffix}`,
      qwen: `/api/qwen/callback${suffix}`,
      aistudio: `/api/credentials${suffix}`,
      vertex: `/api/credentials${suffix}`,
    };

    const target = targetMap[provider];
    if (!target) return c.notFound();
    return c.redirect(target, 302);
  },
);

export default oauth;
