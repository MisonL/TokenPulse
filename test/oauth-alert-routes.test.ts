import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../src/config";
import { db } from "../src/db";
import enterprise from "../src/routes/enterprise";

function createAdminApp() {
  const app = new Hono();
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

function auditorHeaders() {
  return ownerHeaders({
    "x-admin-user": "oauth-alert-auditor",
    "x-admin-role": "auditor",
  });
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

    const alias = await app.fetch(
      new Request("http://localhost/api/admin/oauth/alerts/config", {
        headers: ownerHeaders(),
      }),
    );
    expect(alias.status).toBe(200);
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

  it("权限不足应返回 403", async () => {
    const app = createAdminApp();

    const response = await app.fetch(
      new Request("http://localhost/api/admin/observability/oauth-alerts/config", {
        headers: auditorHeaders(),
      }),
    );

    expect(response.status).toBe(403);
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
