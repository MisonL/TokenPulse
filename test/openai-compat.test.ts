import { afterEach, describe, expect, it, mock } from "bun:test";
import openaiCompat from "../src/api/unified/openai";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("OpenAI 兼容路由", () => {
  it("GET /v1/models 应返回 OpenAI list 结构", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          data: [
            { id: "codex:gpt-4.1", provider: "openai" },
            { id: "claude:claude-3-7-sonnet-20250219", provider: "anthropic" },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const res = await openaiCompat.fetch(new Request("http://local/models"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      object: string;
      data: Array<{ id: string; object: string; owned_by: string }>;
    };
    expect(json.object).toBe("list");
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data[0]?.id).toBe("codex:gpt-4.1");
    expect(json.data[0]?.object).toBe("model");
  });

  it("POST /v1/responses 非流式应转换为 response 对象", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "chatcmpl_xxx",
          object: "chat.completion",
          model: "gpt-4.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "你好，我是助手" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const res = await openaiCompat.fetch(
      new Request("http://local/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "codex:gpt-4.1",
          input: "你好",
        }),
      }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      object: string;
      status: string;
      output_text: string;
      usage: { input_tokens: number; output_tokens: number; total_tokens: number };
    };
    expect(json.object).toBe("response");
    expect(json.status).toBe("completed");
    expect(json.output_text).toContain("你好");
    expect(json.usage.total_tokens).toBe(20);
  });

  it("POST /v1/chat/completions 应透传统一路由决策头", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "chatcmpl_1",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-tokenpulse-provider": "codex",
            "x-tokenpulse-route-policy": "round_robin",
            "x-tokenpulse-fallback": "none",
          },
        },
      );
    }) as unknown as typeof fetch;

    const res = await openaiCompat.fetch(
      new Request("http://local/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "codex:gpt-4.1",
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-tokenpulse-provider")).toBe("codex");
    expect(res.headers.get("x-tokenpulse-route-policy")).toBe("round_robin");
    expect(res.headers.get("x-tokenpulse-fallback")).toBe("none");
  });
});
