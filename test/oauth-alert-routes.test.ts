import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
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

async function expectRejectedJsonWithTraceId(response: Response, expectedTraceId: string) {
  expect([401, 403]).toContain(response.status);
  expect(response.headers.get("x-request-id")).toBe(expectedTraceId);
  const payload = await response.json();
  expect(payload.error).toBe("权限不足");
  expect(payload.traceId).toBe(expectedTraceId);
  return payload;
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

describe("OAuth 告警路由", () => {
  beforeAll(async () => {
    await ensureAlertRouteTables();
  });

  beforeEach(async () => {
    await resetAlertRouteTables();
    await seedRoles();
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

    const updated = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify({
          warningRateThresholdBps: 2500,
          warningFailureCountThreshold: 12,
          cooldownMinutes: 20,
        }),
      }),
    );
    expect(updated.status).toBe(200);
    const updatedPayload = await updated.json();
    expect(updatedPayload.success).toBe(true);
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
      expect(typeof firstEventId).toBe("number");

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
    } finally {
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
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

  it("规则版本回滚 versionId 非法应返回 400", async () => {
    const app = createAdminApp();

    const invalidRollback = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/rules/versions/not-a-number/rollback", {
        method: "POST",
        headers: ownerHeaders(),
      }),
    );
    expect(invalidRollback.status).toBe(400);
    const invalidPayload = await invalidRollback.json();
    expect(String(invalidPayload.error || "")).toContain("versionId 非法");
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
    const endpoints = [
      "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync",
      "http://localhost/api/admin/oauth/alertmanager/sync",
    ];

    for (const endpoint of endpoints) {
      const overLimitResp = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: tooLongReason }),
        }),
      );
      expect(overLimitResp.status).toBe(400);

      const invalidTypeResp = await app.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: ownerHeaders(),
          body: JSON.stringify({ reason: 123 }),
        }),
      );
      expect(invalidTypeResp.status).toBe(400);
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

      const endpoints = [
        "http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync",
        "http://localhost/api/admin/oauth/alertmanager/sync",
      ];

      for (const endpoint of endpoints) {
        failNextReload = true;
        const resp = await app.fetch(
          new Request(endpoint, {
            method: "POST",
            headers: ownerHeaders(),
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
        expect(resp.status).toBe(500);
        const payload = await resp.json();
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
        new Request("http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history?limit=1", {
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

    const invalidRollback = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync-history/%20/rollback", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: "invalid-history-id" }),
      }),
    );
    expect(invalidRollback.status).toBe(400);
    const invalidPayload = await invalidRollback.json();
    expect(String(invalidPayload.error || "")).toContain("historyId 非法");

    const missingRollback = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alertmanager/sync-history/not-exist-history-id/rollback", {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({ reason: "missing-history-id" }),
      }),
    );
    expect(missingRollback.status).toBe(404);
    const missingPayload = await missingRollback.json();
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

      const endpoints = [
        `http://localhost/api/admin/observability/oauth-alerts/alertmanager/sync-history/${historyId}/rollback`,
        `http://localhost/api/admin/oauth/alertmanager/sync-history/${historyId}/rollback`,
      ];

      for (const endpoint of endpoints) {
        failNextReload = true;
        const resp = await app.fetch(
          new Request(endpoint, {
            method: "POST",
            headers: ownerHeaders(),
            body: JSON.stringify({ reason: "rollback-sync-error" }),
          }),
        );
        expect(resp.status).toBe(500);
        const payload = await resp.json();
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
