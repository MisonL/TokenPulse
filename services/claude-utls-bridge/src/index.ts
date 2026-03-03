import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();
const upstream =
  process.env.CLAUDE_BRIDGE_UPSTREAM ||
  "https://api.anthropic.com/v1/messages?beta=true";
const port = Number.parseInt(process.env.PORT || "9460", 10);
const sharedKey = (process.env.CLAUDE_BRIDGE_SHARED_KEY || "").trim();

app.use("*", logger());

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "claude-utls-bridge",
    upstream,
  }),
);

app.post("/v1/messages", async (c) => {
  if (sharedKey) {
    const incomingKey = c.req.header("x-tokenpulse-bridge-key") || "";
    if (incomingKey !== sharedKey) {
      return c.json({ error: "bridge 内部鉴权失败" }, 403);
    }
  }

  const req = c.req.raw;
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-tokenpulse-bridge-key");

  const response = await fetch(upstream, {
    method: "POST",
    headers,
    body: req.body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

export default {
  port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
};
