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
const alertmanagerControlSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "AlertmanagerControlSection.tsx"),
  "utf8",
);
const enterpriseAdminLoginSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "EnterpriseAdminLoginSection.tsx"),
  "utf8",
);
const enterpriseConsoleHeaderSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "EnterpriseConsoleHeader.tsx"),
  "utf8",
);
const enterpriseFeatureFlagsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "EnterpriseFeatureFlagsSection.tsx"),
  "utf8",
);
const enterpriseOrgDomainSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "EnterpriseOrgDomainSection.tsx"),
  "utf8",
);
const enterpriseRolesPermissionsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "EnterpriseRolesPermissionsSection.tsx"),
  "utf8",
);
const auditEventsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "AuditEventsSection.tsx"),
  "utf8",
);
const billingUsageSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "BillingUsageSection.tsx"),
  "utf8",
);
const routePoliciesSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "OAuthRoutePoliciesSection.tsx"),
  "utf8",
);
const capabilityHealthSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "CapabilityHealthSection.tsx"),
  "utf8",
);
const providerCapabilityMapSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "ProviderCapabilityMapSection.tsx"),
  "utf8",
);
const fallbackSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "ClaudeFallbackSection.tsx"),
  "utf8",
);
const oauthAlertCenterSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "OAuthAlertCenterSection.tsx"),
  "utf8",
);
const oauthCallbackEventsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "OAuthCallbackEventsSection.tsx"),
  "utf8",
);
const oauthSessionEventsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "OAuthSessionEventsSection.tsx"),
  "utf8",
);
const quotaPoliciesSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "QuotaPoliciesSection.tsx"),
  "utf8",
);
const orgOrganizationsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "OrgOrganizationsSection.tsx"),
  "utf8",
);
const orgProjectsSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "OrgProjectsSection.tsx"),
  "utf8",
);
const orgMembersSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "OrgMembersSection.tsx"),
  "utf8",
);
const tenantManagementSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "TenantManagementSection.tsx"),
  "utf8",
);
const userManagementSectionSource = readFileSync(
  join(import.meta.dir, "..", "components", "enterprise", "UserManagementSection.tsx"),
  "utf8",
);
const agentLedgerAdaptersSource = readFileSync(
  join(import.meta.dir, "enterpriseAgentLedgerAdapters.ts"),
  "utf8",
);
const agentLedgerLoadersSource = readFileSync(
  join(import.meta.dir, "enterpriseAgentLedgerLoaders.ts"),
  "utf8",
);
const agentLedgerTraceControllerSource = readFileSync(
  join(import.meta.dir, "enterpriseAgentLedgerTraceController.ts"),
  "utf8",
);
const oauthAlertAdaptersSource = readFileSync(
  join(import.meta.dir, "enterpriseOAuthAlertAdapters.ts"),
  "utf8",
);
const fallbackLoadersSource = readFileSync(
  join(import.meta.dir, "enterpriseFallbackLoaders.ts"),
  "utf8",
);
const eventFiltersSource = readFileSync(
  join(import.meta.dir, "enterpriseEventFilters.ts"),
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
const queryBuildersSource = readFileSync(
  join(import.meta.dir, "enterpriseQueryBuilders.ts"),
  "utf8",
);
const policyValidatorsSource = readFileSync(
  join(import.meta.dir, "enterprisePolicyValidators.ts"),
  "utf8",
);
const policyEditorsSource = readFileSync(
  join(import.meta.dir, "enterprisePolicyEditors.ts"),
  "utf8",
);
const dangerousActionConfirmationsSource = readFileSync(
  join(import.meta.dir, "enterpriseDangerousActionConfirmations.ts"),
  "utf8",
);
const userBindingEditorsSource = readFileSync(
  join(import.meta.dir, "enterpriseUserBindingEditors.ts"),
  "utf8",
);
const adminMutationsSource = readFileSync(
  join(import.meta.dir, "enterpriseAdminMutations.ts"),
  "utf8",
);
const orgMutationsSource = readFileSync(
  join(import.meta.dir, "enterpriseOrgMutations.ts"),
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
const bootstrapSectionLoadsSource = enterprisePageSource.slice(
  enterprisePageSource.indexOf("const startBootstrapSectionLoads = () => {"),
  enterprisePageSource.indexOf("const bootstrap = async () => {"),
);
const oauthAlertConfigLoaderSource = enterprisePageSource.slice(
  enterprisePageSource.indexOf("const loadOAuthAlertCenterConfig = async () =>"),
  enterprisePageSource.indexOf("const loadOAuthAlertIncidents = async (page = 1) =>"),
);
const oauthAlertIncidentsLoaderSource = enterprisePageSource.slice(
  enterprisePageSource.indexOf("const loadOAuthAlertIncidents = async (page = 1) =>"),
  enterprisePageSource.indexOf("const loadOAuthAlertDeliveries = async (page = 1) =>"),
);
const oauthAlertDeliveriesLoaderSource = enterprisePageSource.slice(
  enterprisePageSource.indexOf("const loadOAuthAlertDeliveries = async (page = 1) =>"),
  enterprisePageSource.indexOf("const loadAlertmanagerConfig = async () =>"),
);
const alertmanagerConfigLoaderSource = enterprisePageSource.slice(
  enterprisePageSource.indexOf("const loadAlertmanagerConfig = async () =>"),
  enterprisePageSource.indexOf("const loadAlertmanagerSyncHistory = async (page = 1) =>"),
);
const alertmanagerHistoryLoaderSource = enterprisePageSource.slice(
  enterprisePageSource.indexOf("const loadAlertmanagerSyncHistory = async (page = 1) =>"),
  enterprisePageSource.indexOf("const loadOAuthAlertRuleActiveVersion = async () =>"),
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
        "组织域基础接口不可用，面板已切换为只读降级。当前组织域处于只读降级，写操作已禁用。当前仅展示最近一次成功加载结果与本地概览，组织/项目创建删除、成员创建删除、成员组织调整、项目绑定增删已全部禁用。请恢复 /api/org/* 后点击“刷新组织域”重试。",
      overviewFallbackHint: "当前后端未提供 /api/org/overview，已降级为前端本地统计。",
      organizationWriteHint: "只读降级中：组织创建与删除已禁用。",
      projectWriteHint: "只读降级中：项目创建与删除已禁用。",
      memberBindingWriteHint: "只读降级中：成员创建删除、成员组织调整与项目绑定增删已禁用。",
    });
  });

  it("组织域写操作应统一经由 write guard，并在加载中优先阻断", () => {
    expect(enterprisePageSource).toContain("const orgDomainWriteGuard = resolveOrgDomainWriteGuardState({");
    expect(enterprisePageSource).toContain("loading: orgLoading");
    expect(enterprisePageSource).toContain("readOnlyFallback: orgDomainReadOnlyFallback");
    expect(enterprisePageSource).toContain("const orgDomainWriteDisabled = orgDomainWriteGuard.blocked");
    expect(enterprisePageSource).toContain("if (!orgDomainWriteGuard.blocked) return true;");
    expect(enterprisePageSource).toContain("toast.error(orgDomainWriteGuard.message);");
    expect(orgAdaptersSource).toContain("export const resolveOrgDomainWriteGuardState");
    expect(orgAdaptersSource).toContain('reason: "loading"');
    expect(orgAdaptersSource).toContain("组织域正在加载，暂不允许写操作。");
    expect(orgAdaptersSource).toContain('reason: "read_only_fallback"');
    expect(orgAdaptersSource).toContain("当前组织域处于只读降级，写操作已禁用。");
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
    expect(enterprisePageSource).not.toContain("const buildOrgOverviewFallback =");
    expect(enterprisePageSource).not.toContain("const normalizeOrgOverviewData =");
    expect(enterprisePageSource).not.toContain("const shouldRefreshOrgDomainAfterMutationError =");
    expect(enterprisePageSource).not.toContain("const resolveOrganizationName =");
    expect(enterprisePageSource).not.toContain("const resolveProjectDisplay =");
    expect(enterprisePageSource).not.toContain("const resolveAdminUserLabel =");
    expect(enterprisePageSource).toContain("createOrgMemberEditForm({");
    expect(orgAdaptersSource).toContain("export const normalizeOrganizationItem");
    expect(orgAdaptersSource).toContain("export const normalizeMemberBindingItem");
    expect(orgAdaptersSource).toContain("export const buildOrgOverviewFallback");
    expect(orgAdaptersSource).toContain("export const normalizeOrgOverviewData");
    expect(orgAdaptersSource).toContain("export const shouldRefreshOrgDomainAfterMutationError");
    expect(orgAdaptersSource).toContain("export const createOrgMemberEditForm");
    expect(orgAdaptersSource).toContain("export const resolveOrganizationDisplayName");
    expect(orgAdaptersSource).toContain("export const resolveProjectDisplay");
    expect(orgAdaptersSource).toContain("export const resolveAdminUserLabel");
    expect(orgAdaptersSource).toContain("export const planOrgMemberBindingMutation");
    expect(orgAdaptersSource).toContain("export const resolveOrgDomainMutationErrorDecision");
    expect(orgAdaptersSource).toContain("export const resolveOrgDomainWriteGuardState");
    expect(orgAdaptersSource).toContain("export const resolveOrgMemberEditingState");
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
    expect(enterprisePageSource).not.toContain("const formatFlows =");
    expect(enterprisePageSource).not.toContain("const parseAuditDetails =");
    expect(pageUtilsSource).toContain("export const normalizeDateTimeParam");
    expect(pageUtilsSource).toContain("export const formatTraceableMessage");
    expect(pageUtilsSource).toContain("export const buildTraceableErrorMessage");
    expect(pageUtilsSource).toContain("export const formatOptionalDateTime");
    expect(pageUtilsSource).toContain("export const formatFlows");
    expect(pageUtilsSource).toContain("export const parseAuditDetails");
  });

  it("应将 AgentLedger 查询构建逻辑抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseQueryBuilders");
    expect(enterprisePageSource).not.toContain("const buildAgentLedgerOutboxBaseQuery =");
    expect(enterprisePageSource).not.toContain("const buildAgentLedgerReplayAuditBaseQuery =");
    expect(queryBuildersSource).toContain("export const buildAgentLedgerOutboxBaseQuery");
    expect(queryBuildersSource).toContain("export const buildAgentLedgerReplayAuditBaseQuery");
  });

  it("应将配额策略表单校验逻辑抽到独立模块", () => {
    expect(enterprisePageSource).not.toContain("const parseOptionalNonNegativeInteger =");
    expect(enterprisePageSource).not.toContain("const normalizePolicyScopeInput =");
    expect(policyValidatorsSource).toContain("export function parseOptionalNonNegativeInteger");
    expect(policyValidatorsSource).toContain("export function normalizePolicyScopeInput");
    expect(policyEditorsSource).toContain("normalizePolicyScopeInput");
    expect(policyEditorsSource).toContain("parseOptionalNonNegativeInteger");
  });

  it("应新增独立配额策略 payload helper，固定创建与编辑组装语义", () => {
    expect(enterprisePageSource).toContain("const createPolicy = async () => {");
    expect(enterprisePageSource).toContain("const savePolicyEdit = async (policy: QuotaPolicyItem) => {");
    expect(enterprisePageSource).toContain("setPolicyForm(resetEnterprisePolicyCreateForm())");
    expect(enterprisePageSource).toContain("buildRemovePolicyConfirmationMessage(policyId)");
    expect(enterprisePageSource).toContain("setPolicyEditForm(createEnterprisePolicyEditForm(policy))");
    expect(enterprisePageSource).toContain("setPolicyEditForm(resetEnterprisePolicyEditForm())");
    expect(enterprisePageSource).not.toContain("if (!confirm(`确认删除策略");
    expect(policyEditorsSource).toContain("export function buildQuotaPolicyCreatePayload");
    expect(policyEditorsSource).toContain("export function buildQuotaPolicyUpdatePayload");
    expect(policyEditorsSource).toContain("export function resetEnterprisePolicyCreateForm");
    expect(policyEditorsSource).toContain("export function resetEnterprisePolicyEditForm");
    expect(policyEditorsSource).toContain("export function createEnterprisePolicyEditForm");
    expect(policyEditorsSource).toContain("export function buildRemovePolicyConfirmationMessage");
    expect(policyEditorsSource).toContain("normalizePolicyScopeInput");
    expect(policyEditorsSource).toContain("parseOptionalNonNegativeInteger");
  });

  it("应将高风险运行操作确认文案抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseDangerousActionConfirmations");
    expect(enterprisePageSource).toContain(
      "confirm(buildRollbackOAuthAlertRuleVersionConfirmationMessage(item))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildRollbackAlertmanagerSyncHistoryConfirmationMessage(item))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildReplayAgentLedgerOutboxConfirmationMessage(item))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildReplayAgentLedgerOutboxBatchConfirmationMessage(selectedItems))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildEvaluateOAuthAlertsConfirmationMessage(oauthAlertEvaluateForm.provider))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildCreateOAuthAlertRuleVersionConfirmationMessage(payload))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildTriggerAlertmanagerSyncConfirmationMessage(alertmanagerConfig?.version))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildSaveOAuthAlertConfigConfirmationMessage())",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildSaveAlertmanagerConfigConfirmationMessage(alertmanagerConfig?.version))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildSaveRoutePoliciesConfirmationMessage(selectionPolicy.defaultPolicy))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildSaveCapabilityMapConfirmationMessage(Object.keys(parsed).length))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildSaveModelAliasConfirmationMessage(countModelAliasEntries(parsed.value)))",
    );
    expect(enterprisePageSource).toContain(
      "confirm(buildSaveExcludedModelsConfirmationMessage(excludedCount))",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildRollbackOAuthAlertRuleVersionConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildRollbackAlertmanagerSyncHistoryConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildReplayAgentLedgerOutboxConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildReplayAgentLedgerOutboxBatchConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildEvaluateOAuthAlertsConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildCreateOAuthAlertRuleVersionConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildTriggerAlertmanagerSyncConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildSaveOAuthAlertConfigConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildSaveAlertmanagerConfigConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildSaveRoutePoliciesConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildSaveCapabilityMapConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildSaveModelAliasConfirmationMessage",
    );
    expect(dangerousActionConfirmationsSource).toContain(
      "export function buildSaveExcludedModelsConfirmationMessage",
    );
  });

  it("应将关键 mutation 的响应解析收口到结构化 client facade", () => {
    expect(enterprisePageSource).toContain("enterpriseAdminClient.createUserResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.updateUserResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.createTenantResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.createPolicyResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.updateConfigResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.evaluateResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.updateAlertmanagerConfigResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.syncAlertmanagerConfigResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.replayAgentLedgerOutboxItemResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.replayAgentLedgerOutboxBatchResult(");
  });

  it("应将关键查询的响应解析收口到结构化 client facade", () => {
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getAdminSessionResult()");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listAuditEventsResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listCallbackEventsResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listSessionEventsResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listRolesResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listPermissionsResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getBillingQuotasResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getRoutePoliciesResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.getConfigResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.listIncidentsResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.listDeliveriesResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.getAlertmanagerConfigResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.listAlertmanagerSyncHistoryResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.getAlertRuleActiveResult(");
    expect(enterprisePageSource).toContain("oauthAlertCenterClient.listAlertRuleVersionsResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listBillingUsageResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getCapabilityHealthResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getCapabilityMapResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getModelAliasResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.getExcludedModelsResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listUsersResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listTenantsResult(");
    expect(enterprisePageSource).toContain("enterpriseAdminClient.listPoliciesResult(");
    expect(enterprisePageSource).toContain("createEnterpriseAgentLedgerLoaders({");
    expect(agentLedgerLoadersSource).toContain("enterpriseAdminClient.listAgentLedgerOutboxResult(");
    expect(agentLedgerLoadersSource).toContain(
      "enterpriseAdminClient.getAgentLedgerOutboxSummaryResult(",
    );
    expect(agentLedgerLoadersSource).toContain(
      "enterpriseAdminClient.getAgentLedgerOutboxReadinessResult(",
    );
    expect(agentLedgerLoadersSource).toContain("enterpriseAdminClient.getAgentLedgerOutboxHealthResult(");
    expect(agentLedgerLoadersSource).toContain(
      "enterpriseAdminClient.listAgentLedgerDeliveryAttemptsResult(",
    );
    expect(agentLedgerLoadersSource).toContain(
      "enterpriseAdminClient.getAgentLedgerDeliveryAttemptSummaryResult(",
    );
    expect(agentLedgerLoadersSource).toContain(
      "enterpriseAdminClient.listAgentLedgerReplayAuditsResult(",
    );
    expect(agentLedgerLoadersSource).toContain(
      "enterpriseAdminClient.getAgentLedgerReplayAuditSummaryResult(",
    );
    expect(agentLedgerTraceControllerSource).toContain(
      "enterpriseAdminClient.getAgentLedgerTraceResult(",
    );
    expect(enterprisePageSource).toContain("createEnterpriseFallbackLoaders({");
    expect(fallbackLoadersSource).toContain("enterpriseAdminClient.listClaudeFallbackEventsResult(");
    expect(fallbackLoadersSource).toContain("enterpriseAdminClient.getClaudeFallbackSummaryResult(");
    expect(fallbackLoadersSource).toContain(
      "enterpriseAdminClient.getClaudeFallbackTimeseriesResult(",
    );
  });

  it("应将用户绑定编辑 payload 构造抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseUserBindingEditors");
    expect(enterprisePageSource).toContain("buildAdminUserUpdatePayload(userEditForm)");
    expect(enterprisePageSource).toContain("createEnterpriseUserEditForm(user)");
    expect(enterprisePageSource).toContain("resetEnterpriseUserEditForm()");
    expect(userManagementSectionSource).toContain("value={editForm.displayName}");
    expect(userBindingEditorsSource).toContain("export const parseRoleBindingsText");
    expect(userBindingEditorsSource).toContain("export const parseTenantIdsText");
    expect(userBindingEditorsSource).toContain("export const createEnterpriseUserEditForm");
    expect(userBindingEditorsSource).toContain("export const resetEnterpriseUserEditForm");
    expect(userBindingEditorsSource).toContain("export const buildAdminUserUpdatePayload");
  });

  it("应将用户创建与租户管理 mutation helper 抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseAdminMutations");
    expect(enterprisePageSource).not.toContain("if (!userForm.username.trim() || !userForm.password.trim())");
    expect(enterprisePageSource).not.toContain("if (!tenantForm.name.trim())");
    expect(enterprisePageSource).toContain("buildAdminUserCreatePayload(userForm)");
    expect(enterprisePageSource).toContain("buildTenantCreatePayload(tenantForm)");
    expect(enterprisePageSource).toContain("buildRemoveUserConfirmationMessage(username)");
    expect(enterprisePageSource).toContain("buildRemoveTenantConfirmationMessage(tenantId)");
    expect(adminMutationsSource).toContain("export const buildAdminUserCreatePayload");
    expect(adminMutationsSource).toContain("export const buildTenantCreatePayload");
    expect(adminMutationsSource).toContain("export const buildRemoveUserConfirmationMessage");
    expect(adminMutationsSource).toContain("export const buildRemoveTenantConfirmationMessage");
  });

  it("应将组织域 mutation helper 抽到独立模块", () => {
    expect(enterprisePageSource).toContain("./enterpriseOrgMutations");
    expect(enterprisePageSource).not.toContain("if (!confirm(`确认删除组织");
    expect(enterprisePageSource).not.toContain("if (!confirm(`确认删除项目");
    expect(enterprisePageSource).not.toContain("if (!confirm(`确认删除成员");
    expect(enterprisePageSource).toContain("buildOrganizationCreatePayload(orgForm)");
    expect(enterprisePageSource).toContain("buildProjectCreatePayload(orgProjectForm)");
    expect(enterprisePageSource).toContain("buildMemberCreatePayload(orgMemberCreateForm, users)");
    expect(enterprisePageSource).toContain("buildRemoveOrganizationConfirmationMessage(organization)");
    expect(enterprisePageSource).toContain("buildToggleOrganizationStatusConfirmationMessage(organization)");
    expect(enterprisePageSource).toContain("buildRemoveProjectConfirmationMessage(project)");
    expect(enterprisePageSource).toContain("buildToggleProjectStatusConfirmationMessage(project)");
    expect(enterprisePageSource).toContain("buildRemoveMemberConfirmationMessage(member)");
    expect(orgMutationsSource).toContain("export const buildOrganizationCreatePayload");
    expect(orgMutationsSource).toContain("export const buildProjectCreatePayload");
    expect(orgMutationsSource).toContain("export const buildMemberCreatePayload");
    expect(orgMutationsSource).toContain("export const buildToggleOrganizationStatusConfirmationMessage");
    expect(orgMutationsSource).toContain("export const buildToggleProjectStatusConfirmationMessage");
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
    expect(enterprisePageSource).toContain("createEnterpriseAgentLedgerTraceController({");
    expect(agentLedgerTraceControllerSource).toContain("enterpriseAdminClient.getAgentLedgerTraceResult(normalizedTraceId)");
    expect(agentLedgerTraceControllerSource).toContain("setAuditEvents(normalized.auditEvents);");
    expect(agentLedgerTraceControllerSource).toContain("setReadiness(normalized.readiness);");
    expect(agentLedgerTraceControllerSource).toContain("const resetAgentLedgerTraceState = (options?: ResetTraceStateOptions) => {");
    expect(traceSectionSource).toContain("AgentLedger TraceId 联查");
    expect(traceSectionSource).toContain("平台审计事件");
    expect(traceSectionSource).toContain("Current State");
    expect(traceSectionSource).toContain("带入 Outbox 主区");
    expect(traceSectionSource).toContain("带入 Replay 主区");
    expect(traceSectionSource).toContain("AgentLedger Trace Crosscheck");
  });

  it("应将 Claude fallback 展示区抽成独立组件，并由页面仅保留筛选状态与查询接线", () => {
    expect(enterprisePageSource).toContain("ClaudeFallbackSection");
    expect(enterprisePageSource).toContain("createEnterpriseFallbackLoaders({");
    expect(enterprisePageSource).toContain("onApplyFilters={(page) => {");
    expect(fallbackSectionSource).toContain("Claude 回退事件");
    expect(fallbackSectionSource).toContain("回退趋势（{step}）");
    expect(fallbackSectionSource).toContain("onReasonFilterChange");
    expect(fallbackSectionSource).toContain("onApplyFilters");
    expect(fallbackSectionSource).toContain("暂无回退事件");
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

  it("应将治理控制面拆成独立 section 组件，并由页面保留保存与刷新动作", () => {
    expect(enterprisePageSource).toContain("OAuthRoutePoliciesSection");
    expect(enterprisePageSource).toContain("CapabilityHealthSection");
    expect(enterprisePageSource).toContain("ProviderCapabilityMapSection");
    expect(enterprisePageSource).toContain("void saveSelectionPolicy();");
    expect(enterprisePageSource).toContain("void refreshCapabilityHealth();");
    expect(enterprisePageSource).toContain("void refreshCapabilityMapFromServer();");
    expect(routePoliciesSectionSource).toContain("保存路由策略");
    expect(routePoliciesSectionSource).toContain("允许请求头覆盖策略");
    expect(capabilityHealthSectionSource).toContain("OAuth 能力健康状态");
    expect(capabilityHealthSectionSource).toContain("未发现能力图谱与运行时适配器不一致问题");
    expect(providerCapabilityMapSectionSource).toContain("Provider 能力图谱");
    expect(providerCapabilityMapSectionSource).toContain("从服务端刷新");
  });

  it("应将 OAuth 告警 deliveries 查询收口到 incidentId 主锚点，并仅保留 eventId 兼容筛选", () => {
    expect(enterprisePageSource).toContain("OAuthAlertCenterSection");
    expect(oauthAlertCenterSectionSource).toContain('placeholder="incidentId（主锚点）"');
    expect(oauthAlertCenterSectionSource).toContain('placeholder="兼容 eventId（可选）"');
    expect(enterprisePageSource).toContain("const jumpToOAuthAlertDeliveriesByIncident = async");
    expect(oauthAlertCenterSectionSource).toContain('id="oauth-alert-deliveries-section"');
    expect(oauthAlertCenterSectionSource).toContain("查 deliveries");
    expect(oauthAlertCenterSectionSource).toContain("查审计");
    expect(enterprisePageSource).not.toContain('placeholder="eventId"');
  });

  it("应将事件与审计区块拆成独立 section 组件，并由页面保留加载与导出动作", () => {
    expect(enterprisePageSource).toContain("OAuthSessionEventsSection");
    expect(enterprisePageSource).toContain("OAuthCallbackEventsSection");
    expect(enterprisePageSource).toContain("AuditEventsSection");
    expect(enterprisePageSource).toContain("BillingUsageSection");
    expect(enterprisePageSource).toContain("const exportSessionEvents = async () => {");
    expect(enterprisePageSource).toContain("const exportAuditEvents = async () => {");
    expect(enterprisePageSource).toContain("const changeAuditPage = async (page: number) => {");
    expect(enterprisePageSource).toContain("const changeUsagePage = async (page: number) => {");
    expect(oauthSessionEventsSectionSource).toContain("OAuth 会话事件");
    expect(oauthSessionEventsSectionSource).toContain("导出 CSV");
    expect(oauthCallbackEventsSectionSource).toContain("OAuth 回调事件");
    expect(auditEventsSectionSource).toContain("审计事件");
    expect(auditEventsSectionSource).toContain("查看策略用量");
    expect(billingUsageSectionSource).toContain("计费与配额");
    expect(billingUsageSectionSource).toContain("查询用量");
  });

  it("应将用户、租户与配额策略区块拆成独立 section 组件，并由页面保留 mutation 接线", () => {
    expect(enterprisePageSource).toContain("UserManagementSection");
    expect(enterprisePageSource).toContain("TenantManagementSection");
    expect(enterprisePageSource).toContain("QuotaPoliciesSection");
    expect(enterprisePageSource).toContain("void createUser();");
    expect(enterprisePageSource).toContain("void createTenant();");
    expect(enterprisePageSource).toContain("void createPolicy();");
    expect(enterprisePageSource).toContain("void saveUserEdit(userId);");
    expect(enterprisePageSource).toContain("void savePolicyEdit(policy);");
    expect(userManagementSectionSource).toContain("用户管理");
    expect(userManagementSectionSource).toContain("多角色绑定：role@tenant,role@tenant");
    expect(tenantManagementSectionSource).toContain("租户管理");
    expect(tenantManagementSectionSource).toContain("tenant.id === \"default\"");
    expect(quotaPoliciesSectionSource).toContain("配额策略管理");
    expect(quotaPoliciesSectionSource).toContain("scopeValue（global 必须留空）");
    expect(quotaPoliciesSectionSource).toContain("暂无配额策略");
  });

  it("应将企业页头部、管理员登录态、能力开关与组织域壳层拆成独立组件", () => {
    expect(enterprisePageSource).toContain("EnterpriseAdminLoginSection");
    expect(enterprisePageSource).toContain("EnterpriseConsoleHeader");
    expect(enterprisePageSource).toContain("EnterpriseFeatureFlagsSection");
    expect(enterprisePageSource).toContain("EnterpriseRolesPermissionsSection");
    expect(enterprisePageSource).toContain("EnterpriseOrgDomainSection");
    expect(enterprisePageSource).toContain("void handleAdminLogin();");
    expect(enterprisePageSource).toContain("void writeTestAuditEvent();");
    expect(enterprisePageSource).toContain("void handleAdminLogout();");
    expect(enterprisePageSource).toContain("void refreshOrgDomain();");
    expect(enterpriseAdminLoginSectionSource).toContain("管理员登录");
    expect(enterpriseAdminLoginSectionSource).toContain("登录管理员会话");
    expect(enterpriseConsoleHeaderSource).toContain("写入测试审计事件");
    expect(enterpriseConsoleHeaderSource).toContain("退出管理员");
    expect(enterpriseFeatureFlagsSectionSource).toContain("能力开关");
    expect(enterpriseRolesPermissionsSectionSource).toContain("角色与权限");
    expect(enterpriseRolesPermissionsSectionSource).toContain("权限词典");
    expect(enterpriseOrgDomainSectionSource).toContain("组织 / 项目 / 成员绑定");
    expect(enterpriseOrgDomainSectionSource).toContain("children");
  });

  it("应将 OAuth 告警中心与 Alertmanager 面板拆成独立 section 组件，并由页面保留副作用", () => {
    expect(enterprisePageSource).toContain("OAuthAlertCenterSection");
    expect(enterprisePageSource).toContain("AlertmanagerControlSection");
    expect(enterprisePageSource).toContain("const saveOAuthAlertConfig = async () => {");
    expect(enterprisePageSource).toContain("const evaluateOAuthAlertsManually = async () => {");
    expect(enterprisePageSource).toContain("const refreshOAuthAlertCenter = async () => {");
    expect(enterprisePageSource).toContain("const saveAlertmanagerConfig = async () => {");
    expect(enterprisePageSource).toContain("const triggerAlertmanagerSync = async () => {");
    expect(enterprisePageSource).toContain("const gotoAlertmanagerHistoryPage = async (page: number) => {");
    expect(oauthAlertCenterSectionSource).toContain("规则版本管理");
    expect(oauthAlertCenterSectionSource).toContain("执行手动评估");
    expect(oauthAlertCenterSectionSource).toContain("查 deliveries");
    expect(alertmanagerControlSectionSource).toContain("Alertmanager 同步");
    expect(alertmanagerControlSectionSource).toContain("执行同步");
    expect(alertmanagerControlSectionSource).toContain("结构化表单");
  });

  it("应将 OAuth Alert 配置、incidents、deliveries 作为独立 bootstrap section，避免单一失败连坐", () => {
    expect(bootstrapSectionLoadsSource).toContain('section: "oauthAlertConfig"');
    expect(bootstrapSectionLoadsSource).toContain(
      'tasks: [{ label: "OAuth 告警配置", run: () => loadOAuthAlertCenterConfig() }]',
    );
    expect(bootstrapSectionLoadsSource).toContain('section: "oauthAlertIncidents"');
    expect(bootstrapSectionLoadsSource).toContain(
      'tasks: [{ label: "OAuth 告警 incidents", run: () => loadOAuthAlertIncidents(1) }]',
    );
    expect(bootstrapSectionLoadsSource).toContain('section: "oauthAlertDeliveries"');
    expect(bootstrapSectionLoadsSource).toContain(
      'tasks: [{ label: "OAuth 告警 deliveries", run: () => loadOAuthAlertDeliveries(1) }]',
    );
  });

  it("OAuth Alert 各 loader 在 404/405 时应只降级本 section 数据，不误清空相邻结果", () => {
    expect(oauthAlertConfigLoaderSource).toContain("if (result.status === 404 || result.status === 405)");
    expect(oauthAlertConfigLoaderSource).toContain("setOAuthAlertCenterApiAvailable(false);");
    expect(oauthAlertConfigLoaderSource).toContain(
      "setOAuthAlertConfig(DEFAULT_OAUTH_ALERT_CENTER_CONFIG);",
    );
    expect(oauthAlertConfigLoaderSource).not.toContain("setOAuthAlertIncidents(null);");
    expect(oauthAlertConfigLoaderSource).not.toContain("setOAuthAlertDeliveries(null);");

    expect(oauthAlertIncidentsLoaderSource).toContain(
      "if (result.status === 404 || result.status === 405)",
    );
    expect(oauthAlertIncidentsLoaderSource).toContain("setOAuthAlertCenterApiAvailable(false);");
    expect(oauthAlertIncidentsLoaderSource).toContain("setOAuthAlertIncidents(null);");
    expect(oauthAlertIncidentsLoaderSource).not.toContain(
      "setOAuthAlertConfig(DEFAULT_OAUTH_ALERT_CENTER_CONFIG);",
    );
    expect(oauthAlertIncidentsLoaderSource).not.toContain("setOAuthAlertDeliveries(null);");

    expect(oauthAlertDeliveriesLoaderSource).toContain(
      "if (result.status === 404 || result.status === 405)",
    );
    expect(oauthAlertDeliveriesLoaderSource).toContain("setOAuthAlertCenterApiAvailable(false);");
    expect(oauthAlertDeliveriesLoaderSource).toContain("setOAuthAlertDeliveries(null);");
    expect(oauthAlertDeliveriesLoaderSource).not.toContain(
      "setOAuthAlertConfig(DEFAULT_OAUTH_ALERT_CENTER_CONFIG);",
    );
    expect(oauthAlertDeliveriesLoaderSource).not.toContain("setOAuthAlertIncidents(null);");
  });

  it("Alertmanager 配置 404/405 降级时应只重置配置编辑态，不误清空同步历史结果", () => {
    expect(alertmanagerConfigLoaderSource).toContain(
      "if (result.status === 404 || result.status === 405)",
    );
    expect(alertmanagerConfigLoaderSource).toContain("setAlertmanagerApiAvailable(false);");
    expect(alertmanagerConfigLoaderSource).toContain("setAlertmanagerConfig(null);");
    expect(alertmanagerConfigLoaderSource).toContain(
      "setAlertmanagerStructuredDraft(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT);",
    );
    expect(alertmanagerConfigLoaderSource).toContain(
      "setAlertmanagerConfigText(DEFAULT_ALERTMANAGER_CONFIG_TEXT);",
    );
    expect(alertmanagerConfigLoaderSource).not.toContain("setAlertmanagerSyncHistory([]);");
    expect(alertmanagerConfigLoaderSource).not.toContain("setAlertmanagerLatestSync(null);");
    expect(alertmanagerConfigLoaderSource).not.toContain("setAlertmanagerHistoryPage(1);");
  });

  it("Alertmanager 同步历史分页失败时不应误清空最近成功结果，只有 404/405 才做降级清空", () => {
    expect(alertmanagerHistoryLoaderSource).toContain(
      "if (result.status === 404 || result.status === 405)",
    );
    expect(alertmanagerHistoryLoaderSource).toContain("setAlertmanagerSyncHistory([]);");
    expect(alertmanagerHistoryLoaderSource).toContain("setAlertmanagerLatestSync(null);");
    expect(alertmanagerHistoryLoaderSource).toContain("setAlertmanagerHistoryPage(1);");
    expect(alertmanagerHistoryLoaderSource).toContain('throw new Error(result.error || "加载 Alertmanager 同步历史失败");');
    expect(alertmanagerHistoryLoaderSource).toContain("if (normalized.page === 1) {");
    expect(alertmanagerHistoryLoaderSource).toContain(
      "setAlertmanagerLatestSync(normalized.data[0] || null);",
    );

    const alertmanagerHistoryNon404FailureSource = alertmanagerHistoryLoaderSource.slice(
      alertmanagerHistoryLoaderSource.indexOf("if (!result.ok) {"),
      alertmanagerHistoryLoaderSource.indexOf("const normalized = normalizeAlertmanagerHistoryQueryResult(result.payload);"),
    );
    expect(alertmanagerHistoryNon404FailureSource).toContain(
      'throw new Error(result.error || "加载 Alertmanager 同步历史失败");',
    );
    expect(alertmanagerHistoryNon404FailureSource).not.toContain("setAlertmanagerSyncHistory([]);");
    expect(alertmanagerHistoryNon404FailureSource).not.toContain("setAlertmanagerLatestSync(null);");
    expect(alertmanagerHistoryNon404FailureSource).not.toContain("setAlertmanagerHistoryPage(1);");
  });

  it("应将事件分页与会话追溯补丁收口到独立 helper", () => {
    expect(enterprisePageSource).toContain("./enterpriseEventFilters");
    expect(enterprisePageSource).toContain("normalizeBoundedPage(");
    expect(enterprisePageSource).toContain("buildSessionEventStatePatch(normalized)");
    expect(eventFiltersSource).toContain("export interface SessionEventFilterPatch");
    expect(eventFiltersSource).toContain("export const normalizeBoundedPage");
    expect(eventFiltersSource).toContain("export const buildSessionEventStatePatch");
  });

  it("应为组织域组织、项目、成员绑定提供统一审计下钻入口", () => {
    expect(enterprisePageSource).toContain("const jumpToAuditByResource = async");
    expect(enterprisePageSource).toContain("const jumpToAuditByAction = async");
    expect(enterprisePageSource).toContain("OrgOrganizationsSection");
    expect(enterprisePageSource).toContain("OrgProjectsSection");
    expect(enterprisePageSource).toContain("OrgMembersSection");
    expect(enterprisePageSource).toContain('resource: "organization"');
    expect(enterprisePageSource).toContain('resource: "project"');
    expect(enterprisePageSource).toContain('resource: "org_member"');
    expect(enterprisePageSource).toContain('resource: primaryProjectId ? "org_member_project" : "org_member"');
    expect(auditEventsSectionSource).toContain('sectionId = "audit-events-section"');
    expect(orgOrganizationsSectionSource).toContain("查看审计");
    expect(orgOrganizationsSectionSource).toContain("启停审计");
    expect(orgProjectsSectionSource).toContain("查看审计");
    expect(orgProjectsSectionSource).toContain("启停审计");
    expect(orgMembersSectionSource).toContain("查看审计");
  });

  it("应补齐组织域成员创建与删除入口，不再只停留在绑定编辑", () => {
    expect(enterprisePageSource).toContain("const [orgMemberCreateForm, setOrgMemberCreateForm] = useState(");
    expect(enterprisePageSource).toContain("const createOrgMember = async () => {");
    expect(enterprisePageSource).toContain("const removeOrgMember = async (member: OrgMemberBindingItem) => {");
    expect(enterprisePageSource).toContain("buildMemberCreatePayload(orgMemberCreateForm, users)");
    expect(enterprisePageSource).toContain("orgDomainClient.createMember(payload.value)");
    expect(enterprisePageSource).toContain("orgDomainClient.deleteMember(member.memberId)");
    expect(orgMembersSectionSource).toContain("创建成员");
    expect(orgMembersSectionSource).toContain("删除成员");
  });

  it("应把组织与项目的 status 收口成最小启用/禁用控制，而不是只展示字段", () => {
    expect(enterprisePageSource).toContain("const toggleOrganizationStatus = async (organization: OrgOrganizationItem) => {");
    expect(enterprisePageSource).toContain("const toggleOrgProjectStatus = async (project: OrgProjectItem) => {");
    expect(enterprisePageSource).toContain("orgDomainClient.updateOrganization(organization.id, {");
    expect(enterprisePageSource).toContain("orgDomainClient.updateProject(project.id, {");
    expect(orgOrganizationsSectionSource).toContain('{organization.status === "disabled" ? "启用" : "禁用"}');
    expect(orgProjectsSectionSource).toContain('{project.status === "disabled" ? "启用" : "禁用"}');
    expect(orgMutationsSource).toContain("禁用后将阻止新增项目、成员和成员项目绑定");
    expect(orgMutationsSource).toContain("禁用后将阻止新增成员项目绑定");
    expect(orgProjectsSectionSource).toContain('disabled={organization.status === "disabled"}');
    expect(orgProjectsSectionSource).toContain('{organization.status === "disabled" ? " · disabled" : ""}');
    expect(orgMembersSectionSource).toContain('disabled={writeDisabled || project.status === "disabled"}');
    expect(orgMembersSectionSource).toContain('{project.status === "disabled" ? " · disabled" : ""}');
  });
});
