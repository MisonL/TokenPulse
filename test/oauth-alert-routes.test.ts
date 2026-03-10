import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import {
  alertmanagerControlLastSuccessTimestampGauge,
  alertmanagerControlOperationDuration,
  alertmanagerControlOperationsCounter,
  oauthAlertCompatRouteCounter,
  register,
} from "../src/lib/metrics";
import { requestContextMiddleware } from "../src/middleware/request-context";
import enterprise from "../src/routes/enterprise";

function createAdminApp() {
  const app = new Hono();
  // 生产环境由全局 middleware 注入 traceId，并为 JSON 错误响应兜底补全 traceId 字段。
  app.use("*", requestContextMiddleware);
  app.route("/api/admin", enterprise);
  return app;
}

function ownerHeaders(extra?: Record<string, string>) {
  return {
    "Content-Type": "application/json",
    "x-admin-user": "oauth-alert-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    ...(extra || {}),
  };
}

function auditorHeaders(extra?: Record<string, string>) {
  return ownerHeaders({
    "x-admin-user": "oauth-alert-auditor",
    "x-admin-role": "auditor",
    ...(extra || {}),
  });
}

function operatorHeaders(extra?: Record<string, string>) {
  return ownerHeaders({
    "x-admin-user": "oauth-alert-operator",
    "x-admin-role": "operator",
    ...(extra || {}),
  });
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function expectRejectedJsonWithTraceId(response: Response, expectedTraceId: string) {
  expect([401, 403]).toContain(response.status);
  expect(response.headers.get("x-request-id")).toBe(expectedTraceId);
  const payload = await response.json();
  expect(payload.error).toBe("权限不足");
  expect(payload.traceId).toBe(expectedTraceId);
  return payload;
}

async function expectJsonErrorWithTraceId(
  response: Response,
  expectedStatus: number,
  expectedTraceId: string,
) {
  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get("x-request-id")).toBe(expectedTraceId);
  const payload = await response.json();
  expect(typeof payload.error).toBe("string");
  expect(payload.traceId).toBe(expectedTraceId);
  return payload;
}

async function expectJsonTraceId(
  response: Response,
  expectedStatus: number,
  expectedTraceId: string,
) {
  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get("x-request-id")).toBe(expectedTraceId);
  const payload = await response.json();
  expect(payload.traceId).toBe(expectedTraceId);
  return payload;
}

async function countSuccessAuditEventsByTraceId(traceId: string) {
  const result = await db.execute(
    sql.raw(`
      SELECT COUNT(*)::int AS count
      FROM enterprise.audit_events
      WHERE trace_id = '${escapeSqlLiteral(traceId)}'
        AND result = 'success'
    `),
  );
  const rows =
    (result as unknown as {
      rows?: Array<{
        count: number | string;
      }>;
    }).rows || [];
  return Number(rows[0]?.count || 0);
}

async function readLatestAuditEventByTraceId(traceId: string) {
  const result = await db.execute(
    sql.raw(`
      SELECT actor, action, resource, resource_id, result, details, trace_id
      FROM enterprise.audit_events
      WHERE trace_id = '${escapeSqlLiteral(traceId)}'
      ORDER BY id DESC
      LIMIT 1
    `),
  );
  const rows =
    (result as unknown as {
      rows?: Array<{
        actor: string;
        action: string;
        resource: string;
        resource_id: string | null;
        result: string;
        details?: string | null;
        trace_id?: string | null;
      }>;
    }).rows || [];
  return rows[0] || null;
}

function parseAuditDetails(details?: string | null) {
  if (!details) return {};
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readMetricsText() {
  return register.metrics();
}

function expectMetricValue(metricsText: string, metricLine: string) {
  expect(metricsText).toContain(metricLine);
}

function expectMetricTimestamp(metricsText: string, metricName: string, operation: string) {
  expect(metricsText).toMatch(
    new RegExp(`${metricName}\\{operation="${operation}"\\} [1-9]\\d*(?:\\.\\d+)?`),
  );
}

async function ensureAlertRouteTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.system_logs (
        id serial PRIMARY KEY,
        timestamp text NOT NULL,
        level text NOT NULL,
        source text NOT NULL,
        message text NOT NULL
      )
    `),
  );
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
      CREATE TABLE IF NOT EXISTS enterprise.admin_roles (
        key text PRIMARY KEY,
        name text NOT NULL,
        permissions text NOT NULL,
        builtin integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.audit_events (
        id serial PRIMARY KEY,
        actor text NOT NULL DEFAULT 'system',
        action text NOT NULL,
        resource text NOT NULL,
        resource_id text,
        result text NOT NULL DEFAULT 'success',
        details text,
        ip text,
        user_agent text,
        trace_id text,
        created_at text NOT NULL
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_session_events (
        id serial PRIMARY KEY,
        state text NOT NULL,
        provider text NOT NULL,
        flow_type text NOT NULL,
        phase text NOT NULL,
        status text NOT NULL,
        event_type text NOT NULL,
        error text,
        created_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_configs (
        id serial PRIMARY KEY,
        enabled integer NOT NULL DEFAULT 1,
        warning_rate_threshold_bps integer NOT NULL DEFAULT 2000,
        warning_failure_count_threshold integer NOT NULL DEFAULT 10,
        critical_rate_threshold_bps integer NOT NULL DEFAULT 3500,
        critical_failure_count_threshold integer NOT NULL DEFAULT 20,
        recovery_rate_threshold_bps integer NOT NULL DEFAULT 1000,
        recovery_failure_count_threshold integer NOT NULL DEFAULT 5,
        dedupe_window_sec integer NOT NULL DEFAULT 600,
        recovery_consecutive_windows integer NOT NULL DEFAULT 2,
        window_size_sec integer NOT NULL DEFAULT 300,
        quiet_hours_enabled integer NOT NULL DEFAULT 0,
        quiet_hours_start text NOT NULL DEFAULT '00:00',
        quiet_hours_end text NOT NULL DEFAULT '00:00',
        quiet_hours_timezone text NOT NULL DEFAULT 'Asia/Shanghai',
        mute_providers text NOT NULL DEFAULT '[]',
        min_delivery_severity text NOT NULL DEFAULT 'warning',
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_events (
        id serial PRIMARY KEY,
        incident_id text NOT NULL,
        provider text NOT NULL,
        phase text NOT NULL,
        severity text NOT NULL,
        total_count integer NOT NULL,
        failure_count integer NOT NULL,
        failure_rate_bps integer NOT NULL,
        window_start bigint NOT NULL,
        window_end bigint NOT NULL,
        status_breakdown text,
        dedupe_key text NOT NULL,
        message text,
        created_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_deliveries (
        id serial PRIMARY KEY,
        event_id integer NOT NULL,
        incident_id text NOT NULL,
        channel text NOT NULL,
        target text,
        attempt integer NOT NULL DEFAULT 1,
        status text NOT NULL,
        response_status integer,
        response_body text,
        error text,
        sent_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_rule_versions (
        id serial PRIMARY KEY,
        version text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        description text,
        mute_windows text NOT NULL DEFAULT '[]',
        recovery_policy text NOT NULL DEFAULT '{}',
        created_by text,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL,
        activated_at bigint
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS oauth_alert_rule_versions_version_unique_idx
      ON core.oauth_alert_rule_versions (version)
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_rule_items (
        id serial PRIMARY KEY,
        version_id integer NOT NULL,
        rule_id text NOT NULL,
        name text NOT NULL,
        enabled integer NOT NULL DEFAULT 1,
        priority integer NOT NULL DEFAULT 100,
        all_conditions text NOT NULL DEFAULT '[]',
        any_conditions text NOT NULL DEFAULT '[]',
        actions text NOT NULL DEFAULT '[]',
        hit_count bigint NOT NULL DEFAULT 0,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_alertmanager_configs (
        id serial PRIMARY KEY,
        enabled integer NOT NULL DEFAULT 1,
        version integer NOT NULL DEFAULT 1,
        updated_by text NOT NULL DEFAULT 'system',
        comment text,
        config_json text NOT NULL DEFAULT '{}',
        warning_webhook_url text NOT NULL DEFAULT '',
        critical_webhook_url text NOT NULL DEFAULT '',
        p1_webhook_url text NOT NULL DEFAULT '',
        group_by text NOT NULL DEFAULT '["alertname","service","severity","provider"]',
        group_wait_sec integer NOT NULL DEFAULT 30,
        group_interval_sec integer NOT NULL DEFAULT 300,
        repeat_interval_sec integer NOT NULL DEFAULT 7200,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS core.oauth_alert_alertmanager_sync_histories (
        id serial PRIMARY KEY,
        config_id integer,
        status text NOT NULL,
        actor text NOT NULL DEFAULT 'system',
        outcome text NOT NULL DEFAULT 'success',
        reason text,
        trace_id text,
        runtime_json text NOT NULL DEFAULT '{}',
        webhook_targets text NOT NULL DEFAULT '[]',
        error text,
        rollback_error text,
        generated_path text,
        rollback_path text,
        details text,
        started_at bigint NOT NULL,
        finished_at bigint
      )
    `),
  );
}

async function resetAlertRouteTables() {
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_rule_items"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_rule_versions"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_alertmanager_sync_histories"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_alertmanager_configs"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_deliveries"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_events"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_configs"));
  await db.execute(sql.raw("DELETE FROM core.oauth_session_events"));
  await db.execute(sql.raw("DELETE FROM core.settings"));
  await db.execute(sql.raw("DELETE FROM enterprise.admin_roles"));
  await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));
}

async function seedRoles() {
  const nowIso = new Date().toISOString();
  await db.execute(
    sql.raw(`
      INSERT INTO enterprise.admin_roles (key, name, permissions, builtin, created_at, updated_at)
      VALUES
      ('owner', '所有者', '["admin.dashboard.read","admin.users.manage","admin.org.read","admin.org.manage","admin.rbac.manage","admin.tenants.manage","admin.oauth.manage","admin.billing.manage","admin.audit.read","admin.audit.write"]', 1, '${nowIso}', '${nowIso}'),
      ('auditor', '审计员', '["admin.dashboard.read","admin.audit.read","admin.org.read"]', 1, '${nowIso}', '${nowIso}')
    `),
  );
}

async function seedWindowSessionEvents(now: number) {
  const values: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    values.push(
      `('state-claude-error-${i}','claude','auth_code','error','error','mark_error','mock',${now - 60_000})`,
    );
  }
  for (let i = 0; i < 20; i += 1) {
    values.push(
      `('state-claude-ok-${i}','claude','auth_code','error','completed','complete',NULL,${now - 60_000})`,
    );
  }
  await db.execute(
    sql.raw(`
      INSERT INTO core.oauth_session_events
      (state, provider, flow_type, phase, status, event_type, error, created_at)
      VALUES ${values.join(",")}
    `),
  );
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;
const originalWebhookUrl = config.oauthAlerts.webhookUrl;
const originalWebhookSecret = config.oauthAlerts.webhookSecret;
const originalWecomUrl = config.oauthAlerts.wecomWebhookUrl;
const originalMentioned = [...config.oauthAlerts.wecomMentionedList];
const originalOAuthAlertCompatMode = process.env.OAUTH_ALERT_COMPAT_MODE;

