import { afterEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import openaiCompat from "../src/api/unified/openai";
import { requestContextMiddleware } from "../src/middleware/request-context";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

function createGoogleStyleSseStream(texts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const text of texts) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text }],
                  },
                },
              ],
            })}\n`,
          ),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n"));
      controller.close();
    },
  });
}

describe("/v1 OpenAI 兼容 streaming 与错误语义回归", () => {
  it("应将 Google-style SSE 流转换为 OpenAI chat.completion.chunk 并以 [DONE] 结束，同时保持路由决策头与 x-request-id", async () => {
    const traceId = "trace-openai-stream-001";
    const upstreamHeaders = {
      "Content-Type": "text/event-stream",
      "x-tokenpulse-provider": "gemini",
      "x-tokenpulse-route-policy": "round_robin",
      "x-tokenpulse-fallback": "none",
    };

    globalThis.fetch = mock(async () => {
      return new Response(createGoogleStyleSseStream(["你好", "世界"]), {
        status: 200,
        headers: upstreamHeaders,
      });
    }) as unknown as typeof fetch;

    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.route("/v1", openaiCompat);

    const response = await app.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": traceId,
        },
        body: JSON.stringify({
          model: "gemini:gemini-1.5-pro",
          stream: true,
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect((response.headers.get("content-type") || "").toLowerCase()).toContain(
      "text/event-stream",
    );
    expect(response.headers.get("x-tokenpulse-provider")).toBe("gemini");
    expect(response.headers.get("x-tokenpulse-route-policy")).toBe("round_robin");
    expect(response.headers.get("x-tokenpulse-fallback")).toBe("none");
    expect(response.headers.get("x-request-id")).toBe(traceId);

    const body = await response.text();
    const dataLines = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data: "));

    expect(
      dataLines.some((line) =>
        line.includes("\"object\":\"chat.completion.chunk\""),
      ),
    ).toBe(true);
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("当上游 fetch throw 时应返回 502 JSON，并确保 traceId 与 x-request-id 对齐", async () => {
    const traceId = "trace-openai-throw-001";

    globalThis.fetch = mock(async () => {
      throw new Error("upstream down");
    }) as unknown as typeof fetch;

    const app = new Hono();
    app.use("*", requestContextMiddleware);
    app.route("/v1", openaiCompat);

    const response = await app.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": traceId,
        },
        body: JSON.stringify({
          model: "gemini:gemini-1.5-pro",
          stream: false,
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect((response.headers.get("content-type") || "").toLowerCase()).toContain(
      "application/json",
    );
    expect(response.headers.get("x-request-id")).toBe(traceId);

    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe("网关转发失败");
    expect(payload.traceId).toBe(traceId);
  });
});
