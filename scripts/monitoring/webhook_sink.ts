const port = Number.parseInt(process.env.PORT ?? "18080", 10);
const hostname = process.env.HOST ?? "0.0.0.0";

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

Bun.serve({
  port,
  hostname,
  async fetch(req) {
    const url = new URL(req.url);
    const bodyText = await req.text();
    const bodyJson = safeJson(bodyText);

    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}${url.search}`);
    if (bodyJson) {
      console.log(JSON.stringify(bodyJson, null, 2));
    } else if (bodyText) {
      console.log(bodyText);
    } else {
      console.log("(empty body)");
    }
    console.log("----");

    return new Response("ok\n", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`本地 webhook sink 已启动: http://${hostname}:${port}`);

