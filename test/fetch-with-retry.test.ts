import { afterEach, describe, expect, it } from "bun:test";
import { HTTPError, fetchWithRetry } from "../src/lib/http";

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Math.random = originalRandom;
  });

  it("应对 5xx 重试并最终成功返回", async () => {
    Math.random = () => 0;

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("bad gateway", { status: 502, statusText: "Bad Gateway" });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const res = await fetchWithRetry("http://local/retry", {
      retries: 1,
      initialDelay: 0,
      maxDelay: 0,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("对 4xx（非 429）不应重试，应原样返回", async () => {
    Math.random = () => 0;

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("bad request", { status: 400, statusText: "Bad Request" });
    }) as unknown as typeof globalThis.fetch;

    const res = await fetchWithRetry("http://local/no-retry", {
      retries: 3,
      initialDelay: 0,
      maxDelay: 0,
    });
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
  });

  it("网络异常应重试并最终成功返回", async () => {
    Math.random = () => 0;

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network down");
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const res = await fetchWithRetry("http://local/network", {
      retries: 1,
      initialDelay: 0,
      maxDelay: 0,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("重试耗尽后应抛出 HTTPError", async () => {
    Math.random = () => 0;

    globalThis.fetch = (async () => {
      return new Response("service unavailable", { status: 503, statusText: "Service Unavailable" });
    }) as unknown as typeof globalThis.fetch;

    await expect(
      fetchWithRetry("http://local/always-503", {
        retries: 1,
        initialDelay: 0,
        maxDelay: 0,
      }),
    ).rejects.toBeInstanceOf(HTTPError);

    try {
      await fetchWithRetry("http://local/always-503", {
        retries: 0,
        initialDelay: 0,
        maxDelay: 0,
      });
      throw new Error("unexpected");
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPError);
      const typed = err as HTTPError;
      expect(typed.status).toBe(503);
    }
  });
});
