import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countModelAliasEntries,
  formatExcludedModelsEditorText,
  formatModelAliasEditorText,
  ORG_DOMAIN_API_CONTRACT_PATHS,
  parseExcludedModelsEditorText,
  parseModelAliasEditorText,
  resolveOrgDomainAvailabilityState,
  resolveOrgDomainPanelState,
} from "./enterpriseGovernance";

const enterprisePageSource = readFileSync(
  join(import.meta.dir, "EnterprisePage.tsx"),
  "utf8",
);
const replayAuditsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "AgentLedgerReplayAuditsSection.tsx"),
  "utf8",
);
const outboxSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "AgentLedgerOutboxSection.tsx"),
  "utf8",
);
const bootstrapSource = enterprisePageSource.slice(
  enterprisePageSource.indexOf("const bootstrap = async () => {"),
  enterprisePageSource.indexOf("const handleAdminLogin = async () => {"),
);

describe("EnterprisePage 治理辅助逻辑", () => {
  it("应格式化并校验模型别名规则", () => {
    const formatted = formatModelAliasEditorText({
      claude: {
        sonnet: "claude:claude-3-7-sonnet",
      },
      "gpt-4o-mini": "gpt-4.1-mini",
    });

    expect(formatted).toContain('"claude"');
    expect(formatted).toContain('"gpt-4o-mini"');
    expect(countModelAliasEntries(JSON.parse(formatted))).toBe(2);

    const parsed = parseModelAliasEditorText(formatted);
    expect(parsed).toEqual({
      ok: true,
      value: {
        claude: {
          sonnet: "claude:claude-3-7-sonnet",
        },
        "gpt-4o-mini": "gpt-4.1-mini",
      },
    });

    expect(parseModelAliasEditorText("[]")).toEqual({
      ok: false,
      error: "模型别名规则必须是 JSON 对象",
    });
  });

  it("应将禁用模型规则统一成逐行文本与去重数组", () => {
    const formatted = formatExcludedModelsEditorText({
      "codex:gpt-4.1": true,
      gemini: ["gemini-2.5-pro", "GEMINI-2.5-PRO"],
      "claude:legacy-model": "1",
    });

    expect(formatted).toBe(
      ["claude:legacy-model", "codex:gpt-4.1", "gemini:gemini-2.5-pro"].join("\n"),
    );
    expect(
      parseExcludedModelsEditorText("claude:legacy-model\n gemini:test-model \nCLAUDE:LEGACY-MODEL"),
    ).toEqual(["claude:legacy-model", "gemini:test-model"]);
  });

  it("应在组织域加载失败时切换到只读降级", () => {
    expect(resolveOrgDomainAvailabilityState({ loadFailed: false })).toEqual({
      apiAvailable: true,
      readOnlyFallback: false,
      reason: "ready",
    });
    expect(resolveOrgDomainAvailabilityState({ loadFailed: true })).toEqual({
      apiAvailable: false,
      readOnlyFallback: true,
      reason: "api_unavailable",
    });
  });

  it("应固定组织域真实契约路径，不再保留前端 fallback 探测", () => {
    expect(ORG_DOMAIN_API_CONTRACT_PATHS).toEqual([
      "/api/org/overview",
      "/api/org/organizations",
      "/api/org/projects",
      "/api/org/members",
      "/api/org/member-project-bindings",
    ]);
  });

  it("应在组织域只读降级时给出清晰的禁用提示", () => {
    expect(
      resolveOrgDomainPanelState({
        apiAvailable: false,
        readOnlyFallback: true,
        overviewApiAvailable: false,
      }),
    ).toEqual({
      summaryText:
        "组织域固定使用 /api/org/organizations、/api/org/projects、/api/org/members、/api/org/member-project-bindings 四个真实接口；前端不再探测历史兼容路径。",
      readOnlyBanner:
        "组织域基础接口不可用，面板已切换为只读降级。当前仅展示最近一次成功加载结果与本地概览，组织/项目创建删除、成员组织调整、项目绑定增删已全部禁用。请恢复 /api/org/* 后点击“刷新组织域”重试。",
      overviewFallbackHint: "当前后端未提供 /api/org/overview，已降级为前端本地统计。",
      organizationWriteHint: "只读降级中：组织创建与删除已禁用。",
      projectWriteHint: "只读降级中：项目创建与删除已禁用。",
      memberBindingWriteHint: "只读降级中：成员组织调整与项目绑定增删已禁用。",
    });
  });

  it("应将首屏 section 加载改为分组并发，不再串行 await 全部观测区", () => {
    expect(enterprisePageSource).toContain("const runBootstrapSectionTasks = async");
    expect(enterprisePageSource).toContain("const startBootstrapSectionLoads = () => {");
    expect(bootstrapSource).toContain("setLoading(false);");
    expect(bootstrapSource).toContain("startBootstrapSectionLoads();");
    expect(bootstrapSource).not.toContain("await loadOAuthAlertCenterConfig();");
    expect(bootstrapSource).not.toContain("await loadAgentLedgerOutbox(1);");
    expect(bootstrapSource).not.toContain("await loadFallbackSummary();");
  });

  it("应将 AgentLedger Replay Audits 抽成独立组件，并支持 outboxId 联查", () => {
    expect(enterprisePageSource).toContain("AgentLedgerReplayAuditsSection");
    expect(enterprisePageSource).toContain("jumpToAgentLedgerReplayAudits");
    expect(replayAuditsSectionSource).toContain("outboxIdFilter");
    expect(replayAuditsSectionSource).toContain("onOutboxIdFilterChange");
    expect(replayAuditsSectionSource).toContain("支持按 outboxId / traceId 联查");
  });

  it("应将 AgentLedger Outbox 抽成独立组件，并保留按 outboxId 联查 replay 动作", () => {
    expect(enterprisePageSource).toContain("AgentLedgerOutboxSection");
    expect(enterprisePageSource).toContain(
      "shouldShowHealthSummary={shouldShowAgentLedgerOutboxHealthSummary}",
    );
    expect(enterprisePageSource).toContain("void jumpToAgentLedgerReplayAudits(options);");
    expect(enterprisePageSource).toContain(
      "attemptsOpenOutboxId={agentLedgerDeliveryAttemptsOpenOutboxId}",
    );
    expect(outboxSectionSource).toContain("onJumpToReplayAudits");
    expect(outboxSectionSource).toContain("attemptsOpenOutboxId");
    expect(outboxSectionSource).toContain("AgentLedger Outbox 健康摘要");
    expect(outboxSectionSource).toContain("Outbox #{item.id} Attempts Detail");
    expect(outboxSectionSource).toContain("批量 replay");
    expect(outboxSectionSource).toContain("按 outboxId 查 replay");
  });
});
