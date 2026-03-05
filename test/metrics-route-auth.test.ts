import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config";
import { register } from "../src/lib/metrics";
import { metricsHandler } from "../src/routes/metrics";

describe("/metrics 鉴权", () => {
  const originalExposeMetrics = config.exposeMetrics;

  afterEach(() => {
    config.exposeMetrics = originalExposeMetrics;
  });

  it("EXPOSE_METRICS=false 时，未携带 Authorization 应返回 404", async () => {
    config.exposeMetrics = false;

    const app = new Hono();
    app.get("/metrics", metricsHandler);

    const res = await app.fetch(new Request("http://local/metrics"));
    expect(res.status).toBe(404);
  });

  it("EXPOSE_METRICS=false 时，携带正确 Bearer API_SECRET 应返回 200 并输出 Prometheus 文本", async () => {
    config.exposeMetrics = false;

    const app = new Hono();
    app.get("/metrics", metricsHandler);

    const res = await app.fetch(
      new Request("http://local/metrics", {
        headers: {
          Authorization: `Bearer ${config.apiSecret}`,
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(register.contentType);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it("EXPOSE_METRICS=true 时，未携带 Authorization 也应返回 200", async () => {
    config.exposeMetrics = true;

    const app = new Hono();
    app.get("/metrics", metricsHandler);

    const res = await app.fetch(new Request("http://local/metrics"));
    expect(res.status).toBe(200);
  });
});