describe("OAuth 告警路由", () => {
  beforeAll(async () => {
    await ensureAlertRouteTables();
  });

  beforeEach(async () => {
    await resetAlertRouteTables();
    await seedRoles();
    oauthAlertCompatRouteCounter.reset();
    alertmanagerControlOperationsCounter.reset();
    alertmanagerControlOperationDuration.reset();
    alertmanagerControlLastSuccessTimestampGauge.reset();
    delete process.env.OAUTH_ALERT_COMPAT_MODE;
    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
    config.oauthAlerts.webhookUrl = "";
    config.oauthAlerts.webhookSecret = "";
    config.oauthAlerts.wecomWebhookUrl = "";
    config.oauthAlerts.wecomMentionedList = [];
  });

  afterAll(async () => {
    await resetAlertRouteTables();
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
    config.oauthAlerts.webhookUrl = originalWebhookUrl;
    config.oauthAlerts.webhookSecret = originalWebhookSecret;
    config.oauthAlerts.wecomWebhookUrl = originalWecomUrl;
    config.oauthAlerts.wecomMentionedList = originalMentioned;
    if (originalOAuthAlertCompatMode === undefined) {
      delete process.env.OAUTH_ALERT_COMPAT_MODE;
    } else {
      process.env.OAUTH_ALERT_COMPAT_MODE = originalOAuthAlertCompatMode;
    }
  });

  it("GET/PUT 配置应支持读取与更新", async () => {
    const app = createAdminApp();

    const before = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(before.status).toBe(200);
    const beforePayload = await before.json();
    expect(beforePayload.data.warningRateThresholdBps).toBe(2000);

    const aliasBefore = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(aliasBefore.status).toBe(200);
    const aliasBeforePayload = await aliasBefore.json();
    expect(aliasBeforePayload.data).toEqual(beforePayload.data);

    const traceId = "trace-oauth-alert-config-put-success-001";
    const updated = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: ownerHeaders({ "x-request-id": traceId }),
        body: JSON.stringify({
          warningRateThresholdBps: 2500,
          warningFailureCountThreshold: 12,
          cooldownMinutes: 20,
        }),
      }),
    );
    expect(updated.status).toBe(200);
    expect(updated.headers.get("x-request-id")).toBe(traceId);
    const updatedPayload = await updated.json();
    expect(updatedPayload.success).toBe(true);
    expect(updatedPayload.traceId).toBe(traceId);
    expect(updatedPayload.data.warningRateThresholdBps).toBe(2500);
    expect(updatedPayload.data.warningFailureCountThreshold).toBe(12);
    expect(updatedPayload.data.dedupeWindowSec).toBe(1200);

    const aliasAfter = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(aliasAfter.status).toBe(200);
    const aliasAfterPayload = await aliasAfter.json();
    expect(aliasAfterPayload.data).toEqual(updatedPayload.data);
  });

  it("PUT 配置遇到非法 JSON 或非对象输入应返回 400，且不得回退到已保存配置", async () => {
    const app = createAdminApp();

    const initial = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(initial.status).toBe(200);
    const initialPayload = await initial.json();

    const validTraceId = "trace-oauth-alert-config-baseline-001";
    const valid = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: ownerHeaders({ "x-request-id": validTraceId }),
        body: JSON.stringify({
          warningRateThresholdBps: 2555,
        }),
      }),
    );
    expect(valid.status).toBe(200);
    expect(valid.headers.get("x-request-id")).toBe(validTraceId);
    const validPayload = await valid.json();
    expect(validPayload.success).toBe(true);
    expect(validPayload.traceId).toBe(validTraceId);
    expect(validPayload.data.warningRateThresholdBps).toBe(2555);

    const baseline = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(baseline.status).toBe(200);
    const baselinePayload = await baseline.json();
    expect(baselinePayload.data.warningRateThresholdBps).toBe(2555);

    const invalidJsonTraceId = "trace-oauth-alert-config-invalid-json-001";
    const invalidJson = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: ownerHeaders({ "x-request-id": invalidJsonTraceId }),
        body: "{\"warningRateThresholdBps\": 9999",
      }),
    );
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.headers.get("x-request-id")).toBe(invalidJsonTraceId);
    const invalidPayload = await invalidJson.json();
    expect(invalidPayload.error).toBe("OAuth 告警配置参数非法");
    expect(invalidPayload.traceId).toBe(invalidJsonTraceId);

    const nonObjectTraceId = "trace-oauth-alert-config-non-object-001";
    const nonObject = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: ownerHeaders({ "x-request-id": nonObjectTraceId }),
        body: "[]",
      }),
    );
    expect(nonObject.status).toBe(400);
    expect(nonObject.headers.get("x-request-id")).toBe(nonObjectTraceId);
    const nonObjectPayload = await nonObject.json();
    expect(nonObjectPayload.error).toBe("OAuth 告警配置参数非法");
    expect(nonObjectPayload.traceId).toBe(nonObjectTraceId);

    const after = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(after.status).toBe(200);
    const afterPayload = await after.json();
    expect(afterPayload.data).toEqual(baselinePayload.data);
    expect(afterPayload.data).not.toEqual(initialPayload.data);
  });

  it("OAuth 治理写接口成功应写入审计事件并返回 traceId", async () => {
    const app = createAdminApp();
    const cases = [
      {
        traceId: "trace-oauth-selection-policy-success-audit",
        endpoint: "http://localhost/api/admin/oauth/selection-policy",
        body: {
          defaultPolicy: "sticky_user",
          allowHeaderOverride: false,
          failureCooldownSec: 45,
          maxRetryOnAccountFailure: 2,
        },
        expectedAction: "oauth.selection.policy.update",
        expectedResource: "oauth.selection.policy",
        expectedResourceId: "active",
        assertPayload: (payload: any) => {
          expect(payload.success).toBe(true);
          expect(payload.data.defaultPolicy).toBe("sticky_user");
          expect(payload.data.failureCooldownSec).toBe(45);
        },
        assertAuditDetails: (details: Record<string, unknown>) => {
          expect(details.updatedFields).toEqual([
            "allowHeaderOverride",
            "defaultPolicy",
            "failureCooldownSec",
            "maxRetryOnAccountFailure",
          ]);
          const config = details.config as Record<string, unknown>;
          expect(config.defaultPolicy).toBe("sticky_user");
          expect(config.failureCooldownSec).toBe(45);
        },
      },
      {
        traceId: "trace-oauth-route-policies-success-audit",
        endpoint: "http://localhost/api/admin/oauth/route-policies",
        body: {
          selection: {
            defaultPolicy: "latest_valid",
            allowHeaderAccountOverride: true,
          },
          execution: {
            emitRouteHeaders: false,
            retryStatusCodes: [429, 503],
            claudeFallbackStatusCodes: [409, 429, 503],
          },
        },
        expectedAction: "oauth.route.policies.update",
        expectedResource: "oauth.route.policies",
        expectedResourceId: "active",
        assertPayload: (payload: any) => {
          expect(payload.success).toBe(true);
          expect(payload.data.selection.defaultPolicy).toBe("latest_valid");
          expect(payload.data.execution.emitRouteHeaders).toBe(false);
        },
        assertAuditDetails: (details: Record<string, unknown>) => {
          expect(details.updatedScopes).toEqual(["selection", "execution"]);
          const selection = details.selection as Record<string, unknown>;
          const execution = details.execution as Record<string, unknown>;
          expect(selection.defaultPolicy).toBe("latest_valid");
          expect(selection.allowHeaderAccountOverride).toBe(true);
          expect(execution.emitRouteHeaders).toBe(false);
        },
      },
      {
        traceId: "trace-oauth-capability-map-success-audit",
        endpoint: "http://localhost/api/admin/oauth/capability-map",
        body: {
          qwen: {
            flows: ["device_code"],
            supportsChat: true,
            supportsModelList: false,
            supportsStream: true,
            supportsManualCallback: false,
          },
        },
        expectedAction: "oauth.capability.map.update",
        expectedResource: "oauth.capability.map",
        expectedResourceId: "active",
        assertPayload: (payload: any) => {
          expect(payload.success).toBe(true);
          expect(payload.data.qwen.supportsModelList).toBe(false);
          expect(typeof payload.health.ok).toBe("boolean");
        },
        assertAuditDetails: (details: Record<string, unknown>) => {
          expect(details.updatedProviders).toEqual(["qwen"]);
          expect(Number(details.providerCount)).toBeGreaterThan(0);
        },
      },
      {
        traceId: "trace-oauth-model-alias-success-audit",
        endpoint: "http://localhost/api/admin/oauth/model-alias",
        body: {
          claude: {
            sonnet: "claude-3-7-sonnet",
          },
          "gpt-4o-mini": "gpt-4.1-mini",
        },
        expectedAction: "oauth.model.alias.update",
        expectedResource: "oauth.model.alias",
        expectedResourceId: "oauth_model_alias",
        assertPayload: (payload: any) => {
          expect(payload.success).toBe(true);
        },
        assertAuditDetails: (details: Record<string, unknown>) => {
          expect(details.payloadType).toBe("object");
          expect(details.keyCount).toBe(2);
          expect(details.keys).toEqual(["claude", "gpt-4o-mini"]);
        },
      },
      {
        traceId: "trace-oauth-excluded-models-success-audit",
        endpoint: "http://localhost/api/admin/oauth/excluded-models",
        body: ["claude:legacy-model", "gemini:test-model"],
        expectedAction: "oauth.excluded.models.update",
        expectedResource: "oauth.excluded.models",
        expectedResourceId: "oauth_excluded_models",
        assertPayload: (payload: any) => {
          expect(payload.success).toBe(true);
        },
        assertAuditDetails: (details: Record<string, unknown>) => {
          expect(details.payloadType).toBe("array");
          expect(details.itemCount).toBe(2);
        },
      },
    ];

    for (const testCase of cases) {
      const response = await app.fetch(
        new Request(testCase.endpoint, {
          method: "PUT",
          headers: ownerHeaders({ "x-request-id": testCase.traceId }),
          body: JSON.stringify(testCase.body),
        }),
      );

      const payload = await expectJsonTraceId(response, 200, testCase.traceId);
      testCase.assertPayload(payload);

      expect(await countSuccessAuditEventsByTraceId(testCase.traceId)).toBe(1);
      const audit = await readLatestAuditEventByTraceId(testCase.traceId);
      expect(audit?.actor).toBe("oauth-alert-owner");
      expect(audit?.action).toBe(testCase.expectedAction);
      expect(audit?.resource).toBe(testCase.expectedResource);
      expect(audit?.resource_id).toBe(testCase.expectedResourceId);
      expect(audit?.result).toBe("success");
      expect(audit?.trace_id).toBe(testCase.traceId);
      testCase.assertAuditDetails(parseAuditDetails(audit?.details));
    }
  });

  it("evaluate/incidents/deliveries 应联动可查询", async () => {
    const app = createAdminApp();
    const fixedNow = 1_776_100_520_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

    try {
      config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
      config.oauthAlerts.webhookSecret = "route-secret";

      await seedWindowSessionEvents(fixedNow);

      const evaluate = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/evaluate", {
          method: "POST",
          headers: ownerHeaders(),
        }),
      );
      expect(evaluate.status).toBe(200);
      const evalPayload = await evaluate.json();
      expect(evalPayload.success).toBe(true);
      expect(evalPayload.data.createdEvents).toBeGreaterThan(0);

      const incidents = await app.fetch(
        new Request(
          "http://localhost/api/admin/observability/oauth-alerts/incidents?provider=claude&page=1&pageSize=10",
          { headers: ownerHeaders() },
        ),
      );
      expect(incidents.status).toBe(200);
      const incidentsPayload = await incidents.json();
      expect(incidentsPayload.total).toBeGreaterThan(0);
      const firstEventId = incidentsPayload.data[0]?.id;
      const firstIncidentId = incidentsPayload.data[0]?.incidentId;
      expect(typeof firstEventId).toBe("number");
      expect(typeof firstIncidentId).toBe("string");
      expect(firstIncidentId.startsWith("incident:")).toBe(true);

      const incidentsAlias = await app.fetch(
        new Request(
          "http://localhost/api/admin/oauth/alerts/incidents?provider=claude&page=1&pageSize=10",
          { headers: ownerHeaders() },
        ),
      );
      expect(incidentsAlias.status).toBe(200);
      const incidentsAliasPayload = await incidentsAlias.json();
      expect(incidentsAliasPayload.total).toBe(incidentsPayload.total);
      expect(incidentsAliasPayload.data?.[0]?.id).toBe(firstEventId);

      const testDelivery = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/test-delivery", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ eventId: firstEventId }),
        }),
      );
      expect(testDelivery.status).toBe(200);
      const deliveryPayload = await testDelivery.json();
      expect(deliveryPayload.success).toBe(true);
      expect(deliveryPayload.data.summary.attemptedChannels).toBeGreaterThan(0);

      const deliveries = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/deliveries?eventId=${firstEventId}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(deliveries.status).toBe(200);
      const deliveriesPayload = await deliveries.json();
      expect(deliveriesPayload.total).toBeGreaterThan(0);
      expect(deliveriesPayload.data.every((item: { incidentId?: string }) => item.incidentId === firstIncidentId)).toBe(
        true,
      );

      const deliveriesByIncident = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/deliveries?incidentId=${encodeURIComponent(firstIncidentId)}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(deliveriesByIncident.status).toBe(200);
      const deliveriesByIncidentPayload = await deliveriesByIncident.json();
      expect(deliveriesByIncidentPayload.total).toBe(deliveriesPayload.total);

      const deliveriesByIntersection = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/deliveries?eventId=${firstEventId}&incidentId=${encodeURIComponent(firstIncidentId)}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(deliveriesByIntersection.status).toBe(200);
      const deliveriesByIntersectionPayload = await deliveriesByIntersection.json();
      expect(deliveriesByIntersectionPayload.total).toBe(deliveriesPayload.total);

      const deliveriesAlias = await app.fetch(
        new Request(
          `http://localhost/api/admin/oauth/alerts/deliveries?eventId=${firstEventId}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(deliveriesAlias.status).toBe(200);
      const deliveriesAliasPayload = await deliveriesAlias.json();
      expect(deliveriesAliasPayload.total).toBe(deliveriesPayload.total);
      expect(deliveriesAliasPayload.data?.[0]?.id).toBe(deliveriesPayload.data?.[0]?.id);
      expect(
        deliveriesAliasPayload.data.every(
          (item: { incidentId?: string }) => item.incidentId === firstIncidentId,
        ),
      ).toBe(true);

      const deliveriesCompatByIncident = await app.fetch(
        new Request(
          `http://localhost/api/admin/oauth/alerts/deliveries?incidentId=${encodeURIComponent(firstIncidentId)}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(deliveriesCompatByIncident.status).toBe(200);
      const deliveriesCompatByIncidentPayload = await deliveriesCompatByIncident.json();
      expect(deliveriesCompatByIncidentPayload.total).toBe(deliveriesPayload.total);
      expect(
        deliveriesCompatByIncidentPayload.data.every(
          (item: { incidentId?: string }) => item.incidentId === firstIncidentId,
        ),
      ).toBe(true);
    } finally {
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
    }
  });

  it("incidents/deliveries 过滤参数应稳定生效（含兼容路径与 status 别名）", async () => {
    const app = createAdminApp();
    const fixedNow = 1_776_100_520_000;
    const originalNow = Date.now;
    Date.now = () => fixedNow;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

    try {
      config.oauthAlerts.webhookUrl = "https://example.com/oauth-alert";
      config.oauthAlerts.webhookSecret = "route-secret";

      await seedWindowSessionEvents(fixedNow);

      const evaluate = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/evaluate", {
          method: "POST",
          headers: ownerHeaders(),
        }),
      );
      expect(evaluate.status).toBe(200);

      const incidents = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/incidents?provider=claude&phase=error&severity=critical&from=${
            encodeURIComponent(new Date(fixedNow - 1_000).toISOString())
          }&to=${encodeURIComponent(new Date(fixedNow + 1_000).toISOString())}&page=1&pageSize=10`,
          { headers: ownerHeaders() },
        ),
      );
      expect(incidents.status).toBe(200);
      const incidentsPayload = await incidents.json();
      expect(incidentsPayload.total).toBe(1);
      expect(
        incidentsPayload.data.every(
          (item: { provider?: string; phase?: string; severity?: string; createdAt?: number }) =>
            item.provider === "claude" &&
            item.phase === "error" &&
            item.severity === "critical" &&
            item.createdAt === fixedNow,
        ),
      ).toBe(true);

      const compatIncidents = await app.fetch(
        new Request(
          `http://localhost/api/admin/oauth/alerts/incidents?provider=claude&phase=error&severity=critical&from=${
            encodeURIComponent(new Date(fixedNow - 1_000).toISOString())
          }&to=${encodeURIComponent(new Date(fixedNow + 1_000).toISOString())}&page=1&pageSize=10`,
          { headers: ownerHeaders() },
        ),
      );
      expect(compatIncidents.status).toBe(200);
      const compatIncidentsPayload = await compatIncidents.json();
      expect(compatIncidentsPayload.total).toBe(incidentsPayload.total);
      expect(compatIncidentsPayload.data?.[0]?.id).toBe(incidentsPayload.data?.[0]?.id);

      const eventId = incidentsPayload.data?.[0]?.id;
      const incidentId = incidentsPayload.data?.[0]?.incidentId;
      expect(typeof eventId).toBe("number");
      expect(typeof incidentId).toBe("string");

      const testDelivery = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/test-delivery", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ eventId }),
        }),
      );
      expect(testDelivery.status).toBe(200);

      await db.execute(
        sql.raw(`
          INSERT INTO core.oauth_alert_deliveries
          (event_id, incident_id, channel, target, attempt, status, response_status, response_body, error, sent_at)
          VALUES
          (${eventId}, '${incidentId}', 'wecom', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock', 9, 'failure', 502, '{"ok":false}', 'http_non_2xx', ${fixedNow + 1_000})
        `),
      );

      const deliveries = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/deliveries?eventId=${eventId}&provider=claude&phase=error&severity=critical&channel=webhook&status=sent&from=${
            encodeURIComponent(new Date(fixedNow - 1_000).toISOString())
          }&to=${encodeURIComponent(new Date(fixedNow + 2_000).toISOString())}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(deliveries.status).toBe(200);
      const deliveriesPayload = await deliveries.json();
      expect(deliveriesPayload.total).toBeGreaterThan(0);
      expect(
        deliveriesPayload.data.every(
          (item: {
            incidentId?: string;
            provider?: string;
            phase?: string;
            severity?: string;
            channel?: string;
            status?: string;
          }) =>
            item.incidentId === incidentId &&
            item.provider === "claude" &&
            item.phase === "error" &&
            item.severity === "critical" &&
            item.channel === "webhook" &&
            item.status === "success",
        ),
      ).toBe(true);

      const compatDeliveries = await app.fetch(
        new Request(
          `http://localhost/api/admin/oauth/alerts/deliveries?incidentId=${encodeURIComponent(incidentId)}&provider=claude&phase=error&severity=critical&channel=wecom&status=failed&from=${
            encodeURIComponent(new Date(fixedNow - 1_000).toISOString())
          }&to=${encodeURIComponent(new Date(fixedNow + 2_000).toISOString())}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(compatDeliveries.status).toBe(200);
      const compatDeliveriesPayload = await compatDeliveries.json();
      expect(compatDeliveriesPayload.total).toBe(1);
      expect(
        compatDeliveriesPayload.data.every(
          (item: {
            incidentId?: string;
            provider?: string;
            phase?: string;
            severity?: string;
            channel?: string;
            status?: string;
          }) =>
            item.incidentId === incidentId &&
            item.provider === "claude" &&
            item.phase === "error" &&
            item.severity === "critical" &&
            item.channel === "wecom" &&
            item.status === "failure",
        ),
      ).toBe(true);
    } finally {
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
    }
  });

  it("legacy incidentId 数据应支持 canonical 查询并返回 canonical incidentId", async () => {
    const app = createAdminApp();

    await db.execute(
      sql.raw(`
        INSERT INTO core.oauth_alert_events
          (id, incident_id, provider, phase, severity, total_count, failure_count, failure_rate_bps, window_start, window_end, status_breakdown, dedupe_key, message, created_at)
        VALUES
          (6101, 'claude:error:6101', 'claude', 'error', 'warning', 20, 10, 5000, 1776201100000, 1776201400000, '{"error":10,"completed":10}', 'legacy-route-6101', 'legacy route event', 1776201405000)
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO core.oauth_alert_deliveries
          (event_id, incident_id, channel, target, attempt, status, response_status, response_body, error, sent_at)
        VALUES
          (6101, 'legacy:6101', 'webhook', 'https://example.com/legacy-route', 1, 'failure', 502, '{"ok":false}', 'request_error', 1776201406000)
      `),
    );

    const incidents = await app.fetch(
      new Request(
        "http://localhost/api/admin/observability/oauth-alerts/incidents?provider=claude&page=1&pageSize=10",
        { headers: ownerHeaders() },
      ),
    );
    expect(incidents.status).toBe(200);
    const incidentsPayload = await incidents.json();
    const seededIncident = incidentsPayload.data.find((item: { id: number }) => item.id === 6101);
    expect(seededIncident?.incidentId).toBe("incident:claude:error:6101");

    for (const endpoint of [
      "http://localhost/api/admin/observability/oauth-alerts/deliveries",
      "http://localhost/api/admin/oauth/alerts/deliveries",
    ]) {
      const response = await app.fetch(
        new Request(
          `${endpoint}?incidentId=${encodeURIComponent("incident:claude:error:6101")}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.total).toBe(1);
      expect(payload.data[0]?.eventId).toBe(6101);
      expect(payload.data[0]?.incidentId).toBe("incident:claude:error:6101");
    }
  });

  it("test-delivery 传不存在 eventId 应返回 404（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/test-delivery",
        traceId: "trace-oauth-alert-test-delivery-missing-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alerts/test-delivery",
        traceId: "trace-oauth-alert-test-delivery-missing-compat",
      },
    ];

    for (const { endpoint, traceId } of cases) {
      const response = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": traceId }),
          body: JSON.stringify({ eventId: 999999 }),
        }),
      );
      const payload = await expectJsonErrorWithTraceId(response, 404, traceId);
      expect(String(payload.error || "")).toContain("eventId 不存在");
    }
  });

  it("legacy incidentId 应在 test-delivery 与 deliveries 查询面统一归一", async () => {
    const app = createAdminApp();
    await db.execute(
      sql.raw(`
        INSERT INTO core.oauth_alert_events
          (id, incident_id, provider, phase, severity, total_count, failure_count, failure_rate_bps, window_start, window_end, status_breakdown, dedupe_key, message, created_at)
        VALUES
          (4101, 'claude:error:4101', 'claude', 'error', 'warning', 50, 20, 4000, 1776100000000, 1776100300000, '{"error":20,"completed":30}', 'legacy-incident-4101', 'legacy incident test', 1776100305000)
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO core.oauth_alert_deliveries
          (event_id, incident_id, channel, target, attempt, status, sent_at)
        VALUES
          (4101, 'legacy:4101', 'webhook', 'https://example.com/legacy', 1, 'success', 1776100306000)
      `),
    );

    const testDelivery = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/test-delivery", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ eventId: 4101 }),
      }),
    );
    expect(testDelivery.status).toBe(200);
    const testDeliveryPayload = await testDelivery.json();
    expect(testDeliveryPayload.data?.summary?.attemptedChannels).toBe(0);
    expect(testDeliveryPayload.data?.event?.incidentId).toBe("incident:claude:error:4101");
    expect(
      testDeliveryPayload.data?.deliveries?.every(
        (item: { incidentId?: string }) => item.incidentId === "incident:claude:error:4101",
      ),
    ).toBe(true);

    const deliveriesByIncident = await app.fetch(
      new Request(
        `http://localhost/api/admin/observability/oauth-alerts/deliveries?incidentId=${encodeURIComponent("incident:claude:error:4101")}&page=1&pageSize=20`,
        { headers: ownerHeaders() },
      ),
    );
    expect(deliveriesByIncident.status).toBe(200);
    const deliveriesPayload = await deliveriesByIncident.json();
    expect(deliveriesPayload.total).toBe(1);
    expect(deliveriesPayload.data?.[0]?.incidentId).toBe("incident:claude:error:4101");
  });

  it("synthetic canonical incidentId 查询旧 deliveries 记录时也应命中并返回事件 canonical incidentId", async () => {
    const app = createAdminApp();
    await db.execute(
      sql.raw(`
        INSERT INTO core.oauth_alert_events
          (id, incident_id, provider, phase, severity, total_count, failure_count, failure_rate_bps, window_start, window_end, status_breakdown, dedupe_key, message, created_at)
        VALUES
          (4102, 'claude:error:4102', 'claude', 'error', 'critical', 40, 20, 5000, 1776100400000, 1776100700000, '{"error":20,"completed":20}', 'legacy-incident-4102', 'synthetic route incident test', 1776100705000)
      `),
    );
    await db.execute(
      sql.raw(`
        INSERT INTO core.oauth_alert_deliveries
          (event_id, incident_id, channel, target, attempt, status, sent_at)
        VALUES
          (4102, 'legacy:4102', 'wecom', 'https://example.com/legacy-synthetic', 1, 'failure', 1776100706000)
      `),
    );

    for (const endpoint of [
      "http://localhost/api/admin/observability/oauth-alerts/deliveries",
      "http://localhost/api/admin/oauth/alerts/deliveries",
    ]) {
      const response = await app.fetch(
        new Request(
          `${endpoint}?incidentId=${encodeURIComponent("incident:legacy:delivery:4102")}&page=1&pageSize=20`,
          { headers: ownerHeaders() },
        ),
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.total).toBe(1);
      expect(payload.data?.[0]?.eventId).toBe(4102);
      expect(payload.data?.[0]?.incidentId).toBe("incident:claude:error:4102");
    }
  });

  it("规则版本接口应支持创建/查询/回滚", async () => {
    const app = createAdminApp();

    const createResp = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          version: "route-v1",
          activate: true,
          description: "route test version",
          muteWindows: [
            {
              id: "route-mute-window",
              timezone: "UTC",
              start: "11:30",
              end: "11:40",
              weekdays: [4],
              severities: ["warning"],
            },
          ],
          recoveryPolicy: {
            consecutiveWindows: 4,
          },
          rules: [
            {
              ruleId: "suppress-claude",
              name: "suppress claude",
              enabled: true,
              priority: 100,
              allConditions: [{ field: "provider", op: "eq", value: "claude" }],
              anyConditions: [],
              actions: [{ type: "suppress" }],
            },
          ],
        }),
      }),
    );
    expect(createResp.status).toBe(200);
    const createdPayload = await createResp.json();
    expect(createdPayload.success).toBe(true);
    expect(Array.isArray(createdPayload.data?.muteWindows)).toBe(true);
    expect(createdPayload.data?.recoveryPolicy?.consecutiveWindows).toBe(4);
    const versionId = createdPayload.data?.id;
    expect(typeof versionId).toBe("number");

    const activeResp = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/active", {
        headers: ownerHeaders(),
      }),
    );
    expect(activeResp.status).toBe(200);
    const activePayload = await activeResp.json();
    expect(activePayload.data?.version).toBe("route-v1");

    const activeAliasResp = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/rules/active", {
        headers: ownerHeaders(),
      }),
    );
    expect(activeAliasResp.status).toBe(200);
    const activeAliasPayload = await activeAliasResp.json();
    expect(activeAliasPayload.data?.version).toBe("route-v1");
    expect(activeAliasPayload.data).toEqual(activePayload.data);

    const versionsByAuditor = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions?page=1&pageSize=10", {
        headers: auditorHeaders(),
      }),
    );
    expect(versionsByAuditor.status).toBe(200);
    const listPayload = await versionsByAuditor.json();
    expect(listPayload.total).toBeGreaterThan(0);

    const versionsAliasByAuditor = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/rules/versions?page=1&pageSize=10", {
        headers: auditorHeaders(),
      }),
    );
    expect(versionsAliasByAuditor.status).toBe(200);
    const aliasListPayload = await versionsAliasByAuditor.json();
    expect(aliasListPayload.total).toBe(listPayload.total);

    const rollbackResp = await app.fetch(
      new Request(
        `http://localhost/api/admin/observability/oauth-alerts/rules/versions/${versionId}/rollback`,
        {
          method: "POST",
          headers: ownerHeaders(),
        },
      ),
    );
    expect(rollbackResp.status).toBe(200);
    const rollbackPayload = await rollbackResp.json();
    expect(rollbackPayload.success).toBe(true);

    const rollbackAliasResp = await app.fetch(
      new Request(`http://localhost/api/admin/oauth/alerts/rules/versions/${versionId}/rollback`, {
        method: "POST",
        headers: ownerHeaders(),
      }),
    );
    expect(rollbackAliasResp.status).toBe(200);
    const rollbackAliasPayload = await rollbackAliasResp.json();
    expect(rollbackAliasPayload.success).toBe(true);
  });

  it("规则版本创建失败应区分 409 冲突与 500 内部错误", async () => {
    const app = createAdminApp();

    const createFirst = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          version: "route-dup-v1",
          activate: true,
          rules: [
            {
              ruleId: "emit-route-dup-1",
              name: "emit route dup 1",
              enabled: true,
              priority: 100,
              allConditions: [{ field: "provider", op: "eq", value: "claude" }],
              anyConditions: [],
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        }),
      }),
    );
    expect(createFirst.status).toBe(200);

    const createDup = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          version: "route-dup-v1",
          activate: true,
          rules: [
            {
              ruleId: "emit-route-dup-2",
              name: "emit route dup 2",
              enabled: true,
              priority: 200,
              allConditions: [{ field: "provider", op: "eq", value: "gemini" }],
              anyConditions: [],
              actions: [{ type: "emit", severity: "critical" }],
            },
          ],
        }),
      }),
    );
    expect(createDup.status).toBe(409);
    const conflictPayload = await createDup.json();
    expect(conflictPayload.code).toBe("oauth_alert_rule_version_already_exists");

    await db.execute(sql.raw("DROP TABLE IF EXISTS core.oauth_alert_rule_versions"));
    try {
      const createBroken = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({
            version: "route-broken-v1",
            activate: true,
            rules: [
              {
                ruleId: "emit-route-broken-1",
                name: "emit route broken 1",
                enabled: true,
                priority: 100,
                allConditions: [{ field: "provider", op: "eq", value: "claude" }],
                anyConditions: [],
                actions: [{ type: "emit", severity: "warning" }],
              },
            ],
          }),
        }),
      );
      expect(createBroken.status).toBe(500);
      const brokenPayload = await createBroken.json();
      expect(String(brokenPayload.error || "")).toContain("OAuth 告警规则版本失败");
    } finally {
      await ensureAlertRouteTables();
    }
  });

  it("规则版本创建 muteWindows 冲突应映射 409 并注入 traceId", async () => {
    const app = createAdminApp();
    const traceId = "route-mute-window-conflict-trace";

    const createConflict = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: ownerHeaders({ "x-request-id": traceId }),
        body: JSON.stringify({
          version: "route-mute-conflict-v1",
          activate: true,
          muteWindows: [
            {
              id: "mute-a",
              timezone: "UTC",
              start: "11:30",
              end: "11:40",
              weekdays: [1],
              severities: ["warning"],
            },
            {
              id: "mute-b",
              timezone: "UTC",
              start: "11:35",
              end: "11:45",
              weekdays: [1],
              severities: ["warning"],
            },
          ],
          rules: [
            {
              ruleId: "emit-route-mute-conflict",
              name: "emit route mute conflict",
              enabled: true,
              priority: 100,
              allConditions: [{ field: "provider", op: "eq", value: "claude" }],
              anyConditions: [],
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        }),
      }),
    );
    expect(createConflict.status).toBe(409);
    expect(createConflict.headers.get("x-request-id")).toBe(traceId);

    const payload = await createConflict.json();
    expect(payload.code).toBe("oauth_alert_rule_mute_window_conflict");
    expect(payload.traceId).toBe(traceId);
  });

  it("规则版本创建 409/500 分支应注入 traceId 并与 x-request-id 对齐", async () => {
    const app = createAdminApp();

    const createFirst = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          version: "route-trace-dup-v1",
          activate: true,
          rules: [
            {
              ruleId: "emit-route-trace-dup-1",
              name: "emit route trace dup 1",
              enabled: true,
              priority: 100,
              allConditions: [{ field: "provider", op: "eq", value: "claude" }],
              anyConditions: [],
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        }),
      }),
    );
    expect(createFirst.status).toBe(200);

    const conflictTraceId = "trace-oauth-alert-rule-create-conflict";
    const createDup = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: ownerHeaders({ "x-request-id": conflictTraceId }),
        body: JSON.stringify({
          version: "route-trace-dup-v1",
          activate: true,
          rules: [
            {
              ruleId: "emit-route-trace-dup-2",
              name: "emit route trace dup 2",
              enabled: true,
              priority: 200,
              allConditions: [{ field: "provider", op: "eq", value: "gemini" }],
              anyConditions: [],
              actions: [{ type: "emit", severity: "critical" }],
            },
          ],
        }),
      }),
    );
    const conflictPayload = await expectJsonErrorWithTraceId(createDup, 409, conflictTraceId);
    expect(conflictPayload.code).toBe("oauth_alert_rule_version_already_exists");

    await db.execute(sql.raw("DROP TABLE IF EXISTS core.oauth_alert_rule_versions"));
    try {
      const brokenTraceId = "trace-oauth-alert-rule-create-broken";
      const createBroken = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": brokenTraceId }),
          body: JSON.stringify({
            version: "route-trace-broken-v1",
            activate: true,
            rules: [
              {
                ruleId: "emit-route-trace-broken-1",
                name: "emit route trace broken 1",
                enabled: true,
                priority: 100,
                allConditions: [{ field: "provider", op: "eq", value: "claude" }],
                anyConditions: [],
                actions: [{ type: "emit", severity: "warning" }],
              },
            ],
          }),
        }),
      );
      const brokenPayload = await expectJsonErrorWithTraceId(createBroken, 500, brokenTraceId);
      expect(String(brokenPayload.error || "")).toContain("OAuth 告警规则版本");
    } finally {
      await ensureAlertRouteTables();
    }
  });

  it("规则版本创建非法输入应返回 400 并注入 traceId（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/rules/versions",
        traceId: "trace-oauth-alert-rule-create-invalid-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alerts/rules/versions",
        traceId: "trace-oauth-alert-rule-create-invalid-compat",
      },
    ];

    for (const { endpoint, traceId } of cases) {
      const invalidCreate = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": traceId }),
          body: JSON.stringify({
            version: `invalid-rule-${traceId}`,
            activate: true,
            rules: [
              {
                ruleId: "invalid rule id",
                name: "invalid rule",
                enabled: true,
                priority: 100,
                allConditions: [{ field: "provider", op: "eq", value: "claude" }],
                anyConditions: [],
                actions: [{ type: "emit", severity: "warning" }],
              },
            ],
          }),
        }),
      );
      const payload = await expectJsonTraceId(invalidCreate, 400, traceId);
      expect(payload.error).toBeDefined();
    }
  });

  it("规则版本创建 timezone / recoveryPolicy 非法时应返回 400 并注入 traceId（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/rules/versions",
        traceId: "trace-oauth-alert-rule-create-invalid-timezone",
        body: {
          version: "invalid-timezone-v1",
          activate: true,
          muteWindows: [
            {
              name: "invalid timezone",
              timezone: "Mars/Olympus",
              start: "08:00",
              end: "10:00",
            },
          ],
          rules: [
            {
              ruleId: "emit-invalid-timezone",
              name: "invalid timezone",
              enabled: true,
              priority: 100,
              allConditions: [{ field: "provider", op: "eq", value: "claude" }],
              anyConditions: [],
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        },
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alerts/rules/versions",
        traceId: "trace-oauth-alert-rule-create-invalid-recovery",
        body: {
          version: "invalid-recovery-v1",
          activate: true,
          recoveryPolicy: {
            consecutiveWindows: 0,
          },
          rules: [
            {
              ruleId: "emit-invalid-recovery",
              name: "invalid recovery",
              enabled: true,
              priority: 100,
              allConditions: [{ field: "provider", op: "eq", value: "claude" }],
              anyConditions: [],
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        },
      },
    ];

    for (const { endpoint, traceId, body } of cases) {
      const invalidCreate = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": traceId }),
          body: JSON.stringify(body),
        }),
      );
      const payload = await expectJsonTraceId(invalidCreate, 400, traceId);
      expect(payload.error).toBeDefined();
    }
  });

  it("规则版本回滚 versionId 非法应返回 400", async () => {
    const app = createAdminApp();
    const cases = ["not-a-number", "1.2", "1e3", "+1"];

    for (const versionId of cases) {
      const invalidRollback = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/rules/versions/${versionId}/rollback`,
          {
            method: "POST",
            headers: ownerHeaders(),
          },
        ),
      );
      expect(invalidRollback.status).toBe(400);
      const invalidPayload = await invalidRollback.json();
      expect(String(invalidPayload.error || "")).toContain("versionId 非法");
    }
  });

  it("规则版本回滚 versionId 不存在应返回 404", async () => {
    const app = createAdminApp();

    const missingRollback = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions/999999/rollback", {
        method: "POST",
        headers: ownerHeaders(),
      }),
    );
    expect(missingRollback.status).toBe(404);
    const missingPayload = await missingRollback.json();
    expect(String(missingPayload.error || "")).toContain("目标规则版本不存在");
  });

  it("Alertmanager sync 在无可同步配置时应返回 400", async () => {
    const app = createAdminApp();

    const syncWithoutConfig = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: "no-config" }),
      }),
    );
    expect(syncWithoutConfig.status).toBe(400);
    const payload = await syncWithoutConfig.json();
    expect(String(payload.error || "")).toContain("缺少可同步的 Alertmanager 配置");
  });

  it("Alertmanager sync 请求体字段超长或非法时应返回 400（含兼容路径）", async () => {
    const app = createAdminApp();
    const tooLongReason = "x".repeat(201);
    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync",
        traceIdPrefix: "trace-oauth-alertmanager-sync-invalid-body-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alertmanager/sync",
        traceIdPrefix: "trace-oauth-alertmanager-sync-invalid-body-compat",
      },
    ];

    for (const { endpoint, traceIdPrefix } of cases) {
      const overLimitResp = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": `${traceIdPrefix}-too-long` }),
          body: JSON.stringify({ reason: tooLongReason }),
        }),
      );
      const overLimitPayload = await expectJsonTraceId(
        overLimitResp,
        400,
        `${traceIdPrefix}-too-long`,
      );
      expect(overLimitPayload.error).toBeDefined();

      const invalidTypeResp = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": `${traceIdPrefix}-invalid-type` }),
          body: JSON.stringify({ reason: 123 }),
        }),
      );
      const invalidTypePayload = await expectJsonTraceId(
        invalidTypeResp,
        400,
        `${traceIdPrefix}-invalid-type`,
      );
      expect(invalidTypePayload.error).toBeDefined();
    }
  });

  it("Alertmanager sync 在无可同步配置时兼容路径也应返回 400", async () => {
    const app = createAdminApp();

    const syncWithoutConfig = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: "no-config-compat" }),
      }),
    );
    expect(syncWithoutConfig.status).toBe(400);
    const payload = await syncWithoutConfig.json();
    expect(String(payload.error || "")).toContain("缺少可同步的 Alertmanager 配置");
  });

  it("Alertmanager sync 400 分支应注入 traceId 并与 x-request-id 对齐", async () => {
    const app = createAdminApp();
    const traceId = "trace-oauth-alertmanager-sync-no-config";

    const syncWithoutConfig = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
        method: "POST",
        headers: ownerHeaders({ "x-request-id": traceId }),
        body: JSON.stringify({ reason: "trace-no-config" }),
      }),
    );
    const payload = await expectJsonErrorWithTraceId(syncWithoutConfig, 400, traceId);
    expect(String(payload.error || "")).toContain("缺少可同步的 Alertmanager 配置");
  });

  it("Alertmanager save 非法配置应返回 400 并注入 traceId（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/alertmanager/config",
        traceId: "trace-oauth-alertmanager-save-invalid-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alertmanager/config",
        traceId: "trace-oauth-alertmanager-save-invalid-compat",
      },
    ];

    for (const { endpoint, traceId } of cases) {
      const invalidSave = await app.fetch(
        new Request(endpoint, {
          method: "PUT",
          headers: ownerHeaders({ "x-request-id": traceId }),
          body: JSON.stringify({
            comment: "missing-config",
          }),
        }),
      );
      const payload = await expectJsonErrorWithTraceId(invalidSave, 400, traceId);
      expect(String(payload.error || "")).toContain("Alertmanager 配置参数非法");
    }
  });

  it("Alertmanager sync 显式非法 config 且已有已存配置时应返回 400，不得回退到已存配置（含兼容路径）", async () => {
    const app = createAdminApp();
    const saveResponse = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify({
          config: {
            route: {
              receiver: "warning-webhook",
              group_by: ["alertname", "severity", "provider"],
            },
            receivers: [
              {
                name: "warning-webhook",
                webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
              },
            ],
          },
        }),
      }),
    );
    expect(saveResponse.status).toBe(200);

    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync",
        traceId: "trace-oauth-alertmanager-sync-invalid-config-new",
        body: {
          reason: "invalid-config-should-not-fallback",
          config: {
            route: {
              receiver: 123,
            },
            receivers: [],
          },
        },
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alertmanager/sync",
        traceId: "trace-oauth-alertmanager-sync-invalid-config-compat",
        body: {
          reason: "invalid-config-should-not-fallback",
          config: {
            route: {
              receiver: 123,
            },
            receivers: [],
          },
        },
      },
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync",
        traceId: "trace-oauth-alertmanager-sync-invalid-top-level-config-new",
        body: {
          reason: "invalid-top-level-config-should-not-fallback",
          route: {},
          receivers: [{ name: "warning-webhook" }],
        },
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alertmanager/sync",
        traceId: "trace-oauth-alertmanager-sync-invalid-top-level-config-compat",
        body: {
          reason: "invalid-top-level-config-should-not-fallback",
          route: {},
          receivers: [{ name: "warning-webhook" }],
        },
      },
    ];

    for (const { endpoint, traceId, body } of cases) {
      const invalidSync = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": traceId }),
          body: JSON.stringify(body),
        }),
      );
      const payload = await expectJsonErrorWithTraceId(invalidSync, 400, traceId);
      expect(String(payload.error || "")).toContain("Alertmanager 配置参数非法");
    }
  });

  it("Alertmanager sync 失败（AlertmanagerSyncError）应映射为 500（含兼容路径）", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    const originalFetch = globalThis.fetch;
    let failNextReload = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/-/reload")) {
        if (failNextReload) {
          failNextReload = false;
          return new Response("reload failed", { status: 500 });
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-sync-error-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const cases = [
        {
          endpoint: "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync",
          traceId: "trace-oauth-alertmanager-sync-error-new",
        },
        {
          endpoint: "http://localhost/api/admin/oauth/alertmanager/sync",
          traceId: "trace-oauth-alertmanager-sync-error-compat",
        },
      ];

      for (const { endpoint, traceId } of cases) {
        failNextReload = true;
        const resp = await app.fetch(
          new Request(endpoint, {
            method: "POST",
            headers: ownerHeaders({ "x-request-id": traceId }),
            body: JSON.stringify({
              reason: `sync-error-${endpoint.includes("/api/admin/oauth/") ? "compat" : "new"}`,
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            }),
          }),
        );
        const payload = await expectJsonErrorWithTraceId(resp, 500, traceId);
        expect(String(payload.error || "")).toContain("Alertmanager 同步失败");
        expect(typeof payload.rollbackSucceeded).toBe("boolean");
      }
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
    }
  });

  it("Alertmanager 接口应支持 owner 写、auditor 读", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const getByAuditor = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          headers: auditorHeaders(),
        }),
      );
      expect(getByAuditor.status).toBe(200);

      const putByOwner = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders(),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(putByOwner.status).toBe(200);

      const putByAuditor = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: auditorHeaders(),
          body: JSON.stringify({
            config: {
              route: { receiver: "warning-webhook" },
              receivers: [],
            },
          }),
        }),
      );
      expect(putByAuditor.status).toBe(403);

      const syncByOwner = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "route-test" }),
        }),
      );
      expect(syncByOwner.status).toBe(200);
      const syncPayload = await syncByOwner.json();
      expect(syncPayload.success).toBe(true);
      expect(typeof syncPayload.traceId).toBe("string");
      expect(typeof syncPayload.data?.history?.id).toBe("string");

      const historyByAuditor = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history?limit=5", {
          headers: auditorHeaders(),
        }),
      );
      expect(historyByAuditor.status).toBe(200);
      const historyPayload = await historyByAuditor.json();
      expect(Array.isArray(historyPayload.data)).toBe(true);
      expect(historyPayload.data.length).toBeGreaterThan(0);
      expect(historyPayload.page).toBe(1);
      expect(historyPayload.pageSize).toBe(5);
      expect(historyPayload.total).toBeGreaterThan(0);
      expect(historyPayload.totalPages).toBeGreaterThan(0);
      const firstHistoryId = historyPayload.data[0]?.id;
      expect(typeof firstHistoryId).toBe("string");

      const rollbackByOwner = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${firstHistoryId}/rollback`,
          {
            method: "POST",
            headers: ownerHeaders(),
            body: JSON.stringify({
              reason: "route-rollback",
            }),
          },
        ),
      );
      expect(rollbackByOwner.status).toBe(200);
      const rollbackPayload = await rollbackByOwner.json();
      expect(rollbackPayload.success).toBe(true);
      expect(typeof rollbackPayload.traceId).toBe("string");
      expect(rollbackPayload.data?.sourceHistoryId).toBe(firstHistoryId);

      const rollbackByAuditor = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${firstHistoryId}/rollback`,
          {
            method: "POST",
            headers: auditorHeaders(),
            body: JSON.stringify({
              reason: "auditor-rollback",
            }),
          },
        ),
      );
      expect(rollbackByAuditor.status).toBe(403);

      const pagedHistory = await app.fetch(
        new Request(
          "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=2&pageSize=1",
          {
            headers: ownerHeaders(),
          },
        ),
      );
      expect(pagedHistory.status).toBe(200);
      const pagedPayload = await pagedHistory.json();
      expect(Array.isArray(pagedPayload.data)).toBe(true);
      expect(pagedPayload.page).toBe(2);
      expect(pagedPayload.pageSize).toBe(1);
      expect(pagedPayload.total).toBeGreaterThanOrEqual(2);
      expect(pagedPayload.totalPages).toBeGreaterThanOrEqual(2);

      const limitCompat = await app.fetch(
        new Request("http://localhost/api/admin/oauth/alertmanager/sync-history?limit=1", {
          headers: ownerHeaders(),
        }),
      );
      expect(limitCompat.status).toBe(200);
      const limitPayload = await limitCompat.json();
      expect(Array.isArray(limitPayload.data)).toBe(true);
      expect(limitPayload.data.length).toBe(1);
      expect(limitPayload.page).toBe(1);
      expect(limitPayload.pageSize).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
    }
  });

  it("Alertmanager 回滚 historyId 异常应区分 400 非法参数与 404 不存在", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-invalid-history-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const putByOwner = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders(),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(putByOwner.status).toBe(200);

      const syncByOwner = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "invalid-history-seed" }),
        }),
      );
      expect(syncByOwner.status).toBe(200);

      const invalidRollback = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/%20/rollback", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "invalid-history-id" }),
        }),
      );
      expect(invalidRollback.status).toBe(400);
      const invalidPayload = await invalidRollback.json();
      expect(String(invalidPayload.error || "")).toContain("historyId 非法");

      const missingRollback = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/not-exist-history-id/rollback", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "missing-history-id" }),
        }),
      );
      expect(missingRollback.status).toBe(404);
      const missingPayload = await missingRollback.json();
      expect(String(missingPayload.error || "")).toContain("不存在");
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
    }
  });

  it("Alertmanager 回滚 historyId 异常在兼容路径也应区分 400 非法参数与 404 不存在", async () => {
    const app = createAdminApp();

    const invalidTraceId = "trace-oauth-alertmanager-rollback-invalid-compat";
    const invalidRollback = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync-history/%20/rollback", {
        method: "POST",
        headers: ownerHeaders({ "x-request-id": invalidTraceId }),
        body: JSON.stringify({ reason: "invalid-history-id" }),
      }),
    );
    const invalidPayload = await expectJsonErrorWithTraceId(invalidRollback, 400, invalidTraceId);
    expect(String(invalidPayload.error || "")).toContain("historyId 非法");

    const missingTraceId = "trace-oauth-alertmanager-rollback-missing-compat";
    const missingRollback = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync-history/not-exist-history-id/rollback", {
        method: "POST",
        headers: ownerHeaders({ "x-request-id": missingTraceId }),
        body: JSON.stringify({ reason: "missing-history-id" }),
      }),
    );
    const missingPayload = await expectJsonErrorWithTraceId(missingRollback, 404, missingTraceId);
    expect(String(missingPayload.error || "")).toContain("不存在");
  });

  it("Alertmanager 回滚请求体字段超长或非法时应返回 400", async () => {
    const app = createAdminApp();
    const tooLongReason = "x".repeat(201);

    const overLimitResp = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/not-exist/rollback", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: tooLongReason }),
      }),
    );
    expect(overLimitResp.status).toBe(400);

    const invalidTypeResp = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/not-exist/rollback", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: 123 }),
      }),
    );
    expect(invalidTypeResp.status).toBe(400);
  });

  it("Alertmanager 回滚请求体字段超长或非法时兼容路径应返回 400", async () => {
    const app = createAdminApp();
    const tooLongReason = "x".repeat(201);

    const overLimitResp = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync-history/not-exist/rollback", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: tooLongReason }),
      }),
    );
    expect(overLimitResp.status).toBe(400);

    const invalidTypeResp = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync-history/not-exist/rollback", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: 123 }),
      }),
    );
    expect(invalidTypeResp.status).toBe(400);
  });

  it("Alertmanager rollback 的 400/404 分支应注入 traceId 并与 x-request-id 对齐", async () => {
    const app = createAdminApp();

    const invalidTraceId = "trace-oauth-alertmanager-rollback-invalid";
    const invalidRollback = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/%20/rollback", {
        method: "POST",
        headers: ownerHeaders({ "x-request-id": invalidTraceId }),
        body: JSON.stringify({ reason: "invalid-history-id-trace" }),
      }),
    );
    const invalidPayload = await expectJsonErrorWithTraceId(invalidRollback, 400, invalidTraceId);
    expect(String(invalidPayload.error || "")).toContain("historyId 非法");

    const missingTraceId = "trace-oauth-alertmanager-rollback-missing";
    const missingRollback = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/not-exist-history-id/rollback", {
        method: "POST",
        headers: ownerHeaders({ "x-request-id": missingTraceId }),
        body: JSON.stringify({ reason: "missing-history-id-trace" }),
      }),
    );
    const missingPayload = await expectJsonErrorWithTraceId(missingRollback, 404, missingTraceId);
    expect(String(missingPayload.error || "")).toContain("不存在");
  });

  it("Alertmanager sync-history 分页参数组合语义应稳定", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-pagination-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const putByOwner = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders(),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(putByOwner.status).toBe(200);

      for (const reason of ["pagination-1", "pagination-2", "pagination-3"]) {
        const syncByOwner = await app.fetch(
          new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
            method: "POST",
            headers: ownerHeaders(),
            body: JSON.stringify({ reason }),
          }),
        );
        expect(syncByOwner.status).toBe(200);
      }

      const limitOnlyResp = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history?limit=1", {
          headers: ownerHeaders(),
        }),
      );
      expect(limitOnlyResp.status).toBe(200);
      const limitOnlyPayload = await limitOnlyResp.json();
      expect(limitOnlyPayload.page).toBe(1);
      expect(limitOnlyPayload.pageSize).toBe(1);
      expect(limitOnlyPayload.data.length).toBe(1);

      const pageAndPageSizeResp = await app.fetch(
        new Request(
          "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=2&pageSize=1",
          {
            headers: ownerHeaders(),
          },
        ),
      );
      expect(pageAndPageSizeResp.status).toBe(200);
      const pageAndPageSizePayload = await pageAndPageSizeResp.json();
      expect(pageAndPageSizePayload.page).toBe(2);
      expect(pageAndPageSizePayload.pageSize).toBe(1);
      expect(pageAndPageSizePayload.data.length).toBe(1);
      expect(pageAndPageSizePayload.data[0]?.id).not.toBe(limitOnlyPayload.data[0]?.id);

      const limitWithPageAndPageSizeResp = await app.fetch(
        new Request(
          "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history?limit=1&page=1&pageSize=2",
          {
            headers: ownerHeaders(),
          },
        ),
      );
      expect(limitWithPageAndPageSizeResp.status).toBe(200);
      const limitWithPageAndPageSizePayload = await limitWithPageAndPageSizeResp.json();
      expect(limitWithPageAndPageSizePayload.page).toBe(1);
      expect(limitWithPageAndPageSizePayload.pageSize).toBe(2);
      expect(limitWithPageAndPageSizePayload.data.length).toBe(2);

      const pageWithLimitOnlyResp = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=2&limit=1", {
          headers: ownerHeaders(),
        }),
      );
      expect(pageWithLimitOnlyResp.status).toBe(200);
      const pageWithLimitOnlyPayload = await pageWithLimitOnlyResp.json();
      expect(pageWithLimitOnlyPayload.page).toBe(2);
      expect(pageWithLimitOnlyPayload.pageSize).toBe(20);
      expect(pageWithLimitOnlyPayload.data.length).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
    }
  });

  it("Alertmanager 同步并发冲突应返回 409", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    let releaseReload: () => void = () => {};
    const firstReloadBarrier = new Promise<void>((resolve) => {
      releaseReload = () => resolve();
    });
    let reloadCallCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/-/reload")) {
        reloadCallCount += 1;
        if (reloadCallCount === 1) {
          await firstReloadBarrier;
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-lock-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const putByOwner = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders(),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(putByOwner.status).toBe(200);

      const firstSyncPromise = app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "lock-first" }),
        }),
      );

      await Promise.resolve();

      const secondSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "lock-second" }),
        }),
      );

      expect(secondSync.status).toBe(409);
      const secondPayload = await secondSync.json();
      expect(secondPayload.code).toBe("alertmanager_sync_in_progress");

      releaseReload();
      const firstSync = await firstSyncPromise;
      expect(firstSync.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
      releaseReload();
    }
  });

  it("Alertmanager 兼容路径同步并发冲突应返回 409", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    let releaseReload: () => void = () => {};
    const firstReloadBarrier = new Promise<void>((resolve) => {
      releaseReload = () => resolve();
    });
    let reloadCallCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/-/reload")) {
        reloadCallCount += 1;
        if (reloadCallCount === 1) {
          await firstReloadBarrier;
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-lock-compat-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const firstSyncPromise = app.fetch(
        new Request("http://localhost/api/admin/oauth/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({
            reason: "lock-first-compat",
            route: {
              receiver: "warning-webhook",
              group_by: ["alertname", "severity", "provider"],
            },
            receivers: [
              {
                name: "warning-webhook",
                webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
              },
            ],
          }),
        }),
      );

      await Promise.resolve();

      const secondSync = await app.fetch(
        new Request("http://localhost/api/admin/oauth/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({
            reason: "lock-second-compat",
            route: {
              receiver: "warning-webhook",
              group_by: ["alertname", "severity", "provider"],
            },
            receivers: [
              {
                name: "warning-webhook",
                webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
              },
            ],
          }),
        }),
      );

      expect(secondSync.status).toBe(409);
      const secondPayload = await secondSync.json();
      expect(secondPayload.code).toBe("alertmanager_sync_in_progress");

      releaseReload();
      const firstSync = await firstSyncPromise;
      expect(firstSync.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
      releaseReload();
    }
  });

  it("Alertmanager rollback 触发同步失败（AlertmanagerSyncError）应映射为 500（含兼容路径）", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    const originalFetch = globalThis.fetch;
    let failNextReload = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/-/reload")) {
        if (failNextReload) {
          failNextReload = false;
          return new Response("reload failed", { status: 500 });
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-rollback-sync-error-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const seedSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({
            reason: "seed-rollback-sync-error",
            route: {
              receiver: "warning-webhook",
              group_by: ["alertname", "severity", "provider"],
            },
            receivers: [
              {
                name: "warning-webhook",
                webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
              },
            ],
          }),
        }),
      );
      expect(seedSync.status).toBe(200);
      const seedPayload = await seedSync.json();
      const historyId = seedPayload.data?.history?.id;
      expect(typeof historyId).toBe("string");

      const cases = [
        {
          endpoint: `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${historyId}/rollback`,
          traceId: "trace-oauth-alertmanager-rollback-sync-error-new",
        },
        {
          endpoint: `http://localhost/api/admin/oauth/alertmanager/sync-history/${historyId}/rollback`,
          traceId: "trace-oauth-alertmanager-rollback-sync-error-compat",
        },
      ];

      for (const { endpoint, traceId } of cases) {
        failNextReload = true;
        const resp = await app.fetch(
          new Request(endpoint, {
            method: "POST",
            headers: ownerHeaders({ "x-request-id": traceId }),
            body: JSON.stringify({ reason: "rollback-sync-error" }),
          }),
        );
        const payload = await expectJsonErrorWithTraceId(resp, 500, traceId);
        expect(typeof payload.rollbackSucceeded).toBe("boolean");
        expect(String(payload.error || "")).toContain("Alertmanager");
      }
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
    }
  });

  it("Alertmanager rollback 并发冲突应返回 409（含兼容路径）", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    let releaseReload: () => void = () => {};
    const rollbackReloadBarrier = new Promise<void>((resolve) => {
      releaseReload = () => resolve();
    });
    let reloadCallCount = 0;

    const originalFetch = globalThis.fetch;
    const okFetch = ((async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

    globalThis.fetch = okFetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-rollback-lock-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const seedSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({
            reason: "seed-rollback-lock",
            route: {
              receiver: "warning-webhook",
              group_by: ["alertname", "severity", "provider"],
            },
            receivers: [
              {
                name: "warning-webhook",
                webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
              },
            ],
          }),
        }),
      );
      expect(seedSync.status).toBe(200);
      const seedPayload = await seedSync.json();
      const historyId = seedPayload.data?.history?.id;
      expect(typeof historyId).toBe("string");

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/-/reload")) {
          reloadCallCount += 1;
          if (reloadCallCount === 1) {
            await rollbackReloadBarrier;
          }
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof globalThis.fetch;

      const rollbackNew = `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${historyId}/rollback`;
      const rollbackCompat = `http://localhost/api/admin/oauth/alertmanager/sync-history/${historyId}/rollback`;

      const firstRollbackPromise = app.fetch(
        new Request(rollbackNew, {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "lock-rollback-first" }),
        }),
      );

      await Promise.resolve();

      const secondRollbackNew = await app.fetch(
        new Request(rollbackNew, {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "lock-rollback-second-new" }),
        }),
      );
      expect(secondRollbackNew.status).toBe(409);
      const secondNewPayload = await secondRollbackNew.json();
      expect(secondNewPayload.code).toBe("alertmanager_sync_in_progress");

      const secondRollbackCompat = await app.fetch(
        new Request(rollbackCompat, {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "lock-rollback-second-compat" }),
        }),
      );
      expect(secondRollbackCompat.status).toBe(409);
      const secondCompatPayload = await secondRollbackCompat.json();
      expect(secondCompatPayload.code).toBe("alertmanager_sync_in_progress");

      releaseReload();
      const firstRollback = await firstRollbackPromise;
      expect(firstRollback.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
      releaseReload();
    }
  });

  it("Alertmanager sync/rollback 的 409 分支应注入 traceId 并与 x-request-id 对齐", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    let releaseReload: () => void = () => {};
    let reloadCallCount = 0;
    const originalFetch = globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-trace-lock-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      globalThis.fetch = ((async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

      const saved = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders(),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(saved.status).toBe(200);

      let reloadBarrier = new Promise<void>((resolve) => {
        releaseReload = () => resolve();
      });
      reloadCallCount = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/-/reload")) {
          reloadCallCount += 1;
          if (reloadCallCount === 1) {
            await reloadBarrier;
          }
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof globalThis.fetch;

      const firstSyncPromise = app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "trace-lock-sync-first" }),
        }),
      );

      await Promise.resolve();

      const syncTraceId = "trace-oauth-alertmanager-sync-conflict";
      const secondSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": syncTraceId }),
          body: JSON.stringify({ reason: "trace-lock-sync-second" }),
        }),
      );
      const syncPayload = await expectJsonErrorWithTraceId(secondSync, 409, syncTraceId);
      expect(syncPayload.code).toBe("alertmanager_sync_in_progress");

      releaseReload();
      const firstSync = await firstSyncPromise;
      expect(firstSync.status).toBe(200);
      const firstSyncPayload = await firstSync.json();
      const historyId = firstSyncPayload.data?.history?.id;
      expect(typeof historyId).toBe("string");

      reloadBarrier = new Promise<void>((resolve) => {
        releaseReload = () => resolve();
      });
      reloadCallCount = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/-/reload")) {
          reloadCallCount += 1;
          if (reloadCallCount === 1) {
            await reloadBarrier;
          }
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof globalThis.fetch;

      const firstRollbackPromise = app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${historyId}/rollback`,
          {
            method: "POST",
            headers: ownerHeaders(),
            body: JSON.stringify({ reason: "trace-lock-rollback-first" }),
          },
        ),
      );

      await Promise.resolve();

      const rollbackTraceId = "trace-oauth-alertmanager-rollback-conflict";
      const secondRollback = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${historyId}/rollback`,
          {
            method: "POST",
            headers: ownerHeaders({ "x-request-id": rollbackTraceId }),
            body: JSON.stringify({ reason: "trace-lock-rollback-second" }),
          },
        ),
      );
      const rollbackPayload = await expectJsonErrorWithTraceId(
        secondRollback,
        409,
        rollbackTraceId,
      );
      expect(rollbackPayload.code).toBe("alertmanager_sync_in_progress");

      releaseReload();
      const firstRollback = await firstRollbackPromise;
      expect(firstRollback.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
      releaseReload();
    }
  });

  it("Alertmanager sync/rollback 的 500 分支应注入 traceId，并暴露 rollbackError", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;

    const originalFetch = globalThis.fetch;
    let reloadCallCount = 0;
    let failReloadCalls = new Set<number>();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/-/reload")) {
        reloadCallCount += 1;
        if (failReloadCalls.has(reloadCallCount)) {
          return new Response(`reload failed #${reloadCallCount}`, { status: 500 });
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-route-trace-sync-error-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const saved = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders(),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(saved.status).toBe(200);

      reloadCallCount = 0;
      failReloadCalls = new Set();
      const seedSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: "trace-500-seed" }),
        }),
      );
      expect(seedSync.status).toBe(200);
      const seedPayload = await seedSync.json();
      const historyId = seedPayload.data?.history?.id;
      expect(typeof historyId).toBe("string");

      reloadCallCount = 0;
      failReloadCalls = new Set([1, 2]);
      const syncTraceId = "trace-oauth-alertmanager-sync-rollback-failed";
      const failedSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": syncTraceId }),
          body: JSON.stringify({ reason: "trace-500-sync" }),
        }),
      );
      const syncPayload = await expectJsonErrorWithTraceId(failedSync, 500, syncTraceId);
      expect(syncPayload.rollbackSucceeded).toBe(false);
      expect(String(syncPayload.rollbackError || "")).toContain("reload failed #2");
      expect(String(syncPayload.error || "")).toContain("Alertmanager");

      reloadCallCount = 0;
      failReloadCalls = new Set([1, 2]);
      const rollbackTraceId = "trace-oauth-alertmanager-rollback-rollback-failed";
      const failedRollback = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${historyId}/rollback`,
          {
            method: "POST",
            headers: ownerHeaders({ "x-request-id": rollbackTraceId }),
            body: JSON.stringify({ reason: "trace-500-rollback" }),
          },
        ),
      );
      const rollbackPayload = await expectJsonErrorWithTraceId(
        failedRollback,
        500,
        rollbackTraceId,
      );
      expect(rollbackPayload.rollbackSucceeded).toBe(false);
      expect(String(rollbackPayload.rollbackError || "")).toContain("reload failed #2");
      expect(String(rollbackPayload.error || "")).toContain("Alertmanager");
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
    }
  });

  it("Alertmanager 控制面成功路径应写入 Prometheus 指标", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-metrics-success-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      const saved = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-config-success" }),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(saved.status).toBe(200);

      const synced = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-sync-success" }),
          body: JSON.stringify({ reason: "metrics-success" }),
        }),
      );
      expect(synced.status).toBe(200);
      const syncPayload = await synced.json();
      const historyId = syncPayload.data?.history?.id;
      expect(typeof historyId).toBe("string");

      const rollback = await app.fetch(
        new Request(
          `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${historyId}/rollback`,
          {
            method: "POST",
            headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-rollback-success" }),
            body: JSON.stringify({ reason: "metrics-rollback" }),
          },
        ),
      );
      expect(rollback.status).toBe(200);

      const metricsText = await readMetricsText();
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="config_update",outcome="success"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="sync",outcome="success"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="rollback",outcome="success"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operation_duration_seconds_count{operation="config_update",outcome="success"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operation_duration_seconds_count{operation="sync",outcome="success"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operation_duration_seconds_count{operation="rollback",outcome="success"} 1',
      );
      expectMetricTimestamp(
        metricsText,
        "tokenpulse_alertmanager_control_last_success_timestamp_seconds",
        "sync",
      );
      expectMetricTimestamp(
        metricsText,
        "tokenpulse_alertmanager_control_last_success_timestamp_seconds",
        "rollback",
      );
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
    }
  });

  it("Alertmanager 控制面失败路径应写入 validation_error / bad_request / conflict / not_found / sync_error 指标", async () => {
    const app = createAdminApp();
    const originalReloadUrl = config.alertmanager.reloadUrl;
    const originalReadyUrl = config.alertmanager.readyUrl;
    const originalRuntimeDir = config.alertmanager.runtimeDir;
    const originalTimeoutMs = config.alertmanager.timeoutMs;
    const originalFetch = globalThis.fetch;

    let releaseReload: () => void = () => {};
    let reloadCallCount = 0;
    let failNextReload = false;

    try {
      config.alertmanager.reloadUrl = "http://127.0.0.1:19093/-/reload";
      config.alertmanager.readyUrl = "http://127.0.0.1:19093/-/ready";
      config.alertmanager.runtimeDir = `/tmp/tokenpulse-alertmanager-metrics-failure-${Date.now()}`;
      config.alertmanager.timeoutMs = 1000;

      globalThis.fetch = ((async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown) as typeof globalThis.fetch;

      const invalidConfig = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-config-invalid" }),
          body: JSON.stringify({
            config: {
              route: { receiver: "warning-webhook" },
              receivers: [],
            },
          }),
        }),
      );
      expect(invalidConfig.status).toBe(400);

      const missingSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-missing-sync" }),
          body: JSON.stringify({ reason: "missing-config" }),
        }),
      );
      expect(missingSync.status).toBe(400);

      const saved = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/config", {
          method: "PUT",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-seed-config" }),
          body: JSON.stringify({
            config: {
              route: {
                receiver: "warning-webhook",
                group_by: ["alertname", "severity", "provider"],
              },
              receivers: [
                {
                  name: "warning-webhook",
                  webhook_configs: [{ url: "https://example.com/webhooks/warning" }],
                },
              ],
            },
          }),
        }),
      );
      expect(saved.status).toBe(200);

      const reloadBarrier = new Promise<void>((resolve) => {
        releaseReload = () => resolve();
      });
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/-/reload")) {
          reloadCallCount += 1;
          if (failNextReload) {
            failNextReload = false;
            return new Response("reload failed", { status: 500 });
          }
          if (reloadCallCount === 1) {
            await reloadBarrier;
          }
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof globalThis.fetch;

      const firstSyncPromise = app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-sync-lock-first" }),
          body: JSON.stringify({ reason: "lock-first" }),
        }),
      );
      await Promise.resolve();

      const conflictSync = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-sync-lock-second" }),
          body: JSON.stringify({ reason: "lock-second" }),
        }),
      );
      expect(conflictSync.status).toBe(409);

      releaseReload();
      const firstSync = await firstSyncPromise;
      expect(firstSync.status).toBe(200);
      const firstSyncPayload = await firstSync.json();
      const historyId = firstSyncPayload.data?.history?.id;
      expect(typeof historyId).toBe("string");

      failNextReload = true;
      const syncError = await app.fetch(
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync", {
          method: "POST",
          headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-sync-error" }),
          body: JSON.stringify({ reason: "sync-error" }),
        }),
      );
      expect(syncError.status).toBe(500);

      const missingRollback = await app.fetch(
        new Request(
          "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/not-found-history/rollback",
          {
            method: "POST",
            headers: ownerHeaders({ "x-request-id": "trace-alertmanager-metrics-rollback-missing" }),
            body: JSON.stringify({ reason: "not-found" }),
          },
        ),
      );
      expect(missingRollback.status).toBe(404);

      const metricsText = await readMetricsText();
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="config_update",outcome="validation_error"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="sync",outcome="bad_request"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="sync",outcome="conflict"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="sync",outcome="sync_error"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operations_total{operation="rollback",outcome="not_found"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operation_duration_seconds_count{operation="sync",outcome="conflict"} 1',
      );
      expectMetricValue(
        metricsText,
        'tokenpulse_alertmanager_control_operation_duration_seconds_count{operation="sync",outcome="sync_error"} 1',
      );
    } finally {
      globalThis.fetch = originalFetch;
      config.alertmanager.reloadUrl = originalReloadUrl;
      config.alertmanager.readyUrl = originalReadyUrl;
      config.alertmanager.runtimeDir = originalRuntimeDir;
      config.alertmanager.timeoutMs = originalTimeoutMs;
      releaseReload();
    }
  });

  it("非法参数应返回 400", async () => {
    const app = createAdminApp();

    const invalidPage = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/incidents?page=0", {
        headers: ownerHeaders(),
      }),
    );
    expect(invalidPage.status).toBe(400);

    const invalidDelivery = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/test-delivery", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          totalCount: 10,
          failureCount: 20,
        }),
      }),
    );
    expect(invalidDelivery.status).toBe(400);

    const invalidQuietHours = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify({
          quietHoursStart: "25:99",
        }),
      }),
    );
    expect(invalidQuietHours.status).toBe(400);

    const invalidTimezone = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify({
          quietHoursTimezone: "Mars/Phobos",
        }),
      }),
    );
    expect(invalidTimezone.status).toBe(400);
  });

  it("incidents/deliveries 无匹配结果时应稳定返回空分页（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      "http://localhost/api/admin/observability/oauth-alerts/incidents?provider=missing-provider&page=1&pageSize=5",
      "http://localhost/api/admin/oauth/alerts/incidents?provider=missing-provider&page=1&pageSize=5",
      "http://localhost/api/admin/observability/oauth-alerts/deliveries?provider=missing-provider&page=1&pageSize=5",
      "http://localhost/api/admin/oauth/alerts/deliveries?provider=missing-provider&page=1&pageSize=5",
    ];

    for (const endpoint of cases) {
      const response = await app.fetch(
        new Request(endpoint, {
          headers: auditorHeaders(),
        }),
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.page).toBe(1);
      expect(payload.pageSize).toBe(5);
      expect(payload.total).toBe(0);
      expect(payload.totalPages).toBe(1);
      expect(payload.data).toEqual([]);
    }
  });

  it("incidents/deliveries 时间范围非法应返回 400（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      {
        endpoint:
          "http://localhost/api/admin/observability/oauth-alerts/incidents?from=2026-03-06T12:00:00Z&to=2026-03-06T11:00:00Z",
        traceId: "trace-oauth-alert-incidents-range-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alerts/incidents?from=not-a-date",
        traceId: "trace-oauth-alert-incidents-range-compat",
      },
      {
        endpoint:
          "http://localhost/api/admin/observability/oauth-alerts/deliveries?from=2026-03-06T12:00:00Z&to=2026-03-06T11:00:00Z",
        traceId: "trace-oauth-alert-deliveries-range-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alerts/deliveries?to=not-a-date",
        traceId: "trace-oauth-alert-deliveries-range-compat",
      },
    ];

    for (const { endpoint, traceId } of cases) {
      const response = await app.fetch(
        new Request(endpoint, {
          headers: ownerHeaders({ "x-request-id": traceId }),
        }),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("x-request-id")).toBe(traceId);
      const payload = await response.json();
      expect(payload.traceId).toBe(traceId);
      expect(payload.error).toBeTruthy();
    }
  });

  it("deliveries 传非法 incidentId 应返回 400（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/deliveries?incidentId=abc.def",
        traceId: "trace-oauth-alert-deliveries-incident-id-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alerts/deliveries?incidentId=bad%2Fvalue",
        traceId: "trace-oauth-alert-deliveries-incident-id-compat",
      },
    ];

    for (const { endpoint, traceId } of cases) {
      const response = await app.fetch(
        new Request(endpoint, {
          headers: ownerHeaders({ "x-request-id": traceId }),
        }),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("x-request-id")).toBe(traceId);
      const payload = await response.json();
      expect(payload.traceId).toBe(traceId);
      expect(payload.error).toBeTruthy();
    }
  });

  it("incidents 传非法 incidentId 应返回 400（含兼容路径）", async () => {
    const app = createAdminApp();
    const cases = [
      {
        endpoint: "http://localhost/api/admin/observability/oauth-alerts/incidents?incidentId=abc.def",
        traceId: "trace-oauth-alert-incidents-incident-id-new",
      },
      {
        endpoint: "http://localhost/api/admin/oauth/alerts/incidents?incidentId=bad%2Fvalue",
        traceId: "trace-oauth-alert-incidents-incident-id-compat",
      },
    ];

    for (const { endpoint, traceId } of cases) {
      const response = await app.fetch(
        new Request(endpoint, {
          headers: ownerHeaders({ "x-request-id": traceId }),
        }),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("x-request-id")).toBe(traceId);
      const payload = await response.json();
      expect(payload.traceId).toBe(traceId);
      expect(payload.error).toBeTruthy();
    }
  });

  it("兼容路径命中应写入 compat route Prometheus 计数器", async () => {
    const app = createAdminApp();

    const compatIncidents = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/incidents?page=1&pageSize=1", {
        headers: auditorHeaders({
          "x-request-id": "trace-oauth-alert-compat-incidents-hit",
        }),
      }),
    );
    expect(compatIncidents.status).toBe(200);

    const compatDeliveries = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/deliveries?page=1&pageSize=1", {
        headers: auditorHeaders({
          "x-request-id": "trace-oauth-alert-compat-deliveries-hit",
        }),
      }),
    );
    expect(compatDeliveries.status).toBe(200);

    const compatConfig = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/config", {
        headers: auditorHeaders({
          "x-request-id": "trace-oauth-alert-compat-config-hit",
        }),
      }),
    );
    expect(compatConfig.status).toBe(200);

    const compatRules = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/rules/active", {
        headers: auditorHeaders({
          "x-request-id": "trace-oauth-alert-compat-rules-hit",
        }),
      }),
    );
    expect(compatRules.status).toBe(200);

    const compatAlertmanager = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync-history?limit=1", {
        headers: auditorHeaders({
          "x-request-id": "trace-oauth-alert-compat-history-hit",
        }),
      }),
    );
    expect(compatAlertmanager.status).toBe(200);

    const compatEvaluate = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/evaluate", {
        method: "POST",
        headers: ownerHeaders({
          "x-request-id": "trace-oauth-alert-compat-evaluate-hit",
        }),
        body: JSON.stringify({}),
      }),
    );
    expect(compatEvaluate.status).toBe(200);

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="GET",route="oauth_alerts.incidents"} 1',
    );
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="GET",route="oauth_alerts.deliveries"} 1',
    );
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="GET",route="oauth_alerts.config"} 1',
    );
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="GET",route="oauth_alerts.rules_active"} 1',
    );
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="GET",route="oauth_alertmanager.sync_history"} 1',
    );
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="POST",route="oauth_alerts.evaluate"} 1',
    );
  });

  it("observe 模式下 compat 路径应追加弃用头与 successorPath", async () => {
    process.env.OAUTH_ALERT_COMPAT_MODE = "observe";
    const app = createAdminApp();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/config", {
        headers: auditorHeaders({
          "x-request-id": "trace-oauth-alert-compat-observe-config",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Sunset")).toBe("Wed, 01 Jul 2026 00:00:00 GMT");
    expect(response.headers.get("Link")).toBe(
      '</api/admin/observability/oauth-alerts/config>; rel="successor-version"',
    );

    const payload = await response.json();
    expect(payload.deprecated).toBe(true);
    expect(payload.successorPath).toBe("/api/admin/observability/oauth-alerts/config");
    expect(payload.data.warningRateThresholdBps).toBe(2000);
  });

  it("enforce 模式下 compat 路径应统一 410 且不产生业务副作用，同时保留计数器", async () => {
    process.env.OAUTH_ALERT_COMPAT_MODE = "enforce";
    const app = createAdminApp();

    const before = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(before.status).toBe(200);
    const beforePayload = await before.json();

    const blockedWrite = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/config", {
        method: "PUT",
        headers: ownerHeaders({
          "x-request-id": "trace-oauth-alert-compat-enforce-put-config",
        }),
        body: JSON.stringify({
          warningRateThresholdBps: 3333,
          warningFailureCountThreshold: 33,
        }),
      }),
    );
    expect(blockedWrite.status).toBe(410);
    expect(blockedWrite.headers.get("Deprecation")).toBe("true");
    expect(blockedWrite.headers.get("Sunset")).toBe("Wed, 01 Jul 2026 00:00:00 GMT");
    expect(blockedWrite.headers.get("Link")).toBe(
      '</api/admin/observability/oauth-alerts/config>; rel="successor-version"',
    );
    const blockedPayload = await blockedWrite.json();
    expect(blockedPayload.code).toBe("oauth_alert_compat_route_sunset");
    expect(blockedPayload.deprecated).toBe(true);
    expect(blockedPayload.successorPath).toBe("/api/admin/observability/oauth-alerts/config");
    expect(blockedPayload.deprecatedSince).toBe("2026-03-01");
    expect(blockedPayload.compatibilityWindowEnd).toBe("2026-06-30");
    expect(blockedPayload.criticalAfter).toBe("2026-07-01");

    const blockedRead = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/incidents?page=1&pageSize=1"),
    );
    expect(blockedRead.status).toBe(410);
    const blockedReadPayload = await blockedRead.json();
    expect(blockedReadPayload.code).toBe("oauth_alert_compat_route_sunset");
    expect(blockedReadPayload.successorPath).toBe(
      "/api/admin/observability/oauth-alerts/incidents",
    );

    const after = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(after.status).toBe(200);
    const afterPayload = await after.json();
    expect(afterPayload.data).toEqual(beforePayload.data);
    expect(afterPayload.data.warningRateThresholdBps).not.toBe(3333);
    expect(afterPayload.data.warningFailureCountThreshold).not.toBe(33);

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="PUT",route="oauth_alerts.config"} 1',
    );
    expect(metricsText).toContain(
      'tokenpulse_oauth_alert_compat_route_hits_total{method="GET",route="oauth_alerts.incidents"} 1',
    );
  });

  it("权限矩阵：auditor 仅可读，写入应拒绝并注入 traceId", async () => {
    const app = createAdminApp();

    const getConfig = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: auditorHeaders(),
      }),
    );
    expect(getConfig.status).toBe(200);

    const getAliasConfig = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/config", {
        headers: auditorHeaders(),
      }),
    );
    expect(getAliasConfig.status).toBe(200);

    const getIncidents = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/incidents?page=1&pageSize=10", {
        headers: auditorHeaders(),
      }),
    );
    expect(getIncidents.status).toBe(200);

    const getDeliveries = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/deliveries?page=1&pageSize=10", {
        headers: auditorHeaders(),
      }),
    );
    expect(getDeliveries.status).toBe(200);

    const getActiveRules = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/active", {
        headers: auditorHeaders(),
      }),
    );
    expect(getActiveRules.status).toBe(200);

    const tracePutConfig = "trace-oauth-alert-auditor-put-config";
    const putConfig = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: auditorHeaders({ "x-request-id": tracePutConfig }),
        body: JSON.stringify({ warningRateThresholdBps: 2100 }),
      }),
    );
    await expectRejectedJsonWithTraceId(putConfig, tracePutConfig);

    const traceEvaluate = "trace-oauth-alert-auditor-evaluate";
    const evaluate = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/evaluate", {
        method: "POST",
        headers: auditorHeaders({ "x-request-id": traceEvaluate }),
      }),
    );
    await expectRejectedJsonWithTraceId(evaluate, traceEvaluate);

    const traceCreateVersion = "trace-oauth-alert-auditor-create-version";
    const createVersion = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: auditorHeaders({ "x-request-id": traceCreateVersion }),
        body: JSON.stringify({
          version: "auditor-should-not-write",
          activate: true,
          rules: [
            {
              ruleId: "auditor-deny-rule",
              name: "auditor deny rule",
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        }),
      }),
    );
    await expectRejectedJsonWithTraceId(createVersion, traceCreateVersion);

    const traceRollback = "trace-oauth-alert-auditor-rollback";
    const rollback = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions/1/rollback", {
        method: "POST",
        headers: auditorHeaders({ "x-request-id": traceRollback }),
      }),
    );
    await expectRejectedJsonWithTraceId(rollback, traceRollback);
  });

  it("权限矩阵：operator 应被禁止（至少 rules/active 与写入）并注入 traceId", async () => {
    const app = createAdminApp();

    const traceActive = "trace-oauth-alert-operator-active";
    const active = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/active", {
        headers: operatorHeaders({ "x-request-id": traceActive }),
      }),
    );
    await expectRejectedJsonWithTraceId(active, traceActive);

    const traceActiveAlias = "trace-oauth-alert-operator-active-alias";
    const activeAlias = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/rules/active", {
        headers: operatorHeaders({ "x-request-id": traceActiveAlias }),
      }),
    );
    await expectRejectedJsonWithTraceId(activeAlias, traceActiveAlias);

    const tracePutConfig = "trace-oauth-alert-operator-put-config";
    const putConfig = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: operatorHeaders({ "x-request-id": tracePutConfig }),
        body: JSON.stringify({ warningRateThresholdBps: 2100 }),
      }),
    );
    await expectRejectedJsonWithTraceId(putConfig, tracePutConfig);

    const traceCreateVersion = "trace-oauth-alert-operator-create-version";
    const createVersion = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions", {
        method: "POST",
        headers: operatorHeaders({ "x-request-id": traceCreateVersion }),
        body: JSON.stringify({
          version: "operator-should-not-write",
          activate: true,
          rules: [
            {
              ruleId: "operator-deny-rule",
              name: "operator deny rule",
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        }),
      }),
    );
    await expectRejectedJsonWithTraceId(createVersion, traceCreateVersion);
  });

  it("依赖异常应返回 500", async () => {
    const app = createAdminApp();
    await db.execute(sql.raw("DROP TABLE IF EXISTS core.oauth_alert_deliveries"));

    const response = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/deliveries", {
        headers: ownerHeaders(),
      }),
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(String(payload.error || "")).toContain("查询失败");

    await ensureAlertRouteTables();
  });
});
