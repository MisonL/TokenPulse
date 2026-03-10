import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import { requestContextMiddleware } from "../src/middleware/request-context";
import enterprise from "../src/routes/enterprise";

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;
const originalAuthMode = config.admin.authMode;

function createAdminApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.route("/api/admin", enterprise);
  return app;
}

function adminHeaders(
  role: "owner" | "auditor" | "operator",
  traceId: string,
) {
  return {
    "x-admin-user": `billing-${role}`,
    "x-admin-role": role,
    "x-admin-tenant": "default",
    "x-request-id": traceId,
  };
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function ensureBillingUsageTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.quota_policies (
        id text PRIMARY KEY,
        name text NOT NULL,
        scope_type text NOT NULL,
        scope_value text,
        provider text,
        model_pattern text,
        requests_per_minute integer,
        tokens_per_minute integer,
        tokens_per_day integer,
        enabled integer NOT NULL DEFAULT 1,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.quota_usage_windows (
        id serial PRIMARY KEY,
        policy_id text NOT NULL,
        bucket_type text NOT NULL,
        window_start bigint NOT NULL,
        request_count integer NOT NULL DEFAULT 0,
        token_count integer NOT NULL DEFAULT 0,
        estimated_token_count integer NOT NULL DEFAULT 0,
        actual_token_count integer NOT NULL DEFAULT 0,
        reconciled_delta integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS quota_usage_windows_unique_idx ON enterprise.quota_usage_windows (policy_id, bucket_type, window_start)",
    ),
  );
}

async function resetBillingUsageFixtures() {
  await db.execute(sql.raw("DELETE FROM enterprise.quota_usage_windows"));
  await db.execute(sql.raw("DELETE FROM enterprise.quota_policies"));
}

