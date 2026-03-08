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
const traceSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "AgentLedgerTraceSection.tsx"),
  "utf8",
);
const agentLedgerAdaptersSource = readFileSync(
  join(import.meta.dir, "enterpriseAgentLedgerAdapters.ts"),
  "utf8",
);
const oauthAlertAdaptersSource = readFileSync(
  join(import.meta.dir, "enterpriseOAuthAlertAdapters.ts"),
  "utf8",
);
const orgAdaptersSource = readFileSync(
  join(import.meta.dir, "enterpriseOrgAdapters.ts"),
  "utf8",
);
const controlEditorsSource = readFileSync(
  join(import.meta.dir, "enterpriseControlEditors.ts"),
  "utf8",
);
const pageUtilsSource = readFileSync(
  join(import.meta.dir, "enterprisePageUtils.ts"),
  "utf8",
);
const oauthModelGovernanceSectionSource = readFileSync(
  join(
    import.meta.dir,
    "..",
    "components",
    "enterprise",
    "OAuthModelGovernanceSection.tsx",
  ),
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
        "组织域基础接口不可用，面板已切换为只读降级。当前仅展示最近一次成功加载结果与本地概览，组织/项目创建删除、成员创建删除、成员组织调整、项目绑定增删已全部禁用。请恢复 /api/org/* 后点击“刷新组织域”重试。",
      overviewFallbackHint: "当前后端未提供 /api/org/overview，已降级为前端本地统计。",
      organizationWriteHint: "只读降级中：组织创建与删除已禁用。",
      projectWriteHint: "只读降级中：项目创建与删除已禁用。",
      memberBindingWriteHint: "只读降级中：成员创建删除、成员组织调整与项目绑定增删已禁用。",
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

  it("应将 AgentLedger 适配逻辑抽到独立模块，并由 EnterprisePage 只做接线", () => {
    expect(enterprisePageSource).toContain("./enterpriseAgentLedgerAdapters");
    expect(enterprisePageSource).not.toContain("const normalizeAgentLedgerOutboxItem =");
    expect(enterprisePageSource).not.toContain("const normalizeAgentLedgerTraceDrilldownResult =");
    expect(enterprisePageSource).not.toContain("const getAgentLedgerOutboxReasonLabel =");
    expect(agentLedgerAdaptersSource).toContain("export const normalizeAgentLedgerOutboxQueryResult");
    expect(agentLedgerAdaptersSource).toContain("export const normalizeAgentLedgerTraceDrilldownResult");
    expect(agentLedgerAdaptersSource).toContain("export const getAgentLedgerOutboxReasonLabel");
  });

  it("应将 OAuth 告警与 Alertmanager 适配逻辑抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseOAuthAlertAdapters");
    expect(enterprisePageSource).not.toContain("const normalizeOAuthAlertConfig =");
    expect(enterprisePageSource).not.toContain("const normalizeOAuthAlertIncidentResult =");
    expect(enterprisePageSource).not.toContain("const normalizeAlertmanagerStoredConfig =");
    expect(oauthAlertAdaptersSource).toContain("export const normalizeOAuthAlertConfig");
    expect(oauthAlertAdaptersSource).toContain("export const normalizeOAuthAlertDeliveryResult");
    expect(oauthAlertAdaptersSource).toContain("export const normalizeAlertmanagerStoredConfig");
    expect(oauthAlertAdaptersSource).toContain("export const renderAlertmanagerSyncSummary");
  });

  it("应将组织域适配与 mutation 刷新判断抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseOrgAdapters");
    expect(enterprisePageSource).not.toContain("const normalizeOrganizationItem =");
    expect(enterprisePageSource).not.toContain("const normalizeMemberBindingItem =");
    expect(enterprisePageSource).not.toContain("const normalizeOrgOverviewData =");
    expect(enterprisePageSource).not.toContain("const shouldRefreshOrgDomainAfterMutationError =");
    expect(orgAdaptersSource).toContain("export const normalizeOrganizationItem");
    expect(orgAdaptersSource).toContain("export const normalizeMemberBindingItem");
    expect(orgAdaptersSource).toContain("export const normalizeOrgOverviewData");
    expect(orgAdaptersSource).toContain("export const shouldRefreshOrgDomainAfterMutationError");
  });

  it("应将规则版本与 Alertmanager 结构化编辑逻辑抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseControlEditors");
    expect(enterprisePageSource).not.toContain("const normalizeOAuthAlertRuleStructuredDraft =");
    expect(enterprisePageSource).not.toContain("const buildStructuredOAuthAlertRulePayload =");
    expect(enterprisePageSource).not.toContain("const normalizeAlertmanagerStructuredDraft =");
    expect(enterprisePageSource).not.toContain("const buildStructuredAlertmanagerPayload =");
    expect(controlEditorsSource).toContain("export const normalizeOAuthAlertRuleStructuredDraft");
    expect(controlEditorsSource).toContain("export const buildStructuredOAuthAlertRulePayload");
    expect(controlEditorsSource).toContain("export const normalizeAlertmanagerStructuredDraft");
    expect(controlEditorsSource).toContain("export const buildStructuredAlertmanagerPayload");
  });

  it("应将通用 trace/时间/审计工具抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterprisePageUtils");
    expect(enterprisePageSource).not.toContain("const normalizeDateTimeParam =");
    expect(enterprisePageSource).not.toContain("const formatTraceableMessage =");
    expect(enterprisePageSource).not.toContain("const buildTraceableErrorMessage =");
    expect(enterprisePageSource).not.toContain("const formatOptionalDateTime =");
    expect(enterprisePageSource).not.toContain("const parseAuditDetails =");
    expect(pageUtilsSource).toContain("export const normalizeDateTimeParam");
    expect(pageUtilsSource).toContain("export const formatTraceableMessage");
    expect(pageUtilsSource).toContain("export const buildTraceableErrorMessage");
    expect(pageUtilsSource).toContain("export const formatOptionalDateTime");
    expect(pageUtilsSource).toContain("export const parseAuditDetails");
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

  it("应新增 AgentLedger traceId 联查区块，并保持父组件持有状态、子组件仅接 props", () => {
    expect(enterprisePageSource).toContain("AgentLedgerTraceSection");
    expect(enterprisePageSource).toContain('sectionId="agentledger-trace-section"');
    expect(enterprisePageSource).toContain("const [agentLedgerTraceInput, setAgentLedgerTraceInput] = useState(\"\")");
    expect(enterprisePageSource).toContain("const [agentLedgerTraceHasQueried, setAgentLedgerTraceHasQueried] = useState(false)");
    expect(enterprisePageSource).toContain("const loadAgentLedgerTrace = async");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getAgentLedgerTrace(normalizedTraceId)");
    expect(enterprisePageSource).toContain("setAgentLedgerTraceAuditEvents(normalized.auditEvents);");
    expect(enterprisePageSource).toContain("setAgentLedgerTraceReadiness(normalized.readiness);");
    expect(enterprisePageSource).toContain("resetAgentLedgerTraceState({");
    expect(traceSectionSource).toContain("AgentLedger TraceId 联查");
    expect(traceSectionSource).toContain("平台审计事件");
    expect(traceSectionSource).toContain("Current State");
    expect(traceSectionSource).toContain("带入 Outbox 主区");
    expect(traceSectionSource).toContain("带入 Replay 主区");
    expect(traceSectionSource).toContain("AgentLedger Trace Crosscheck");
  });

  it("应将 OAuth 模型治理抽成独立组件，并保留模型别名与禁用模型操作", () => {
    expect(enterprisePageSource).toContain("OAuthModelGovernanceSection");
    expect(enterprisePageSource).toContain("onRefreshModelAlias={refreshModelAlias}");
    expect(enterprisePageSource).toContain("onRefreshExcludedModels={refreshExcludedModels}");
    expect(enterprisePageSource).toContain("onSaveModelAlias={saveModelAlias}");
    expect(enterprisePageSource).toContain("onSaveExcludedModels={saveExcludedModels}");
    expect(oauthModelGovernanceSectionSource).toContain("保存别名规则");
    expect(oauthModelGovernanceSectionSource).toContain("onSaveModelAlias");
    expect(oauthModelGovernanceSectionSource).toContain("保存禁用模型");
    expect(oauthModelGovernanceSectionSource).toContain("onSaveExcludedModels");
  });

  it("应将 OAuth 告警 deliveries 查询收口到 incidentId 主锚点，并仅保留 eventId 兼容筛选", () => {
    expect(enterprisePageSource).toContain('placeholder="incidentId（主锚点）"');
    expect(enterprisePageSource).toContain('placeholder="兼容 eventId（可选）"');
    expect(enterprisePageSource).toContain("const jumpToOAuthAlertDeliveriesByIncident = async");
    expect(enterprisePageSource).toContain('id="oauth-alert-deliveries-section"');
    expect(enterprisePageSource).toContain("查 deliveries");
    expect(enterprisePageSource).toContain("查审计");
    expect(enterprisePageSource).toContain("void jumpToOAuthAlertDeliveriesByIncident(item.incidentId);");
    expect(enterprisePageSource).toContain("void jumpToAuditByKeyword(item.incidentId);");
    expect(enterprisePageSource).not.toContain('placeholder="eventId"');
  });

  it("应为组织域组织、项目、成员绑定提供统一审计下钻入口", () => {
    expect(enterprisePageSource).toContain("const jumpToAuditByResource = async");
    expect(enterprisePageSource).toContain("const jumpToAuditByAction = async");
    expect(enterprisePageSource).toContain('id="audit-events-section"');
    expect(enterprisePageSource).toContain('resource: "organization"');
    expect(enterprisePageSource).toContain('resource: "project"');
    expect(enterprisePageSource).toContain('resource: "org_member"');
    expect(enterprisePageSource).toContain('resource: primaryProjectId ? "org_member_project" : "org_member"');
    expect(enterprisePageSource).toContain("查看审计");
    expect(enterprisePageSource).toContain("启停审计");
    expect(enterprisePageSource).toContain('action: "org.organization.update"');
    expect(enterprisePageSource).toContain('action: "org.project.update"');
  });

  it("应补齐组织域成员创建与删除入口，不再只停留在绑定编辑", () => {
    expect(enterprisePageSource).toContain("const [orgMemberCreateForm, setOrgMemberCreateForm] = useState(");
    expect(enterprisePageSource).toContain("const createOrgMember = async () => {");
    expect(enterprisePageSource).toContain("const removeOrgMember = async (member: OrgMemberBindingItem) => {");
    expect(enterprisePageSource).toContain("orgDomainClient.createMember({");
    expect(enterprisePageSource).toContain("orgDomainClient.deleteMember(member.memberId)");
    expect(enterprisePageSource).toContain("创建成员");
    expect(enterprisePageSource).toContain("删除成员");
  });

  it("应把组织与项目的 status 收口成最小启用/禁用控制，而不是只展示字段", () => {
    expect(enterprisePageSource).toContain("const toggleOrganizationStatus = async (organization: OrgOrganizationItem) => {");
    expect(enterprisePageSource).toContain("const toggleOrgProjectStatus = async (project: OrgProjectItem) => {");
    expect(enterprisePageSource).toContain("orgDomainClient.updateOrganization(organization.id, {");
    expect(enterprisePageSource).toContain("orgDomainClient.updateProject(project.id, {");
    expect(enterprisePageSource).toContain('{organization.status === "disabled" ? "启用" : "禁用"}');
    expect(enterprisePageSource).toContain('{project.status === "disabled" ? "启用" : "禁用"}');
    expect(enterprisePageSource).toContain("禁用后将阻止新增项目、成员和成员项目绑定");
    expect(enterprisePageSource).toContain("禁用后将阻止新增成员项目绑定");
    expect(enterprisePageSource).toContain('disabled={organization.status === "disabled"}');
    expect(enterprisePageSource).toContain('{organization.status === "disabled" ? " · disabled" : ""}');
    expect(enterprisePageSource).toContain('disabled={orgDomainWriteDisabled || project.status === "disabled"}');
    expect(enterprisePageSource).toContain('{project.status === "disabled" ? " · disabled" : ""}');
  });
});
