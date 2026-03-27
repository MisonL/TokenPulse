import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { app as coreApp } from "../apps/core/src/index";
import { app as enterpriseApp } from "../apps/enterprise/src/index";

const originalApiSecret = config.apiSecret;
const originalSharedKey = config.enterprise.internalSharedKey;

describe("core/enterprise 实际入口挂载", () => {
  beforeAll(async () => {
    await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS core.settings (
          key text PRIMARY KEY,
          value text NOT NULL,
          description text,
          updated_at text
        )
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS core.request_logs (
          id serial PRIMARY KEY,
          timestamp text NOT NULL,
          provider text,
          method text,
          path text,
          status integer,
          latency_ms integer,
          prompt_tokens integer,
          completion_tokens integer,
          model text,
          trace_id text,
          account_id text
        )
      `),
    );
  });

  beforeEach(() => {
    config.apiSecret = "tokenpulse-entrypoint-secret";
    config.enterprise.internalSharedKey = "tokenpulse-entrypoint-shared-key";
  });

  afterAll(() => {
    config.apiSecret = originalApiSecret;
    config.enterprise.internalSharedKey = originalSharedKey;
  });

  it("core app 应挂载 /api/auth/verify-secret", async () => {
    const response = await coreApp.fetch(
      new Request("http://localhost/api/auth/verify-secret", {
        headers: {
          Authorization: "Bearer tokenpulse-entrypoint-secret",
          "x-request-id": "trace-core-entrypoint-auth-001",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(
      "trace-core-entrypoint-auth-001",
    );
    const payload = (await response.json()) as { success?: boolean };
    expect(payload.success).toBe(true);
  });

  it("enterprise app 在配置 shared key 时应保护 /api/admin/features", async () => {
    const forbidden = await enterpriseApp.fetch(
      new Request("http://localhost/api/admin/features"),
    );
    expect(forbidden.status).toBe(403);
    const forbiddenPayload = (await forbidden.json()) as { error?: string };
    expect(forbiddenPayload.error).toBe("enterprise 内部鉴权失败");

    const allowed = await enterpriseApp.fetch(
      new Request("http://localhost/api/admin/features", {
        headers: {
          "x-tokenpulse-internal-key": "tokenpulse-entrypoint-shared-key",
        },
      }),
    );
    expect(allowed.status).toBe(200);
    const allowedPayload = (await allowed.json()) as {
      edition?: string;
      features?: Record<string, unknown>;
    };
    expect(allowedPayload.edition).toBeTruthy();
    expect(allowedPayload.features).toBeDefined();
  });
});
