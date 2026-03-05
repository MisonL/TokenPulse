import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config";
import {
  getProviderRuntimeAdapter,
  overrideProviderRuntimeAdapterForTest,
} from "../src/lib/oauth/runtime-adapters";
import enterprise from "../src/routes/enterprise";

function createAdminApp() {
  const app = new Hono();
  app.route("/api/admin", enterprise);
  return app;
}

function ownerHeaders(extra?: Record<string, string>) {
  return {
    "x-admin-user": "oauth-capability-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    ...(extra || {}),
  };
}

function auditorHeaders() {
  return ownerHeaders({
    "x-admin-user": "oauth-capability-auditor",
    "x-admin-role": "auditor",
  });
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;

describe("OAuth capability health 路由", () => {
  beforeEach(() => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
  });

  afterAll(() => {
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("GET /api/admin/oauth/capability-health 正常场景应返回健康报告结构", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/oauth/capability-health", {
        headers: ownerHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: {
        ok: boolean;
        checkedAt: string;
        issueCount: number;
        issues: Array<Record<string, unknown>>;
      };
    };

    expect(typeof payload.data.ok).toBe("boolean");
    expect(typeof payload.data.checkedAt).toBe("string");
    expect(typeof payload.data.issueCount).toBe("number");
    expect(Array.isArray(payload.data.issues)).toBe(true);
    expect(payload.data.issueCount).toBe(payload.data.issues.length);
  });

  it("GET /api/admin/oauth/capability-health 在 qwen poll 能力缺口时应返回 poll_flows_mismatch", async () => {
    const app = createAdminApp();
    const current = getProviderRuntimeAdapter("qwen");

    expect(current).toBeTruthy();

    const restore = overrideProviderRuntimeAdapterForTest("qwen", {
      ...current!,
      poll: undefined,
      pollFlows: [],
    });

    try {
      const response = await app.fetch(
        new Request("http://localhost/api/admin/oauth/capability-health", {
          headers: ownerHeaders(),
        }),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        data: {
          issues: Array<{
            provider: string;
            code: string;
            message: string;
          }>;
        };
      };

      const issue = payload.data.issues.find(
        (item) => item.provider === "qwen" && item.code === "poll_flows_mismatch",
      );

      expect(issue).toBeTruthy();
      expect(issue?.message).toContain("device_code");
    } finally {
      restore();
    }
  });

  it("auditor 访问 GET /api/admin/oauth/capability-health 应返回 403 与 required 字段", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/oauth/capability-health", {
        headers: auditorHeaders(),
      }),
    );

    expect(response.status).toBe(403);
    const payload = (await response.json()) as {
      error: string;
      role: string;
      required: string;
    };

    expect(payload.error).toBe("权限不足");
    expect(payload.role).toBe("auditor");
    expect(payload.required).toBe("admin.oauth.manage");
  });
});
