import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  activateOAuthAlertRuleVersion,
  createOAuthAlertRuleVersion,
  evaluateOAuthAlertRuleDecision,
  getActiveOAuthAlertRuleVersion,
  isOAuthAlertRuleVersionMuteWindowActive,
  listOAuthAlertRuleVersions,
  OAUTH_ALERT_RULE_MUTE_WINDOW_CONFLICT_CODE,
  OAUTH_ALERT_RULE_VERSION_ALREADY_EXISTS_CODE,
  OAuthAlertRuleVersionConflictError,
  resolveOAuthAlertRuleRecoveryConsecutiveWindows,
} from "../src/lib/observability/oauth-alert-rules";

async function ensureRuleTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS core"));
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
}

async function resetRuleTables() {
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_rule_items"));
  await db.execute(sql.raw("DELETE FROM core.oauth_alert_rule_versions"));
}

describe("OAuth 告警规则引擎", () => {
  beforeAll(async () => {
    await ensureRuleTables();
  });

  beforeEach(async () => {
    await resetRuleTables();
  });

  afterAll(async () => {
    await resetRuleTables();
  });

  it("应支持版本创建、激活与回滚", async () => {
    const v1 = await createOAuthAlertRuleVersion({
      actor: "owner",
      payload: {
        version: "v1",
        activate: true,
        description: "首个版本",
        muteWindows: [
          {
            id: "weekday-mute",
            name: "工作日静默",
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
            ruleId: "emit-claude",
            name: "claude warning",
            priority: 100,
            allConditions: [{ field: "provider", op: "eq", value: "claude" }],
            anyConditions: [],
            enabled: true,
            actions: [{ type: "emit", severity: "warning" }],
          },
        ],
      },
    });
    expect(v1?.version).toBe("v1");
    expect(v1?.status).toBe("active");
    expect(v1?.muteWindows.length).toBe(1);
    expect(v1?.recoveryPolicy.consecutiveWindows).toBe(4);

    const v2 = await createOAuthAlertRuleVersion({
      actor: "owner",
      payload: {
        version: "v2",
        activate: false,
        description: "草稿",
        rules: [
          {
            ruleId: "emit-gemini",
            name: "gemini warning",
            priority: 100,
            allConditions: [{ field: "provider", op: "eq", value: "gemini" }],
            anyConditions: [],
            enabled: true,
            actions: [{ type: "emit", severity: "warning" }],
          },
        ],
      },
    });
    expect(v2?.status).toBe("draft");

    const rolled = await activateOAuthAlertRuleVersion(v2?.id || 0);
    expect(rolled?.version).toBe("v2");
    expect(rolled?.status).toBe("active");

    const active = await getActiveOAuthAlertRuleVersion();
    expect(active?.version).toBe("v2");

    const listed = await listOAuthAlertRuleVersions({ page: 1, pageSize: 10 });
    expect(listed.total).toBeGreaterThanOrEqual(2);
    expect(listed.data.some((item) => item.version === "v1")).toBe(true);
    expect(listed.data.some((item) => item.version === "v2")).toBe(true);
  });

  it("重复版本创建失败时不应清空已有 active 版本", async () => {
    const first = await createOAuthAlertRuleVersion({
      actor: "owner",
      payload: {
        version: "dup-v1",
        activate: true,
        rules: [
          {
            ruleId: "emit-dup-1",
            name: "dup 1",
            priority: 100,
            allConditions: [{ field: "provider", op: "eq", value: "claude" }],
            anyConditions: [],
            enabled: true,
            actions: [{ type: "emit", severity: "warning" }],
          },
        ],
      },
    });
    expect(first?.version).toBe("dup-v1");
    expect(first?.status).toBe("active");

    let conflictError: unknown = null;
    try {
      await createOAuthAlertRuleVersion({
        actor: "owner",
        payload: {
          version: "dup-v1",
          activate: true,
          rules: [
            {
              ruleId: "emit-dup-2",
              name: "dup 2",
              priority: 200,
              allConditions: [{ field: "provider", op: "eq", value: "gemini" }],
              anyConditions: [],
              enabled: true,
              actions: [{ type: "emit", severity: "critical" }],
            },
          ],
        },
      });
    } catch (error) {
      conflictError = error;
    }
    expect(conflictError).toBeInstanceOf(OAuthAlertRuleVersionConflictError);
    expect((conflictError as OAuthAlertRuleVersionConflictError).code).toBe(
      OAUTH_ALERT_RULE_VERSION_ALREADY_EXISTS_CODE,
    );

    const active = await getActiveOAuthAlertRuleVersion();
    expect(active?.version).toBe("dup-v1");
    expect(active?.status).toBe("active");

    const listed = await listOAuthAlertRuleVersions({ page: 1, pageSize: 10 });
    expect(listed.total).toBe(1);
    expect(listed.data.filter((item) => item.status === "active").length).toBe(1);
  });

  it("muteWindows 冲突时应拒绝创建", async () => {
    let conflictError: unknown = null;
    try {
      await createOAuthAlertRuleVersion({
        actor: "owner",
        payload: {
          version: "mute-conflict-v1",
          activate: true,
          muteWindows: [
            {
              id: "window-a",
              timezone: "Asia/Shanghai",
              start: "09:00",
              end: "10:30",
              weekdays: [1, 2],
              severities: ["warning"],
            },
            {
              id: "window-b",
              timezone: "Asia/Shanghai",
              start: "10:00",
              end: "11:00",
              weekdays: [2, 3],
              severities: ["warning", "critical"],
            },
          ],
          rules: [
            {
              ruleId: "emit-mute-conflict",
              name: "emit mute conflict",
              priority: 100,
              allConditions: [{ field: "provider", op: "eq", value: "claude" }],
              anyConditions: [],
              enabled: true,
              actions: [{ type: "emit", severity: "warning" }],
            },
          ],
        },
      });
    } catch (error) {
      conflictError = error;
    }

    expect(conflictError).toBeInstanceOf(OAuthAlertRuleVersionConflictError);
    expect((conflictError as OAuthAlertRuleVersionConflictError).code).toBe(
      OAUTH_ALERT_RULE_MUTE_WINDOW_CONFLICT_CODE,
    );

    const listed = await listOAuthAlertRuleVersions({ page: 1, pageSize: 10 });
    expect(listed.total).toBe(0);
  });

  it("同优先级应按 suppress > escalate > emit 决策", async () => {
    const version = await createOAuthAlertRuleVersion({
      actor: "owner",
      payload: {
        version: "decision-v1",
        activate: true,
        rules: [
          {
            ruleId: "emit-1",
            name: "emit",
            priority: 100,
            allConditions: [{ field: "provider", op: "eq", value: "claude" }],
            anyConditions: [],
            enabled: true,
            actions: [{ type: "emit", severity: "warning" }],
          },
          {
            ruleId: "suppress-1",
            name: "suppress",
            priority: 100,
            allConditions: [{ field: "provider", op: "eq", value: "claude" }],
            anyConditions: [],
            enabled: true,
            actions: [{ type: "suppress" }],
          },
        ],
      },
    });
    expect(version).not.toBeNull();

    const active = await getActiveOAuthAlertRuleVersion();
    const decision = await evaluateOAuthAlertRuleDecision({
      activeVersion: active,
      defaultSeverity: "warning",
      context: {
        provider: "claude",
        phase: "error",
        severity: "warning",
        failureRateBps: 2500,
        failureCount: 20,
        totalCount: 100,
        quietHours: false,
      },
    });

    expect(decision.action).toBe("suppress");
    expect(decision.severity).toBeNull();
    expect(decision.matched).toBe(true);
  });

  it("应支持规则升级与投递通道覆盖", async () => {
    const version = await createOAuthAlertRuleVersion({
      actor: "owner",
      payload: {
        version: "escalate-v1",
        activate: true,
        rules: [
          {
            ruleId: "critical-escalate",
            name: "高失败率升级",
            priority: 200,
            allConditions: [{ field: "failureRateBps", op: "gte", value: 3500 }],
            anyConditions: [],
            enabled: true,
            actions: [
              { type: "escalate", severity: "critical" },
              { type: "set_channel", channels: ["wecom"] },
            ],
          },
        ],
      },
    });
    expect(version).not.toBeNull();

    const active = await getActiveOAuthAlertRuleVersion();
    const decision = await evaluateOAuthAlertRuleDecision({
      activeVersion: active,
      defaultSeverity: "warning",
      context: {
        provider: "claude",
        phase: "error",
        severity: "warning",
        failureRateBps: 5000,
        failureCount: 50,
        totalCount: 100,
        quietHours: false,
      },
    });

    expect(decision.action).toBe("escalate");
    expect(decision.severity).toBe("critical");
    expect(decision.channels).toEqual(["wecom"]);
  });

  it("应支持规则版本静默窗口与恢复策略解析", async () => {
    const version = await createOAuthAlertRuleVersion({
      actor: "owner",
      payload: {
        version: "meta-v1",
        activate: true,
        muteWindows: [
          {
            id: "maintenance",
            timezone: "UTC",
            start: "11:30",
            end: "11:40",
            weekdays: [4],
            severities: ["warning"],
          },
        ],
        recoveryPolicy: {
          consecutiveWindows: 5,
        },
        rules: [
          {
            ruleId: "emit-meta",
            name: "emit meta",
            priority: 1,
            allConditions: [{ field: "provider", op: "eq", value: "claude" }],
            anyConditions: [],
            enabled: true,
            actions: [{ type: "emit", severity: "warning" }],
          },
        ],
      },
    });
    expect(version).not.toBeNull();

    const active = await getActiveOAuthAlertRuleVersion();
    expect(active?.version).toBe("meta-v1");
    expect(active?.muteWindows.length).toBe(1);
    expect(active?.recoveryPolicy.consecutiveWindows).toBe(5);

    const inWindow = isOAuthAlertRuleVersionMuteWindowActive({
      version: active,
      severity: "warning",
      nowMs: Date.parse("2026-03-05T11:35:00.000Z"),
    });
    const outWindowBySeverity = isOAuthAlertRuleVersionMuteWindowActive({
      version: active,
      severity: "critical",
      nowMs: Date.parse("2026-03-05T11:35:00.000Z"),
    });
    expect(inWindow).toBe(true);
    expect(outWindowBySeverity).toBe(false);

    const windows = resolveOAuthAlertRuleRecoveryConsecutiveWindows(active, 2);
    const fallbackWindows = resolveOAuthAlertRuleRecoveryConsecutiveWindows(null, 2);
    expect(windows).toBe(5);
    expect(fallbackWindows).toBe(2);
  });
});