describe("企业域计费 usage 与 RBAC 边界", () => {
  beforeAll(async () => {
    await ensureBillingUsageTables();
  });

  beforeEach(async () => {
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    config.admin.authMode = "hybrid";
    await resetBillingUsageFixtures();
  });

  afterAll(async () => {
    await resetBillingUsageFixtures();
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
    config.admin.authMode = originalAuthMode;
  });

  it("auditor/operator 访问 billing/usage 应返回 403 + required=admin.billing.manage，并对齐 traceId", async () => {
    const app = createAdminApp();
    const roles = ["auditor", "operator"] as const;

    for (const role of roles) {
      const traceId = `trace-billing-usage-forbidden-${role}-001`;
      const response = await app.fetch(
        new Request("http://localhost/api/admin/billing/usage", {
          headers: adminHeaders(role, traceId),
        }),
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("x-request-id")).toBe(traceId);
      const payload = await response.json();
      expect(payload.traceId).toBe(traceId);
      expect(payload.role).toBe(role);
      expect(payload.required).toBe("admin.billing.manage");
    }
  });

  it("billing/usage from>to 应返回 400 + error=from 不能晚于 to，并对齐 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-billing-usage-range-error-001";
    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/billing/usage?from=2026-03-10T00:00:00.000Z&to=2026-03-09T00:00:00.000Z",
        { headers: adminHeaders("owner", traceId) },
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("from 不能晚于 to");
    expect(payload.traceId).toBe(traceId);
  });

  it("billing/usage tenantId 与 projectId 同时提供应返回 400，并对齐 traceId", async () => {
    const app = createAdminApp();
    const traceId = "trace-billing-usage-scope-conflict-001";
    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/billing/usage?tenantId=tenant-a&projectId=project-a",
        { headers: adminHeaders("owner", traceId) },
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("tenantId 与 projectId 不能同时提供");
    expect(payload.traceId).toBe(traceId);
  });

  it("billing/usage 应支持按 policyId/bucketType/provider/tenantId/model 过滤并回传 join 信息", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    const policyId = "policy-usage-1";

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.quota_policies (
          id, name, scope_type, scope_value, provider, model_pattern,
          enabled, created_at, updated_at
        )
        VALUES (
          '${escapeSqlLiteral(policyId)}',
          'Usage Policy',
          'tenant',
          'tenant-a',
          'openai',
          'gpt-4*',
          1,
          '${escapeSqlLiteral(nowIso)}',
          '${escapeSqlLiteral(nowIso)}'
        )
      `),
    );

    const minuteStart = 1_700_000_000_000;
    const dayStart = 1_700_000_000_000 - 86_400_000;

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.quota_usage_windows (
          policy_id, bucket_type, window_start, request_count, token_count,
          estimated_token_count, actual_token_count, reconciled_delta,
          created_at, updated_at
        )
        VALUES
          (
            '${escapeSqlLiteral(policyId)}',
            'minute',
            ${minuteStart},
            2,
            120,
            120,
            80,
            -40,
            '${escapeSqlLiteral(nowIso)}',
            '${escapeSqlLiteral(nowIso)}'
          ),
          (
            '${escapeSqlLiteral(policyId)}',
            'day',
            ${dayStart},
            10,
            500,
            500,
            480,
            -20,
            '${escapeSqlLiteral(nowIso)}',
            '${escapeSqlLiteral(nowIso)}'
          )
      `),
    );

    const traceId = "trace-billing-usage-filter-001";
    const response = await app.fetch(
      new Request(
        `http://localhost/api/admin/billing/usage?policyId=${encodeURIComponent(
          policyId,
        )}&bucketType=minute&provider=OPENAI&tenantId=%20TENANT-A%20&model=gpt-4o-mini`,
        { headers: adminHeaders("owner", traceId) },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(Array.isArray(payload.data)).toBe(true);

    const rows = payload.data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.policyId).toBe(policyId);
    expect(rows[0]?.policyName).toBe("Usage Policy");
    expect(rows[0]?.bucketType).toBe("minute");
    expect(rows[0]?.windowStart).toBe(minuteStart);
    expect(rows[0]?.requestCount).toBe(2);
    expect(rows[0]?.tokenCount).toBe(120);
    expect(rows[0]?.estimatedTokenCount).toBe(120);
    expect(rows[0]?.actualTokenCount).toBe(80);
    expect(rows[0]?.reconciledDelta).toBe(-40);
    expect(rows[0]?.scopeType).toBe("tenant");
    expect(rows[0]?.scopeValue).toBe("tenant-a");
    expect(rows[0]?.provider).toBe("openai");
    expect(rows[0]?.modelPattern).toBe("gpt-4*");
  });

  it("billing/usage 应支持按 projectId 过滤并回传 join 信息", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    const projectPolicyId = "policy-usage-project-1";
    const tenantPolicyId = "policy-usage-tenant-2";

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.quota_policies (
          id, name, scope_type, scope_value, provider, model_pattern,
          enabled, created_at, updated_at
        )
        VALUES
          (
            '${escapeSqlLiteral(projectPolicyId)}',
            'Usage Project Policy',
            'project',
            'project-a',
            'openai',
            'gpt-4*',
            1,
            '${escapeSqlLiteral(nowIso)}',
            '${escapeSqlLiteral(nowIso)}'
          ),
          (
            '${escapeSqlLiteral(tenantPolicyId)}',
            'Usage Tenant Policy',
            'tenant',
            'tenant-a',
            'openai',
            'gpt-4*',
            1,
            '${escapeSqlLiteral(nowIso)}',
            '${escapeSqlLiteral(nowIso)}'
          )
      `),
    );

    const minuteStart = 1_700_000_123_000;

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.quota_usage_windows (
          policy_id, bucket_type, window_start, request_count, token_count,
          estimated_token_count, actual_token_count, reconciled_delta,
          created_at, updated_at
        )
        VALUES
          (
            '${escapeSqlLiteral(projectPolicyId)}',
            'minute',
            ${minuteStart},
            3,
            300,
            300,
            260,
            -40,
            '${escapeSqlLiteral(nowIso)}',
            '${escapeSqlLiteral(nowIso)}'
          ),
          (
            '${escapeSqlLiteral(tenantPolicyId)}',
            'minute',
            ${minuteStart},
            1,
            100,
            100,
            90,
            -10,
            '${escapeSqlLiteral(nowIso)}',
            '${escapeSqlLiteral(nowIso)}'
          )
      `),
    );

    const traceId = "trace-billing-usage-project-filter-001";
    const response = await app.fetch(
      new Request(
        "http://localhost/api/admin/billing/usage?bucketType=minute&provider=OPENAI&projectId=%20PROJECT-A%20&model=gpt-4o-mini",
        { headers: adminHeaders("owner", traceId) },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(Array.isArray(payload.data)).toBe(true);

    const rows = payload.data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.policyId).toBe(projectPolicyId);
    expect(rows[0]?.policyName).toBe("Usage Project Policy");
    expect(rows[0]?.bucketType).toBe("minute");
    expect(rows[0]?.windowStart).toBe(minuteStart);
    expect(rows[0]?.requestCount).toBe(3);
    expect(rows[0]?.tokenCount).toBe(300);
    expect(rows[0]?.estimatedTokenCount).toBe(300);
    expect(rows[0]?.actualTokenCount).toBe(260);
    expect(rows[0]?.reconciledDelta).toBe(-40);
    expect(rows[0]?.scopeType).toBe("project");
    expect(rows[0]?.scopeValue).toBe("project-a");
    expect(rows[0]?.provider).toBe("openai");
    expect(rows[0]?.modelPattern).toBe("gpt-4*");
  });

  it("billing/usage/export 应返回 CSV 且包含 header 与至少 1 行数据", async () => {
    const app = createAdminApp();
    const nowIso = new Date().toISOString();
    const policyId = "policy-usage-export-1";
    const windowStart = 1_700_000_456_000;

    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.quota_policies (
          id, name, scope_type, scope_value, provider, model_pattern,
          enabled, created_at, updated_at
        )
        VALUES (
          '${escapeSqlLiteral(policyId)}',
          'Usage Export Policy',
          'tenant',
          'tenant-a',
          'openai',
          'gpt-4*',
          1,
          '${escapeSqlLiteral(nowIso)}',
          '${escapeSqlLiteral(nowIso)}'
        )
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO enterprise.quota_usage_windows (
          policy_id, bucket_type, window_start, request_count, token_count,
          estimated_token_count, actual_token_count, reconciled_delta,
          created_at, updated_at
        )
        VALUES (
          '${escapeSqlLiteral(policyId)}',
          'minute',
          ${windowStart},
          1,
          100,
          100,
          90,
          -10,
          '${escapeSqlLiteral(nowIso)}',
          '${escapeSqlLiteral(nowIso)}'
        )
      `),
    );

    const traceId = "trace-billing-usage-export-001";
    const response = await app.fetch(
      new Request(
        `http://localhost/api/admin/billing/usage/export?policyId=${encodeURIComponent(policyId)}`,
        { headers: adminHeaders("owner", traceId) },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    expect(response.headers.get("content-type")).toContain("text/csv");

    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const csv = await response.text();
    const normalized = csv.replace(/^\uFEFF/, "");
    const lines = normalized.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "windowStartIso,bucketType,policyId,policyName,scopeType,scopeValue,provider,modelPattern,requestCount,tokenCount,estimatedTokenCount,actualTokenCount,reconciledDelta",
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(normalized).toContain(policyId);
    expect(normalized).toContain(new Date(windowStart).toISOString());
  });
});
