import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config";
import { rateLimiter, __resetRateLimiterForTests } from "../src/middleware/rate-limiter";

describe("rateLimiter", () => {
  const originalTrustProxy = config.trustProxy;

  afterEach(() => {
    config.trustProxy = originalTrustProxy;
    __resetRateLimiterForTests();
  });

  it("TRUST_PROXY=true 时应按头部 IP 分桶限流（101 次触发 429）", async () => {
    config.trustProxy = true;
    __resetRateLimiterForTests();

    const app = new Hono();
    app.use("*", rateLimiter);
    app.get("/", (c) => c.text("ok"));

    let lastStatus = 0;
    for (let i = 0; i < 101; i += 1) {
      const res = await app.fetch(
        new Request("http://local/", {
          headers: {
            "cf-connecting-ip": "1.2.3.4",
          },
        }),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("TRUST_PROXY=false 时应使用 global 桶（不同头部 IP 也会共享计数）", async () => {
    config.trustProxy = false;
    __resetRateLimiterForTests();

    const app = new Hono();
    app.use("*", rateLimiter);
    app.get("/", (c) => c.text("ok"));

    let lastStatus = 0;
    for (let i = 0; i < 101; i += 1) {
      const res = await app.fetch(
        new Request("http://local/", {
          headers: {
            "cf-connecting-ip": i % 2 === 0 ? "1.2.3.4" : "9.9.9.9",
          },
        }),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

