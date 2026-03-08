import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Users,
  ScrollText,
  Gauge,
  LogOut,
  Building2,
  UserPlus,
  Trash2,
} from "lucide-react";
import {
  downloadWithApiSecret,
  enterpriseAdminClient,
  isEnterpriseBackendReachable,
  isEnterpriseFeatureEnabled,
  loadFeaturePayload,
  orgDomainClient,
  oauthAlertCenterClient,
} from "../lib/client";
import type {
  AdminUserItem,
  AgentLedgerDeliveryAttemptQuery,
  AgentLedgerDeliveryAttemptQueryResult,
  AgentLedgerDeliveryAttemptSummary,
  AgentLedgerDeliveryState,
  AgentLedgerOutboxHealth,
  AgentLedgerOutboxItem,
  AgentLedgerOutboxQueryResult,
  AgentLedgerOutboxReadiness,
  AgentLedgerOutboxSummary,
  AgentLedgerReplayAuditQueryResult,
  AgentLedgerReplayAuditResult,
  AgentLedgerReplayAuditSummary,
  AgentLedgerReplayTriggerSource,
  AgentLedgerTraceDrilldownSummary,
  AgentLedgerRuntimeStatus,
  AlertmanagerConfigPayload,
  AlertmanagerStoredConfig,
  AlertmanagerSyncHistoryItem,
  AuditEventItem,
  AuditQueryResult,
  BillingQuotaResult,
  BillingUsageFilterInput,
  BillingUsageItem,
  BillingUsageQueryResult,
  CapabilityRuntimeHealthData,
  ClaudeFallbackQueryResult,
  ClaudeFallbackSummary,
  ClaudeFallbackTimeseriesPoint,
  ClaudeFallbackTimeseriesResult,
  FeaturePayload,
  OAuthAlertCenterConfigPayload,
  OAuthAlertDeliveryQueryResult,
  OAuthAlertIncidentItem,
  OAuthAlertIncidentQueryResult,
  OAuthAlertRuleVersionListResult,
  OAuthAlertRuleVersionSummaryItem,
  OAuthCallbackQueryResult,
  OAuthExcludedModelsPayload,
  OAuthModelAliasPayload,
  OAuthSessionEventQueryResult,
  OrgMemberBindingItem,
  OrgMemberProjectBindingRow,
  OrgOrganizationItem,
  OrgOverviewData,
  OrgProjectItem,
  PermissionItem,
  ProviderCapabilityMapData,
  QuotaPolicyItem,
  RoleItem,
  RouteExecutionPolicyData,
  SelectionPolicyData,
  TenantItem,
} from "../lib/client";
import {
  formatExcludedModelsEditorText,
  formatModelAliasEditorText,
  parseExcludedModelsEditorText,
  parseModelAliasEditorText,
  resolveOrgDomainAvailabilityState,
  resolveOrgDomainPanelState,
} from "./enterpriseGovernance";
import {
  AGENTLEDGER_OUTBOX_READINESS_STATUS_META,
  buildAgentLedgerTracePageResult,
  getAgentLedgerOutboxReasonLabel,
  normalizeAgentLedgerDeliveryAttemptSummary,
  normalizeAgentLedgerDeliveryAttemptQueryResult,
  normalizeAgentLedgerOutboxHealth,
  normalizeAgentLedgerOutboxQueryResult,
  normalizeAgentLedgerOutboxReadiness,
  normalizeAgentLedgerOutboxSummary,
  normalizeAgentLedgerReplayAuditSummary,
  normalizeAgentLedgerReplayAuditQueryResult,
  normalizeAgentLedgerReplayBatchResult,
  normalizeAgentLedgerTraceDrilldownResult,
  summarizeAgentLedgerTraceAttempts,
  summarizeAgentLedgerTraceOutbox,
  summarizeAgentLedgerTraceReplayAudits,
} from "./enterpriseAgentLedgerAdapters";
import {
  buildStructuredAlertmanagerPayload,
  buildStructuredOAuthAlertRulePayload,
  DEFAULT_ALERTMANAGER_CONFIG_TEXT,
  DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT,
  DEFAULT_OAUTH_ALERT_RULE_CREATE_TEXT,
  DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT,
  type AlertmanagerStructuredDraft,
  isManagedAlertmanagerReceiverName,
  isMaskedWebhookUrl,
  MANAGED_ALERTMANAGER_RECEIVER_NAMES,
  normalizeAlertmanagerStructuredDraft,
  normalizeOAuthAlertRuleStructuredDraft,
  type OAuthAlertRuleStructuredDraft,
} from "./enterpriseControlEditors";
import {
  normalizeAlertmanagerHistoryQueryResult,
  normalizeAlertmanagerStoredConfig,
  normalizeOAuthAlertConfig,
  normalizeOAuthAlertDeliveryResult,
  normalizeOAuthAlertIncidentResult,
  normalizeOAuthAlertRuleVersionSummary,
  normalizeOAuthAlertRuleVersionList,
  renderAlertmanagerSyncSummary as renderAlertmanagerSyncSummaryText,
  toAlertmanagerConfigPayload,
  toAlertmanagerHistoryItem,
} from "./enterpriseOAuthAlertAdapters";
import {
  createOrgMemberEditForm,
  normalizeMemberBindingItem,
  normalizeMemberProjectBindingRow,
  normalizeOrganizationItem,
  buildOrgOverviewFallback,
  normalizeOrgOverviewData,
  normalizeProjectItem,
  planOrgMemberBindingMutation,
  resolveAdminUserLabel,
  resolveOrganizationDisplayName,
  resolveProjectDisplay,
  shouldRefreshOrgDomainAfterMutationError,
} from "./enterpriseOrgAdapters";
import {
  buildAgentLedgerOutboxBaseQuery,
  buildAgentLedgerReplayAuditBaseQuery,
} from "./enterpriseQueryBuilders";
import {
  buildTraceableErrorMessage,
  extractListData,
  extractTraceIdFromResponse,
  formatFlows,
  formatOptionalDateTime,
  formatTraceableMessage,
  formatWindowStart,
  normalizeDateTimeParam,
  resolveAuditPolicyId,
  toObject,
  toText,
} from "./enterprisePageUtils";
import {
  buildRemovePolicyConfirmationMessage,
  buildQuotaPolicyCreatePayload,
  buildQuotaPolicyUpdatePayload,
  createEnterprisePolicyEditForm,
  resetEnterprisePolicyCreateForm,
  resetEnterprisePolicyEditForm,
} from "./enterprisePolicyEditors";
import {
  buildReplayAgentLedgerOutboxBatchConfirmationMessage,
  buildReplayAgentLedgerOutboxConfirmationMessage,
  buildRollbackAlertmanagerSyncHistoryConfirmationMessage,
  buildRollbackOAuthAlertRuleVersionConfirmationMessage,
} from "./enterpriseDangerousActionConfirmations";
import {
  buildAdminUserCreatePayload,
  buildRemoveTenantConfirmationMessage,
  buildRemoveUserConfirmationMessage,
  buildTenantCreatePayload,
  resetEnterpriseTenantCreateForm,
  resetEnterpriseUserCreateForm,
} from "./enterpriseAdminMutations";
import {
  buildMemberCreatePayload,
  buildOrganizationCreatePayload,
  buildProjectCreatePayload,
  buildRemoveMemberConfirmationMessage,
  buildRemoveOrganizationConfirmationMessage,
  buildRemoveProjectConfirmationMessage,
  buildToggleOrganizationStatusConfirmationMessage,
  buildToggleProjectStatusConfirmationMessage,
  resetEnterpriseOrgCreateForm,
  resetEnterpriseOrgMemberCreateForm,
  resetEnterpriseOrgProjectCreateForm,
} from "./enterpriseOrgMutations";
import {
  buildAdminUserUpdatePayload,
  createEnterpriseUserEditForm,
  resetEnterpriseUserEditForm,
} from "./enterpriseUserBindingEditors";
import { AgentLedgerOutboxSection } from "../components/enterprise/AgentLedgerOutboxSection";
import { AgentLedgerReplayAuditsSection } from "../components/enterprise/AgentLedgerReplayAuditsSection";
import { AgentLedgerTraceSection } from "../components/enterprise/AgentLedgerTraceSection";
import { OAuthModelGovernanceSection } from "../components/enterprise/OAuthModelGovernanceSection";
import {
  SectionErrorBanner,
  TableFeedbackRow,
} from "../components/enterprise/EnterpriseSectionFeedback";
import { cn } from "../lib/utils";

interface SessionEventFilterPatch {
  state?: string;
  provider?: string;
  flowType?: "" | "auth_code" | "device_code" | "manual_key" | "service_account";
  phase?:
    | ""
    | "pending"
    | "waiting_callback"
    | "waiting_device"
    | "exchanging"
    | "completed"
    | "error";
  status?: "" | "pending" | "completed" | "error";
  eventType?: "" | "register" | "set_phase" | "complete" | "mark_error";
  from?: string;
  to?: string;
}

interface OAuthAlertManualEvaluateForm {
  provider: string;
}

type EnterpriseLoadSection =
  | "baseData"
  | "agentLedgerTrace"
  | "agentLedgerOutbox"
  | "agentLedgerReplayAudits"
  | "oauthAlertConfig"
  | "oauthAlertIncidents"
  | "oauthAlertDeliveries"
  | "oauthAlertRules"
  | "alertmanager"
  | "audit"
  | "callbackEvents"
  | "sessionEvents"
  | "fallback"
  | "usage";

type EnterpriseSectionErrors = Record<EnterpriseLoadSection, string>;

interface BootstrapSectionTask {
  label: string;
  run: () => Promise<unknown>;
}

const EMPTY_ENTERPRISE_SECTION_ERRORS: EnterpriseSectionErrors = {
  baseData: "",
  agentLedgerTrace: "",
  agentLedgerOutbox: "",
  agentLedgerReplayAudits: "",
  oauthAlertConfig: "",
  oauthAlertIncidents: "",
  oauthAlertDeliveries: "",
  oauthAlertRules: "",
  alertmanager: "",
  audit: "",
  callbackEvents: "",
  sessionEvents: "",
  fallback: "",
  usage: "",
};

const DEFAULT_OAUTH_ALERT_CENTER_CONFIG: OAuthAlertCenterConfigPayload = {
  enabled: true,
  warningRateThresholdBps: 2000,
  warningFailureCountThreshold: 10,
  criticalRateThresholdBps: 3500,
  criticalFailureCountThreshold: 20,
  recoveryRateThresholdBps: 1000,
  recoveryFailureCountThreshold: 5,
  dedupeWindowSec: 600,
  recoveryConsecutiveWindows: 2,
  windowSizeSec: 300,
  quietHoursEnabled: false,
  quietHoursStart: "00:00",
  quietHoursEnd: "00:00",
  quietHoursTimezone: "Asia/Shanghai",
  muteProviders: [],
  minDeliverySeverity: "warning",
};

const OAUTH_ALERT_INCIDENT_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

export function EnterprisePage() {
  const [featurePayload, setFeaturePayload] = useState<FeaturePayload | null>(null);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [auditResult, setAuditResult] = useState<AuditQueryResult | null>(null);
  const [quotas, setQuotas] = useState<BillingQuotaResult["data"] | null>(null);
  const [selectionPolicy, setSelectionPolicy] = useState<SelectionPolicyData | null>(null);
  const [routeExecutionPolicy, setRouteExecutionPolicy] = useState<RouteExecutionPolicyData | null>(null);
  const [capabilityMap, setCapabilityMap] = useState<ProviderCapabilityMapData>({});
  const [capabilityMapText, setCapabilityMapText] = useState("{}");
  const [capabilityHealth, setCapabilityHealth] = useState<CapabilityRuntimeHealthData | null>(null);
  const [capabilityHealthLoading, setCapabilityHealthLoading] = useState(false);
  const [capabilityHealthError, setCapabilityHealthError] = useState("");
  const [oauthGovernanceModelAlias, setOAuthGovernanceModelAlias] =
    useState<OAuthModelAliasPayload>({});
  const [oauthGovernanceModelAliasText, setOAuthGovernanceModelAliasText] = useState("{}");
  const [oauthGovernanceModelAliasSaving, setOAuthGovernanceModelAliasSaving] = useState(false);
  const [oauthGovernanceModelAliasApiAvailable, setOAuthGovernanceModelAliasApiAvailable] =
    useState(true);
  const [oauthGovernanceExcludedModels, setOAuthGovernanceExcludedModels] =
    useState<OAuthExcludedModelsPayload>([]);
  const [oauthGovernanceExcludedModelsText, setOAuthGovernanceExcludedModelsText] = useState("");
  const [oauthGovernanceExcludedModelsSaving, setOAuthGovernanceExcludedModelsSaving] =
    useState(false);
  const [oauthGovernanceExcludedModelsApiAvailable, setOAuthGovernanceExcludedModelsApiAvailable] =
    useState(true);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [policies, setPolicies] = useState<QuotaPolicyItem[]>([]);
  const [callbackEvents, setCallbackEvents] = useState<OAuthCallbackQueryResult | null>(null);
  const [sessionEvents, setSessionEvents] = useState<OAuthSessionEventQueryResult | null>(null);
  const [sessionEventsApiAvailable, setSessionEventsApiAvailable] = useState(true);
  const [agentLedgerOutbox, setAgentLedgerOutbox] = useState<AgentLedgerOutboxQueryResult | null>(
    null,
  );
  const [agentLedgerOutboxSummary, setAgentLedgerOutboxSummary] =
    useState<AgentLedgerOutboxSummary | null>(null);
  const [agentLedgerOutboxApiAvailable, setAgentLedgerOutboxApiAvailable] = useState(true);
  const [agentLedgerOutboxReadiness, setAgentLedgerOutboxReadiness] =
    useState<AgentLedgerOutboxReadiness | null>(null);
  const [agentLedgerOutboxReadinessApiAvailable, setAgentLedgerOutboxReadinessApiAvailable] =
    useState(true);
  const [agentLedgerOutboxReadinessError, setAgentLedgerOutboxReadinessError] = useState("");
  const [agentLedgerOutboxHealth, setAgentLedgerOutboxHealth] =
    useState<AgentLedgerOutboxHealth | null>(null);
  const [agentLedgerOutboxHealthApiAvailable, setAgentLedgerOutboxHealthApiAvailable] =
    useState(true);
  const [agentLedgerOutboxHealthError, setAgentLedgerOutboxHealthError] = useState("");
  const [agentLedgerDeliveryAttemptsOpenOutboxId, setAgentLedgerDeliveryAttemptsOpenOutboxId] =
    useState<number | null>(null);
  const [agentLedgerDeliveryAttempts, setAgentLedgerDeliveryAttempts] =
    useState<AgentLedgerDeliveryAttemptQueryResult | null>(null);
  const [agentLedgerDeliveryAttemptSummary, setAgentLedgerDeliveryAttemptSummary] =
    useState<AgentLedgerDeliveryAttemptSummary | null>(null);
  const [agentLedgerDeliveryAttemptApiAvailable, setAgentLedgerDeliveryAttemptApiAvailable] =
    useState(true);
  const [agentLedgerDeliveryAttemptLoading, setAgentLedgerDeliveryAttemptLoading] = useState(false);
  const [agentLedgerDeliveryAttemptError, setAgentLedgerDeliveryAttemptError] = useState("");
  const [agentLedgerReplayAudits, setAgentLedgerReplayAudits] =
    useState<AgentLedgerReplayAuditQueryResult | null>(null);
  const [agentLedgerReplayAuditSummary, setAgentLedgerReplayAuditSummary] =
    useState<AgentLedgerReplayAuditSummary | null>(null);
  const [agentLedgerReplayAuditApiAvailable, setAgentLedgerReplayAuditApiAvailable] =
    useState(true);
  const [agentLedgerTraceInput, setAgentLedgerTraceInput] = useState("");
  const [agentLedgerTraceResolvedTraceId, setAgentLedgerTraceResolvedTraceId] = useState("");
  const [agentLedgerTraceHasQueried, setAgentLedgerTraceHasQueried] = useState(false);
  const [agentLedgerTraceLoading, setAgentLedgerTraceLoading] = useState(false);
  const [agentLedgerTraceOutbox, setAgentLedgerTraceOutbox] =
    useState<AgentLedgerOutboxQueryResult | null>(null);
  const [agentLedgerTraceOutboxSummary, setAgentLedgerTraceOutboxSummary] =
    useState<AgentLedgerOutboxSummary | null>(null);
  const [agentLedgerTraceOutboxApiAvailable, setAgentLedgerTraceOutboxApiAvailable] =
    useState(true);
  const [agentLedgerTraceAttempts, setAgentLedgerTraceAttempts] =
    useState<AgentLedgerDeliveryAttemptQueryResult | null>(null);
  const [agentLedgerTraceAttemptSummary, setAgentLedgerTraceAttemptSummary] =
    useState<AgentLedgerDeliveryAttemptSummary | null>(null);
  const [agentLedgerTraceAttemptApiAvailable, setAgentLedgerTraceAttemptApiAvailable] =
    useState(true);
  const [agentLedgerTraceReplayAudits, setAgentLedgerTraceReplayAudits] =
    useState<AgentLedgerReplayAuditQueryResult | null>(null);
  const [agentLedgerTraceReplayAuditSummary, setAgentLedgerTraceReplayAuditSummary] =
    useState<AgentLedgerReplayAuditSummary | null>(null);
  const [agentLedgerTraceReplayAuditApiAvailable, setAgentLedgerTraceReplayAuditApiAvailable] =
    useState(true);
  const [agentLedgerTraceSummary, setAgentLedgerTraceSummary] =
    useState<AgentLedgerTraceDrilldownSummary | null>(null);
  const [agentLedgerTraceAuditEvents, setAgentLedgerTraceAuditEvents] = useState<AuditEventItem[]>([]);
  const [agentLedgerTraceReadiness, setAgentLedgerTraceReadiness] =
    useState<AgentLedgerOutboxReadiness | null>(null);
  const [agentLedgerTraceHealth, setAgentLedgerTraceHealth] =
    useState<AgentLedgerOutboxHealth | null>(null);
  const agentLedgerDeliveryAttemptRequestIdRef = useRef(0);
  const agentLedgerTraceRequestIdRef = useRef(0);
  const [fallbackEvents, setFallbackEvents] = useState<ClaudeFallbackQueryResult | null>(null);
  const [fallbackSummary, setFallbackSummary] = useState<ClaudeFallbackSummary | null>(null);
  const [oauthAlertCenterApiAvailable, setOAuthAlertCenterApiAvailable] = useState(true);
  const [oauthAlertConfig, setOAuthAlertConfig] = useState<OAuthAlertCenterConfigPayload>(
    DEFAULT_OAUTH_ALERT_CENTER_CONFIG,
  );
  const [oauthAlertConfigSaving, setOAuthAlertConfigSaving] = useState(false);
  const [oauthAlertIncidents, setOAuthAlertIncidents] =
    useState<OAuthAlertIncidentQueryResult | null>(null);
  const [oauthAlertDeliveries, setOAuthAlertDeliveries] =
    useState<OAuthAlertDeliveryQueryResult | null>(null);
  const [oauthAlertIncidentProviderFilter, setOAuthAlertIncidentProviderFilter] = useState("");
  const [oauthAlertIncidentPhaseFilter, setOAuthAlertIncidentPhaseFilter] = useState("");
  const [oauthAlertIncidentSeverityFilter, setOAuthAlertIncidentSeverityFilter] = useState<
    "" | "critical" | "warning" | "recovery"
  >("");
  const [oauthAlertIncidentFromFilter, setOAuthAlertIncidentFromFilter] = useState("");
  const [oauthAlertIncidentToFilter, setOAuthAlertIncidentToFilter] = useState("");
  const [oauthAlertDeliveryEventIdFilter, setOAuthAlertDeliveryEventIdFilter] = useState("");
  const [oauthAlertDeliveryIncidentIdFilter, setOAuthAlertDeliveryIncidentIdFilter] = useState("");
  const [oauthAlertDeliveryChannelFilter, setOAuthAlertDeliveryChannelFilter] = useState("");
  const [oauthAlertDeliveryStatusFilter, setOAuthAlertDeliveryStatusFilter] = useState<
    "" | "success" | "failure"
  >("");
  const [oauthAlertDeliveryFromFilter, setOAuthAlertDeliveryFromFilter] = useState("");
  const [oauthAlertDeliveryToFilter, setOAuthAlertDeliveryToFilter] = useState("");
  const [oauthAlertEvaluateForm, setOAuthAlertEvaluateForm] =
    useState<OAuthAlertManualEvaluateForm>({
      provider: "",
    });
  const [oauthAlertEvaluating, setOAuthAlertEvaluating] = useState(false);
  const [oauthAlertLastEvaluateResult, setOAuthAlertLastEvaluateResult] = useState("");
  const [alertmanagerApiAvailable, setAlertmanagerApiAvailable] = useState(true);
  const [alertmanagerConfigSaving, setAlertmanagerConfigSaving] = useState(false);
  const [alertmanagerSyncing, setAlertmanagerSyncing] = useState(false);
  const [alertmanagerConfigText, setAlertmanagerConfigText] = useState(
    DEFAULT_ALERTMANAGER_CONFIG_TEXT,
  );
  const [alertmanagerConfig, setAlertmanagerConfig] = useState<AlertmanagerStoredConfig | null>(
    null,
  );
  const [useStructuredAlertmanagerEditor, setUseStructuredAlertmanagerEditor] = useState(true);
  const [alertmanagerStructuredDraft, setAlertmanagerStructuredDraft] =
    useState<AlertmanagerStructuredDraft>(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT);
  const [alertmanagerSyncHistory, setAlertmanagerSyncHistory] = useState<
    AlertmanagerSyncHistoryItem[]
  >([]);
  const [alertmanagerLatestSync, setAlertmanagerLatestSync] =
    useState<AlertmanagerSyncHistoryItem | null>(null);
  const [alertmanagerHistoryPage, setAlertmanagerHistoryPage] = useState(1);
  const [alertmanagerHistoryPageSize] = useState(20);
  const [alertmanagerHistoryTotal, setAlertmanagerHistoryTotal] = useState(0);
  const [alertmanagerHistoryTotalPages, setAlertmanagerHistoryTotalPages] = useState(1);
  const [alertmanagerHistoryPageLoading, setAlertmanagerHistoryPageLoading] = useState(false);
  const [alertmanagerHistoryPageInput, setAlertmanagerHistoryPageInput] = useState("1");
  const [oauthAlertRuleActiveVersion, setOAuthAlertRuleActiveVersion] =
    useState<OAuthAlertRuleVersionSummaryItem | null>(null);
  const [oauthAlertRuleVersions, setOAuthAlertRuleVersions] =
    useState<OAuthAlertRuleVersionListResult | null>(null);
  const [oauthAlertRulePageLoading, setOAuthAlertRulePageLoading] = useState(false);
  const [oauthAlertRulePageInput, setOAuthAlertRulePageInput] = useState("1");
  const [oauthAlertRuleCreating, setOAuthAlertRuleCreating] = useState(false);
  const [oauthAlertRuleRollingVersionId, setOAuthAlertRuleRollingVersionId] = useState<number | null>(
    null,
  );
  const [alertmanagerHistoryRollingId, setAlertmanagerHistoryRollingId] = useState<string>("");
  const [oauthAlertRuleCreateText, setOAuthAlertRuleCreateText] = useState(
    DEFAULT_OAUTH_ALERT_RULE_CREATE_TEXT,
  );
  const [useStructuredOAuthAlertRuleEditor, setUseStructuredOAuthAlertRuleEditor] = useState(true);
  const [oauthAlertRuleStructuredDraft, setOAuthAlertRuleStructuredDraft] =
    useState<OAuthAlertRuleStructuredDraft>(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT);
  const [usageRows, setUsageRows] = useState<BillingUsageItem[]>([]);
  const [usagePage, setUsagePage] = useState(1);
  const [usagePageSize] = useState(20);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usageTotalPages, setUsageTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [enterpriseEnabled, setEnterpriseEnabled] = useState(true);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [auditKeyword, setAuditKeyword] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditResource, setAuditResource] = useState("");
  const [auditResultFilter, setAuditResultFilter] = useState<"" | "success" | "failure">("");
  const [auditTraceId, setAuditTraceId] = useState("");
  const [auditResourceId, setAuditResourceId] = useState("");
  const [auditPolicyId, setAuditPolicyId] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [userForm, setUserForm] = useState(resetEnterpriseUserCreateForm);
  const [tenantForm, setTenantForm] = useState(resetEnterpriseTenantCreateForm);
  const [policyForm, setPolicyForm] = useState(resetEnterprisePolicyCreateForm);
  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [userEditForm, setUserEditForm] = useState(resetEnterpriseUserEditForm);
  const [policyEditingId, setPolicyEditingId] = useState<string | null>(null);
  const [policyEditForm, setPolicyEditForm] = useState(resetEnterprisePolicyEditForm);
  const [callbackProviderFilter, setCallbackProviderFilter] = useState("");
  const [callbackStatusFilter, setCallbackStatusFilter] = useState<"" | "success" | "failure">("");
  const [callbackStateFilter, setCallbackStateFilter] = useState("");
  const [callbackTraceFilter, setCallbackTraceFilter] = useState("");
  const [sessionEventProviderFilter, setSessionEventProviderFilter] = useState("");
  const [sessionEventStateFilter, setSessionEventStateFilter] = useState("");
  const [sessionEventFlowFilter, setSessionEventFlowFilter] = useState<
    "" | "auth_code" | "device_code" | "manual_key" | "service_account"
  >("");
  const [sessionEventPhaseFilter, setSessionEventPhaseFilter] = useState<
    "" | "pending" | "waiting_callback" | "waiting_device" | "exchanging" | "completed" | "error"
  >("");
  const [sessionEventStatusFilter, setSessionEventStatusFilter] = useState<
    "" | "pending" | "completed" | "error"
  >("");
  const [sessionEventTypeFilter, setSessionEventTypeFilter] = useState<
    "" | "register" | "set_phase" | "complete" | "mark_error"
  >("");
  const [sessionEventFromFilter, setSessionEventFromFilter] = useState("");
  const [sessionEventToFilter, setSessionEventToFilter] = useState("");
  const [agentLedgerOutboxDeliveryStateFilter, setAgentLedgerOutboxDeliveryStateFilter] =
    useState<"" | AgentLedgerDeliveryState>("");
  const [agentLedgerOutboxStatusFilter, setAgentLedgerOutboxStatusFilter] =
    useState<"" | AgentLedgerRuntimeStatus>("");
  const [agentLedgerOutboxProviderFilter, setAgentLedgerOutboxProviderFilter] = useState("");
  const [agentLedgerOutboxTenantFilter, setAgentLedgerOutboxTenantFilter] = useState("");
  const [agentLedgerOutboxTraceFilter, setAgentLedgerOutboxTraceFilter] = useState("");
  const [agentLedgerOutboxFromFilter, setAgentLedgerOutboxFromFilter] = useState("");
  const [agentLedgerOutboxToFilter, setAgentLedgerOutboxToFilter] = useState("");
  const [agentLedgerOutboxReplayingId, setAgentLedgerOutboxReplayingId] = useState<number | null>(
    null,
  );
  const [agentLedgerOutboxSelectedIds, setAgentLedgerOutboxSelectedIds] = useState<number[]>([]);
  const [agentLedgerOutboxBatchReplaying, setAgentLedgerOutboxBatchReplaying] = useState(false);
  const [agentLedgerReplayAuditTraceFilter, setAgentLedgerReplayAuditTraceFilter] = useState("");
  const [agentLedgerReplayAuditOutboxIdFilter, setAgentLedgerReplayAuditOutboxIdFilter] =
    useState("");
  const [agentLedgerReplayAuditOperatorFilter, setAgentLedgerReplayAuditOperatorFilter] =
    useState("");
  const [agentLedgerReplayAuditResultFilter, setAgentLedgerReplayAuditResultFilter] = useState<
    "" | AgentLedgerReplayAuditResult
  >("");
  const [agentLedgerReplayAuditTriggerSourceFilter, setAgentLedgerReplayAuditTriggerSourceFilter] =
    useState<"" | AgentLedgerReplayTriggerSource>("");
  const [agentLedgerReplayAuditFromFilter, setAgentLedgerReplayAuditFromFilter] = useState("");
  const [agentLedgerReplayAuditToFilter, setAgentLedgerReplayAuditToFilter] = useState("");
  const [fallbackModeFilter, setFallbackModeFilter] = useState<"" | "api_key" | "bridge">("");
  const [fallbackPhaseFilter, setFallbackPhaseFilter] = useState<
    "" | "attempt" | "success" | "failure" | "skipped"
  >("");
  const [fallbackReasonFilter, setFallbackReasonFilter] = useState<
    | ""
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown"
  >("");
  const [fallbackTraceFilter, setFallbackTraceFilter] = useState("");
  const [fallbackFromFilter, setFallbackFromFilter] = useState("");
  const [fallbackToFilter, setFallbackToFilter] = useState("");
  const [fallbackStep, setFallbackStep] = useState<"5m" | "15m" | "1h" | "6h" | "1d">("15m");
  const [fallbackTimeseries, setFallbackTimeseries] = useState<ClaudeFallbackTimeseriesPoint[]>([]);
  const [usagePolicyIdFilter, setUsagePolicyIdFilter] = useState("");
  const [usageBucketTypeFilter, setUsageBucketTypeFilter] = useState<"" | "minute" | "day">("");
  const [usageProviderFilter, setUsageProviderFilter] = useState("");
  const [usageModelFilter, setUsageModelFilter] = useState("");
  const [usageTenantFilter, setUsageTenantFilter] = useState("");
  const [usageFromFilter, setUsageFromFilter] = useState("");
  const [usageToFilter, setUsageToFilter] = useState("");
  const [orgOrganizations, setOrgOrganizations] = useState<OrgOrganizationItem[]>([]);
  const [orgProjects, setOrgProjects] = useState<OrgProjectItem[]>([]);
  const [orgMemberBindings, setOrgMemberBindings] = useState<OrgMemberBindingItem[]>([]);
  const [orgMemberProjectBindings, setOrgMemberProjectBindings] = useState<
    OrgMemberProjectBindingRow[]
  >([]);
  const [orgDomainApiAvailable, setOrgDomainApiAvailable] = useState(true);
  const [orgDomainReadOnlyFallback, setOrgDomainReadOnlyFallback] = useState(false);
  const [orgOverview, setOrgOverview] = useState<OrgOverviewData | null>(null);
  const [orgOverviewApiAvailable, setOrgOverviewApiAvailable] = useState(true);
  const [orgOverviewFromFallback, setOrgOverviewFromFallback] = useState(false);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState("");
  const [orgForm, setOrgForm] = useState(resetEnterpriseOrgCreateForm);
  const [orgProjectForm, setOrgProjectForm] = useState(resetEnterpriseOrgProjectCreateForm);
  const [orgMemberCreateForm, setOrgMemberCreateForm] = useState(resetEnterpriseOrgMemberCreateForm);
  const [orgProjectFilterOrganizationId, setOrgProjectFilterOrganizationId] = useState("");
  const [orgMemberEditingId, setOrgMemberEditingId] = useState<string | null>(null);
  const [orgMemberEditForm, setOrgMemberEditForm] = useState({
    organizationId: "",
    projectIds: [] as string[],
  });
  const [sectionErrors, setSectionErrors] = useState<EnterpriseSectionErrors>(
    EMPTY_ENTERPRISE_SECTION_ERRORS,
  );
  const oauthAlertRuleActionBusy =
    oauthAlertRuleCreating || oauthAlertRuleRollingVersionId !== null;
  const alertmanagerActionBusy =
    alertmanagerConfigSaving || alertmanagerSyncing || Boolean(alertmanagerHistoryRollingId);
  const oauthGovernanceActionBusy =
    oauthGovernanceModelAliasSaving || oauthGovernanceExcludedModelsSaving;
  const orgDomainWriteDisabled = orgLoading || orgDomainReadOnlyFallback;
  const orgDomainPanelState = useMemo(
    () =>
      resolveOrgDomainPanelState({
        apiAvailable: orgDomainApiAvailable,
        readOnlyFallback: orgDomainReadOnlyFallback,
        overviewApiAvailable: orgOverviewApiAvailable,
      }),
    [orgDomainApiAvailable, orgDomainReadOnlyFallback, orgOverviewApiAvailable],
  );

  const canLoadEnterprise = useMemo(
    () => enterpriseEnabled && isEnterpriseBackendReachable(featurePayload),
    [enterpriseEnabled, featurePayload],
  );

  const getErrorMessage = (error: unknown, fallback: string) => {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : fallback;
    const traceId =
      typeof (error as { traceId?: unknown })?.traceId === "string"
        ? (error as { traceId?: string }).traceId?.trim()
        : "";
    if (!traceId || message.includes(traceId)) {
      return message;
    }
    return `${message}（traceId: ${traceId}）`;
  };

  const setSectionError = (section: EnterpriseLoadSection, message: string) => {
    setSectionErrors((prev) =>
      prev[section] === message
        ? prev
        : {
            ...prev,
            [section]: message,
          },
    );
  };

  const clearSectionError = (section: EnterpriseLoadSection) => {
    setSectionErrors((prev) =>
      prev[section]
        ? {
            ...prev,
            [section]: "",
          }
        : prev,
    );
  };

  const runSectionLoad = async <T,>(
    section: EnterpriseLoadSection,
    action: () => Promise<T>,
    fallback: string,
  ): Promise<T> => {
    try {
      const result = await action();
      clearSectionError(section);
      return result;
    } catch (error) {
      setSectionError(section, getErrorMessage(error, fallback));
      throw error;
    }
  };

  const collectRejectedMessages = (
    entries: Array<{ label: string; result: PromiseSettledResult<unknown> }>,
  ) =>
    entries
      .flatMap((entry) => {
        if (entry.result.status === "rejected") {
          return [`${entry.label}：${getErrorMessage(entry.result.reason, `${entry.label}加载失败`)}`];
        }
        if (entry.result.value instanceof Response && !entry.result.value.ok) {
          return [`${entry.label}：${entry.label}加载失败（HTTP ${entry.result.value.status}）`];
        }
        return [];
      });

  const runBootstrapSectionTasks = async (
    section: EnterpriseLoadSection,
    tasks: BootstrapSectionTask[],
  ) => {
    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    const errors = collectRejectedMessages(
      tasks.map((task, index) => ({
        label: task.label,
        result: results[index] as PromiseSettledResult<unknown>,
      })),
    );
    if (errors.length > 0) {
      setSectionError(section, errors.join("；"));
      return;
    }
    clearSectionError(section);
  };

  const readJsonSafely = async (resp: Response) =>
    (await resp.json().catch(() => ({}))) as Record<string, unknown>;

  const alertmanagerReceiverOptions = useMemo(() => {
    const managed = [...MANAGED_ALERTMANAGER_RECEIVER_NAMES];
    const extra = Array.isArray(alertmanagerConfig?.config?.receivers)
      ? alertmanagerConfig.config.receivers
          .map((item) => toText(toObject(item).name).trim())
          .filter((name) => name && !isManagedAlertmanagerReceiverName(name))
      : [];
    return [...managed, ...extra];
  }, [alertmanagerConfig?.config]);

  const hasMaskedManagedAlertmanagerWebhook = useMemo(() => {
    if (!Array.isArray(alertmanagerConfig?.config?.receivers)) return false;
    return alertmanagerConfig.config.receivers.some((item) => {
      const receiver = toObject(item);
      const name = toText(receiver.name).trim();
      if (!isManagedAlertmanagerReceiverName(name)) return false;
      const webhookConfig = toObject(
        Array.isArray(receiver.webhook_configs) ? receiver.webhook_configs[0] : undefined,
      );
      const url = toText(webhookConfig.url).trim();
      return Boolean(url) && isMaskedWebhookUrl(url);
    });
  }, [alertmanagerConfig?.config]);

  const renderAlertmanagerSyncSummary = (item?: AlertmanagerSyncHistoryItem) => {
    return renderAlertmanagerSyncSummaryText(item);
  };

  const loadOrgOverview = async (fallback: OrgOverviewData) => {
    try {
      const json = await orgDomainClient.getOverview();
      const normalized = normalizeOrgOverviewData(json);
      if (!normalized) {
        throw new Error("组织域概览数据格式无效");
      }
      setOrgOverview(normalized);
      setOrgOverviewApiAvailable(true);
      setOrgOverviewFromFallback(false);
      return;
    } catch (error) {
      const typed = error as Error & { status?: number };
      if (typed.status === 404 || typed.status === 405) {
        setOrgOverview(fallback);
        setOrgOverviewApiAvailable(false);
        setOrgOverviewFromFallback(true);
        return;
      }
      setOrgOverview(fallback);
      setOrgOverviewApiAvailable(true);
      setOrgOverviewFromFallback(true);
      throw typed;
    }
  };

  const loadOrgOrganizations = async () => {
    const rows = extractListData(await orgDomainClient.listOrganizations());
    const normalized = rows
      .map((item) => normalizeOrganizationItem(item))
      .filter((item): item is OrgOrganizationItem => Boolean(item));
    setOrgOrganizations(normalized);
    setOrgProjectForm((prev) => {
      const current = prev.organizationId.trim().toLowerCase();
      if (current && normalized.some((item) => item.id === current)) {
        return prev;
      }
      return { ...prev, organizationId: normalized[0]?.id || "" };
    });
    setOrgMemberCreateForm((prev) => {
      const current = prev.organizationId.trim().toLowerCase();
      if (current && normalized.some((item) => item.id === current)) {
        return prev;
      }
      return {
        ...prev,
        organizationId: normalized[0]?.id || "",
      };
    });
    setOrgProjectFilterOrganizationId((prev) => {
      const current = prev.trim().toLowerCase();
      if (!current) return prev;
      return normalized.some((item) => item.id === current) ? prev : "";
    });
    return normalized;
  };

  const loadOrgProjects = async () => {
    const rows = extractListData(await orgDomainClient.listProjects());
    const normalized = rows
      .map((item) => normalizeProjectItem(item))
      .filter((item): item is OrgProjectItem => Boolean(item));
    setOrgProjects(normalized);
    setOrgMemberEditForm((prev) => {
      const allowed = new Set(
        normalized
          .filter((item) =>
            prev.organizationId ? item.organizationId === prev.organizationId : true,
          )
          .map((item) => item.id),
      );
      const projectIds = prev.projectIds.filter((item) => allowed.has(item));
      return projectIds.length === prev.projectIds.length
        ? prev
        : {
            ...prev,
            projectIds,
          };
    });
    return normalized;
  };

  const loadOrgMemberBindings = async () => {
    const [memberRows, bindingRows] = await Promise.all([
      orgDomainClient.listMembers(),
      orgDomainClient.listMemberProjectBindings(),
    ]);
    const normalizedMemberRows = extractListData(memberRows);
    const normalizedBindingSourceRows = extractListData(bindingRows);
    const normalizedMembers = normalizedMemberRows
      .map((item) => normalizeMemberBindingItem(item))
      .filter((item): item is OrgMemberBindingItem => Boolean(item));
    const normalizedBindingRows = normalizedBindingSourceRows
      .map((item) => normalizeMemberProjectBindingRow(item))
      .filter((item): item is OrgMemberProjectBindingRow => Boolean(item));
    setOrgMemberProjectBindings(normalizedBindingRows);

    const bindingsByMember = new Map<string, Set<string>>();
    const organizationByMember = new Map<string, string>();
    for (const row of normalizedBindingRows) {
      const existing = bindingsByMember.get(row.memberId) || new Set<string>();
      existing.add(row.projectId);
      bindingsByMember.set(row.memberId, existing);
      if (row.organizationId && !organizationByMember.has(row.memberId)) {
        organizationByMember.set(row.memberId, row.organizationId);
      }
    }

    const merged = normalizedMembers.map((member) => {
      const fromBindings = Array.from(bindingsByMember.get(member.memberId) || []);
      return {
        ...member,
        organizationId: organizationByMember.get(member.memberId) || member.organizationId,
        projectIds: Array.from(new Set([...member.projectIds, ...fromBindings])),
      };
    });
    setOrgMemberBindings(merged);
    return {
      members: merged,
      bindingRows: normalizedBindingRows,
    };
  };

  const loadOrgMemberProjectBindingsByMember = async (memberId: string) => {
    const rows = extractListData(
      await orgDomainClient.listMemberProjectBindings({ memberId }),
    );
    return rows
      .map((item) => normalizeMemberProjectBindingRow(item))
      .filter((item): item is OrgMemberProjectBindingRow => Boolean(item));
  };

  const loadOrgDomainData = async (silent = true) => {
    setOrgLoading(true);
    setOrgError("");
    const results = await Promise.allSettled([
      loadOrgOrganizations(),
      loadOrgProjects(),
      loadOrgMemberBindings(),
    ]);
    const organizationsData =
      results[0].status === "fulfilled" ? results[0].value : orgOrganizations;
    const projectsData = results[1].status === "fulfilled" ? results[1].value : orgProjects;
    const membersData =
      results[2].status === "fulfilled" ? results[2].value.members : orgMemberBindings;
    const bindingRows =
      results[2].status === "fulfilled"
        ? results[2].value.bindingRows
        : orgMemberProjectBindings;
    const overviewFallback = buildOrgOverviewFallback(
      organizationsData,
      projectsData,
      membersData,
      bindingRows,
    );
    try {
      await loadOrgOverview(overviewFallback);
    } catch {
      // ignore: fallback 已生效
    }
    const failed = results.filter((item) => item.status === "rejected");
    const availability = resolveOrgDomainAvailabilityState({
      loadFailed: failed.length > 0,
    });
    setOrgDomainApiAvailable(availability.apiAvailable);
    setOrgDomainReadOnlyFallback(availability.readOnlyFallback);
    if (failed.length > 0) {
      setOrgMemberEditingId(null);
      setOrgError("组织域接口加载失败，请检查 /api/org 服务状态或权限配置。");
      if (!silent) {
        toast.error("组织域接口不完整，管理面板已切换为只读降级。");
      }
    } else if (!silent) {
      toast.success("组织域数据已刷新");
    }
    setOrgLoading(false);
  };

  const ensureOrgDomainWritable = () => {
    if (!orgDomainReadOnlyFallback) return true;
    toast.error("当前组织域处于只读降级，写操作已禁用。");
    return false;
  };

  const loadAuditEvents = async (
    page = 1,
    keyword = auditKeyword,
    traceId = auditTraceId,
    action = auditAction,
    resource = auditResource,
    resourceId = auditResourceId,
    policyId = auditPolicyId,
    result = auditResultFilter,
    from = auditFrom,
    to = auditTo,
  ) =>
    runSectionLoad("audit", async () => {
      const fromParam = normalizeDateTimeParam(from);
      const toParam = normalizeDateTimeParam(to);
      const resp = await enterpriseAdminClient.listAuditEvents({
        page,
        pageSize: 10,
        keyword: keyword || undefined,
        traceId: traceId || undefined,
        action: action || undefined,
        resource: resource || undefined,
        resourceId: resourceId || undefined,
        policyId: policyId || undefined,
        result: result || undefined,
        from: fromParam,
        to: toParam,
      });
      if (!resp.ok) {
        throw new Error("加载审计日志失败");
      }
      const json = await resp.json();
      setAuditResult(json);
      setAuditPage(json.page);
    }, "加载审计日志失败");

  const loadCallbackEvents = async (page = 1) =>
    runSectionLoad("callbackEvents", async () => {
      const resp = await enterpriseAdminClient.listCallbackEvents({
        page,
        pageSize: 10,
        provider: callbackProviderFilter || undefined,
        status: callbackStatusFilter || undefined,
        state: callbackStateFilter || undefined,
        traceId: callbackTraceFilter || undefined,
      });
      if (!resp.ok) throw new Error("加载 OAuth 回调事件失败");
      const json = await resp.json();
      setCallbackEvents(json as OAuthCallbackQueryResult);
    }, "加载 OAuth 回调事件失败");

  const loadOAuthAlertCenterConfig = async () =>
    runSectionLoad("oauthAlertConfig", async () => {
      const resp = await oauthAlertCenterClient.getConfig();
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertConfig(DEFAULT_OAUTH_ALERT_CENTER_CONFIG);
        return;
      }
      if (!resp.ok) throw new Error("加载 OAuth 告警配置失败");
      const json = await resp.json();
      setOAuthAlertConfig(normalizeOAuthAlertConfig(json, DEFAULT_OAUTH_ALERT_CENTER_CONFIG));
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警配置失败");

  const loadOAuthAlertIncidents = async (page = 1) =>
    runSectionLoad("oauthAlertIncidents", async () => {
      const fromParam = normalizeDateTimeParam(oauthAlertIncidentFromFilter);
      const toParam = normalizeDateTimeParam(oauthAlertIncidentToFilter);
      const resp = await oauthAlertCenterClient.listIncidents({
        page,
        pageSize: 10,
        provider: oauthAlertIncidentProviderFilter.trim() || undefined,
        phase: oauthAlertIncidentPhaseFilter.trim() || undefined,
        severity: oauthAlertIncidentSeverityFilter || undefined,
        from: fromParam,
        to: toParam,
      });
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertIncidents(null);
        return;
      }
      if (!resp.ok) throw new Error("加载 OAuth 告警 incidents 失败");
      const json = await resp.json();
      setOAuthAlertIncidents(normalizeOAuthAlertIncidentResult(json));
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警 incidents 失败");

  const loadOAuthAlertDeliveries = async (page = 1) =>
    runSectionLoad("oauthAlertDeliveries", async () => {
      const fromParam = normalizeDateTimeParam(oauthAlertDeliveryFromFilter);
      const toParam = normalizeDateTimeParam(oauthAlertDeliveryToFilter);
      const resp = await oauthAlertCenterClient.listDeliveries({
        page,
        pageSize: 10,
        eventId: oauthAlertDeliveryEventIdFilter.trim() || undefined,
        incidentId: oauthAlertDeliveryIncidentIdFilter.trim() || undefined,
        channel: oauthAlertDeliveryChannelFilter.trim() || undefined,
        status: oauthAlertDeliveryStatusFilter || undefined,
        from: fromParam,
        to: toParam,
      });
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertDeliveries(null);
        return;
      }
      if (!resp.ok) throw new Error("加载 OAuth 告警 deliveries 失败");
      const json = await resp.json();
      setOAuthAlertDeliveries(normalizeOAuthAlertDeliveryResult(json));
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警 deliveries 失败");

  const loadAlertmanagerConfig = async () =>
    runSectionLoad("alertmanager", async () => {
      const resp = await oauthAlertCenterClient.getAlertmanagerConfig();
      if (resp.status === 404 || resp.status === 405) {
        setAlertmanagerApiAvailable(false);
        setAlertmanagerConfig(null);
        setAlertmanagerStructuredDraft(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT);
        setAlertmanagerConfigText(DEFAULT_ALERTMANAGER_CONFIG_TEXT);
        return;
      }
      if (!resp.ok) {
        throw new Error("加载 Alertmanager 配置失败");
      }
      const json = await resp.json();
      const normalized = normalizeAlertmanagerStoredConfig(json);
      setAlertmanagerConfig(normalized);
      setAlertmanagerStructuredDraft(normalizeAlertmanagerStructuredDraft(normalized?.config));
      setAlertmanagerConfigText(
        JSON.stringify(
          normalized?.config || JSON.parse(DEFAULT_ALERTMANAGER_CONFIG_TEXT),
          null,
          2,
        ),
      );
      setAlertmanagerApiAvailable(true);
    }, "加载 Alertmanager 配置失败");

  const loadAlertmanagerSyncHistory = async (page = 1) =>
    runSectionLoad("alertmanager", async () => {
      const safePage = Math.max(1, Math.floor(page || 1));
      setAlertmanagerHistoryPageLoading(true);
      try {
        const resp = await oauthAlertCenterClient.listAlertmanagerSyncHistory({
          page: safePage,
          pageSize: alertmanagerHistoryPageSize,
        });
        if (resp.status === 404 || resp.status === 405) {
          setAlertmanagerApiAvailable(false);
          setAlertmanagerSyncHistory([]);
          setAlertmanagerLatestSync(null);
          setAlertmanagerHistoryPage(1);
          setAlertmanagerHistoryTotal(0);
          setAlertmanagerHistoryTotalPages(1);
          setAlertmanagerHistoryPageInput("1");
          return;
        }
        if (!resp.ok) {
          throw new Error("加载 Alertmanager 同步历史失败");
        }
        const json = await resp.json();
        const normalized = normalizeAlertmanagerHistoryQueryResult(json);
        setAlertmanagerSyncHistory(normalized.data);
        setAlertmanagerHistoryPage(normalized.page);
        setAlertmanagerHistoryTotal(normalized.total);
        setAlertmanagerHistoryTotalPages(normalized.totalPages);
        setAlertmanagerHistoryPageInput(String(normalized.page));
        if (normalized.page === 1) {
          setAlertmanagerLatestSync(normalized.data[0] || null);
        }
        setAlertmanagerApiAvailable(true);
      } finally {
        setAlertmanagerHistoryPageLoading(false);
      }
    }, "加载 Alertmanager 同步历史失败");

  const loadOAuthAlertRuleActiveVersion = async () =>
    runSectionLoad("oauthAlertRules", async () => {
      const resp = await oauthAlertCenterClient.getAlertRuleActive();
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertRuleActiveVersion(null);
        return;
      }
      if (!resp.ok) {
        throw new Error("加载 OAuth 告警规则当前版本失败");
      }
      const json = await resp.json();
      const root = toObject(json);
      const data = toObject(root.data);
      setOAuthAlertRuleActiveVersion(normalizeOAuthAlertRuleVersionSummary(data));
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警规则当前版本失败");

  const loadOAuthAlertRuleVersions = async (page = 1) =>
    runSectionLoad("oauthAlertRules", async () => {
      const safePage = Math.max(1, Math.floor(page || 1));
      setOAuthAlertRulePageLoading(true);
      try {
        const resp = await oauthAlertCenterClient.listAlertRuleVersions({
          page: safePage,
          pageSize: 20,
        });
        if (resp.status === 404 || resp.status === 405) {
          setOAuthAlertCenterApiAvailable(false);
          setOAuthAlertRuleVersions(null);
          setOAuthAlertRulePageInput("1");
          return;
        }
        if (!resp.ok) {
          throw new Error("加载 OAuth 告警规则版本失败");
        }
        const json = await resp.json();
        const normalized = normalizeOAuthAlertRuleVersionList(json);
        setOAuthAlertRuleVersions(normalized);
        setOAuthAlertRulePageInput(String(normalized.page));
        setOAuthAlertCenterApiAvailable(true);
      } finally {
        setOAuthAlertRulePageLoading(false);
      }
    }, "加载 OAuth 告警规则版本失败");

  const loadSessionEvents = async (page = 1, patch?: SessionEventFilterPatch) =>
    runSectionLoad("sessionEvents", async () => {
      const stateFilter = (patch?.state ?? sessionEventStateFilter).trim();
      const providerFilter = (patch?.provider ?? sessionEventProviderFilter).trim();
      const flowFilter = patch?.flowType ?? sessionEventFlowFilter;
      const phaseFilter = patch?.phase ?? sessionEventPhaseFilter;
      const statusFilter = patch?.status ?? sessionEventStatusFilter;
      const typeFilter = patch?.eventType ?? sessionEventTypeFilter;
      const fromParam = normalizeDateTimeParam(patch?.from ?? sessionEventFromFilter);
      const toParam = normalizeDateTimeParam(patch?.to ?? sessionEventToFilter);
      const resp = await enterpriseAdminClient.listSessionEvents({
        page,
        pageSize: 10,
        state: stateFilter || undefined,
        provider: providerFilter || undefined,
        flowType: flowFilter || undefined,
        phase: phaseFilter || undefined,
        status: statusFilter || undefined,
        eventType: typeFilter || undefined,
        from: fromParam,
        to: toParam,
      });
      if (resp.status === 404 || resp.status === 405) {
        setSessionEventsApiAvailable(false);
        setSessionEvents(null);
        return;
      }
      if (!resp.ok) throw new Error("加载 OAuth 会话事件失败");
      const json = await resp.json();
      setSessionEvents(json as OAuthSessionEventQueryResult);
      setSessionEventsApiAvailable(true);
    }, "加载 OAuth 会话事件失败");

  const resetAgentLedgerTraceState = (options?: { clearInput?: boolean; preserveAvailability?: boolean }) => {
    agentLedgerTraceRequestIdRef.current += 1;
    setAgentLedgerTraceResolvedTraceId("");
    setAgentLedgerTraceHasQueried(false);
    setAgentLedgerTraceLoading(false);
    setAgentLedgerTraceSummary(null);
    setAgentLedgerTraceAuditEvents([]);
    setAgentLedgerTraceReadiness(null);
    setAgentLedgerTraceHealth(null);
    setAgentLedgerTraceOutbox(null);
    setAgentLedgerTraceOutboxSummary(null);
    setAgentLedgerTraceAttempts(null);
    setAgentLedgerTraceAttemptSummary(null);
    setAgentLedgerTraceReplayAudits(null);
    setAgentLedgerTraceReplayAuditSummary(null);
    clearSectionError("agentLedgerTrace");
    if (options?.clearInput) {
      setAgentLedgerTraceInput("");
    }
    if (!options?.preserveAvailability) {
      setAgentLedgerTraceOutboxApiAvailable(true);
      setAgentLedgerTraceAttemptApiAvailable(true);
      setAgentLedgerTraceReplayAuditApiAvailable(true);
    }
  };

  const handleAgentLedgerTraceInputChange = (value: string) => {
    setAgentLedgerTraceInput(value);
    if (sectionErrors.agentLedgerTrace) {
      clearSectionError("agentLedgerTrace");
    }
  };

  const closeAgentLedgerDeliveryAttemptPanel = (preserveAvailability = true) => {
    agentLedgerDeliveryAttemptRequestIdRef.current += 1;
    setAgentLedgerDeliveryAttemptsOpenOutboxId(null);
    setAgentLedgerDeliveryAttempts(null);
    setAgentLedgerDeliveryAttemptSummary(null);
    setAgentLedgerDeliveryAttemptLoading(false);
    setAgentLedgerDeliveryAttemptError("");
    if (!preserveAvailability) {
      setAgentLedgerDeliveryAttemptApiAvailable(true);
    }
  };

  const loadAgentLedgerDeliveryAttempts = async (outboxId: number, page = 1) => {
    const normalizedOutboxId = Math.max(0, Math.floor(Number(outboxId) || 0));
    if (normalizedOutboxId <= 0) {
      closeAgentLedgerDeliveryAttemptPanel();
      setAgentLedgerDeliveryAttemptError("无效的 outbox id");
      return;
    }

    const requestId = agentLedgerDeliveryAttemptRequestIdRef.current + 1;
    agentLedgerDeliveryAttemptRequestIdRef.current = requestId;
    setAgentLedgerDeliveryAttemptsOpenOutboxId(normalizedOutboxId);
    setAgentLedgerDeliveryAttemptLoading(true);
    setAgentLedgerDeliveryAttemptError("");

    const baseQuery: Omit<AgentLedgerDeliveryAttemptQuery, "page" | "pageSize"> = {
      outboxId: normalizedOutboxId,
    };

    try {
      const [listRespResult, summaryRespResult] = await Promise.allSettled([
        enterpriseAdminClient.listAgentLedgerDeliveryAttempts({
          ...baseQuery,
          page,
          pageSize: 10,
        }),
        enterpriseAdminClient.getAgentLedgerDeliveryAttemptSummary(baseQuery),
      ]);

      if (listRespResult.status === "rejected") {
        throw listRespResult.reason;
      }
      if (summaryRespResult.status === "rejected") {
        throw summaryRespResult.reason;
      }

      const listResp = listRespResult.value;
      const summaryResp = summaryRespResult.value;

      if (
        listResp.status === 404 ||
        listResp.status === 405 ||
        summaryResp.status === 404 ||
        summaryResp.status === 405
      ) {
        if (agentLedgerDeliveryAttemptRequestIdRef.current !== requestId) return;
        setAgentLedgerDeliveryAttempts(null);
        setAgentLedgerDeliveryAttemptSummary(null);
        setAgentLedgerDeliveryAttemptApiAvailable(false);
        setAgentLedgerDeliveryAttemptError("");
        return;
      }

      if (!listResp.ok) {
        const payload = await readJsonSafely(listResp);
        throw new Error(
          buildTraceableErrorMessage(
            payload,
            "加载 AgentLedger delivery attempts 列表失败",
            extractTraceIdFromResponse(listResp, payload),
          ),
        );
      }
      if (!summaryResp.ok) {
        const payload = await readJsonSafely(summaryResp);
        throw new Error(
          buildTraceableErrorMessage(
            payload,
            "加载 AgentLedger delivery attempts 汇总失败",
            extractTraceIdFromResponse(summaryResp, payload),
          ),
        );
      }

      const listJson = await readJsonSafely(listResp);
      const summaryJson = await readJsonSafely(summaryResp);
      if (agentLedgerDeliveryAttemptRequestIdRef.current !== requestId) return;
      setAgentLedgerDeliveryAttempts(normalizeAgentLedgerDeliveryAttemptQueryResult(listJson));
      setAgentLedgerDeliveryAttemptSummary(normalizeAgentLedgerDeliveryAttemptSummary(summaryJson));
      setAgentLedgerDeliveryAttemptApiAvailable(true);
      setAgentLedgerDeliveryAttemptError("");
    } catch (error) {
      if (agentLedgerDeliveryAttemptRequestIdRef.current !== requestId) return;
      setAgentLedgerDeliveryAttempts(null);
      setAgentLedgerDeliveryAttemptSummary(null);
      setAgentLedgerDeliveryAttemptApiAvailable(true);
      setAgentLedgerDeliveryAttemptError(
        getErrorMessage(error, "加载 AgentLedger delivery attempts 失败"),
      );
      throw error;
    } finally {
      if (agentLedgerDeliveryAttemptRequestIdRef.current === requestId) {
        setAgentLedgerDeliveryAttemptLoading(false);
      }
    }
  };

  const loadAgentLedgerOutbox = async (page = 1) =>
    runSectionLoad("agentLedgerOutbox", async () => {
      const baseQuery = buildAgentLedgerOutboxBaseQuery({
        deliveryState: agentLedgerOutboxDeliveryStateFilter,
        status: agentLedgerOutboxStatusFilter,
        provider: agentLedgerOutboxProviderFilter,
        tenantId: agentLedgerOutboxTenantFilter,
        traceId: agentLedgerOutboxTraceFilter,
        from: agentLedgerOutboxFromFilter,
        to: agentLedgerOutboxToFilter,
      });
      const [listRespResult, summaryRespResult, readinessRespResult, healthRespResult] =
        await Promise.allSettled([
        enterpriseAdminClient.listAgentLedgerOutbox({
          ...baseQuery,
          page,
          pageSize: 10,
        }),
        enterpriseAdminClient.getAgentLedgerOutboxSummary(baseQuery),
        enterpriseAdminClient.getAgentLedgerOutboxReadiness(),
        enterpriseAdminClient.getAgentLedgerOutboxHealth(),
      ]);

      if (listRespResult.status === "rejected") {
        throw listRespResult.reason;
      }
      if (summaryRespResult.status === "rejected") {
        throw summaryRespResult.reason;
      }

      const listResp = listRespResult.value;
      const summaryResp = summaryRespResult.value;

      if (
        listResp.status === 404 ||
        listResp.status === 405 ||
        summaryResp.status === 404 ||
        summaryResp.status === 405
      ) {
        setAgentLedgerOutboxApiAvailable(false);
        setAgentLedgerOutbox(null);
        setAgentLedgerOutboxSummary(null);
        setAgentLedgerOutboxReadiness(null);
        setAgentLedgerOutboxReadinessApiAvailable(false);
        setAgentLedgerOutboxReadinessError("");
        setAgentLedgerOutboxHealth(null);
        setAgentLedgerOutboxHealthApiAvailable(false);
        setAgentLedgerOutboxHealthError("");
        setAgentLedgerOutboxSelectedIds([]);
        closeAgentLedgerDeliveryAttemptPanel(false);
        return;
      }
      if (!listResp.ok) {
        throw new Error("加载 AgentLedger outbox 列表失败");
      }
      if (!summaryResp.ok) {
        throw new Error("加载 AgentLedger outbox 汇总失败");
      }

      const listJson = await readJsonSafely(listResp);
      const summaryJson = await readJsonSafely(summaryResp);
      const normalizedOutbox = normalizeAgentLedgerOutboxQueryResult(listJson);
      setAgentLedgerOutbox(normalizedOutbox);
      setAgentLedgerOutboxSummary(normalizeAgentLedgerOutboxSummary(summaryJson));
      setAgentLedgerOutboxApiAvailable(true);
      setAgentLedgerOutboxSelectedIds([]);
      if (
        agentLedgerDeliveryAttemptsOpenOutboxId !== null &&
        !normalizedOutbox.data.some((item) => item.id === agentLedgerDeliveryAttemptsOpenOutboxId)
      ) {
        closeAgentLedgerDeliveryAttemptPanel();
      }

      let readinessData: AgentLedgerOutboxReadiness | null = null;
      let readinessRouteAvailable = false;

      if (readinessRespResult.status === "fulfilled") {
        const readinessResp = readinessRespResult.value;
        if (readinessResp.status === 404 || readinessResp.status === 405) {
          setAgentLedgerOutboxReadiness(null);
          setAgentLedgerOutboxReadinessApiAvailable(false);
          setAgentLedgerOutboxReadinessError("");
        } else {
          readinessRouteAvailable = true;
          const payload = await readJsonSafely(readinessResp);
          const normalizedReadiness = normalizeAgentLedgerOutboxReadiness(payload);
          if (normalizedReadiness) {
            readinessData = normalizedReadiness;
            setAgentLedgerOutboxReadiness(normalizedReadiness);
            setAgentLedgerOutboxReadinessApiAvailable(true);
            setAgentLedgerOutboxReadinessError("");
          } else {
            setAgentLedgerOutboxReadiness(null);
            setAgentLedgerOutboxReadinessApiAvailable(true);
            setAgentLedgerOutboxReadinessError(
              buildTraceableErrorMessage(
                payload,
                "加载 AgentLedger readiness 失败",
                extractTraceIdFromResponse(readinessResp, payload),
              ),
            );
          }
        }
      } else {
        setAgentLedgerOutboxReadiness(null);
        setAgentLedgerOutboxReadinessApiAvailable(true);
        setAgentLedgerOutboxReadinessError(
          getErrorMessage(readinessRespResult.reason, "加载 AgentLedger readiness 失败"),
        );
      }

      if (readinessData?.health) {
        setAgentLedgerOutboxHealth(readinessData.health);
        setAgentLedgerOutboxHealthApiAvailable(true);
        setAgentLedgerOutboxHealthError("");
        return;
      }

      if (healthRespResult.status === "fulfilled") {
        const healthResp = healthRespResult.value;
        if (healthResp.status === 404 || healthResp.status === 405) {
          setAgentLedgerOutboxHealth(null);
          setAgentLedgerOutboxHealthApiAvailable(readinessRouteAvailable);
          setAgentLedgerOutboxHealthError("");
        } else if (!healthResp.ok) {
          const payload = await readJsonSafely(healthResp);
          setAgentLedgerOutboxHealth(null);
          setAgentLedgerOutboxHealthApiAvailable(true);
          setAgentLedgerOutboxHealthError(
            buildTraceableErrorMessage(
              payload,
              "加载 AgentLedger 健康摘要失败",
              extractTraceIdFromResponse(healthResp, payload),
            ),
          );
        } else {
          const healthJson = await readJsonSafely(healthResp);
          setAgentLedgerOutboxHealth(normalizeAgentLedgerOutboxHealth(healthJson));
          setAgentLedgerOutboxHealthApiAvailable(true);
          setAgentLedgerOutboxHealthError("");
        }
      } else {
        setAgentLedgerOutboxHealth(null);
        setAgentLedgerOutboxHealthApiAvailable(true);
        setAgentLedgerOutboxHealthError(
          getErrorMessage(healthRespResult.reason, "加载 AgentLedger 健康摘要失败"),
        );
      }
    }, "加载 AgentLedger outbox 失败");

  const loadAgentLedgerReplayAudits = async (page = 1) =>
    runSectionLoad("agentLedgerReplayAudits", async () => {
      const baseQuery = buildAgentLedgerReplayAuditBaseQuery({
        outboxId: agentLedgerReplayAuditOutboxIdFilter,
        traceId: agentLedgerReplayAuditTraceFilter,
        operatorId: agentLedgerReplayAuditOperatorFilter,
        result: agentLedgerReplayAuditResultFilter,
        triggerSource: agentLedgerReplayAuditTriggerSourceFilter,
        from: agentLedgerReplayAuditFromFilter,
        to: agentLedgerReplayAuditToFilter,
      });
      const [listRespResult, summaryRespResult] = await Promise.allSettled([
        enterpriseAdminClient.listAgentLedgerReplayAudits({
          ...baseQuery,
          page,
          pageSize: 10,
        }),
        enterpriseAdminClient.getAgentLedgerReplayAuditSummary(baseQuery),
      ]);

      if (listRespResult.status === "rejected") {
        throw listRespResult.reason;
      }
      if (summaryRespResult.status === "rejected") {
        throw summaryRespResult.reason;
      }

      const listResp = listRespResult.value;
      const summaryResp = summaryRespResult.value;
      if (
        listResp.status === 404 ||
        listResp.status === 405 ||
        summaryResp.status === 404 ||
        summaryResp.status === 405
      ) {
        setAgentLedgerReplayAuditApiAvailable(false);
        setAgentLedgerReplayAudits(null);
        setAgentLedgerReplayAuditSummary(null);
        return;
      }
      if (!listResp.ok) {
        throw new Error("加载 AgentLedger replay 审计列表失败");
      }
      if (!summaryResp.ok) {
        throw new Error("加载 AgentLedger replay 审计汇总失败");
      }

      const listJson = await listResp.json();
      const summaryJson = await summaryResp.json();
      setAgentLedgerReplayAudits(normalizeAgentLedgerReplayAuditQueryResult(listJson));
      setAgentLedgerReplayAuditSummary(normalizeAgentLedgerReplayAuditSummary(summaryJson));
      setAgentLedgerReplayAuditApiAvailable(true);
    }, "加载 AgentLedger replay 审计失败");

  const loadAgentLedgerTrace = async (traceIdInput?: string) => {
    const normalizedTraceId = (traceIdInput ?? agentLedgerTraceInput).trim();
    if (!normalizedTraceId) {
      setSectionError("agentLedgerTrace", "请输入 traceId 后再执行联查");
      return;
    }

    const requestId = agentLedgerTraceRequestIdRef.current + 1;
    agentLedgerTraceRequestIdRef.current = requestId;
    setAgentLedgerTraceHasQueried(true);
    setAgentLedgerTraceLoading(true);
    setAgentLedgerTraceResolvedTraceId(normalizedTraceId);
    clearSectionError("agentLedgerTrace");
    try {
      const resp = await enterpriseAdminClient.getAgentLedgerTrace(normalizedTraceId);
      const payload = await readJsonSafely(resp);
      if (agentLedgerTraceRequestIdRef.current !== requestId) {
        return;
      }

      if (resp.status === 404) {
        setAgentLedgerTraceSummary(null);
        setAgentLedgerTraceAuditEvents([]);
        setAgentLedgerTraceReadiness(null);
        setAgentLedgerTraceHealth(null);
        setAgentLedgerTraceOutbox(buildAgentLedgerTracePageResult([]));
        setAgentLedgerTraceOutboxSummary(summarizeAgentLedgerTraceOutbox([]));
        setAgentLedgerTraceAttempts(buildAgentLedgerTracePageResult([]));
        setAgentLedgerTraceAttemptSummary(summarizeAgentLedgerTraceAttempts([]));
        setAgentLedgerTraceReplayAudits(buildAgentLedgerTracePageResult([]));
        setAgentLedgerTraceReplayAuditSummary(summarizeAgentLedgerTraceReplayAudits([]));
        setAgentLedgerTraceOutboxApiAvailable(true);
        setAgentLedgerTraceAttemptApiAvailable(true);
        setAgentLedgerTraceReplayAuditApiAvailable(true);
        setSectionError(
          "agentLedgerTrace",
          buildTraceableErrorMessage(
            payload,
            "未找到对应 traceId 的 AgentLedger 联查记录",
            extractTraceIdFromResponse(resp, payload),
          ),
        );
        return;
      }

      if (!resp.ok) {
        throw new Error(
          buildTraceableErrorMessage(
            payload,
            "加载 AgentLedger trace 联查失败",
            extractTraceIdFromResponse(resp, payload),
          ),
        );
      }

      const normalized = normalizeAgentLedgerTraceDrilldownResult(payload);
      if (!normalized) {
        throw new Error("AgentLedger trace 联查返回数据格式无效");
      }

      setAgentLedgerTraceSummary(normalized.summary);
      setAgentLedgerTraceAuditEvents(normalized.auditEvents);
      setAgentLedgerTraceReadiness(normalized.readiness);
      setAgentLedgerTraceHealth(normalized.health);
      setAgentLedgerTraceOutbox(buildAgentLedgerTracePageResult(normalized.outbox));
      setAgentLedgerTraceOutboxSummary(summarizeAgentLedgerTraceOutbox(normalized.outbox));
      setAgentLedgerTraceAttempts(buildAgentLedgerTracePageResult(normalized.deliveryAttempts));
      setAgentLedgerTraceAttemptSummary(
        summarizeAgentLedgerTraceAttempts(normalized.deliveryAttempts),
      );
      setAgentLedgerTraceReplayAudits(buildAgentLedgerTracePageResult(normalized.replayAudits));
      setAgentLedgerTraceReplayAuditSummary(
        summarizeAgentLedgerTraceReplayAudits(normalized.replayAudits),
      );
      setAgentLedgerTraceOutboxApiAvailable(true);
      setAgentLedgerTraceAttemptApiAvailable(true);
      setAgentLedgerTraceReplayAuditApiAvailable(true);
      clearSectionError("agentLedgerTrace");
    } catch (error) {
      if (agentLedgerTraceRequestIdRef.current !== requestId) {
        return;
      }
      setAgentLedgerTraceSummary(null);
      setAgentLedgerTraceAuditEvents([]);
      setAgentLedgerTraceReadiness(null);
      setAgentLedgerTraceHealth(null);
      setAgentLedgerTraceOutbox(null);
      setAgentLedgerTraceOutboxSummary(null);
      setAgentLedgerTraceAttempts(null);
      setAgentLedgerTraceAttemptSummary(null);
      setAgentLedgerTraceReplayAudits(null);
      setAgentLedgerTraceReplayAuditSummary(null);
      setAgentLedgerTraceOutboxApiAvailable(true);
      setAgentLedgerTraceAttemptApiAvailable(true);
      setAgentLedgerTraceReplayAuditApiAvailable(true);
      setSectionError("agentLedgerTrace", getErrorMessage(error, "加载 AgentLedger trace 联查失败"));
    } finally {
      if (agentLedgerTraceRequestIdRef.current === requestId) {
        setAgentLedgerTraceLoading(false);
      }
    }
  };

  const loadFallbackEvents = async (page = 1) =>
    runSectionLoad("fallback", async () => {
      const fromParam = normalizeDateTimeParam(fallbackFromFilter);
      const toParam = normalizeDateTimeParam(fallbackToFilter);
      const resp = await enterpriseAdminClient.listClaudeFallbackEvents({
        page,
        pageSize: 10,
        mode: fallbackModeFilter || undefined,
        phase: fallbackPhaseFilter || undefined,
        reason: fallbackReasonFilter || undefined,
        traceId: fallbackTraceFilter || undefined,
        from: fromParam,
        to: toParam,
      });
      if (!resp.ok) throw new Error("加载 Claude 回退事件失败");
      const json = await resp.json();
      setFallbackEvents(json as ClaudeFallbackQueryResult);
    }, "加载 Claude 回退事件失败");

  const loadFallbackSummary = async () =>
    runSectionLoad("fallback", async () => {
      const fromParam = normalizeDateTimeParam(fallbackFromFilter);
      const toParam = normalizeDateTimeParam(fallbackToFilter);
      const resp = await enterpriseAdminClient.getClaudeFallbackSummary({
        mode: fallbackModeFilter || undefined,
        phase: fallbackPhaseFilter || undefined,
        reason: fallbackReasonFilter || undefined,
        traceId: fallbackTraceFilter || undefined,
        from: fromParam,
        to: toParam,
      });
      if (!resp.ok) throw new Error("加载 Claude 回退聚合失败");
      const json = await resp.json();
      setFallbackSummary((json.data || null) as ClaudeFallbackSummary | null);
    }, "加载 Claude 回退聚合失败");

  const loadFallbackTimeseries = async () =>
    runSectionLoad("fallback", async () => {
      const fromParam = normalizeDateTimeParam(fallbackFromFilter);
      const toParam = normalizeDateTimeParam(fallbackToFilter);
      const resp = await enterpriseAdminClient.getClaudeFallbackTimeseries({
        mode: fallbackModeFilter || undefined,
        phase: fallbackPhaseFilter || undefined,
        reason: fallbackReasonFilter || undefined,
        traceId: fallbackTraceFilter || undefined,
        from: fromParam,
        to: toParam,
        step: fallbackStep,
      });
      if (!resp.ok) throw new Error("加载 Claude 回退趋势失败");
      const json = (await resp.json()) as ClaudeFallbackTimeseriesResult;
      setFallbackTimeseries(json.data || []);
    }, "加载 Claude 回退趋势失败");

  const loadFallbackTimeseriesSafely = async () => {
    try {
      await loadFallbackTimeseries();
    } catch {
      setFallbackTimeseries([]);
      toast.error("Claude 回退趋势加载失败");
    }
  };

  const loadFallbackTimeseriesForBootstrap = async () => {
    try {
      await loadFallbackTimeseries();
    } catch (error) {
      setFallbackTimeseries([]);
      toast.error("Claude 回退趋势加载失败");
      throw error;
    }
  };

  const loadUsageRows = async (filters?: BillingUsageFilterInput) =>
    runSectionLoad("usage", async () => {
      const policyId = (filters?.policyId ?? usagePolicyIdFilter).trim();
      const bucketType = filters?.bucketType ?? usageBucketTypeFilter;
      const provider = (filters?.provider ?? usageProviderFilter).trim();
      const model = (filters?.model ?? usageModelFilter).trim();
      const tenantId = (filters?.tenantId ?? usageTenantFilter).trim();
      const from = filters?.from ?? usageFromFilter;
      const to = filters?.to ?? usageToFilter;
      const page = Math.max(1, Math.floor(filters?.page ?? usagePage));
      const pageSize = Math.min(
        500,
        Math.max(1, Math.floor(filters?.pageSize ?? usagePageSize)),
      );
      const fromParam = normalizeDateTimeParam(from);
      const toParam = normalizeDateTimeParam(to);

      const resp = await enterpriseAdminClient.listBillingUsage({
        policyId: policyId || undefined,
        bucketType: bucketType || undefined,
        provider: provider || undefined,
        model: model || undefined,
        tenantId: tenantId || undefined,
        from: fromParam,
        to: toParam,
        page,
        pageSize,
      });
      if (!resp.ok) throw new Error("加载配额使用记录失败");
      const json = (await resp.json()) as BillingUsageQueryResult;
      setUsageRows((json.data || []) as BillingUsageItem[]);
      setUsagePage(json.page || page);
      setUsageTotal(json.total || 0);
      setUsageTotalPages(Math.max(1, json.totalPages || 1));
    }, "加载配额使用记录失败");

  const loadCapabilityHealth = async () => {
    const resp = await enterpriseAdminClient.getCapabilityHealth();
    if (!resp.ok) {
      throw new Error("加载能力健康状态失败");
    }
    const json = await resp.json();
    const health = (json.data || null) as CapabilityRuntimeHealthData | null;
    setCapabilityHealth(health);
    setCapabilityHealthError("");
    return health;
  };

  const loadModelAlias = async () => {
    const resp = await enterpriseAdminClient.getModelAlias();
    if (resp.status === 404 || resp.status === 405) {
      setOAuthGovernanceModelAliasApiAvailable(false);
      setOAuthGovernanceModelAlias({});
      setOAuthGovernanceModelAliasText("{}");
      return {};
    }
    if (!resp.ok) {
      const payload = await readJsonSafely(resp);
      throw new Error(buildTraceableErrorMessage(payload, "加载模型别名规则失败"));
    }
    const json = await readJsonSafely(resp);
    const payload = formatModelAliasEditorText(toObject(json).data);
    const normalized = parseModelAliasEditorText(payload);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    setOAuthGovernanceModelAlias(normalized.value);
    setOAuthGovernanceModelAliasText(payload);
    setOAuthGovernanceModelAliasApiAvailable(true);
    return normalized.value;
  };

  const loadExcludedModels = async () => {
    const resp = await enterpriseAdminClient.getExcludedModels();
    if (resp.status === 404 || resp.status === 405) {
      setOAuthGovernanceExcludedModelsApiAvailable(false);
      setOAuthGovernanceExcludedModels([]);
      setOAuthGovernanceExcludedModelsText("");
      return [];
    }
    if (!resp.ok) {
      const payload = await readJsonSafely(resp);
      throw new Error(buildTraceableErrorMessage(payload, "加载禁用模型列表失败"));
    }
    const json = await readJsonSafely(resp);
    const normalized = parseExcludedModelsEditorText(
      formatExcludedModelsEditorText(toObject(json).data),
    );
    setOAuthGovernanceExcludedModels(normalized);
    setOAuthGovernanceExcludedModelsText(normalized.join("\n"));
    setOAuthGovernanceExcludedModelsApiAvailable(true);
    return normalized;
  };

  const loadUsers = async () => {
    const resp = await enterpriseAdminClient.listUsers();
    if (!resp.ok) throw new Error("加载用户失败");
    const json = await resp.json();
    setUsers((json.data || []) as AdminUserItem[]);
  };

  const loadTenants = async () => {
    const resp = await enterpriseAdminClient.listTenants();
    if (!resp.ok) throw new Error("加载租户失败");
    const json = await resp.json();
    setTenants((json.data || []) as TenantItem[]);
  };

  const loadPolicies = async () => {
    const resp = await enterpriseAdminClient.listPolicies();
    if (!resp.ok) throw new Error("加载配额策略失败");
    const json = await resp.json();
    const normalized = ((json.data || []) as QuotaPolicyItem[]).map((item) => ({
      ...item,
      enabled: item.enabled !== false,
    }));
    setPolicies(normalized);
  };

  const startBootstrapSectionLoads = () => {
    const sectionGroups: Array<{
      section: EnterpriseLoadSection;
      tasks: BootstrapSectionTask[];
    }> = [
      {
        section: "oauthAlertConfig",
        tasks: [{ label: "OAuth 告警配置", run: () => loadOAuthAlertCenterConfig() }],
      },
      {
        section: "oauthAlertIncidents",
        tasks: [{ label: "OAuth 告警 incidents", run: () => loadOAuthAlertIncidents(1) }],
      },
      {
        section: "oauthAlertDeliveries",
        tasks: [{ label: "OAuth 告警 deliveries", run: () => loadOAuthAlertDeliveries(1) }],
      },
      {
        section: "oauthAlertRules",
        tasks: [
          { label: "OAuth 告警规则当前版本", run: () => loadOAuthAlertRuleActiveVersion() },
          { label: "OAuth 告警规则版本列表", run: () => loadOAuthAlertRuleVersions(1) },
        ],
      },
      {
        section: "alertmanager",
        tasks: [
          { label: "Alertmanager 配置", run: () => loadAlertmanagerConfig() },
          { label: "Alertmanager 同步历史", run: () => loadAlertmanagerSyncHistory() },
        ],
      },
      {
        section: "audit",
        tasks: [{ label: "审计日志", run: () => loadAuditEvents(1, auditKeyword) }],
      },
      {
        section: "callbackEvents",
        tasks: [{ label: "OAuth 回调事件", run: () => loadCallbackEvents(1) }],
      },
      {
        section: "sessionEvents",
        tasks: [{ label: "OAuth 会话事件", run: () => loadSessionEvents(1) }],
      },
      {
        section: "agentLedgerOutbox",
        tasks: [{ label: "AgentLedger outbox", run: () => loadAgentLedgerOutbox(1) }],
      },
      {
        section: "agentLedgerReplayAudits",
        tasks: [{ label: "AgentLedger replay 审计", run: () => loadAgentLedgerReplayAudits(1) }],
      },
      {
        section: "fallback",
        tasks: [
          { label: "Claude 回退事件", run: () => loadFallbackEvents(1) },
          { label: "Claude 回退聚合", run: () => loadFallbackSummary() },
          { label: "Claude 回退趋势", run: () => loadFallbackTimeseriesForBootstrap() },
        ],
      },
      {
        section: "usage",
        tasks: [{ label: "配额使用记录", run: () => loadUsageRows() }],
      },
    ];

    for (const group of sectionGroups) {
      void runBootstrapSectionTasks(group.section, group.tasks);
    }

    void loadOrgDomainData(true);
  };

  const bootstrap = async () => {
    setLoading(true);
    setAdminAuthenticated(false);
    setCapabilityHealthError("");
    setSectionErrors(EMPTY_ENTERPRISE_SECTION_ERRORS);
    const featureJson = await loadFeaturePayload();
    if (!featureJson) {
      toast.error("企业能力加载失败");
      setSectionError("baseData", "企业能力加载失败，请刷新后重试。");
      setLoading(false);
      return;
    }
    setFeaturePayload(featureJson);
    const advancedEnabled = isEnterpriseFeatureEnabled(featureJson);
    setEnterpriseEnabled(advancedEnabled);

    if (!advancedEnabled) {
      setLoading(false);
      return;
    }

    const backendProbe = (featureJson as FeaturePayload | null)?.enterpriseBackend;
    if (!backendProbe?.reachable) {
      const baseUrl = backendProbe?.baseUrl ? ` (${backendProbe.baseUrl})` : "";
      const detail = backendProbe?.error ? `：${backendProbe.error}` : "";
      toast.error(`企业后端不可用${baseUrl}${detail}`);
      setSectionError("baseData", `企业后端不可用${baseUrl}${detail}`);
      setLoading(false);
      setAdminAuthenticated(false);
      return;
    }

    const meRes = await enterpriseAdminClient.getAdminSession();
    if (meRes.status === 503) {
      toast.error("企业后端不可用，请检查 enterprise 服务与代理配置");
      setSectionError("baseData", "企业后端不可用，请检查 enterprise 服务与代理配置。");
      setLoading(false);
      setAdminAuthenticated(false);
      return;
    }
    const meJson = (await meRes.json().catch(() => ({ authenticated: false }))) as {
      authenticated?: boolean;
    };
    if (!meRes.ok || meJson.authenticated !== true) {
      setLoading(false);
      setAdminAuthenticated(false);
      return;
    }
    setAdminAuthenticated(true);

    const [
      roleRes,
      permRes,
      quotaRes,
      routePoliciesRes,
      capabilityRes,
      capabilityHealthRes,
      modelAliasRes,
      excludedModelsRes,
      userRes,
      tenantRes,
      policyRes,
    ] = await Promise.allSettled([
      enterpriseAdminClient.listRoles(),
      enterpriseAdminClient.listPermissions(),
      enterpriseAdminClient.getBillingQuotas(),
      enterpriseAdminClient.getRoutePolicies(),
      enterpriseAdminClient.getCapabilityMap(),
      enterpriseAdminClient.getCapabilityHealth(),
      loadModelAlias(),
      loadExcludedModels(),
      enterpriseAdminClient.listUsers(),
      enterpriseAdminClient.listTenants(),
      enterpriseAdminClient.listPolicies(),
    ]);

    if (roleRes.status === "fulfilled" && roleRes.value.ok) {
      const json = await roleRes.value.json();
      setRoles(json.data || []);
    }
    if (permRes.status === "fulfilled" && permRes.value.ok) {
      const json = await permRes.value.json();
      setPermissions(json.data || []);
    }
    if (quotaRes.status === "fulfilled" && quotaRes.value.ok) {
      const json = await quotaRes.value.json();
      setQuotas(json.data || null);
    }
    if (routePoliciesRes.status === "fulfilled" && routePoliciesRes.value.ok) {
      const json = await routePoliciesRes.value.json();
      setSelectionPolicy((json.data?.selection || null) as SelectionPolicyData | null);
      setRouteExecutionPolicy(
        (json.data?.execution || null) as RouteExecutionPolicyData | null,
      );
    }
    if (capabilityRes.status === "fulfilled" && capabilityRes.value.ok) {
      const json = await capabilityRes.value.json();
      const map = (json.data || {}) as ProviderCapabilityMapData;
      setCapabilityMap(map);
      setCapabilityMapText(JSON.stringify(map, null, 2));
    }
    if (capabilityHealthRes.status === "fulfilled" && capabilityHealthRes.value.ok) {
      const json = await capabilityHealthRes.value.json();
      setCapabilityHealth((json.data || null) as CapabilityRuntimeHealthData | null);
      setCapabilityHealthError("");
    } else {
      setCapabilityHealth(null);
      setCapabilityHealthError("能力健康状态加载失败，请稍后重试。");
    }
    if (userRes.status === "fulfilled" && userRes.value.ok) {
      const json = await userRes.value.json();
      setUsers((json.data || []) as AdminUserItem[]);
    }
    if (tenantRes.status === "fulfilled" && tenantRes.value.ok) {
      const json = await tenantRes.value.json();
      setTenants((json.data || []) as TenantItem[]);
    }
    if (policyRes.status === "fulfilled" && policyRes.value.ok) {
      const json = await policyRes.value.json();
      const normalized = ((json.data || []) as QuotaPolicyItem[]).map((item) => ({
        ...item,
        enabled: item.enabled !== false,
      }));
      setPolicies(normalized);
    }

    const baseDataErrors = collectRejectedMessages([
      { label: "角色", result: roleRes },
      { label: "权限词典", result: permRes },
      { label: "基础配额", result: quotaRes },
      { label: "路由策略", result: routePoliciesRes },
      { label: "能力图谱", result: capabilityRes },
      { label: "能力健康状态", result: capabilityHealthRes },
      { label: "模型别名", result: modelAliasRes },
      { label: "禁用模型", result: excludedModelsRes },
      { label: "用户", result: userRes },
      { label: "租户", result: tenantRes },
      { label: "配额策略", result: policyRes },
    ]);

    if (baseDataErrors.length > 0) {
      setSectionError("baseData", baseDataErrors.join("；"));
    } else {
      clearSectionError("baseData");
    }

    setLoading(false);
    startBootstrapSectionLoads();
  };

  const handleAdminLogin = async () => {
    if (!adminUsername.trim() || !adminPassword) {
      toast.error("请输入管理员账号和密码");
      return;
    }

    setAuthSubmitting(true);
    try {
      const resp = await enterpriseAdminClient.login({
        username: adminUsername.trim(),
        password: adminPassword,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({} as { error?: string }));
        toast.error(data.error || "管理员登录失败");
        return;
      }
      toast.success("管理员登录成功");
      setAdminPassword("");
      await bootstrap();
    } catch {
      toast.error("管理员登录失败");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await enterpriseAdminClient.logout();
    } catch {
      // ignore
    }
    setAdminAuthenticated(false);
    setRoles([]);
    setPermissions([]);
    setAuditResult(null);
    setQuotas(null);
    setSelectionPolicy(null);
    setRouteExecutionPolicy(null);
    setCapabilityMap({});
    setCapabilityMapText("{}");
    setCapabilityHealth(null);
    setCapabilityHealthLoading(false);
    setCapabilityHealthError("");
    setOAuthGovernanceModelAlias({});
    setOAuthGovernanceModelAliasText("{}");
    setOAuthGovernanceModelAliasSaving(false);
    setOAuthGovernanceModelAliasApiAvailable(true);
    setOAuthGovernanceExcludedModels([]);
    setOAuthGovernanceExcludedModelsText("");
    setOAuthGovernanceExcludedModelsSaving(false);
    setOAuthGovernanceExcludedModelsApiAvailable(true);
    setUsers([]);
    setTenants([]);
    setPolicies([]);
    setCallbackEvents(null);
    setSessionEvents(null);
    setSessionEventsApiAvailable(true);
    setAgentLedgerOutbox(null);
    setAgentLedgerOutboxSummary(null);
    setAgentLedgerOutboxApiAvailable(true);
    setAgentLedgerOutboxReadiness(null);
    setAgentLedgerOutboxReadinessApiAvailable(true);
    setAgentLedgerOutboxReadinessError("");
    setAgentLedgerOutboxHealth(null);
    setAgentLedgerOutboxHealthApiAvailable(true);
    setAgentLedgerOutboxHealthError("");
    setAgentLedgerOutboxDeliveryStateFilter("");
    setAgentLedgerOutboxStatusFilter("");
    setAgentLedgerOutboxProviderFilter("");
    setAgentLedgerOutboxTenantFilter("");
    setAgentLedgerOutboxTraceFilter("");
    setAgentLedgerOutboxFromFilter("");
    setAgentLedgerOutboxToFilter("");
    setAgentLedgerOutboxReplayingId(null);
    setAgentLedgerOutboxSelectedIds([]);
    setAgentLedgerOutboxBatchReplaying(false);
    closeAgentLedgerDeliveryAttemptPanel(false);
    setAgentLedgerReplayAudits(null);
    setAgentLedgerReplayAuditSummary(null);
    setAgentLedgerReplayAuditApiAvailable(true);
    setAgentLedgerReplayAuditOutboxIdFilter("");
    setAgentLedgerReplayAuditTraceFilter("");
    setAgentLedgerReplayAuditOperatorFilter("");
    setAgentLedgerReplayAuditResultFilter("");
    setAgentLedgerReplayAuditTriggerSourceFilter("");
    setAgentLedgerReplayAuditFromFilter("");
    setAgentLedgerReplayAuditToFilter("");
    resetAgentLedgerTraceState({
      clearInput: true,
    });
    setFallbackEvents(null);
    setFallbackSummary(null);
    setFallbackTimeseries([]);
    setOAuthAlertCenterApiAvailable(true);
    setOAuthAlertConfig(DEFAULT_OAUTH_ALERT_CENTER_CONFIG);
    setOAuthAlertConfigSaving(false);
    setOAuthAlertIncidents(null);
    setOAuthAlertDeliveries(null);
    setOAuthAlertIncidentProviderFilter("");
    setOAuthAlertIncidentPhaseFilter("");
    setOAuthAlertIncidentSeverityFilter("");
    setOAuthAlertIncidentFromFilter("");
    setOAuthAlertIncidentToFilter("");
    setOAuthAlertDeliveryEventIdFilter("");
    setOAuthAlertDeliveryIncidentIdFilter("");
    setOAuthAlertDeliveryChannelFilter("");
    setOAuthAlertDeliveryStatusFilter("");
    setOAuthAlertDeliveryFromFilter("");
    setOAuthAlertDeliveryToFilter("");
    setOAuthAlertEvaluateForm({
      provider: "",
    });
    setOAuthAlertEvaluating(false);
    setOAuthAlertLastEvaluateResult("");
    setAlertmanagerApiAvailable(true);
    setAlertmanagerConfigSaving(false);
    setAlertmanagerSyncing(false);
    setAlertmanagerConfigText(DEFAULT_ALERTMANAGER_CONFIG_TEXT);
    setAlertmanagerConfig(null);
    setUseStructuredAlertmanagerEditor(true);
    setAlertmanagerStructuredDraft(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT);
    setAlertmanagerSyncHistory([]);
    setAlertmanagerLatestSync(null);
    setAlertmanagerHistoryPage(1);
    setAlertmanagerHistoryTotal(0);
    setAlertmanagerHistoryTotalPages(1);
    setAlertmanagerHistoryPageLoading(false);
    setAlertmanagerHistoryPageInput("1");
    setOAuthAlertRuleActiveVersion(null);
    setOAuthAlertRuleVersions(null);
    setOAuthAlertRulePageLoading(false);
    setOAuthAlertRulePageInput("1");
    setOAuthAlertRuleCreating(false);
    setOAuthAlertRuleRollingVersionId(null);
    setAlertmanagerHistoryRollingId("");
    setOAuthAlertRuleCreateText(DEFAULT_OAUTH_ALERT_RULE_CREATE_TEXT);
    setUseStructuredOAuthAlertRuleEditor(true);
    setOAuthAlertRuleStructuredDraft(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT);
    setUsageRows([]);
    setOrgOrganizations([]);
    setOrgProjects([]);
    setOrgMemberBindings([]);
    setOrgMemberProjectBindings([]);
    setOrgDomainApiAvailable(true);
    setOrgDomainReadOnlyFallback(false);
    setOrgOverview(null);
    setOrgOverviewApiAvailable(true);
    setOrgOverviewFromFallback(false);
    setOrgLoading(false);
    setOrgError("");
    setOrgForm({ name: "" });
    setOrgProjectForm({ name: "", organizationId: "" });
    setOrgProjectFilterOrganizationId("");
    setOrgMemberEditingId(null);
    setOrgMemberEditForm({ organizationId: "", projectIds: [] });
    toast.success("已退出管理员会话");
  };

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeTestAuditEvent = async () => {
    try {
      const resp = await enterpriseAdminClient.createAuditEvent({
        action: "admin.audit.write",
        resource: "enterprise-panel",
        result: "success",
        details: { source: "enterprise-ui", type: "manual-check" },
      });
      if (!resp.ok) {
        toast.error("写入测试审计事件失败");
        return;
      }
      toast.success("测试审计事件已写入");
      await loadAuditEvents(
        auditPage,
        auditKeyword,
        auditTraceId,
        auditAction,
        auditResource,
        auditResourceId,
        auditPolicyId,
        auditResultFilter,
        auditFrom,
        auditTo,
      );
    } catch {
      toast.error("写入测试审计事件失败");
    }
  };

  const saveSelectionPolicy = async () => {
    if (!selectionPolicy || !routeExecutionPolicy) return;
    try {
      const resp = await enterpriseAdminClient.updateRoutePolicies({
        selection: selectionPolicy,
        execution: routeExecutionPolicy,
      });
      if (!resp.ok) {
        toast.error("保存路由策略失败");
        return;
      }
      const json = await resp.json();
      setSelectionPolicy((json.data?.selection || selectionPolicy) as SelectionPolicyData);
      setRouteExecutionPolicy(
        (json.data?.execution || routeExecutionPolicy) as RouteExecutionPolicyData,
      );
      toast.success("路由策略已保存");
    } catch {
      toast.error("保存路由策略失败");
    }
  };

  const saveCapabilityMap = async () => {
    let parsed: ProviderCapabilityMapData;
    try {
      parsed = JSON.parse(capabilityMapText || "{}") as ProviderCapabilityMapData;
    } catch {
      toast.error("能力图谱 JSON 格式无效");
      return;
    }

    try {
      const resp = await enterpriseAdminClient.updateCapabilityMap(parsed);
      if (!resp.ok) {
        toast.error("保存能力图谱失败");
        return;
      }
      const json = await resp.json();
      const map = (json.data || parsed) as ProviderCapabilityMapData;
      setCapabilityMap(map);
      setCapabilityMapText(JSON.stringify(map, null, 2));

      let healthRefreshFailed = false;
      try {
        await loadCapabilityHealth();
      } catch {
        healthRefreshFailed = true;
        setCapabilityHealthError("能力健康状态加载失败，请稍后重试。");
      }
      toast.success(healthRefreshFailed ? "能力图谱已保存（健康状态未刷新）" : "能力图谱已保存");
    } catch {
      toast.error("保存能力图谱失败");
    }
  };

  const saveModelAlias = async () => {
    const parsed = parseModelAliasEditorText(oauthGovernanceModelAliasText);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }

    setOAuthGovernanceModelAliasSaving(true);
    try {
      const resp = await enterpriseAdminClient.updateModelAlias(parsed.value);
      if (resp.status === 404 || resp.status === 405) {
        setOAuthGovernanceModelAliasApiAvailable(false);
        toast.error("后端尚未开放模型别名治理接口");
        return;
      }
      if (!resp.ok) {
        const payload = await readJsonSafely(resp);
        throw new Error(buildTraceableErrorMessage(payload, "保存模型别名规则失败"));
      }

      await loadModelAlias();
      const payload = await readJsonSafely(resp);
      const traceId = extractTraceIdFromResponse(resp, payload);
      toast.success(traceId ? `模型别名规则已保存（traceId: ${traceId}）` : "模型别名规则已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存模型别名规则失败");
    } finally {
      setOAuthGovernanceModelAliasSaving(false);
    }
  };

  const saveExcludedModels = async () => {
    const payload = parseExcludedModelsEditorText(oauthGovernanceExcludedModelsText);
    setOAuthGovernanceExcludedModelsSaving(true);
    try {
      const resp = await enterpriseAdminClient.updateExcludedModels(payload);
      if (resp.status === 404 || resp.status === 405) {
        setOAuthGovernanceExcludedModelsApiAvailable(false);
        toast.error("后端尚未开放禁用模型治理接口");
        return;
      }
      if (!resp.ok) {
        const errorPayload = await readJsonSafely(resp);
        throw new Error(buildTraceableErrorMessage(errorPayload, "保存禁用模型列表失败"));
      }

      await loadExcludedModels();
      const responsePayload = await readJsonSafely(resp);
      const traceId = extractTraceIdFromResponse(resp, responsePayload);
      toast.success(traceId ? `禁用模型列表已保存（traceId: ${traceId}）` : "禁用模型列表已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存禁用模型列表失败");
    } finally {
      setOAuthGovernanceExcludedModelsSaving(false);
    }
  };

  const refreshModelAlias = () => {
    void loadModelAlias().catch(() => {
      toast.error("刷新模型别名规则失败");
    });
  };

  const refreshExcludedModels = () => {
    void loadExcludedModels().catch(() => {
      toast.error("刷新禁用模型列表失败");
    });
  };

  const refreshCapabilityHealth = async () => {
    setCapabilityHealthLoading(true);
    try {
      await loadCapabilityHealth();
      toast.success("能力健康状态已刷新");
    } catch {
      setCapabilityHealthError("能力健康状态加载失败，请稍后重试。");
      toast.error("能力健康状态加载失败");
    } finally {
      setCapabilityHealthLoading(false);
    }
  };

  const createUser = async () => {
    const payload = buildAdminUserCreatePayload(userForm);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }
    try {
      const resp = await enterpriseAdminClient.createUser(payload.value);
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "创建用户失败" }));
        toast.error((json as { error?: string }).error || "创建用户失败");
        return;
      }
      toast.success("用户已创建");
      setUserForm(resetEnterpriseUserCreateForm());
      await loadUsers();
    } catch {
      toast.error("创建用户失败");
    }
  };

  const removeUser = async (userId: string, username: string) => {
    if (!confirm(buildRemoveUserConfirmationMessage(username))) return;
    try {
      const resp = await enterpriseAdminClient.deleteUser(userId);
      if (!resp.ok) {
        toast.error("删除用户失败");
        return;
      }
      toast.success("用户已删除");
      await loadUsers();
    } catch {
      toast.error("删除用户失败");
    }
  };

  const startEditUser = (user: AdminUserItem) => {
    setUserEditingId(user.id);
    setUserEditForm(createEnterpriseUserEditForm(user));
  };

  const saveUserEdit = async (userId: string) => {
    try {
      const resp = await enterpriseAdminClient.updateUser(
        userId,
        buildAdminUserUpdatePayload(userEditForm),
      );
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "更新用户失败" }));
        toast.error((json as { error?: string }).error || "更新用户失败");
        return;
      }
      toast.success("用户已更新");
      setUserEditingId(null);
      setUserEditForm(resetEnterpriseUserEditForm());
      await loadUsers();
    } catch {
      toast.error("更新用户失败");
    }
  };

  const createTenant = async () => {
    const payload = buildTenantCreatePayload(tenantForm);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }
    try {
      const resp = await enterpriseAdminClient.createTenant(payload.value);
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "创建租户失败" }));
        toast.error((json as { error?: string }).error || "创建租户失败");
        return;
      }
      toast.success("租户已创建");
      setTenantForm(resetEnterpriseTenantCreateForm());
      await loadTenants();
    } catch {
      toast.error("创建租户失败");
    }
  };

  const removeTenant = async (tenantId: string) => {
    if (!confirm(buildRemoveTenantConfirmationMessage(tenantId))) return;
    try {
      const resp = await enterpriseAdminClient.deleteTenant(tenantId);
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "删除租户失败" }));
        toast.error((json as { error?: string }).error || "删除租户失败");
        return;
      }
      toast.success("租户已删除");
      await loadTenants();
    } catch {
      toast.error("删除租户失败");
    }
  };

  const createOrganization = async () => {
    if (!ensureOrgDomainWritable()) return;
    const payload = buildOrganizationCreatePayload(orgForm);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }

    try {
      const result = await orgDomainClient.createOrganization(payload.value);
      toast.success(formatTraceableMessage("组织已创建", result.traceId));
      setOrgForm(resetEnterpriseOrgCreateForm());
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "创建组织失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const removeOrganization = async (organization: OrgOrganizationItem) => {
    if (!ensureOrgDomainWritable()) return;
    if (!confirm(buildRemoveOrganizationConfirmationMessage(organization))) return;
    try {
      const result = await orgDomainClient.deleteOrganization(organization.id);
      toast.success(formatTraceableMessage("组织已删除", result.traceId));
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "删除组织失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const toggleOrganizationStatus = async (organization: OrgOrganizationItem) => {
    if (!ensureOrgDomainWritable()) return;
    const nextStatus = organization.status === "disabled" ? "active" : "disabled";
    if (!confirm(buildToggleOrganizationStatusConfirmationMessage(organization))) {
      return;
    }
    try {
      const result = await orgDomainClient.updateOrganization(organization.id, {
        status: nextStatus,
      });
      toast.success(
        formatTraceableMessage(
          nextStatus === "disabled" ? "组织已禁用" : "组织已启用",
          result.traceId,
        ),
      );
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, nextStatus === "disabled" ? "禁用组织失败" : "启用组织失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const createOrgProject = async () => {
    if (!ensureOrgDomainWritable()) return;
    const payload = buildProjectCreatePayload(orgProjectForm);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }

    try {
      const result = await orgDomainClient.createProject(payload.value);
      toast.success(formatTraceableMessage("项目已创建", result.traceId));
      setOrgProjectForm((prev) => ({
        ...resetEnterpriseOrgProjectCreateForm(),
        organizationId: prev.organizationId,
      }));
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "创建项目失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const removeOrgProject = async (project: OrgProjectItem) => {
    if (!ensureOrgDomainWritable()) return;
    if (!confirm(buildRemoveProjectConfirmationMessage(project))) return;
    try {
      const result = await orgDomainClient.deleteProject(project.id);
      toast.success(formatTraceableMessage("项目已删除", result.traceId));
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "删除项目失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const toggleOrgProjectStatus = async (project: OrgProjectItem) => {
    if (!ensureOrgDomainWritable()) return;
    const nextStatus = project.status === "disabled" ? "active" : "disabled";
    if (!confirm(buildToggleProjectStatusConfirmationMessage(project))) {
      return;
    }
    try {
      const result = await orgDomainClient.updateProject(project.id, {
        status: nextStatus,
      });
      toast.success(
        formatTraceableMessage(
          nextStatus === "disabled" ? "项目已禁用" : "项目已启用",
          result.traceId,
        ),
      );
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, nextStatus === "disabled" ? "禁用项目失败" : "启用项目失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const createOrgMember = async () => {
    if (!ensureOrgDomainWritable()) return;
    const payload = buildMemberCreatePayload(orgMemberCreateForm, users);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }
    try {
      const result = await orgDomainClient.createMember(payload.value);
      toast.success(formatTraceableMessage("成员已创建", result.traceId));
      setOrgMemberCreateForm((prev) => ({
        ...resetEnterpriseOrgMemberCreateForm(),
        organizationId: prev.organizationId,
      }));
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "创建成员失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const removeOrgMember = async (member: OrgMemberBindingItem) => {
    if (!ensureOrgDomainWritable()) return;
    if (!confirm(buildRemoveMemberConfirmationMessage(member))) return;
    try {
      const result = await orgDomainClient.deleteMember(member.memberId);
      toast.success(formatTraceableMessage("成员已删除", result.traceId));
      if (orgMemberEditingId === member.memberId) {
        setOrgMemberEditingId(null);
      }
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "删除成员失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const startEditOrgMemberBinding = (member: OrgMemberBindingItem) => {
    setOrgMemberEditingId(member.memberId);
    setOrgMemberEditForm(
      createOrgMemberEditForm({
        member,
        organizations: orgOrganizations,
        projects: orgProjects,
        fallbackOrganizationId: orgProjectForm.organizationId,
      }),
    );
  };

  const saveOrgMemberBinding = async (memberId: string) => {
    if (!ensureOrgDomainWritable()) return;
    const organizationId = orgMemberEditForm.organizationId.trim().toLowerCase();
    if (!organizationId) {
      toast.error("请先选择组织");
      return;
    }

    const targetMember = orgMemberBindings.find((item) => item.memberId === memberId);
    if (!targetMember) {
      toast.error("成员数据已变化，请刷新后重试");
      return;
    }

    let existingRows: OrgMemberProjectBindingRow[] = orgMemberProjectBindings.filter(
      (item) => item.memberId === memberId,
    );
    try {
      existingRows = await loadOrgMemberProjectBindingsByMember(memberId);
    } catch (error) {
      toast.error(getErrorMessage(error, "加载成员绑定失败"));
      return;
    }

    const currentOrganizationId = targetMember.organizationId.trim().toLowerCase();
    let organizationUpdateTraceId = "";
    if (currentOrganizationId !== organizationId) {
      try {
        const result = await orgDomainClient.updateMember(memberId, { organizationId });
        organizationUpdateTraceId = result.traceId?.trim() || "";
      } catch (error) {
        toast.error(getErrorMessage(error, "更新成员组织失败"));
        if (shouldRefreshOrgDomainAfterMutationError(error)) {
          await loadOrgDomainData(true);
        }
        return;
      }
    }

    const mutationPlan = planOrgMemberBindingMutation({
      organizationId,
      selectedProjectIds: orgMemberEditForm.projectIds,
      projects: orgProjects,
      existingRows,
    });

    try {
      let mutationTraceId = organizationUpdateTraceId;
      for (const row of mutationPlan.rowsToDelete) {
        const result = await orgDomainClient.deleteMemberProjectBinding(String(row.id));
        if (result.traceId?.trim()) {
          mutationTraceId = result.traceId.trim();
        }
      }

      if (mutationPlan.projectsToCreate.length > 0) {
        const result = await orgDomainClient.createMemberProjectBindingsBatch(
          mutationPlan.projectsToCreate.map((projectId) => ({
            organizationId,
            memberId,
            projectId,
          })),
        );
        if (result.traceId?.trim()) {
          mutationTraceId = result.traceId.trim();
        }
        if (!result.success && result.data.errors.length > 0) {
          const primaryError = result.data.errors[0];
          throw Object.assign(
            new Error(primaryError?.error || "成员绑定批量更新失败"),
            { traceId: result.traceId },
          );
        }
      }

      toast.success(formatTraceableMessage("成员绑定已更新", mutationTraceId));
      setOrgMemberEditingId(null);
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "成员绑定更新失败"));
      if (shouldRefreshOrgDomainAfterMutationError(error)) {
        await loadOrgDomainData(true);
      }
    }
  };

  const refreshOrgDomain = async () => {
    await loadOrgDomainData(false);
  };

  const createPolicy = async () => {
    const payload = buildQuotaPolicyCreatePayload(policyForm);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }
    try {
      const resp = await enterpriseAdminClient.createPolicy(payload.value);
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "创建策略失败" }));
        toast.error((json as { error?: string }).error || "创建策略失败");
        return;
      }
      toast.success("配额策略已创建");
      setPolicyForm(resetEnterprisePolicyCreateForm());
      await loadPolicies();
    } catch {
      toast.error("创建策略失败");
    }
  };

  const removePolicy = async (policyId: string) => {
    if (!confirm(buildRemovePolicyConfirmationMessage(policyId))) return;
    try {
      const resp = await enterpriseAdminClient.deletePolicy(policyId);
      if (!resp.ok) {
        toast.error("删除策略失败");
        return;
      }
      toast.success("策略已删除");
      await loadPolicies();
    } catch {
      toast.error("删除策略失败");
    }
  };

  const startEditPolicy = (policy: QuotaPolicyItem) => {
    setPolicyEditingId(policy.id);
    setPolicyEditForm(createEnterprisePolicyEditForm(policy));
  };

  const savePolicyEdit = async (policy: QuotaPolicyItem) => {
    const payload = buildQuotaPolicyUpdatePayload(policyEditForm);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }
    try {
      const resp = await enterpriseAdminClient.updatePolicy(policy.id, payload.value);
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "更新策略失败" }));
        toast.error((json as { error?: string }).error || "更新策略失败");
        return;
      }
      toast.success("策略已更新");
      setPolicyEditingId(null);
      setPolicyEditForm(resetEnterprisePolicyEditForm());
      await loadPolicies();
    } catch {
      toast.error("更新策略失败");
    }
  };

  const saveOAuthAlertConfig = async () => {
    setOAuthAlertConfigSaving(true);
    try {
      const resp = await oauthAlertCenterClient.updateConfig({
        enabled: oauthAlertConfig.enabled,
        warningRateThresholdBps: Math.max(
          1,
          Math.floor(Number(oauthAlertConfig.warningRateThresholdBps) || 1),
        ),
        warningFailureCountThreshold: Math.max(
          1,
          Math.floor(Number(oauthAlertConfig.warningFailureCountThreshold) || 1),
        ),
        criticalRateThresholdBps: Math.max(
          1,
          Math.floor(Number(oauthAlertConfig.criticalRateThresholdBps) || 1),
        ),
        criticalFailureCountThreshold: Math.max(
          1,
          Math.floor(Number(oauthAlertConfig.criticalFailureCountThreshold) || 1),
        ),
        recoveryRateThresholdBps: Math.max(
          0,
          Math.floor(Number(oauthAlertConfig.recoveryRateThresholdBps) || 0),
        ),
        recoveryFailureCountThreshold: Math.max(
          0,
          Math.floor(Number(oauthAlertConfig.recoveryFailureCountThreshold) || 0),
        ),
        dedupeWindowSec: Math.max(0, Math.floor(Number(oauthAlertConfig.dedupeWindowSec) || 0)),
        recoveryConsecutiveWindows: Math.max(
          1,
          Math.floor(Number(oauthAlertConfig.recoveryConsecutiveWindows) || 1),
        ),
        windowSizeSec: Math.max(60, Math.floor(Number(oauthAlertConfig.windowSizeSec) || 60)),
        quietHoursEnabled: oauthAlertConfig.quietHoursEnabled,
        quietHoursStart: oauthAlertConfig.quietHoursStart.trim() || "00:00",
        quietHoursEnd: oauthAlertConfig.quietHoursEnd.trim() || "00:00",
        quietHoursTimezone: oauthAlertConfig.quietHoursTimezone.trim() || "Asia/Shanghai",
        muteProviders: oauthAlertConfig.muteProviders
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
        minDeliverySeverity:
          oauthAlertConfig.minDeliverySeverity === "critical" ? "critical" : "warning",
      });
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        toast.error("后端尚未启用 OAuth 告警中心接口");
        return;
      }
      if (!resp.ok) {
        const errorData = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "保存 OAuth 告警配置失败");
      }
      const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      const root = toObject(json);
      const data = toObject(root.data);
      const source = Object.keys(data).length > 0 ? data : root;
      const hasConfigField = [
        "enabled",
        "warningRateThresholdBps",
        "warningFailureCountThreshold",
        "criticalRateThresholdBps",
        "criticalFailureCountThreshold",
        "recoveryRateThresholdBps",
        "recoveryFailureCountThreshold",
        "dedupeWindowSec",
        "recoveryConsecutiveWindows",
        "windowSizeSec",
        "quietHoursEnabled",
        "quietHoursStart",
        "quietHoursEnd",
        "quietHoursTimezone",
        "muteProviders",
        "minDeliverySeverity",
      ].some((key) => key in source);
      setOAuthAlertConfig(
        hasConfigField
          ? normalizeOAuthAlertConfig(json, DEFAULT_OAUTH_ALERT_CENTER_CONFIG)
          : oauthAlertConfig,
      );
      setOAuthAlertCenterApiAvailable(true);
      toast.success("OAuth 告警配置已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 OAuth 告警配置失败";
      toast.error(message);
    } finally {
      setOAuthAlertConfigSaving(false);
    }
  };

  const evaluateOAuthAlertsManually = async () => {
    setOAuthAlertEvaluating(true);
    try {
      const resp = await oauthAlertCenterClient.evaluate({
        provider: oauthAlertEvaluateForm.provider.trim() || undefined,
      });
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        throw new Error("后端尚未启用 OAuth 告警评估接口");
      }
      const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!resp.ok) {
        throw new Error(toText(json.error).trim() || "OAuth 告警手动评估失败");
      }
      const data = toObject(json.data);
      const message =
        toText(data.message).trim() ||
        toText(json.message).trim() ||
        (data.triggered === true ? "评估完成：触发告警" : "评估完成：未触发告警");
      setOAuthAlertLastEvaluateResult(message);
      setOAuthAlertCenterApiAvailable(true);
      toast.success("OAuth 告警评估完成");
      await Promise.all([loadOAuthAlertIncidents(1), loadOAuthAlertDeliveries(1)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth 告警手动评估失败";
      toast.error(message);
    } finally {
      setOAuthAlertEvaluating(false);
    }
  };

  const applyOAuthAlertIncidentFilters = async (page = 1) => {
    try {
      await loadOAuthAlertIncidents(page);
    } catch {
      toast.error("OAuth 告警 incidents 加载失败");
    }
  };

  const applyOAuthAlertDeliveryFilters = async (page = 1) => {
    const normalizedIncidentId = oauthAlertDeliveryIncidentIdFilter.trim();
    if (normalizedIncidentId && !OAUTH_ALERT_INCIDENT_ID_PATTERN.test(normalizedIncidentId)) {
      toast.error("incidentId 仅支持字母、数字、冒号、下划线和连字符");
      return;
    }
    try {
      await loadOAuthAlertDeliveries(page);
    } catch {
      toast.error("OAuth 告警 deliveries 加载失败");
    }
  };

  const gotoOAuthAlertRulePage = async (page: number) => {
    const totalPages = oauthAlertRuleVersions?.totalPages || 1;
    const target = Math.min(totalPages, Math.max(1, Math.floor(page || 1)));
    try {
      await loadOAuthAlertRuleVersions(target);
    } catch {
      toast.error("规则版本分页加载失败");
    }
  };

  const gotoAlertmanagerHistoryPage = async (page: number) => {
    const totalPages = alertmanagerHistoryTotalPages || 1;
    const target = Math.min(totalPages, Math.max(1, Math.floor(page || 1)));
    try {
      await loadAlertmanagerSyncHistory(target);
    } catch {
      toast.error("Alertmanager 历史分页加载失败");
    }
  };

  const refreshOAuthAlertCenter = async () => {
    try {
      await Promise.all([
        loadOAuthAlertCenterConfig(),
        loadOAuthAlertIncidents(1),
        loadOAuthAlertDeliveries(1),
        loadOAuthAlertRuleActiveVersion(),
        loadOAuthAlertRuleVersions(oauthAlertRuleVersions?.page || 1),
      ]);
      toast.success("OAuth 告警中心已刷新");
    } catch {
      toast.error("OAuth 告警中心刷新失败");
    }
  };

  const refreshOAuthAlertRuleVersions = async () => {
    try {
      await Promise.all([
        loadOAuthAlertRuleActiveVersion(),
        loadOAuthAlertRuleVersions(oauthAlertRuleVersions?.page || 1),
      ]);
      toast.success("规则版本已刷新");
    } catch {
      toast.error("规则版本刷新失败");
    }
  };

  const switchToAdvancedOAuthAlertRuleEditor = () => {
    const next = buildStructuredOAuthAlertRulePayload(oauthAlertRuleStructuredDraft);
    if (next.ok) {
      setOAuthAlertRuleCreateText(JSON.stringify(next.payload, null, 2));
    }
    setUseStructuredOAuthAlertRuleEditor(false);
  };

  const switchToStructuredOAuthAlertRuleEditor = () => {
    let payload: Record<string, unknown>;
    try {
      payload = toObject(JSON.parse(oauthAlertRuleCreateText || "{}"));
    } catch {
      toast.error("规则版本 JSON 格式无效，无法切回结构化模式");
      return;
    }
    if (!Array.isArray(payload.rules) || payload.rules.length === 0) {
      toast.error("规则版本必须包含 rules[]，才能切回结构化模式");
      return;
    }
    setOAuthAlertRuleStructuredDraft(normalizeOAuthAlertRuleStructuredDraft(payload));
    setUseStructuredOAuthAlertRuleEditor(true);
  };

  const switchToAdvancedAlertmanagerEditor = () => {
    const next = buildStructuredAlertmanagerPayload(
      alertmanagerStructuredDraft,
      alertmanagerConfig?.config,
    );
    if (next.ok) {
      setAlertmanagerConfigText(JSON.stringify(next.payload, null, 2));
    }
    setUseStructuredAlertmanagerEditor(false);
  };

  const switchToStructuredAlertmanagerEditor = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(alertmanagerConfigText || "{}");
    } catch {
      toast.error("Alertmanager 配置 JSON 格式无效，无法切回结构化模式");
      return;
    }
    const normalized = toAlertmanagerConfigPayload(toObject(raw));
    if (!normalized) {
      toast.error("Alertmanager 配置缺少 route/receivers，无法切回结构化模式");
      return;
    }
    setAlertmanagerStructuredDraft(normalizeAlertmanagerStructuredDraft(normalized));
    setUseStructuredAlertmanagerEditor(true);
  };

  const refreshAlertmanagerCenter = async () => {
    try {
      await Promise.all([loadAlertmanagerConfig(), loadAlertmanagerSyncHistory(alertmanagerHistoryPage)]);
      toast.success("Alertmanager 配置已刷新");
    } catch {
      toast.error("Alertmanager 配置刷新失败");
    }
  };

  const saveAlertmanagerConfig = async () => {
    if (alertmanagerActionBusy) {
      toast.error("Alertmanager 操作进行中，请稍后重试");
      return;
    }

    let parsed: AlertmanagerConfigPayload;
    if (useStructuredAlertmanagerEditor) {
      const structured = buildStructuredAlertmanagerPayload(
        alertmanagerStructuredDraft,
        alertmanagerConfig?.config,
      );
      if (!structured.ok) {
        toast.error(structured.error);
        return;
      }
      parsed = structured.payload;
    } else {
      let raw: unknown;
      try {
        raw = JSON.parse(alertmanagerConfigText || "{}") as unknown;
      } catch {
        toast.error("Alertmanager 配置 JSON 格式无效");
        return;
      }
      const normalized = toAlertmanagerConfigPayload(toObject(raw));
      if (!normalized) {
        toast.error("Alertmanager 配置缺少 route/receivers");
        return;
      }
      parsed = normalized;
    }

    setAlertmanagerConfigSaving(true);
    try {
      const resp = await oauthAlertCenterClient.updateAlertmanagerConfig({
        config: parsed,
      });
      if (resp.status === 404 || resp.status === 405) {
        setAlertmanagerApiAvailable(false);
        toast.error("后端尚未启用 Alertmanager 配置接口");
        return;
      }
      if (!resp.ok) {
        const json = await readJsonSafely(resp);
        throw new Error(
          buildTraceableErrorMessage(
            json,
            "保存 Alertmanager 配置失败",
            extractTraceIdFromResponse(resp, json),
          ),
        );
      }
      const json = await readJsonSafely(resp);
      const normalized = normalizeAlertmanagerStoredConfig(json);
      setAlertmanagerConfig(normalized);
      setAlertmanagerStructuredDraft(normalizeAlertmanagerStructuredDraft(normalized?.config));
      setAlertmanagerConfigText(
        JSON.stringify(
          normalized?.config || JSON.parse(DEFAULT_ALERTMANAGER_CONFIG_TEXT),
          null,
          2,
        ),
      );
      setAlertmanagerApiAvailable(true);
      toast.success("Alertmanager 配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存 Alertmanager 配置失败");
    } finally {
      setAlertmanagerConfigSaving(false);
    }
  };

  const triggerAlertmanagerSync = async () => {
    if (alertmanagerActionBusy) {
      toast.error("Alertmanager 操作进行中，请稍后重试");
      return;
    }
    setAlertmanagerSyncing(true);
    try {
      const resp = await oauthAlertCenterClient.syncAlertmanagerConfig({});
      if (resp.status === 404 || resp.status === 405) {
        setAlertmanagerApiAvailable(false);
        toast.error("后端尚未启用 Alertmanager 同步接口");
        return;
      }
      const json = await readJsonSafely(resp);
      if (!resp.ok) {
        throw new Error(
          buildTraceableErrorMessage(
            json,
            "Alertmanager 同步失败",
            extractTraceIdFromResponse(resp, json),
          ),
        );
      }
      const syncData = toObject(json.data);
      const syncHistory = toAlertmanagerHistoryItem(syncData.history);
      if (syncHistory.id || syncHistory.ts) {
        setAlertmanagerLatestSync(syncHistory);
      }
      setAlertmanagerApiAvailable(true);
      toast.success("Alertmanager 同步已执行");
      await loadAlertmanagerSyncHistory(alertmanagerHistoryPage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Alertmanager 同步失败");
    } finally {
      setAlertmanagerSyncing(false);
    }
  };

  const createOAuthAlertRuleVersion = async () => {
    if (oauthAlertRuleActionBusy) {
      toast.error("规则版本操作进行中，请稍后重试");
      return;
    }

    let payload: Record<string, unknown>;
    if (useStructuredOAuthAlertRuleEditor) {
      const structured = buildStructuredOAuthAlertRulePayload(oauthAlertRuleStructuredDraft);
      if (!structured.ok) {
        toast.error(structured.error);
        return;
      }
      payload = structured.payload;
    } else {
      try {
        payload = toObject(JSON.parse(oauthAlertRuleCreateText || "{}"));
      } catch {
        toast.error("规则版本 JSON 格式无效");
        return;
      }
      if (!Array.isArray(payload.rules) || payload.rules.length === 0) {
        toast.error("规则版本必须包含 rules[]");
        return;
      }
    }

    setOAuthAlertRuleCreating(true);
    try {
      const resp = await oauthAlertCenterClient.createAlertRuleVersion(payload);
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        toast.error("后端尚未启用规则版本接口");
        return;
      }
      const json = await readJsonSafely(resp);
      if (!resp.ok) {
        throw new Error(
          buildTraceableErrorMessage(
            json,
            "创建规则版本失败",
            extractTraceIdFromResponse(resp, json),
          ),
        );
      }
      toast.success("规则版本已创建");
      await Promise.all([loadOAuthAlertRuleActiveVersion(), loadOAuthAlertRuleVersions(1)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建规则版本失败");
    } finally {
      setOAuthAlertRuleCreating(false);
    }
  };

  const rollbackOAuthAlertRuleVersion = async (item: OAuthAlertRuleVersionSummaryItem) => {
    const versionId = item.id;
    if (oauthAlertRuleActionBusy) {
      toast.error("规则版本操作进行中，请稍后重试");
      return;
    }
    if (!Number.isFinite(versionId) || versionId <= 0) {
      toast.error("versionId 非法");
      return;
    }
    if (!confirm(buildRollbackOAuthAlertRuleVersionConfirmationMessage(item))) {
      return;
    }
    setOAuthAlertRuleRollingVersionId(versionId);
    try {
      const resp = await oauthAlertCenterClient.rollbackAlertRuleVersion(versionId);
      if (resp.status === 404 || resp.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        toast.error("后端尚未启用规则回滚接口");
        return;
      }
      const json = await readJsonSafely(resp);
      if (!resp.ok) {
        throw new Error(
          buildTraceableErrorMessage(
            json,
            "规则版本回滚失败",
            extractTraceIdFromResponse(resp, json),
          ),
        );
      }
      toast.success("规则版本已回滚");
      await Promise.all([
        loadOAuthAlertRuleActiveVersion(),
        loadOAuthAlertRuleVersions(oauthAlertRuleVersions?.page || 1),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "规则版本回滚失败");
    } finally {
      setOAuthAlertRuleRollingVersionId(null);
    }
  };

  const rollbackAlertmanagerSyncHistoryById = async (item: AlertmanagerSyncHistoryItem) => {
    if (alertmanagerActionBusy) {
      toast.error("Alertmanager 操作进行中，请稍后重试");
      return;
    }
    const historyId = item.id || "";
    const normalizedId = historyId.trim();
    if (!normalizedId) {
      toast.error("历史记录 ID 非法");
      return;
    }
    if (!confirm(buildRollbackAlertmanagerSyncHistoryConfirmationMessage(item))) {
      return;
    }
    setAlertmanagerHistoryRollingId(normalizedId);
    try {
      const resp = await oauthAlertCenterClient.rollbackAlertmanagerSyncHistory(normalizedId, {
        reason: "ui-history-rollback",
      });
      if (resp.status === 404 || resp.status === 405) {
        setAlertmanagerApiAvailable(false);
        toast.error("后端尚未启用 Alertmanager 历史回滚接口");
        return;
      }
      const json = await readJsonSafely(resp);
      if (!resp.ok) {
        throw new Error(
          buildTraceableErrorMessage(
            json,
            "Alertmanager 历史回滚失败",
            extractTraceIdFromResponse(resp, json),
          ),
        );
      }
      const rollbackData = toObject(json.data);
      const rollbackHistory = toAlertmanagerHistoryItem(rollbackData.history);
      if (rollbackHistory.id || rollbackHistory.ts) {
        setAlertmanagerLatestSync(rollbackHistory);
      }
      toast.success("Alertmanager 历史回滚已执行");
      await Promise.all([
        loadAlertmanagerConfig(),
        loadAlertmanagerSyncHistory(alertmanagerHistoryPage),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Alertmanager 历史回滚失败");
    } finally {
      setAlertmanagerHistoryRollingId("");
    }
  };

  const linkIncidentToSessionEvents = async (incident: OAuthAlertIncidentItem) => {
    const provider = incident.provider?.trim() || "";
    const phase = incident.phase?.trim() || "";
    const normalizedPhase: "" | "pending" | "waiting_callback" | "waiting_device" | "exchanging" | "completed" | "error" = (
      [
        "pending",
        "waiting_callback",
        "waiting_device",
        "exchanging",
        "completed",
        "error",
      ] as const
    ).includes(phase as "pending")
      ? (phase as "pending" | "waiting_callback" | "waiting_device" | "exchanging" | "completed" | "error")
      : "";
    if (!provider && !phase) {
      toast.error("该 incident 不含 provider/phase，无法联动会话事件");
      return;
    }
    setSessionEventProviderFilter(provider);
    setSessionEventPhaseFilter(normalizedPhase);
    await applySessionEventFilters(1, {
      provider: provider || undefined,
      phase: normalizedPhase || undefined,
    });
    const panel = document.getElementById("oauth-session-events-panel");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const applyAuditFilters = async () => {
    try {
      await loadAuditEvents(
        1,
        auditKeyword,
        auditTraceId,
        auditAction,
        auditResource,
        auditResourceId,
        auditPolicyId,
        auditResultFilter,
        auditFrom,
        auditTo,
      );
    } catch {
      toast.error("审计日志加载失败");
    }
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportAuditEvents = async () => {
    try {
      const fromParam = normalizeDateTimeParam(auditFrom);
      const toParam = normalizeDateTimeParam(auditTo);
      const defaultFilename = `audit-events-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.csv`;
      const { blob, filename } = await downloadWithApiSecret(
        enterpriseAdminClient.buildAuditEventExportPath({
          keyword: auditKeyword.trim() || undefined,
          traceId: auditTraceId.trim() || undefined,
          action: auditAction.trim() || undefined,
          resource: auditResource.trim() || undefined,
          resourceId: auditResourceId.trim() || undefined,
          policyId: auditPolicyId.trim() || undefined,
          result: auditResultFilter || undefined,
          from: fromParam || undefined,
          to: toParam || undefined,
          limit: 2000,
        }),
        {
          method: "GET",
        },
        {
          fallbackErrorMessage: "审计导出失败",
          defaultFilename,
        },
      );
      triggerBlobDownload(blob, filename || defaultFilename);
      toast.success("审计 CSV 导出完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "审计导出失败";
      toast.error(message);
    }
  };

  const applyCallbackFilters = async (page = 1) => {
    try {
      await loadCallbackEvents(page);
    } catch {
      toast.error("OAuth 回调事件加载失败");
    }
  };

  const applySessionEventFilters = async (page = 1, patch?: SessionEventFilterPatch) => {
    try {
      await loadSessionEvents(page, patch);
    } catch {
      toast.error("OAuth 会话事件加载失败");
    }
  };

  const traceSessionEventsByState = (state: string) => {
    const normalized = state.trim();
    if (!normalized) return;
    setSessionEventStateFilter(normalized);
    void applySessionEventFilters(1, { state: normalized });
  };

  const exportSessionEvents = async () => {
    try {
      const fromParam = normalizeDateTimeParam(sessionEventFromFilter);
      const toParam = normalizeDateTimeParam(sessionEventToFilter);
      const defaultFilename = `oauth-session-events-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.csv`;
      const { blob, filename } = await downloadWithApiSecret(
        enterpriseAdminClient.buildSessionEventExportPath({
          state: sessionEventStateFilter.trim() || undefined,
          provider: sessionEventProviderFilter.trim() || undefined,
          flowType: sessionEventFlowFilter || undefined,
          phase: sessionEventPhaseFilter || undefined,
          status: sessionEventStatusFilter || undefined,
          eventType: sessionEventTypeFilter || undefined,
          from: fromParam || undefined,
          to: toParam || undefined,
          limit: 2000,
        }),
        {
          method: "GET",
        },
        {
          fallbackErrorMessage: "OAuth 会话事件导出失败",
          defaultFilename,
        },
      );
      triggerBlobDownload(blob, filename || defaultFilename);
      toast.success("OAuth 会话事件 CSV 导出完成");
      setSessionEventsApiAvailable(true);
    } catch (error) {
      const typed = error as Error & { status?: number };
      if (typed.status === 404 || typed.status === 405) {
        setSessionEventsApiAvailable(false);
        toast.error("后端尚未启用 OAuth 会话事件导出接口");
        return;
      }
      toast.error(typed.message || "OAuth 会话事件导出失败");
    }
  };

  const applyAgentLedgerOutboxFilters = async (page = 1) => {
    try {
      await loadAgentLedgerOutbox(page);
    } catch {
      toast.error("AgentLedger outbox 加载失败");
    }
  };

  const toggleAgentLedgerDeliveryAttemptPanel = async (item: AgentLedgerOutboxItem) => {
    const outboxId = Math.max(0, Math.floor(Number(item.id) || 0));
    if (outboxId <= 0) {
      toast.error("outbox id 非法");
      return;
    }
    if (agentLedgerDeliveryAttemptsOpenOutboxId === outboxId) {
      closeAgentLedgerDeliveryAttemptPanel();
      return;
    }

    setAgentLedgerDeliveryAttemptsOpenOutboxId(outboxId);
    setAgentLedgerDeliveryAttempts(null);
    setAgentLedgerDeliveryAttemptSummary(null);
    setAgentLedgerDeliveryAttemptError("");

    if (!agentLedgerDeliveryAttemptApiAvailable) {
      return;
    }

    try {
      await loadAgentLedgerDeliveryAttempts(outboxId, 1);
    } catch {
      // 错误已在 detail panel 内展示，这里不额外打断主区交互。
    }
  };

  const reloadAgentLedgerDeliveryAttemptPanel = async (page = 1) => {
    if (agentLedgerDeliveryAttemptsOpenOutboxId === null) return;
    try {
      await loadAgentLedgerDeliveryAttempts(agentLedgerDeliveryAttemptsOpenOutboxId, page);
    } catch {
      // 错误已在 detail panel 内展示，这里不额外打断主区交互。
    }
  };

  const applyAgentLedgerReplayAuditFilters = async (page = 1) => {
    try {
      await loadAgentLedgerReplayAudits(page);
    } catch {
      toast.error("AgentLedger replay 审计加载失败");
    }
  };

  const getSelectableAgentLedgerOutboxIds = () =>
    (agentLedgerOutbox?.data || [])
      .filter((item) => item.deliveryState !== "delivered")
      .map((item) => item.id)
      .filter((id) => Number.isFinite(id) && id > 0);

  const toggleAgentLedgerOutboxSelection = (id: number, checked: boolean) => {
    const selectableIds = new Set(getSelectableAgentLedgerOutboxIds());
    if (!selectableIds.has(id)) return;
    setAgentLedgerOutboxSelectedIds((prev) => {
      const next = new Set(prev.filter((item) => selectableIds.has(item)));
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return Array.from(next).sort((left, right) => left - right);
    });
  };

  const toggleAllAgentLedgerOutboxSelection = (checked: boolean) => {
    const selectableIds = getSelectableAgentLedgerOutboxIds();
    setAgentLedgerOutboxSelectedIds(checked ? selectableIds : []);
  };

  const refreshAgentLedgerObservabilitySections = async () => {
    const outboxPage = agentLedgerOutbox?.page || 1;
    const replayAuditPage = agentLedgerReplayAudits?.page || 1;
    const attemptPage = agentLedgerDeliveryAttempts?.page || 1;
    const refreshResults = await Promise.allSettled([
      loadAgentLedgerOutbox(outboxPage),
      loadAgentLedgerReplayAudits(replayAuditPage),
      ...(agentLedgerDeliveryAttemptsOpenOutboxId !== null && agentLedgerDeliveryAttemptApiAvailable
        ? [loadAgentLedgerDeliveryAttempts(agentLedgerDeliveryAttemptsOpenOutboxId, attemptPage)]
        : []),
    ]);
    const [outboxRefreshResult, replayAuditRefreshResult, attemptRefreshResult] = refreshResults;
    const refreshErrors = collectRejectedMessages([
      { label: "AgentLedger outbox", result: outboxRefreshResult },
      { label: "AgentLedger replay 审计", result: replayAuditRefreshResult },
      ...(attemptRefreshResult
        ? [{ label: "AgentLedger delivery attempts", result: attemptRefreshResult }]
        : []),
    ]);
    if (refreshErrors.length > 0) {
      toast.error(refreshErrors.join("；"));
    }
  };

  const exportAgentLedgerOutbox = async () => {
    try {
      const defaultFilename = `agentledger-outbox-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.csv`;
      const { blob, filename } = await downloadWithApiSecret(
        enterpriseAdminClient.buildAgentLedgerOutboxExportPath({
          ...buildAgentLedgerOutboxBaseQuery({
            deliveryState: agentLedgerOutboxDeliveryStateFilter,
            status: agentLedgerOutboxStatusFilter,
            provider: agentLedgerOutboxProviderFilter,
            tenantId: agentLedgerOutboxTenantFilter,
            traceId: agentLedgerOutboxTraceFilter,
            from: agentLedgerOutboxFromFilter,
            to: agentLedgerOutboxToFilter,
          }),
          limit: 2000,
        }),
        {
          method: "GET",
        },
        {
          fallbackErrorMessage: "AgentLedger outbox 导出失败",
          defaultFilename,
        },
      );
      triggerBlobDownload(blob, filename || defaultFilename);
      toast.success("AgentLedger outbox CSV 导出完成");
      setAgentLedgerOutboxApiAvailable(true);
    } catch (error) {
      const typed = error as Error & { status?: number };
      if (typed.status === 404 || typed.status === 405) {
        setAgentLedgerOutboxApiAvailable(false);
        toast.error("后端尚未启用 AgentLedger outbox 导出接口");
        return;
      }
      toast.error(typed.message || "AgentLedger outbox 导出失败");
    }
  };

  const replayAgentLedgerOutboxById = async (id: number) => {
    if (!Number.isFinite(id) || id <= 0) {
      toast.error("outbox id 非法");
      return;
    }
    const item = (agentLedgerOutbox?.data || []).find((row) => row.id === id);
    if (
      item &&
      !confirm(buildReplayAgentLedgerOutboxConfirmationMessage(item))
    ) {
      return;
    }
    setAgentLedgerOutboxSelectedIds((prev) => prev.filter((item) => item !== id));
    setAgentLedgerOutboxReplayingId(id);
    try {
      const resp = await enterpriseAdminClient.replayAgentLedgerOutboxItem(id);
      const payload = await readJsonSafely(resp);
      if (!resp.ok) {
        throw new Error(
          buildTraceableErrorMessage(
            payload,
            "AgentLedger replay 失败",
            extractTraceIdFromResponse(resp, payload),
          ),
        );
      }

      const traceId = extractTraceIdFromResponse(resp, payload);
      toast.success(traceId ? `AgentLedger replay 已触发（traceId: ${traceId}）` : "AgentLedger replay 已触发");

      try {
        await refreshAgentLedgerObservabilitySections();
      } catch {
        toast.error("AgentLedger 观测数据刷新失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AgentLedger replay 失败");
    } finally {
      setAgentLedgerOutboxReplayingId(null);
    }
  };

  const replayAgentLedgerOutboxBatch = async () => {
    const ids = Array.from(
      new Set(agentLedgerOutboxSelectedIds.filter((item) => Number.isFinite(item) && item > 0)),
    );
    if (ids.length === 0) {
      toast.error("请先选择需要 replay 的 outbox 记录");
      return;
    }
    const selectedItems = (agentLedgerOutbox?.data || []).filter((item) => ids.includes(item.id));
    if (
      selectedItems.length > 0 &&
      !confirm(buildReplayAgentLedgerOutboxBatchConfirmationMessage(selectedItems))
    ) {
      return;
    }

    setAgentLedgerOutboxBatchReplaying(true);
    try {
      const resp = await enterpriseAdminClient.replayAgentLedgerOutboxBatch(ids);
      const payload = await readJsonSafely(resp);
      if (!resp.ok) {
        throw new Error(
          buildTraceableErrorMessage(
            payload,
            "AgentLedger 批量 replay 失败",
            extractTraceIdFromResponse(resp, payload),
          ),
        );
      }

      const batchResult = normalizeAgentLedgerReplayBatchResult(payload);
      const traceId = extractTraceIdFromResponse(resp, payload);
      const summaryParts = [
        `请求 ${batchResult.requestedCount}`,
        `已处理 ${batchResult.processedCount}`,
        `成功 ${batchResult.successCount}`,
        `失败 ${batchResult.failureCount}`,
      ];
      if (batchResult.notFoundCount > 0) {
        summaryParts.push(`未找到 ${batchResult.notFoundCount}`);
      }
      if (batchResult.notConfiguredCount > 0) {
        summaryParts.push(`未配置 ${batchResult.notConfiguredCount}`);
      }
      const summaryText = summaryParts.join("，");
      const hasPartialFailures =
        batchResult.failureCount > 0 ||
        batchResult.notFoundCount > 0 ||
        batchResult.notConfiguredCount > 0;
      const message = traceId
        ? `AgentLedger 批量 replay 已触发：${summaryText}（traceId: ${traceId}）`
        : `AgentLedger 批量 replay 已触发：${summaryText}`;
      if (hasPartialFailures) {
        toast.info(message);
      } else {
        toast.success(message);
      }

      await refreshAgentLedgerObservabilitySections();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AgentLedger 批量 replay 失败");
    } finally {
      setAgentLedgerOutboxBatchReplaying(false);
    }
  };

  const applyFallbackFilters = async (page = 1) => {
    try {
      await loadFallbackEvents(page);
      await loadFallbackSummary();
    } catch {
      toast.error("Claude 回退事件加载失败");
      return;
    }
    await loadFallbackTimeseriesSafely();
  };

  const applyUsageFilters = async () => {
    try {
      await loadUsageRows({ page: 1 });
    } catch {
      toast.error("配额使用记录加载失败");
    }
  };

  const jumpToAuditTrace = async (traceId?: string | null) => {
    if (!traceId) return;
    setAuditTraceId(traceId);
    try {
      await loadAuditEvents(
        1,
        auditKeyword,
        traceId,
        auditAction,
        auditResource,
        auditResourceId,
        auditPolicyId,
        auditResultFilter,
        auditFrom,
        auditTo,
      );
    } catch {
      toast.error("按追踪 ID 查询审计失败");
    }
  };

  const jumpToAuditByResource = async (options: {
    resource: string;
    resourceId?: string | null;
    keyword?: string | null;
  }) => {
    const normalizedResource = options.resource.trim();
    if (!normalizedResource) return;
    const normalizedResourceId = options.resourceId?.trim() || "";
    const normalizedKeyword = options.keyword?.trim() || "";
    setAuditKeyword(normalizedKeyword);
    setAuditTraceId("");
    setAuditAction("");
    setAuditResource(normalizedResource);
    setAuditResourceId(normalizedResourceId);
    setAuditPolicyId("");
    setAuditResultFilter("");
    setAuditFrom("");
    setAuditTo("");
    if (typeof document !== "undefined") {
      document
        .getElementById("audit-events-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try {
      await loadAuditEvents(
        1,
        normalizedKeyword,
        "",
        "",
        normalizedResource,
        normalizedResourceId,
        "",
        "",
        "",
        "",
      );
    } catch {
      toast.error("按资源联动审计失败");
    }
  };

  const jumpToAuditByAction = async (options: {
    action: string;
    resource: string;
    resourceId?: string | null;
    keyword?: string | null;
  }) => {
    const normalizedAction = options.action.trim();
    const normalizedResource = options.resource.trim();
    if (!normalizedAction || !normalizedResource) return;
    const normalizedResourceId = options.resourceId?.trim() || "";
    const normalizedKeyword = options.keyword?.trim() || "";
    setAuditKeyword(normalizedKeyword);
    setAuditTraceId("");
    setAuditAction(normalizedAction);
    setAuditResource(normalizedResource);
    setAuditResourceId(normalizedResourceId);
    setAuditPolicyId("");
    setAuditResultFilter("");
    setAuditFrom("");
    setAuditTo("");
    if (typeof document !== "undefined") {
      document
        .getElementById("audit-events-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try {
      await loadAuditEvents(
        1,
        normalizedKeyword,
        "",
        normalizedAction,
        normalizedResource,
        normalizedResourceId,
        "",
        "",
        "",
        "",
      );
    } catch {
      toast.error("按动作联动审计失败");
    }
  };

  const jumpToAuditByKeyword = async (keyword?: string | null) => {
    const normalizedKeyword = keyword?.trim() || "";
    if (!normalizedKeyword) return;
    setAuditKeyword(normalizedKeyword);
    setAuditTraceId("");
    setAuditAction("");
    setAuditResource("");
    setAuditResourceId("");
    setAuditPolicyId("");
    setAuditResultFilter("");
    setAuditFrom("");
    setAuditTo("");
    if (typeof document !== "undefined") {
      document
        .getElementById("audit-events-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try {
      await loadAuditEvents(1, normalizedKeyword, "", "", "", "", "", "", "", "");
    } catch {
      toast.error("按关键词联动审计失败");
    }
  };

  const jumpToAgentLedgerReplayAudits = async (options: {
    outboxId?: number | null;
    traceId?: string | null;
  }) => {
    const normalizedOutboxId =
      typeof options.outboxId === "number" && Number.isFinite(options.outboxId) && options.outboxId > 0
        ? `${Math.floor(options.outboxId)}`
        : "";
    setAgentLedgerReplayAuditOutboxIdFilter(normalizedOutboxId);
    setAgentLedgerReplayAuditTraceFilter(options.traceId?.trim() || "");
    setAgentLedgerReplayAuditOperatorFilter("");
    setAgentLedgerReplayAuditResultFilter("");
    setAgentLedgerReplayAuditTriggerSourceFilter("");
    setAgentLedgerReplayAuditFromFilter("");
    setAgentLedgerReplayAuditToFilter("");

    if (typeof document !== "undefined") {
      document
        .getElementById("agentledger-replay-audits-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      await loadAgentLedgerReplayAudits(1);
    } catch {
      toast.error("AgentLedger replay 审计加载失败");
    }
  };

  const jumpToAgentLedgerOutboxByTrace = async (traceId?: string | null) => {
    const normalizedTraceId = traceId?.trim();
    if (!normalizedTraceId) return;
    setAgentLedgerOutboxTraceFilter(normalizedTraceId);

    if (typeof document !== "undefined") {
      document
        .getElementById("agentledger-outbox-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      await loadAgentLedgerOutbox(1);
    } catch {
      toast.error("AgentLedger outbox 加载失败");
    }
  };

  const jumpToAuditByPolicy = async (policyId?: string | null) => {
    if (!policyId) return;
    setAuditPolicyId(policyId);
    setAuditResource("gateway.request");
    setUsagePolicyIdFilter(policyId);
    try {
      await loadAuditEvents(
        1,
        auditKeyword,
        auditTraceId,
        auditAction,
        "gateway.request",
        auditResourceId,
        policyId,
        auditResultFilter,
        auditFrom,
        auditTo,
      );
      await loadUsageRows({ policyId, page: 1 });
    } catch {
      toast.error("按策略 ID 联动审计/配额失败");
    }
  };

  const jumpToOAuthAlertDeliveriesByIncident = async (incidentId?: string | null) => {
    const normalizedIncidentId = incidentId?.trim() || "";
    if (!normalizedIncidentId) return;
    setOAuthAlertDeliveryIncidentIdFilter(normalizedIncidentId);
    setOAuthAlertDeliveryEventIdFilter("");
    setOAuthAlertDeliveryChannelFilter("");
    setOAuthAlertDeliveryStatusFilter("");
    setOAuthAlertDeliveryFromFilter("");
    setOAuthAlertDeliveryToFilter("");
    if (typeof document !== "undefined") {
      document
        .getElementById("oauth-alert-deliveries-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try {
      await loadOAuthAlertDeliveries(1);
    } catch {
      toast.error("按 incidentId 联动 deliveries 失败");
    }
  };

  const agentLedgerOutboxReadinessMeta = agentLedgerOutboxReadiness
    ? AGENTLEDGER_OUTBOX_READINESS_STATUS_META[agentLedgerOutboxReadiness.status]
    : null;

  const shouldShowAgentLedgerOutboxHealthSummary = Boolean(
    agentLedgerOutboxReadiness ||
      agentLedgerOutboxHealth ||
      !agentLedgerOutboxReadinessApiAvailable ||
      !agentLedgerOutboxHealthApiAvailable ||
      agentLedgerOutboxReadinessError ||
      agentLedgerOutboxHealthError,
  );

  const selectableAgentLedgerOutboxIds = useMemo(
    () =>
      (agentLedgerOutbox?.data || [])
        .filter((item) => item.deliveryState !== "delivered")
        .map((item) => item.id)
        .filter((id) => Number.isFinite(id) && id > 0),
    [agentLedgerOutbox],
  );

  const allSelectableAgentLedgerOutboxChecked = useMemo(
    () =>
      selectableAgentLedgerOutboxIds.length > 0 &&
      selectableAgentLedgerOutboxIds.every((id) => agentLedgerOutboxSelectedIds.includes(id)),
    [agentLedgerOutboxSelectedIds, selectableAgentLedgerOutboxIds],
  );

  const filteredOrgProjects = useMemo(() => {
    const orgId = orgProjectFilterOrganizationId.trim().toLowerCase();
    if (!orgId) return orgProjects;
    return orgProjects.filter((item) => item.organizationId === orgId);
  }, [orgProjectFilterOrganizationId, orgProjects]);

  const editableProjectsForMember = useMemo(() => {
    const orgId = orgMemberEditForm.organizationId.trim().toLowerCase();
    if (!orgId) return [];
    return orgProjects.filter((item) => item.organizationId === orgId);
  }, [orgMemberEditForm.organizationId, orgProjects]);

  if (loading) {
    return (
      <div className="bg-white border-4 border-black p-10 b-shadow">
        <p className="text-xl font-black uppercase animate-pulse">企业中心加载中...</p>
      </div>
    );
  }

  if (!enterpriseEnabled || !canLoadEnterprise) {
    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4 border-b-8 border-black pb-6">
          <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
            <ShieldCheck className="w-10 h-10 text-black" />
          </div>
          <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
        </header>
        {enterpriseEnabled && featurePayload?.edition === "advanced" ? (
          <section className="bg-white border-4 border-black p-8 b-shadow space-y-3">
            <p className="text-2xl font-black mb-1">企业后端不可用</p>
            <p className="text-sm font-bold text-gray-600">
              Core 已启用高级版能力，但无法连接 enterprise 服务。请检查以下配置与依赖后重试：
            </p>
            <ul className="text-xs font-bold text-gray-600 list-disc pl-5 space-y-1">
              <li>
                <code>ENABLE_ADVANCED=true</code>（已开启）
              </li>
              <li>
                <code>ENTERPRISE_BASE_URL</code> 指向可达的 enterprise 地址
              </li>
              <li>
                <code>ENTERPRISE_SHARED_KEY</code>（如启用）在 core 与 enterprise 两端保持一致
              </li>
              <li>enterprise 服务已启动，且 <code>/health</code> 返回 200</li>
            </ul>
            <div className="text-xs font-bold text-gray-600">
              <p>
                当前探针：configured=
                <code>{String(featurePayload?.enterpriseBackend?.configured ?? false)}</code>{" "}
                reachable=
                <code>{String(featurePayload?.enterpriseBackend?.reachable ?? false)}</code>
              </p>
              {featurePayload?.enterpriseBackend?.baseUrl ? (
                <p>
                  baseUrl: <code>{featurePayload.enterpriseBackend.baseUrl}</code>
                </p>
              ) : null}
              {featurePayload?.enterpriseBackend?.error ? (
                <p>
                  error: <code>{featurePayload.enterpriseBackend.error}</code>
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="bg-white border-4 border-black p-8 b-shadow">
            <p className="text-2xl font-black mb-2">当前为标准版</p>
            <p className="text-sm font-bold text-gray-600">
              请在服务端设置环境变量 <code>ENABLE_ADVANCED=true</code> 后重启，即可启用 RBAC、审计与配额管理能力。
            </p>
          </section>
        )}
      </div>
    );
  }

  if (!adminAuthenticated) {
    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4 border-b-8 border-black pb-6">
          <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
            <ShieldCheck className="w-10 h-10 text-black" />
          </div>
          <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
        </header>
        <section className="bg-white border-4 border-black p-8 b-shadow space-y-4 max-w-xl">
          <p className="text-2xl font-black">管理员登录</p>
          <p className="text-xs font-bold text-gray-500">
            当前后端已启用企业管理员会话，请先登录后再访问 RBAC、审计与配额能力。
          </p>
          <div className="space-y-3">
            <input
              className="b-input h-11 w-full"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              placeholder="管理员用户名"
            />
            <input
              type="password"
              className="b-input h-11 w-full"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="管理员密码"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleAdminLogin();
                }
              }}
            />
          </div>
          <button
            className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
            disabled={authSubmitting}
            onClick={handleAdminLogin}
          >
            {authSubmitting ? "登录中..." : "登录管理员会话"}
          </button>
        </section>
      </div>
    );
  }

  const featureEntries = Object.entries(featurePayload?.features || {});
  const oauthAlertSectionError = [
    sectionErrors.oauthAlertConfig,
    sectionErrors.oauthAlertIncidents,
    sectionErrors.oauthAlertDeliveries,
    sectionErrors.oauthAlertRules,
    sectionErrors.alertmanager,
  ]
    .filter(Boolean)
    .join("；");

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between border-b-8 border-black pb-6">
        <div className="flex items-center gap-4">
          <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
            <ShieldCheck className="w-10 h-10 text-black" />
          </div>
          <div>
            <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-gray-500">
              高级版能力编排与审计追踪
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={writeTestAuditEvent}>
            写入测试审计事件
          </button>
          <button className="b-btn bg-white" onClick={handleAdminLogout}>
            <LogOut className="w-4 h-4" />
            退出管理员
          </button>
        </div>
      </header>

      <SectionErrorBanner
        title="基础管理数据"
        error={sectionErrors.baseData}
        onRetry={() => {
          void bootstrap();
        }}
        retryLabel="重新加载基础数据"
      />

      <section
        id="oauth-session-events-panel"
        className="bg-white border-4 border-black p-6 b-shadow"
      >
        <div className="flex items-center gap-3 mb-4">
          <Gauge className="w-6 h-6" />
          <h3 className="text-2xl font-black uppercase">能力开关</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {featureEntries.map(([key, enabled]) => (
            <div
              key={key}
              className={cn(
                "border-2 border-black p-4 flex items-center justify-between",
                enabled ? "bg-emerald-50" : "bg-gray-100",
              )}
            >
              <span className="font-bold uppercase text-xs tracking-wider">{key}</span>
              <span className={cn("text-xs font-black", enabled ? "text-emerald-700" : "text-gray-500")}>
                {enabled ? "已启用" : "未启用"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border-4 border-black p-6 b-shadow">
          <div className="flex items-center gap-3 mb-4">
            <Users className="w-6 h-6" />
            <h3 className="text-2xl font-black uppercase">角色与权限</h3>
          </div>
          <div className="space-y-4">
            {roles.map((role) => (
              <div key={role.key} className="border-2 border-black p-4">
                <p className="font-black text-lg">{role.name}</p>
                <p className="text-[10px] uppercase text-gray-500 mb-2">{role.key}</p>
                <div className="flex flex-wrap gap-2">
                  {role.permissions.map((perm) => (
                    <span
                      key={`${role.key}-${perm}`}
                      className="px-2 py-1 border border-black text-[10px] font-bold bg-[#FFD500]/30"
                    >
                      {perm}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border-4 border-black p-6 b-shadow">
          <div className="flex items-center gap-3 mb-4">
            <ScrollText className="w-6 h-6" />
            <h3 className="text-2xl font-black uppercase">权限词典</h3>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {permissions.map((permission) => (
              <div key={permission.key} className="border-2 border-black p-3">
                <p className="font-bold text-sm">{permission.name}</p>
                <p className="font-mono text-[10px] text-gray-500">{permission.key}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border-4 border-black p-6 b-shadow space-y-4">
          <div className="flex items-center gap-3">
            <UserPlus className="w-6 h-6" />
            <h3 className="text-2xl font-black uppercase">用户管理</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="b-input h-10"
              value={userForm.username}
              placeholder="用户名"
              onChange={(e) =>
                setUserForm((prev) => ({ ...prev, username: e.target.value }))
              }
            />
            <input
              type="password"
              className="b-input h-10"
              value={userForm.password}
              placeholder="密码（至少 8 位）"
              onChange={(e) =>
                setUserForm((prev) => ({ ...prev, password: e.target.value }))
              }
            />
            <select
              className="b-input h-10"
              value={userForm.roleKey}
              onChange={(e) =>
                setUserForm((prev) => ({ ...prev, roleKey: e.target.value }))
              }
            >
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.name} ({role.key})
                </option>
              ))}
            </select>
            <select
              className="b-input h-10"
              value={userForm.tenantId}
              onChange={(e) =>
                setUserForm((prev) => ({ ...prev, tenantId: e.target.value }))
              }
            >
              {(tenants.length ? tenants : [{ id: "default", name: "默认租户", status: "active" }]).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.id})
                </option>
              ))}
            </select>
          </div>
          <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={createUser}>
            创建用户
          </button>

          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-black text-white text-xs uppercase">
                <tr>
                  <th className="p-2">用户名</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">角色绑定</th>
                  <th className="p-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="p-2">
                      <p className="font-bold">{user.username}</p>
                      {user.displayName ? (
                        <p className="text-xs text-gray-500">{user.displayName}</p>
                      ) : null}
                    </td>
                    <td className="p-2">
                      {userEditingId === user.id ? (
                        <select
                          className="b-input h-8 text-xs"
                          value={userEditForm.status}
                          onChange={(e) =>
                            setUserEditForm((prev) => ({
                              ...prev,
                              status: e.target.value as "active" | "disabled",
                            }))
                          }
                        >
                          <option value="active">active</option>
                          <option value="disabled">disabled</option>
                        </select>
                      ) : user.status === "active" ? (
                        "启用"
                      ) : (
                        "禁用"
                      )}
                    </td>
                    <td className="p-2 text-xs font-mono">
                      {userEditingId === user.id ? (
                        <div className="grid grid-cols-1 gap-2">
                          <input
                            className="b-input h-8 text-xs"
                            value={userEditForm.displayName}
                            placeholder="显示名称（可选）"
                            onChange={(e) =>
                              setUserEditForm((prev) => ({
                                ...prev,
                                displayName: e.target.value,
                              }))
                            }
                          />
                          <select
                            className="b-input h-8 text-xs"
                            value={userEditForm.roleKey}
                            onChange={(e) =>
                              setUserEditForm((prev) => ({
                                ...prev,
                                roleKey: e.target.value,
                              }))
                            }
                          >
                            {roles.map((role) => (
                              <option key={role.key} value={role.key}>
                                {role.key}
                              </option>
                            ))}
                          </select>
                          <select
                            className="b-input h-8 text-xs"
                            value={userEditForm.tenantId}
                            onChange={(e) =>
                              setUserEditForm((prev) => ({
                                ...prev,
                                tenantId: e.target.value,
                              }))
                            }
                          >
                            {(tenants.length
                              ? tenants
                              : [{ id: "default", name: "默认租户", status: "active" }]
                            ).map((tenant) => (
                              <option key={tenant.id} value={tenant.id}>
                                {tenant.id}
                              </option>
                            ))}
                          </select>
                          <input
                            type="password"
                            className="b-input h-8 text-xs"
                            value={userEditForm.password}
                            placeholder="可选：重置密码"
                            onChange={(e) =>
                              setUserEditForm((prev) => ({
                                ...prev,
                                password: e.target.value,
                              }))
                            }
                          />
                          <input
                            className="b-input h-8 text-xs"
                            value={userEditForm.roleBindingsText}
                            placeholder="多角色绑定：role@tenant,role@tenant"
                            onChange={(e) =>
                              setUserEditForm((prev) => ({
                                ...prev,
                                roleBindingsText: e.target.value,
                              }))
                            }
                          />
                          <input
                            className="b-input h-8 text-xs"
                            value={userEditForm.tenantIdsText}
                            placeholder="租户绑定：tenant1,tenant2"
                            onChange={(e) =>
                              setUserEditForm((prev) => ({
                                ...prev,
                                tenantIdsText: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ) : (
                        user.roles.map((item) => `${item.roleKey}@${item.tenantId || "default"}`).join(", ") || "-"
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-2">
                        {userEditingId === user.id ? (
                          <>
                            <button
                              className="b-btn bg-[#FFD500] text-xs"
                              onClick={() => saveUserEdit(user.id)}
                            >
                              保存
                            </button>
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() => {
                                setUserEditingId(null);
                                setUserEditForm(resetEnterpriseUserEditForm());
                              }}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() => startEditUser(user)}
                            >
                              编辑
                            </button>
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() => removeUser(user.id, user.username)}
                            >
                              <Trash2 className="w-3 h-3" />
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border-4 border-black p-6 b-shadow space-y-4">
          <div className="flex items-center gap-3">
            <Building2 className="w-6 h-6" />
            <h3 className="text-2xl font-black uppercase">租户管理</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="b-input h-10"
              placeholder="租户名称"
              value={tenantForm.name}
              onChange={(e) =>
                setTenantForm((prev) => ({ ...prev, name: e.target.value }))
              }
            />
            <select
              className="b-input h-10"
              value={tenantForm.status}
              onChange={(e) =>
                setTenantForm((prev) => ({
                  ...prev,
                  status: e.target.value as "active" | "disabled",
                }))
              }
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={createTenant}>
            创建租户
          </button>

          <div className="space-y-2">
            {tenants.map((tenant) => (
              <div key={tenant.id} className="border-2 border-black p-3 flex items-center justify-between">
                <div>
                  <p className="font-bold">{tenant.name}</p>
                  <p className="font-mono text-xs text-gray-500">
                    {tenant.id} · {tenant.status}
                  </p>
                </div>
                <button
                  className="b-btn bg-white text-xs"
                  disabled={tenant.id === "default"}
                  onClick={() => removeTenant(tenant.id)}
                >
                  <Trash2 className="w-3 h-3" />
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Building2 className="w-6 h-6" />
            <h3 className="text-2xl font-black uppercase">组织 / 项目 / 成员绑定</h3>
          </div>
          <button
            className="b-btn bg-white"
            disabled={orgLoading}
            onClick={() => {
              void refreshOrgDomain();
            }}
          >
            {orgLoading ? "刷新中..." : "刷新组织域"}
          </button>
        </div>

        {orgError ? (
          <p className="text-xs font-bold text-red-700">{orgError}</p>
        ) : (
          <p className="text-xs font-bold text-gray-500">
            {orgDomainPanelState.summaryText}
          </p>
        )}

        {orgDomainPanelState.readOnlyBanner ? (
          <p className="text-xs font-bold text-amber-700">
            {orgDomainPanelState.readOnlyBanner}
          </p>
        ) : null}

        {orgOverview ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border-2 border-black p-3 bg-[#FFD500]/20">
              <p className="text-[10px] uppercase text-gray-600">组织</p>
              <p className="text-2xl font-black">{orgOverview.organizations.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{orgOverview.organizations.active} D:{orgOverview.organizations.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">项目</p>
              <p className="text-2xl font-black">{orgOverview.projects.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{orgOverview.projects.active} D:{orgOverview.projects.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">成员</p>
              <p className="text-2xl font-black">{orgOverview.members.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                A:{orgOverview.members.active} D:{orgOverview.members.disabled}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">绑定</p>
              <p className="text-2xl font-black">{orgOverview.bindings.total}</p>
              <p className="text-[10px] font-mono text-gray-600">
                来源:{orgOverviewFromFallback ? "fallback" : "overview"} · 模式:
                {orgDomainReadOnlyFallback ? "readonly" : "api"}
              </p>
            </div>
          </div>
        ) : null}

        {orgDomainPanelState.overviewFallbackHint ? (
          <p className="text-[10px] font-bold text-gray-500">
            {orgDomainPanelState.overviewFallbackHint}
          </p>
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">组织列表</h4>
            {orgDomainPanelState.organizationWriteHint ? (
              <p className="text-[10px] font-bold text-amber-700">
                {orgDomainPanelState.organizationWriteHint}
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <input
                className="b-input h-10"
                disabled={orgDomainWriteDisabled}
                placeholder="组织名称"
                value={orgForm.name}
                onChange={(e) =>
                  setOrgForm({
                    name: e.target.value,
                  })
                }
              />
              <button
                className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
                disabled={orgDomainWriteDisabled}
                onClick={() => {
                  void createOrganization();
                }}
              >
                创建组织
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {orgOrganizations.map((organization) => (
                <div
                  key={organization.id}
                  className="border-2 border-black p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-bold truncate">{organization.name}</p>
                    <p className="text-[10px] font-mono text-gray-500 truncate">
                      {organization.id} · {organization.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="b-btn bg-white text-xs"
                      onClick={() => {
                        void jumpToAuditByResource({
                          resource: "organization",
                          resourceId: organization.id,
                          keyword: organization.name,
                        });
                      }}
                    >
                      查看审计
                    </button>
                    <button
                      className="b-btn bg-white text-xs"
                      onClick={() => {
                        void jumpToAuditByAction({
                          action: "org.organization.update",
                          resource: "organization",
                          resourceId: organization.id,
                          keyword: organization.name,
                        });
                      }}
                    >
                      启停审计
                    </button>
                    <button
                      className="b-btn bg-white text-xs"
                      disabled={orgDomainWriteDisabled}
                      onClick={() => {
                        void toggleOrganizationStatus(organization);
                      }}
                    >
                      {organization.status === "disabled" ? "启用" : "禁用"}
                    </button>
                    <button
                      className="b-btn bg-white text-xs"
                      disabled={orgDomainWriteDisabled}
                      onClick={() => {
                        void removeOrganization(organization);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {orgOrganizations.length === 0 ? (
                <p className="text-xs font-bold text-gray-500">暂无组织</p>
              ) : null}
            </div>
          </div>

          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">项目列表</h4>
            {orgDomainPanelState.projectWriteHint ? (
              <p className="text-[10px] font-bold text-amber-700">
                {orgDomainPanelState.projectWriteHint}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-2">
              <select
                className="b-input h-10"
                disabled={orgDomainWriteDisabled}
                value={orgProjectForm.organizationId}
                onChange={(e) =>
                  setOrgProjectForm((prev) => ({
                    ...prev,
                    organizationId: e.target.value,
                  }))
                }
              >
                <option value="">选择组织</option>
                {orgOrganizations.map((organization) => (
                  <option
                    key={organization.id}
                    value={organization.id}
                    disabled={organization.status === "disabled"}
                  >
                    {organization.name} ({organization.id})
                    {organization.status === "disabled" ? " · disabled" : ""}
                  </option>
                ))}
              </select>
              <input
                className="b-input h-10"
                disabled={orgDomainWriteDisabled}
                placeholder="项目名称"
                value={orgProjectForm.name}
                onChange={(e) =>
                  setOrgProjectForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
              />
              <button
                className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
                disabled={orgDomainWriteDisabled}
                onClick={() => {
                  void createOrgProject();
                }}
              >
                创建项目
              </button>
            </div>

            <label className="text-xs font-bold uppercase text-gray-500 block">
              组织筛选
              <select
                className="b-input h-9 w-full mt-1"
                value={orgProjectFilterOrganizationId}
                onChange={(e) => setOrgProjectFilterOrganizationId(e.target.value)}
              >
                <option value="">全部组织</option>
                {orgOrganizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {filteredOrgProjects.map((project) => (
                <div
                  key={project.id}
                  className="border-2 border-black p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-bold truncate">{project.name}</p>
                    <p className="text-[10px] font-mono text-gray-500 truncate">
                      {project.id} · {resolveOrganizationDisplayName(project.organizationId, orgOrganizations)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="b-btn bg-white text-xs"
                      onClick={() => {
                        void jumpToAuditByResource({
                          resource: "project",
                          resourceId: project.id,
                          keyword: project.name,
                        });
                      }}
                    >
                      查看审计
                    </button>
                    <button
                      className="b-btn bg-white text-xs"
                      onClick={() => {
                        void jumpToAuditByAction({
                          action: "org.project.update",
                          resource: "project",
                          resourceId: project.id,
                          keyword: project.name,
                        });
                      }}
                    >
                      启停审计
                    </button>
                    <button
                      className="b-btn bg-white text-xs"
                      disabled={orgDomainWriteDisabled}
                      onClick={() => {
                        void toggleOrgProjectStatus(project);
                      }}
                    >
                      {project.status === "disabled" ? "启用" : "禁用"}
                    </button>
                    <button
                      className="b-btn bg-white text-xs"
                      disabled={orgDomainWriteDisabled}
                      onClick={() => {
                        void removeOrgProject(project);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {filteredOrgProjects.length === 0 ? (
                <p className="text-xs font-bold text-gray-500">暂无项目</p>
              ) : null}
            </div>
          </div>

          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">成员管理与绑定</h4>
            {orgDomainPanelState.memberBindingWriteHint ? (
              <p className="text-[10px] font-bold text-amber-700">
                {orgDomainPanelState.memberBindingWriteHint}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-2">
              <select
                className="b-input h-10"
                disabled={orgDomainWriteDisabled}
                value={orgMemberCreateForm.organizationId}
                onChange={(e) =>
                  setOrgMemberCreateForm((prev) => ({
                    ...prev,
                    organizationId: e.target.value,
                  }))
                }
              >
                <option value="">选择组织</option>
                {orgOrganizations.map((organization) => (
                  <option
                    key={organization.id}
                    value={organization.id}
                    disabled={organization.status === "disabled"}
                  >
                    {organization.name} ({organization.id})
                    {organization.status === "disabled" ? " · disabled" : ""}
                  </option>
                ))}
              </select>
              <select
                className="b-input h-10"
                disabled={orgDomainWriteDisabled}
                value={orgMemberCreateForm.userId}
                onChange={(e) =>
                  setOrgMemberCreateForm((prev) => ({
                    ...prev,
                    userId: e.target.value,
                  }))
                }
              >
                <option value="">选择管理员用户</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {resolveAdminUserLabel(user.id, users)}
                  </option>
                ))}
              </select>
              <button
                className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
                disabled={orgDomainWriteDisabled}
                onClick={() => {
                  void createOrgMember();
                }}
              >
                创建成员
              </button>
            </div>
            <div className="border-2 border-black overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-black text-white uppercase">
                  <tr>
                    <th className="p-2">成员</th>
                    <th className="p-2">组织</th>
                    <th className="p-2">项目</th>
                    <th className="p-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/20">
                  {orgMemberBindings.map((member) => (
                    <tr key={member.memberId}>
                      <td className="p-2">
                        <p className="font-bold">{member.username}</p>
                        <p className="font-mono text-[10px] text-gray-500">{member.memberId}</p>
                        <p className="text-[10px] text-gray-500">
                          {member.userId ? `userId: ${member.userId}` : member.email || "未绑定 userId"}
                          {" · "}
                          {(member.status || "active") === "disabled" ? "disabled" : "active"}
                        </p>
                      </td>
                      <td className="p-2">
                        {orgMemberEditingId === member.memberId ? (
                          <select
                            className="b-input h-8 text-xs w-40"
                            disabled={orgDomainWriteDisabled}
                            value={orgMemberEditForm.organizationId}
                            onChange={(e) => {
                              const nextOrganizationId = e.target.value;
                              setOrgMemberEditForm((prev) => ({
                                organizationId: nextOrganizationId,
                                projectIds: prev.projectIds.filter((projectId) =>
                                  orgProjects.some(
                                    (project) =>
                                      project.id === projectId &&
                                      project.organizationId === nextOrganizationId,
                                  ),
                                ),
                              }));
                            }}
                          >
                            <option value="">选择组织</option>
                            {orgOrganizations.map((organization) => (
                              <option
                                key={organization.id}
                                value={organization.id}
                                disabled={organization.status === "disabled"}
                              >
                                {organization.name}
                                {organization.status === "disabled" ? " · disabled" : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono">
                            {resolveOrganizationDisplayName(member.organizationId, orgOrganizations)}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {orgMemberEditingId === member.memberId ? (
                          <div className="flex flex-wrap gap-2 max-w-[300px]">
                            {editableProjectsForMember.map((project) => {
                              const checked = orgMemberEditForm.projectIds.includes(project.id);
                              return (
                                <label
                                  key={`${member.memberId}-${project.id}`}
                                  className="inline-flex items-center gap-1 border border-black px-2 py-1 bg-white"
                                >
                                  <input
                                    type="checkbox"
                                    disabled={orgDomainWriteDisabled || project.status === "disabled"}
                                    checked={checked}
                                    onChange={(e) => {
                                      const nextChecked = e.target.checked;
                                      setOrgMemberEditForm((prev) => {
                                        const current = new Set(prev.projectIds);
                                        if (nextChecked) {
                                          current.add(project.id);
                                        } else {
                                          current.delete(project.id);
                                        }
                                        return {
                                          ...prev,
                                          projectIds: Array.from(current),
                                        };
                                      });
                                    }}
                                  />
                                  <span className="font-mono text-[10px]">
                                    {project.name}
                                    {project.status === "disabled" ? " · disabled" : ""}
                                  </span>
                                </label>
                              );
                            })}
                            {editableProjectsForMember.length === 0 ? (
                              <span className="text-[10px] font-bold text-gray-500">
                                当前组织下暂无可选项目
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="font-mono">{resolveProjectDisplay(member.projectIds, orgProjects)}</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-2">
                          {orgMemberEditingId === member.memberId ? (
                            <>
                              <button
                                className="b-btn bg-white text-xs"
                                onClick={() => {
                                  void jumpToAuditByResource({
                                    resource: "org_member",
                                    resourceId: member.memberId,
                                    keyword: member.username,
                                  });
                                }}
                              >
                                查看审计
                              </button>
                              <button
                                className="b-btn bg-[#FFD500] text-xs"
                                disabled={orgDomainWriteDisabled}
                                onClick={() => {
                                  void saveOrgMemberBinding(member.memberId);
                                }}
                              >
                                保存
                              </button>
                              <button
                                className="b-btn bg-white text-xs"
                                onClick={() => setOrgMemberEditingId(null)}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="b-btn bg-white text-xs"
                                disabled={orgDomainWriteDisabled}
                                onClick={() => startEditOrgMemberBinding(member)}
                              >
                                编辑绑定
                              </button>
                              <button
                                className="b-btn bg-white text-xs"
                                onClick={() => {
                                  const primaryProjectId = member.projectIds[0] || "";
                                  void jumpToAuditByResource({
                                    resource: primaryProjectId ? "org_member_project" : "org_member",
                                    resourceId: primaryProjectId
                                      ? `${member.memberId}:${primaryProjectId}`
                                      : member.memberId,
                                    keyword: member.username,
                                  });
                                }}
                              >
                                查看审计
                              </button>
                              <button
                                className="b-btn bg-white text-xs"
                                disabled={orgDomainWriteDisabled}
                                onClick={() => {
                                  void removeOrgMember(member);
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                                删除成员
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {orgMemberBindings.length === 0 ? (
                    <tr>
                      <td className="p-3 text-gray-500 font-bold" colSpan={4}>
                        暂无成员绑定数据
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow space-y-4">
        <h3 className="text-2xl font-black uppercase">配额策略管理</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            className="b-input h-10"
            placeholder="策略名"
            value={policyForm.name}
            onChange={(e) =>
              setPolicyForm((prev) => ({ ...prev, name: e.target.value }))
            }
          />
          <select
            className="b-input h-10"
            value={policyForm.scopeType}
            onChange={(e) => {
              const nextScopeType = e.target.value as QuotaPolicyItem["scopeType"];
              setPolicyForm((prev) => ({
                ...prev,
                scopeType: nextScopeType,
                scopeValue: nextScopeType === "global" ? "" : prev.scopeValue,
              }));
            }}
          >
            <option value="global">global</option>
            <option value="tenant">tenant</option>
            <option value="role">role</option>
            <option value="user">user</option>
          </select>
          <input
            className="b-input h-10"
            placeholder={policyForm.scopeType === "global" ? "scopeValue（global 必须留空）" : "scopeValue（必填）"}
            disabled={policyForm.scopeType === "global"}
            value={policyForm.scopeValue}
            onChange={(e) =>
              setPolicyForm((prev) => ({ ...prev, scopeValue: e.target.value }))
            }
          />
          <input
            className="b-input h-10"
            placeholder="provider（可选）"
            value={policyForm.provider}
            onChange={(e) =>
              setPolicyForm((prev) => ({ ...prev, provider: e.target.value }))
            }
          />
          <input
            className="b-input h-10"
            placeholder="modelPattern（可选）"
            value={policyForm.modelPattern}
            onChange={(e) =>
              setPolicyForm((prev) => ({ ...prev, modelPattern: e.target.value }))
            }
          />
          <input
            className="b-input h-10"
            type="number"
            min={0}
            placeholder="RPM"
            value={policyForm.requestsPerMinute}
            onChange={(e) =>
              setPolicyForm((prev) => ({
                ...prev,
                requestsPerMinute: e.target.value,
              }))
            }
          />
          <input
            className="b-input h-10"
            type="number"
            min={0}
            placeholder="TPM"
            value={policyForm.tokensPerMinute}
            onChange={(e) =>
              setPolicyForm((prev) => ({
                ...prev,
                tokensPerMinute: e.target.value,
              }))
            }
          />
          <input
            className="b-input h-10"
            type="number"
            min={0}
            placeholder="TPD"
            value={policyForm.tokensPerDay}
            onChange={(e) =>
              setPolicyForm((prev) => ({
                ...prev,
                tokensPerDay: e.target.value,
              }))
            }
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={policyForm.enabled}
            onChange={(e) =>
              setPolicyForm((prev) => ({ ...prev, enabled: e.target.checked }))
            }
          />
          启用策略
        </label>
        <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={createPolicy}>
          创建配额策略
        </button>

        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-black text-white text-xs uppercase">
              <tr>
                <th className="p-2">策略</th>
                <th className="p-2">范围</th>
                <th className="p-2">限制</th>
                <th className="p-2">状态</th>
                <th className="p-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20">
              {policies.map((policy) => (
                <tr key={policy.id}>
                  <td className="p-2">
                    {policyEditingId === policy.id ? (
                      <div className="space-y-2">
                        <input
                          className="b-input h-8 text-xs"
                          value={policyEditForm.name}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          placeholder="策略名"
                        />
                        <p className="font-mono text-xs text-gray-500">{policy.id}</p>
                      </div>
                    ) : (
                      <>
                        <p className="font-bold">{policy.name}</p>
                        <p className="font-mono text-xs text-gray-500">{policy.id}</p>
                      </>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {policyEditingId === policy.id ? (
                      <div className="grid grid-cols-1 gap-2">
                        <select
                          className="b-input h-8 text-xs"
                          value={policyEditForm.scopeType}
                          onChange={(e) => {
                            const nextScopeType = e.target.value as QuotaPolicyItem["scopeType"];
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              scopeType: nextScopeType,
                              scopeValue: nextScopeType === "global" ? "" : prev.scopeValue,
                            }));
                          }}
                        >
                          <option value="global">global</option>
                          <option value="tenant">tenant</option>
                          <option value="role">role</option>
                          <option value="user">user</option>
                        </select>
                        <input
                          className="b-input h-8 text-xs"
                          value={policyEditForm.scopeValue}
                          disabled={policyEditForm.scopeType === "global"}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              scopeValue: e.target.value,
                            }))
                          }
                          placeholder={
                            policyEditForm.scopeType === "global"
                              ? "scopeValue（global 必须留空）"
                              : "scopeValue（必填）"
                          }
                        />
                        <input
                          className="b-input h-8 text-xs"
                          value={policyEditForm.provider}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              provider: e.target.value,
                            }))
                          }
                          placeholder="provider（可选）"
                        />
                        <input
                          className="b-input h-8 text-xs"
                          value={policyEditForm.modelPattern}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              modelPattern: e.target.value,
                            }))
                          }
                          placeholder="modelPattern（可选）"
                        />
                      </div>
                    ) : (
                      <>
                        {policy.scopeType}
                        {policy.scopeValue ? `:${policy.scopeValue}` : ""}
                        {(policy.provider || policy.modelPattern) && (
                          <div className="mt-1 space-y-1 text-[11px] text-gray-500">
                            <div>provider: {policy.provider || "-"}</div>
                            <div>model: {policy.modelPattern || "-"}</div>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {policyEditingId === policy.id ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          className="b-input h-8 text-xs"
                          type="number"
                          min={0}
                          value={policyEditForm.requestsPerMinute}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              requestsPerMinute: e.target.value,
                            }))
                          }
                          placeholder="RPM"
                        />
                        <input
                          className="b-input h-8 text-xs"
                          type="number"
                          min={0}
                          value={policyEditForm.tokensPerMinute}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              tokensPerMinute: e.target.value,
                            }))
                          }
                          placeholder="TPM"
                        />
                        <input
                          className="b-input h-8 text-xs"
                          type="number"
                          min={0}
                          value={policyEditForm.tokensPerDay}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              tokensPerDay: e.target.value,
                            }))
                          }
                          placeholder="TPD"
                        />
                      </div>
                    ) : (
                      <>
                        RPM {policy.requestsPerMinute ?? "-"} / TPM {policy.tokensPerMinute ?? "-"} /
                        TPD {policy.tokensPerDay ?? "-"}
                      </>
                    )}
                  </td>
                  <td className="p-2">
                    {policyEditingId === policy.id ? (
                      <label className="inline-flex items-center gap-2 text-xs font-bold">
                        <input
                          type="checkbox"
                          checked={policyEditForm.enabled}
                          onChange={(e) =>
                            setPolicyEditForm((prev) => ({
                              ...prev,
                              enabled: e.target.checked,
                            }))
                          }
                        />
                        启用
                      </label>
                    ) : policy.enabled ? (
                      "启用"
                    ) : (
                      "停用"
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-2">
                      {policyEditingId === policy.id ? (
                        <>
                          <button
                            className="b-btn bg-[#FFD500] text-xs"
                            onClick={() => savePolicyEdit(policy)}
                          >
                            保存
                          </button>
                          <button
                            className="b-btn bg-white text-xs"
                            onClick={() => {
                              setPolicyEditingId(null);
                              setPolicyEditForm(resetEnterprisePolicyEditForm());
                            }}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="b-btn bg-white text-xs"
                            onClick={() => startEditPolicy(policy)}
                          >
                            编辑
                          </button>
                          <button
                            className="b-btn bg-white text-xs"
                            onClick={() => removePolicy(policy.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-2xl font-black uppercase">OAuth 告警中心</h3>
          <button
            className="b-btn bg-white"
            onClick={() => {
              void refreshOAuthAlertCenter();
            }}
          >
            刷新告警中心
          </button>
        </div>

        {!oauthAlertCenterApiAvailable ? (
          <p className="text-xs font-bold text-gray-500">
            当前后端未提供 <code>/api/admin/observability/oauth-alerts/*</code>
            ，告警中心面板已自动降级。
          </p>
        ) : (
          <p className="text-xs font-bold text-gray-500">
            支持阈值配置、手动评估、incident / delivery 值班追踪；点击 incident 可联动会话事件筛选。
          </p>
        )}

        <SectionErrorBanner
          title="OAuth 告警中心"
          error={oauthAlertSectionError}
          onRetry={() => {
            void refreshOAuthAlertCenter();
          }}
          retryLabel="重新拉取告警中心"
        />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">告警配置（引擎 + 投递抑制）</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="text-xs font-bold uppercase text-gray-500">
                warningRateThresholdBps
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={1}
                  value={oauthAlertConfig.warningRateThresholdBps}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      warningRateThresholdBps: Number.parseInt(e.target.value || "1", 10) || 1,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                warningFailureCountThreshold
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={1}
                  value={oauthAlertConfig.warningFailureCountThreshold}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      warningFailureCountThreshold: Number.parseInt(e.target.value || "1", 10) || 1,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                criticalRateThresholdBps
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={1}
                  value={oauthAlertConfig.criticalRateThresholdBps}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      criticalRateThresholdBps: Number.parseInt(e.target.value || "1", 10) || 1,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                criticalFailureCountThreshold
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={1}
                  value={oauthAlertConfig.criticalFailureCountThreshold}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      criticalFailureCountThreshold:
                        Number.parseInt(e.target.value || "1", 10) || 1,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                recoveryRateThresholdBps
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={0}
                  value={oauthAlertConfig.recoveryRateThresholdBps}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      recoveryRateThresholdBps: Number.parseInt(e.target.value || "0", 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                recoveryFailureCountThreshold
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={0}
                  value={oauthAlertConfig.recoveryFailureCountThreshold}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      recoveryFailureCountThreshold:
                        Number.parseInt(e.target.value || "0", 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                dedupeWindowSec
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={0}
                  value={oauthAlertConfig.dedupeWindowSec}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      dedupeWindowSec: Number.parseInt(e.target.value || "0", 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                recoveryConsecutiveWindows
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={1}
                  value={oauthAlertConfig.recoveryConsecutiveWindows}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      recoveryConsecutiveWindows:
                        Number.parseInt(e.target.value || "1", 10) || 1,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                windowSizeSec
                <input
                  className="b-input h-9 mt-1"
                  type="number"
                  min={60}
                  value={oauthAlertConfig.windowSizeSec}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      windowSizeSec: Number.parseInt(e.target.value || "60", 10) || 60,
                    }))
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                quietHoursStart
                <input
                  className="b-input h-9 mt-1"
                  value={oauthAlertConfig.quietHoursStart}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      quietHoursStart: e.target.value,
                    }))
                  }
                  placeholder="HH:mm"
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                quietHoursEnd
                <input
                  className="b-input h-9 mt-1"
                  value={oauthAlertConfig.quietHoursEnd}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      quietHoursEnd: e.target.value,
                    }))
                  }
                  placeholder="HH:mm"
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                quietHoursTimezone
                <input
                  className="b-input h-9 mt-1"
                  value={oauthAlertConfig.quietHoursTimezone}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      quietHoursTimezone: e.target.value,
                    }))
                  }
                  placeholder="Asia/Shanghai"
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                minDeliverySeverity
                <select
                  className="b-input h-9 mt-1"
                  value={oauthAlertConfig.minDeliverySeverity}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      minDeliverySeverity: e.target.value as "warning" | "critical",
                    }))
                  }
                >
                  <option value="warning">warning</option>
                  <option value="critical">critical</option>
                </select>
              </label>
            </div>
            <label className="text-xs font-bold uppercase text-gray-500 block">
              muteProviders（逗号分隔）
              <input
                className="b-input h-9 mt-1"
                value={oauthAlertConfig.muteProviders.join(",")}
                onChange={(e) =>
                  setOAuthAlertConfig((prev) => ({
                    ...prev,
                    muteProviders: e.target.value
                      .split(",")
                      .map((item) => item.trim().toLowerCase())
                      .filter(Boolean),
                  }))
                }
                placeholder="claude,gemini"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={oauthAlertConfig.enabled}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      enabled: e.target.checked,
                    }))
                  }
                />
                启用告警引擎
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={oauthAlertConfig.quietHoursEnabled}
                  onChange={(e) =>
                    setOAuthAlertConfig((prev) => ({
                      ...prev,
                      quietHoursEnabled: e.target.checked,
                    }))
                  }
                />
                启用静默时段
              </label>
            </div>
            <button
              className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
              disabled={oauthAlertConfigSaving}
              onClick={() => {
                void saveOAuthAlertConfig();
              }}
            >
              {oauthAlertConfigSaving ? "保存中..." : "保存告警配置"}
            </button>
          </div>

          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">手动评估</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="b-input h-9"
                value={oauthAlertEvaluateForm.provider}
                onChange={(e) =>
                  setOAuthAlertEvaluateForm((prev) => ({ ...prev, provider: e.target.value }))
                }
                placeholder="provider（可选）"
              />
            </div>
            <button
              className="b-btn bg-white"
              disabled={oauthAlertEvaluating}
              onClick={() => {
                void evaluateOAuthAlertsManually();
              }}
            >
              {oauthAlertEvaluating ? "评估中..." : "执行手动评估"}
            </button>
            {oauthAlertLastEvaluateResult ? (
              <p className="text-xs font-bold text-emerald-700">{oauthAlertLastEvaluateResult}</p>
            ) : (
              <p className="text-xs font-bold text-gray-500">
                评估结果会显示在这里，并自动刷新 incidents / deliveries 列表。
              </p>
            )}
          </div>
        </div>

        <div className="border-2 border-black p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-lg font-black uppercase">规则版本管理</h4>
            <div className="flex flex-wrap gap-2">
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  oauthAlertRuleActionBusy ||
                  oauthAlertRulePageLoading ||
                  !oauthAlertCenterApiAvailable
                }
                onClick={() => {
                  void refreshOAuthAlertRuleVersions();
                }}
              >
                刷新规则
              </button>
              <button
                className="b-btn bg-[#FFD500] hover:bg-[#ffe033] text-xs"
                disabled={oauthAlertRuleActionBusy || !oauthAlertCenterApiAvailable}
                onClick={() => {
                  void createOAuthAlertRuleVersion();
                }}
              >
                {oauthAlertRuleCreating ? "创建中..." : "创建并发布版本"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={cn(
                "b-btn text-xs",
                useStructuredOAuthAlertRuleEditor
                  ? "bg-black text-white"
                  : "bg-white text-black",
              )}
              disabled={oauthAlertRuleActionBusy}
              onClick={switchToStructuredOAuthAlertRuleEditor}
            >
              结构化表单
            </button>
            <button
              className={cn(
                "b-btn text-xs",
                !useStructuredOAuthAlertRuleEditor
                  ? "bg-black text-white"
                  : "bg-white text-black",
              )}
              disabled={oauthAlertRuleActionBusy}
              onClick={switchToAdvancedOAuthAlertRuleEditor}
            >
              高级 JSON
            </button>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
              默认提供单规则模板，失败提示会附带 traceId。
            </span>
          </div>
          <p className="text-xs font-bold text-gray-500">
            当前激活版本：{oauthAlertRuleActiveVersion?.version || "-"}（
            {oauthAlertRuleActiveVersion?.status || "-"}）
          </p>
          {useStructuredOAuthAlertRuleEditor ? (
            <div className="border-2 border-black bg-[#FFF6C2] p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  版本号
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.version}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        version: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="ops-v2"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  描述
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.description}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="针对高失败率的升级规则"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  provider
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.provider}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        provider: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="留空表示全部 provider"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  失败率阈值 Bps
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.failureRateBps}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        failureRateBps: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="3500"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  告警严重级别
                  <select
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.severity}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        severity: e.target.value as OAuthAlertRuleStructuredDraft["severity"],
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                  >
                    <option value="warning">warning</option>
                    <option value="critical">critical</option>
                    <option value="recovery">recovery</option>
                  </select>
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  通知通道
                  <select
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.channel}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        channel: e.target.value as OAuthAlertRuleStructuredDraft["channel"],
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                  >
                    <option value="">继承默认</option>
                    <option value="webhook">webhook</option>
                    <option value="wecom">wecom</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  ruleId
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.ruleId}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        ruleId: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="critical-escalate"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  规则名称
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.name}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="高失败率升级"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  优先级
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.priority}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        priority: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="200"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  恢复连续窗口
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={oauthAlertRuleStructuredDraft.recoveryConsecutiveWindows}
                    onChange={(e) =>
                      setOAuthAlertRuleStructuredDraft((prev) => ({
                        ...prev,
                        recoveryConsecutiveWindows: e.target.value,
                      }))
                    }
                    disabled={oauthAlertRuleActionBusy}
                    placeholder="3"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="border-2 border-black bg-white p-3 text-xs font-bold uppercase tracking-[0.12em]">
                  发布策略
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-black"
                      checked={oauthAlertRuleStructuredDraft.activate}
                      onChange={(e) =>
                        setOAuthAlertRuleStructuredDraft((prev) => ({
                          ...prev,
                          activate: e.target.checked,
                        }))
                      }
                      disabled={oauthAlertRuleActionBusy}
                    />
                    <span className="text-xs font-bold normal-case">创建后立即激活</span>
                  </div>
                </label>
                <label className="border-2 border-black bg-white p-3 text-xs font-bold uppercase tracking-[0.12em]">
                  规则开关
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-black"
                      checked={oauthAlertRuleStructuredDraft.enabled}
                      onChange={(e) =>
                        setOAuthAlertRuleStructuredDraft((prev) => ({
                          ...prev,
                          enabled: e.target.checked,
                        }))
                      }
                      disabled={oauthAlertRuleActionBusy}
                    />
                    <span className="text-xs font-bold normal-case">规则默认启用</span>
                  </div>
                </label>
              </div>
              <div className="border-2 border-black bg-white p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black uppercase">静默窗口</p>
                    <p className="text-[11px] font-bold text-gray-500">
                      仅生成一个常用静默窗口。weekdays 按 0-6 填写，0 表示周日。
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-black"
                      checked={oauthAlertRuleStructuredDraft.muteWindowEnabled}
                      onChange={(e) =>
                        setOAuthAlertRuleStructuredDraft((prev) => ({
                          ...prev,
                          muteWindowEnabled: e.target.checked,
                        }))
                      }
                      disabled={oauthAlertRuleActionBusy}
                    />
                    启用静默窗口
                  </label>
                </div>
                {oauthAlertRuleStructuredDraft.muteWindowEnabled ? (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                      ID
                      <input
                        className="b-input h-10 w-full mt-1"
                        value={oauthAlertRuleStructuredDraft.muteWindowId}
                        onChange={(e) =>
                          setOAuthAlertRuleStructuredDraft((prev) => ({
                            ...prev,
                            muteWindowId: e.target.value,
                          }))
                        }
                        disabled={oauthAlertRuleActionBusy}
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                      名称
                      <input
                        className="b-input h-10 w-full mt-1"
                        value={oauthAlertRuleStructuredDraft.muteWindowName}
                        onChange={(e) =>
                          setOAuthAlertRuleStructuredDraft((prev) => ({
                            ...prev,
                            muteWindowName: e.target.value,
                          }))
                        }
                        disabled={oauthAlertRuleActionBusy}
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                      开始时间
                      <input
                        className="b-input h-10 w-full mt-1"
                        value={oauthAlertRuleStructuredDraft.muteWindowStart}
                        onChange={(e) =>
                          setOAuthAlertRuleStructuredDraft((prev) => ({
                            ...prev,
                            muteWindowStart: e.target.value,
                          }))
                        }
                        disabled={oauthAlertRuleActionBusy}
                        placeholder="23:00"
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                      结束时间
                      <input
                        className="b-input h-10 w-full mt-1"
                        value={oauthAlertRuleStructuredDraft.muteWindowEnd}
                        onChange={(e) =>
                          setOAuthAlertRuleStructuredDraft((prev) => ({
                            ...prev,
                            muteWindowEnd: e.target.value,
                          }))
                        }
                        disabled={oauthAlertRuleActionBusy}
                        placeholder="08:00"
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] md:col-span-2">
                      时区
                      <input
                        className="b-input h-10 w-full mt-1"
                        value={oauthAlertRuleStructuredDraft.muteWindowTimezone}
                        onChange={(e) =>
                          setOAuthAlertRuleStructuredDraft((prev) => ({
                            ...prev,
                            muteWindowTimezone: e.target.value,
                          }))
                        }
                        disabled={oauthAlertRuleActionBusy}
                        placeholder="Asia/Shanghai"
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                      weekdays
                      <input
                        className="b-input h-10 w-full mt-1"
                        value={oauthAlertRuleStructuredDraft.muteWindowWeekdaysText}
                        onChange={(e) =>
                          setOAuthAlertRuleStructuredDraft((prev) => ({
                            ...prev,
                            muteWindowWeekdaysText: e.target.value,
                          }))
                        }
                        disabled={oauthAlertRuleActionBusy}
                        placeholder="1,2,3,4,5"
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                      severities
                      <input
                        className="b-input h-10 w-full mt-1"
                        value={oauthAlertRuleStructuredDraft.muteWindowSeveritiesText}
                        onChange={(e) =>
                          setOAuthAlertRuleStructuredDraft((prev) => ({
                            ...prev,
                            muteWindowSeveritiesText: e.target.value,
                          }))
                        }
                        disabled={oauthAlertRuleActionBusy}
                        placeholder="warning,critical"
                      />
                    </label>
                  </div>
                ) : (
                  <p className="text-xs font-bold text-gray-500">
                    关闭时不会写入 <code>muteWindows</code>。
                  </p>
                )}
              </div>
            </div>
          ) : (
            <textarea
              className="b-input min-h-[180px] font-mono text-xs"
              value={oauthAlertRuleCreateText}
              onChange={(e) => setOAuthAlertRuleCreateText(e.target.value)}
              disabled={oauthAlertRuleActionBusy}
              placeholder='{"version":"ops-v1","activate":true,"rules":[...]}'
            />
          )}
          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-black text-white uppercase">
                <tr>
                  <th className="p-2">版本</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">规则</th>
                  <th className="p-2">命中</th>
                  <th className="p-2">更新时间</th>
                  <th className="p-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20">
                {(oauthAlertRuleVersions?.data || []).map((item) => (
                  <tr key={`rule-version-${item.id}`}>
                    <td className="p-2 font-mono">{item.version}</td>
                    <td className="p-2">{item.status}</td>
                    <td className="p-2 font-mono">
                      {item.enabledRules ?? 0}/{item.totalRules ?? 0}
                    </td>
                    <td className="p-2 font-mono">{item.totalHits ?? 0}</td>
                    <td className="p-2 font-mono">
                      {item.updatedAt ? new Date(item.updatedAt).toISOString() : "-"}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        className="b-btn bg-white text-xs"
                        disabled={
                          oauthAlertRuleActionBusy ||
                          item.status === "active"
                        }
                        onClick={() => {
                          void rollbackOAuthAlertRuleVersion(item);
                        }}
                      >
                        {oauthAlertRuleRollingVersionId === item.id ? "回滚中..." : "回滚到此版本"}
                      </button>
                    </td>
                  </tr>
                ))}
                {(oauthAlertRuleVersions?.data || []).length === 0 ? (
                  <tr>
                    <td className="p-3 text-gray-500 font-bold" colSpan={6}>
                      暂无规则版本
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-gray-600">
            <span>
              共 {oauthAlertRuleVersions?.total || 0} 条，第 {oauthAlertRuleVersions?.page || 1}/
              {oauthAlertRuleVersions?.totalPages || 1} 页
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  oauthAlertRuleActionBusy ||
                  oauthAlertRulePageLoading ||
                  (oauthAlertRuleVersions?.page || 1) <= 1
                }
                onClick={() => {
                  void gotoOAuthAlertRulePage(1);
                }}
              >
                首页
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  oauthAlertRuleActionBusy ||
                  oauthAlertRulePageLoading ||
                  (oauthAlertRuleVersions?.page || 1) <= 1
                }
                onClick={() => {
                  void gotoOAuthAlertRulePage((oauthAlertRuleVersions?.page || 1) - 1);
                }}
              >
                上一页
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  oauthAlertRuleActionBusy ||
                  oauthAlertRulePageLoading ||
                  (oauthAlertRuleVersions?.page || 1) >= (oauthAlertRuleVersions?.totalPages || 1)
                }
                onClick={() => {
                  void gotoOAuthAlertRulePage((oauthAlertRuleVersions?.page || 1) + 1);
                }}
              >
                下一页
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  oauthAlertRuleActionBusy ||
                  oauthAlertRulePageLoading ||
                  (oauthAlertRuleVersions?.page || 1) >= (oauthAlertRuleVersions?.totalPages || 1)
                }
                onClick={() => {
                  void gotoOAuthAlertRulePage(oauthAlertRuleVersions?.totalPages || 1);
                }}
              >
                末页
              </button>
              <input
                className="b-input h-8 w-20"
                value={oauthAlertRulePageInput}
                onChange={(e) => setOAuthAlertRulePageInput(e.target.value)}
                placeholder="页码"
                disabled={oauthAlertRuleActionBusy || oauthAlertRulePageLoading}
              />
              <button
                className="b-btn bg-white text-xs"
                disabled={oauthAlertRuleActionBusy || oauthAlertRulePageLoading}
                onClick={() => {
                  const target = Number(oauthAlertRulePageInput);
                  if (!Number.isFinite(target) || target <= 0) {
                    toast.error("页码非法");
                    return;
                  }
                  void gotoOAuthAlertRulePage(Math.floor(target));
                }}
              >
                跳转
              </button>
            </div>
          </div>
        </div>

        <div className="border-2 border-black p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-lg font-black uppercase">Alertmanager 同步</h4>
            <div className="flex flex-wrap gap-2">
              <button
                className="b-btn bg-white text-xs"
                disabled={alertmanagerActionBusy || alertmanagerHistoryPageLoading}
                onClick={() => {
                  void refreshAlertmanagerCenter();
                }}
              >
                读取配置
              </button>
              <button
                className="b-btn bg-[#FFD500] hover:bg-[#ffe033] text-xs"
                disabled={alertmanagerActionBusy || !alertmanagerApiAvailable}
                onClick={() => {
                  void saveAlertmanagerConfig();
                }}
              >
                {alertmanagerConfigSaving ? "保存中..." : "保存配置"}
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={alertmanagerActionBusy || !alertmanagerApiAvailable}
                onClick={() => {
                  void triggerAlertmanagerSync();
                }}
              >
                {alertmanagerSyncing ? "同步中..." : "执行同步"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={cn(
                "b-btn text-xs",
                useStructuredAlertmanagerEditor ? "bg-black text-white" : "bg-white text-black",
              )}
              disabled={alertmanagerActionBusy}
              onClick={switchToStructuredAlertmanagerEditor}
            >
              结构化表单
            </button>
            <button
              className={cn(
                "b-btn text-xs",
                !useStructuredAlertmanagerEditor ? "bg-black text-white" : "bg-white text-black",
              )}
              disabled={alertmanagerActionBusy}
              onClick={switchToAdvancedAlertmanagerEditor}
            >
              高级 JSON
            </button>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
              保存配置后再执行同步，复杂路由保留高级 JSON 模式。
            </span>
          </div>
          {!alertmanagerApiAvailable ? (
            <p className="text-xs font-bold text-gray-500">
              后端未启用 <code>/api/admin/observability/oauth-alerts/alertmanager/*</code>
              ，已自动降级该面板。
            </p>
          ) : (
            <p className="text-xs font-bold text-gray-500">
              支持后台维护 Alertmanager 配置并触发 reload/ready 同步回滚链路。
            </p>
          )}
          {useStructuredAlertmanagerEditor ? (
            <div className="border-2 border-black bg-[#EAF2FF] p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  默认接收器
                  <select
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.defaultReceiver}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        defaultReceiver: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                  >
                    {alertmanagerReceiverOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  group_by
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.groupByText}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        groupByText: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                    placeholder="alertname, provider, severity"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  group_wait 秒数
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.groupWaitSec}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        groupWaitSec: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                    placeholder="30"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  group_interval 秒数
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.groupIntervalSec}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        groupIntervalSec: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                    placeholder="300"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  repeat_interval 秒数
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.repeatIntervalSec}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        repeatIntervalSec: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                    placeholder="14400"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  warning webhook
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.warningWebhookUrl}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        warningWebhookUrl: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                    placeholder="https://hooks.example.com/warning"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  critical webhook
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.criticalWebhookUrl}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        criticalWebhookUrl: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                    placeholder="https://hooks.example.com/critical"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                  p1 webhook
                  <input
                    className="b-input h-10 w-full mt-1"
                    value={alertmanagerStructuredDraft.p1WebhookUrl}
                    onChange={(e) =>
                      setAlertmanagerStructuredDraft((prev) => ({
                        ...prev,
                        p1WebhookUrl: e.target.value,
                      }))
                    }
                    disabled={alertmanagerActionBusy}
                    placeholder="https://hooks.example.com/p1"
                  />
                </label>
              </div>
              <label className="block text-xs font-bold uppercase tracking-[0.12em]">
                templates
                <textarea
                  className="b-input min-h-[96px] w-full mt-1 font-mono text-xs"
                  value={alertmanagerStructuredDraft.templatesText}
                  onChange={(e) =>
                    setAlertmanagerStructuredDraft((prev) => ({
                      ...prev,
                      templatesText: e.target.value,
                    }))
                  }
                  disabled={alertmanagerActionBusy}
                  placeholder={"/etc/alertmanager/templates/oauth-alerts.tmpl\n/etc/alertmanager/templates/common.tmpl"}
                />
              </label>
              {hasMaskedManagedAlertmanagerWebhook ? (
                <p className="text-xs font-bold text-amber-700">
                  当前已加载的 webhook 地址已脱敏。若要重新保存结构化配置，请填写真实 URL。
                </p>
              ) : null}
              <p className="text-xs font-bold text-gray-500">
                结构化模式会保留现有的 <code>global</code>、<code>inhibit_rules</code>、
                <code>time_intervals</code> 等高级字段；若要编辑复杂路由树，请切换到高级 JSON。
              </p>
            </div>
          ) : (
            <textarea
              className="b-input min-h-[180px] font-mono text-xs"
              value={alertmanagerConfigText}
              onChange={(e) => setAlertmanagerConfigText(e.target.value)}
              disabled={alertmanagerActionBusy}
              placeholder='{"route":{"receiver":"warning-webhook"},"receivers":[]}'
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-bold text-gray-600">
            <p>版本：{alertmanagerConfig?.version ?? "-"}</p>
            <p>更新人：{alertmanagerConfig?.updatedBy || "-"}</p>
            <p>更新时间：{alertmanagerConfig?.updatedAt || "-"}</p>
            <p>最近同步：{renderAlertmanagerSyncSummary(alertmanagerLatestSync || undefined)}</p>
          </div>
          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-black text-white uppercase">
                <tr>
                  <th className="p-2">时间</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">信息</th>
                  <th className="p-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20">
                {alertmanagerSyncHistory.map((item, index) => (
                  <tr key={`${item.id || "sync"}-${index}`}>
                    <td className="p-2 font-mono">{item.ts || "-"}</td>
                    <td className="p-2 font-mono">{item.outcome || "-"}</td>
                    <td className="p-2">{renderAlertmanagerSyncSummary(item)}</td>
                    <td className="p-2 text-right">
                      <button
                        className="b-btn bg-white text-xs"
                        disabled={
                          !item.id ||
                          !alertmanagerApiAvailable ||
                          alertmanagerActionBusy
                        }
                        onClick={() => {
                          if (item.id) {
                            void rollbackAlertmanagerSyncHistoryById(item);
                          }
                        }}
                      >
                        {alertmanagerHistoryRollingId === item.id ? "回滚中..." : "回滚此记录"}
                      </button>
                    </td>
                  </tr>
                ))}
                {alertmanagerSyncHistory.length === 0 ? (
                  <tr>
                    <td className="p-3 text-gray-500 font-bold" colSpan={4}>
                      暂无同步记录
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-gray-600">
            <span>
              共 {alertmanagerHistoryTotal} 条，第 {alertmanagerHistoryPage}/{alertmanagerHistoryTotalPages} 页
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  alertmanagerActionBusy ||
                  alertmanagerHistoryPageLoading ||
                  !alertmanagerApiAvailable ||
                  alertmanagerHistoryPage <= 1
                }
                onClick={() => {
                  void gotoAlertmanagerHistoryPage(1);
                }}
              >
                首页
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  alertmanagerActionBusy ||
                  alertmanagerHistoryPageLoading ||
                  !alertmanagerApiAvailable ||
                  alertmanagerHistoryPage <= 1
                }
                onClick={() => {
                  void gotoAlertmanagerHistoryPage(alertmanagerHistoryPage - 1);
                }}
              >
                上一页
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  alertmanagerActionBusy ||
                  alertmanagerHistoryPageLoading ||
                  !alertmanagerApiAvailable ||
                  alertmanagerHistoryPage >= alertmanagerHistoryTotalPages
                }
                onClick={() => {
                  void gotoAlertmanagerHistoryPage(alertmanagerHistoryPage + 1);
                }}
              >
                下一页
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  alertmanagerActionBusy ||
                  alertmanagerHistoryPageLoading ||
                  !alertmanagerApiAvailable ||
                  alertmanagerHistoryPage >= alertmanagerHistoryTotalPages
                }
                onClick={() => {
                  void gotoAlertmanagerHistoryPage(alertmanagerHistoryTotalPages);
                }}
              >
                末页
              </button>
              <input
                className="b-input h-8 w-20"
                value={alertmanagerHistoryPageInput}
                onChange={(e) => setAlertmanagerHistoryPageInput(e.target.value)}
                placeholder="页码"
                disabled={
                  alertmanagerActionBusy || alertmanagerHistoryPageLoading || !alertmanagerApiAvailable
                }
              />
              <button
                className="b-btn bg-white text-xs"
                disabled={
                  alertmanagerActionBusy || alertmanagerHistoryPageLoading || !alertmanagerApiAvailable
                }
                onClick={() => {
                  const target = Number(alertmanagerHistoryPageInput);
                  if (!Number.isFinite(target) || target <= 0) {
                    toast.error("页码非法");
                    return;
                  }
                  void gotoAlertmanagerHistoryPage(Math.floor(target));
                }}
              >
                跳转
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="border-2 border-black p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-lg font-black uppercase">Incidents</h4>
              <button className="b-btn bg-white text-xs" onClick={() => void applyOAuthAlertIncidentFilters(1)}>
                查询
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="b-input h-9"
                value={oauthAlertIncidentProviderFilter}
                onChange={(e) => setOAuthAlertIncidentProviderFilter(e.target.value)}
                placeholder="provider"
              />
              <input
                className="b-input h-9"
                value={oauthAlertIncidentPhaseFilter}
                onChange={(e) => setOAuthAlertIncidentPhaseFilter(e.target.value)}
                placeholder="phase"
              />
              <select
                className="b-input h-9"
                value={oauthAlertIncidentSeverityFilter}
                onChange={(e) =>
                  setOAuthAlertIncidentSeverityFilter(
                    e.target.value as "" | "critical" | "warning" | "recovery",
                  )
                }
              >
                <option value="">全部级别</option>
                <option value="critical">critical</option>
                <option value="warning">warning</option>
                <option value="recovery">recovery</option>
              </select>
              <input
                type="datetime-local"
                className="b-input h-9"
                value={oauthAlertIncidentFromFilter}
                onChange={(e) => setOAuthAlertIncidentFromFilter(e.target.value)}
              />
              <input
                type="datetime-local"
                className="b-input h-9"
                value={oauthAlertIncidentToFilter}
                onChange={(e) => setOAuthAlertIncidentToFilter(e.target.value)}
              />
            </div>
            <div className="border-2 border-black overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-black text-white uppercase">
                  <tr>
                    <th className="p-2">incident</th>
                    <th className="p-2">provider/phase</th>
                    <th className="p-2">severity</th>
                    <th className="p-2">失败率</th>
                    <th className="p-2">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/20">
                  {(oauthAlertIncidents?.data || []).map((item) => (
                    <tr key={item.id}>
                      <td className="p-2">
                        <button
                          className="font-mono underline decoration-dotted"
                          onClick={() => {
                            void linkIncidentToSessionEvents(item);
                          }}
                          title="联动 OAuth 会话事件筛选"
                        >
                          {item.incidentId || "-"}
                        </button>
                        <p className="text-[10px] text-gray-500 truncate">
                          event={item.id} {item.dedupeKey ? `| ${item.dedupeKey}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold">
                          <button
                            className="underline decoration-dotted"
                            disabled={!item.incidentId}
                            onClick={() => {
                              void jumpToOAuthAlertDeliveriesByIncident(item.incidentId);
                            }}
                            title="按 incidentId 联动 Deliveries"
                          >
                            查 deliveries
                          </button>
                          <button
                            className="underline decoration-dotted"
                            disabled={!item.incidentId}
                            onClick={() => {
                              void jumpToAuditByKeyword(item.incidentId);
                            }}
                            title="按 incidentId 关键字联动统一审计"
                          >
                            查审计
                          </button>
                        </div>
                      </td>
                      <td className="p-2 font-mono">
                        {item.provider} / {item.phase}
                      </td>
                      <td className="p-2 font-mono">
                        {item.severity}
                      </td>
                      <td className="p-2 font-mono">
                        {item.failureCount}/{item.totalCount}
                        <p className="text-[10px] text-gray-500">
                          {(item.failureRateBps / 100).toFixed(2)}% {item.message || ""}
                        </p>
                      </td>
                      <td className="p-2 font-mono">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {(oauthAlertIncidents?.data || []).length === 0 ? (
                    <tr>
                      <td className="p-3 font-bold text-gray-500" colSpan={5}>
                        暂无告警 incidents
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-gray-500">
              <p>
                共 {oauthAlertIncidents?.total || 0} 条，第 {oauthAlertIncidents?.page || 1}/
                {oauthAlertIncidents?.totalPages || 1} 页
              </p>
              <div className="flex gap-2">
                <button
                  className="b-btn bg-white text-xs"
                  disabled={(oauthAlertIncidents?.page || 1) <= 1}
                  onClick={() => {
                    const prev = Math.max(1, (oauthAlertIncidents?.page || 1) - 1);
                    void applyOAuthAlertIncidentFilters(prev);
                  }}
                >
                  上一页
                </button>
                <button
                  className="b-btn bg-white text-xs"
                  disabled={
                    (oauthAlertIncidents?.page || 1) >= (oauthAlertIncidents?.totalPages || 1)
                  }
                  onClick={() => {
                    const next = Math.min(
                      oauthAlertIncidents?.totalPages || 1,
                      (oauthAlertIncidents?.page || 1) + 1,
                    );
                    void applyOAuthAlertIncidentFilters(next);
                  }}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>

          <div
            id="oauth-alert-deliveries-section"
            className="border-2 border-black p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-lg font-black uppercase">Deliveries</h4>
              <button className="b-btn bg-white text-xs" onClick={() => void applyOAuthAlertDeliveryFilters(1)}>
                查询
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="b-input h-9"
                value={oauthAlertDeliveryIncidentIdFilter}
                onChange={(e) => setOAuthAlertDeliveryIncidentIdFilter(e.target.value)}
                placeholder="incidentId（主锚点）"
              />
              <input
                className="b-input h-9"
                value={oauthAlertDeliveryEventIdFilter}
                onChange={(e) => setOAuthAlertDeliveryEventIdFilter(e.target.value)}
                placeholder="兼容 eventId（可选）"
              />
              <input
                className="b-input h-9"
                value={oauthAlertDeliveryChannelFilter}
                onChange={(e) => setOAuthAlertDeliveryChannelFilter(e.target.value)}
                placeholder="channel"
              />
              <select
                className="b-input h-9"
                value={oauthAlertDeliveryStatusFilter}
                onChange={(e) =>
                    setOAuthAlertDeliveryStatusFilter(
                    e.target.value as "" | "success" | "failure",
                  )
                }
              >
                <option value="">全部状态</option>
                <option value="success">success</option>
                <option value="failure">failure</option>
              </select>
              <input
                type="datetime-local"
                className="b-input h-9"
                value={oauthAlertDeliveryFromFilter}
                onChange={(e) => setOAuthAlertDeliveryFromFilter(e.target.value)}
              />
              <input
                type="datetime-local"
                className="b-input h-9"
                value={oauthAlertDeliveryToFilter}
                onChange={(e) => setOAuthAlertDeliveryToFilter(e.target.value)}
              />
            </div>
            <div className="border-2 border-black overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-black text-white uppercase">
                  <tr>
                    <th className="p-2">delivery</th>
                    <th className="p-2">incident/channel/provider</th>
                    <th className="p-2">状态</th>
                    <th className="p-2">响应</th>
                    <th className="p-2">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/20">
                  {(oauthAlertDeliveries?.data || []).map((item) => (
                    <tr key={item.id}>
                      <td className="p-2 font-mono">{item.id}</td>
                      <td className="p-2 font-mono">
                        {item.incidentId || "-"}
                        <p className="text-[10px] text-gray-500">
                          channel={item.channel} / provider={(item.provider || "-") + " / " + (item.phase || "-")}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">{item.target || "-"}</p>
                        <p className="text-[10px] text-gray-500">event={item.eventId}</p>
                      </td>
                      <td className="p-2 font-mono">
                        {item.status}
                        <p className="text-[10px] text-gray-500">
                          attempt={item.attempt} code={item.responseStatus ?? "-"}
                        </p>
                      </td>
                      <td className="p-2 font-mono">
                        {item.error || item.responseBody || "-"}
                      </td>
                      <td className="p-2 font-mono">
                        {new Date(item.sentAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {(oauthAlertDeliveries?.data || []).length === 0 ? (
                    <tr>
                      <td className="p-3 font-bold text-gray-500" colSpan={5}>
                        暂无告警 deliveries
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-gray-500">
              <p>
                共 {oauthAlertDeliveries?.total || 0} 条，第 {oauthAlertDeliveries?.page || 1}/
                {oauthAlertDeliveries?.totalPages || 1} 页
              </p>
              <div className="flex gap-2">
                <button
                  className="b-btn bg-white text-xs"
                  disabled={(oauthAlertDeliveries?.page || 1) <= 1}
                  onClick={() => {
                    const prev = Math.max(1, (oauthAlertDeliveries?.page || 1) - 1);
                    void applyOAuthAlertDeliveryFilters(prev);
                  }}
                >
                  上一页
                </button>
                <button
                  className="b-btn bg-white text-xs"
                  disabled={
                    (oauthAlertDeliveries?.page || 1) >= (oauthAlertDeliveries?.totalPages || 1)
                  }
                  onClick={() => {
                    const next = Math.min(
                      oauthAlertDeliveries?.totalPages || 1,
                      (oauthAlertDeliveries?.page || 1) + 1,
                    );
                    void applyOAuthAlertDeliveryFilters(next);
                  }}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="text-2xl font-black uppercase">OAuth 会话事件</h3>
          <div className="flex flex-wrap gap-2">
            <input
              className="b-input h-10 w-40"
              value={sessionEventProviderFilter}
              onChange={(e) => setSessionEventProviderFilter(e.target.value)}
              placeholder="provider"
            />
            <input
              className="b-input h-10 w-44"
              value={sessionEventStateFilter}
              onChange={(e) => setSessionEventStateFilter(e.target.value)}
              placeholder="state"
            />
            <select
              className="b-input h-10 w-32"
              value={sessionEventFlowFilter}
              onChange={(e) =>
                setSessionEventFlowFilter(
                  e.target.value as "" | "auth_code" | "device_code" | "manual_key" | "service_account",
                )
              }
            >
              <option value="">全部 flow</option>
              <option value="auth_code">auth_code</option>
              <option value="device_code">device_code</option>
              <option value="manual_key">manual_key</option>
              <option value="service_account">service_account</option>
            </select>
            <select
              className="b-input h-10 w-36"
              value={sessionEventPhaseFilter}
              onChange={(e) =>
                setSessionEventPhaseFilter(
                  e.target.value as
                    | ""
                    | "pending"
                    | "waiting_callback"
                    | "waiting_device"
                    | "exchanging"
                    | "completed"
                    | "error",
                )
              }
            >
              <option value="">全部 phase</option>
              <option value="pending">pending</option>
              <option value="waiting_callback">waiting_callback</option>
              <option value="waiting_device">waiting_device</option>
              <option value="exchanging">exchanging</option>
              <option value="completed">completed</option>
              <option value="error">error</option>
            </select>
            <select
              className="b-input h-10 w-28"
              value={sessionEventStatusFilter}
              onChange={(e) =>
                setSessionEventStatusFilter(
                  e.target.value as "" | "pending" | "completed" | "error",
                )
              }
            >
              <option value="">全部状态</option>
              <option value="pending">pending</option>
              <option value="completed">completed</option>
              <option value="error">error</option>
            </select>
            <select
              className="b-input h-10 w-32"
              value={sessionEventTypeFilter}
              onChange={(e) =>
                setSessionEventTypeFilter(
                  e.target.value as "" | "register" | "set_phase" | "complete" | "mark_error",
                )
              }
            >
              <option value="">全部事件</option>
              <option value="register">register</option>
              <option value="set_phase">set_phase</option>
              <option value="complete">complete</option>
              <option value="mark_error">mark_error</option>
            </select>
            <input
              type="datetime-local"
              className="b-input h-10 w-56"
              value={sessionEventFromFilter}
              onChange={(e) => setSessionEventFromFilter(e.target.value)}
              title="起始时间"
            />
            <input
              type="datetime-local"
              className="b-input h-10 w-56"
              value={sessionEventToFilter}
              onChange={(e) => setSessionEventToFilter(e.target.value)}
              title="结束时间"
            />
            <button className="b-btn bg-white" onClick={() => void applySessionEventFilters(1)}>
              查询
            </button>
            <button className="b-btn bg-white" onClick={() => void exportSessionEvents()}>
              导出 CSV
            </button>
          </div>
        </div>

        {!sessionEventsApiAvailable ? (
          <p className="mb-3 text-xs font-bold text-gray-500">
            当前后端未提供 <code>/api/admin/oauth/session-events*</code>，该诊断面板已自动降级。
          </p>
        ) : (
          <p className="mb-3 text-xs font-bold text-gray-500">
            提示：点击表格中的 state 可自动回填筛选并追溯该会话链路。
          </p>
        )}

        <SectionErrorBanner
          title="OAuth 会话事件"
          error={sectionErrors.sessionEvents}
          onRetry={() => {
            void applySessionEventFilters(sessionEvents?.page || 1);
          }}
          retryLabel="重试当前筛选"
        />

        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-black text-white text-xs uppercase">
              <tr>
                <th className="p-2">时间</th>
                <th className="p-2">provider</th>
                <th className="p-2">state</th>
                <th className="p-2">flow</th>
                <th className="p-2">phase</th>
                <th className="p-2">status</th>
                <th className="p-2">event</th>
                <th className="p-2">错误</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20 text-xs">
              {(sessionEvents?.data || []).map((item, index) => (
                <tr key={`${item.id || "se"}-${item.createdAt}-${index}`}>
                  <td className="p-2 font-mono">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="p-2 font-mono">{item.provider}</td>
                  <td className="p-2 font-mono">
                    <button
                      className="underline decoration-dotted"
                      onClick={() => traceSessionEventsByState(item.state)}
                      title={`按 state=${item.state} 追溯`}
                    >
                      {item.state}
                    </button>
                  </td>
                  <td className="p-2 font-mono">{item.flowType}</td>
                  <td className="p-2 font-mono">{item.phase}</td>
                  <td className="p-2">{item.status}</td>
                  <td className="p-2 font-mono">{item.eventType}</td>
                  <td className="p-2 text-red-700">{item.error || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500">
            共 {sessionEvents?.total || 0} 条，第 {sessionEvents?.page || 1}/
            {sessionEvents?.totalPages || 1} 页
          </p>
          <div className="flex gap-2">
            <button
              className="b-btn bg-white"
              disabled={(sessionEvents?.page || 1) <= 1}
              onClick={() => {
                const prev = Math.max(1, (sessionEvents?.page || 1) - 1);
                void applySessionEventFilters(prev);
              }}
            >
              上一页
            </button>
            <button
              className="b-btn bg-white"
              disabled={(sessionEvents?.page || 1) >= (sessionEvents?.totalPages || 1)}
              onClick={() => {
                const next = Math.min(
                  sessionEvents?.totalPages || 1,
                  (sessionEvents?.page || 1) + 1,
                );
                void applySessionEventFilters(next);
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="text-2xl font-black uppercase">OAuth 回调事件</h3>
          <div className="flex flex-wrap gap-2">
            <input
              className="b-input h-10 w-32"
              value={callbackProviderFilter}
              onChange={(e) => setCallbackProviderFilter(e.target.value)}
              placeholder="provider"
            />
            <select
              className="b-input h-10 w-28"
              value={callbackStatusFilter}
              onChange={(e) =>
                setCallbackStatusFilter(e.target.value as "" | "success" | "failure")
              }
            >
              <option value="">全部状态</option>
              <option value="success">success</option>
              <option value="failure">failure</option>
            </select>
            <input
              className="b-input h-10 w-44"
              value={callbackStateFilter}
              onChange={(e) => setCallbackStateFilter(e.target.value)}
              placeholder="state 包含过滤"
            />
            <input
              className="b-input h-10 w-44"
              value={callbackTraceFilter}
              onChange={(e) => setCallbackTraceFilter(e.target.value)}
              placeholder="traceId"
            />
            <button className="b-btn bg-white" onClick={() => applyCallbackFilters(1)}>
              查询
            </button>
          </div>
        </div>

        <SectionErrorBanner
          title="OAuth 回调事件"
          error={sectionErrors.callbackEvents}
          onRetry={() => {
            void applyCallbackFilters(callbackEvents?.page || 1);
          }}
          retryLabel="重试当前筛选"
        />

        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-black text-white text-xs uppercase">
              <tr>
                <th className="p-2">时间</th>
                <th className="p-2">provider</th>
                <th className="p-2">source</th>
                <th className="p-2">status</th>
                <th className="p-2">state</th>
                <th className="p-2">traceId</th>
                <th className="p-2">错误</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20 text-xs">
              {(callbackEvents?.data || []).map((item, index) => (
                <tr key={`${item.id || "cb"}-${item.createdAt}-${index}`}>
                  <td className="p-2 font-mono">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="p-2 font-mono">{item.provider}</td>
                  <td className="p-2 font-mono">{item.source}</td>
                  <td className="p-2">{item.status}</td>
                  <td className="p-2 font-mono">{item.state || "-"}</td>
                  <td className="p-2 font-mono">
                    {item.traceId ? (
                      <button
                        className="underline decoration-dotted"
                        onClick={() => {
                          void jumpToAuditTrace(item.traceId);
                        }}
                      >
                        {item.traceId}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-2 text-red-700">{item.error || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500">
            共 {callbackEvents?.total || 0} 条，第 {callbackEvents?.page || 1}/
            {callbackEvents?.totalPages || 1} 页
          </p>
          <div className="flex gap-2">
            <button
              className="b-btn bg-white"
              disabled={(callbackEvents?.page || 1) <= 1}
              onClick={() => {
                const prev = Math.max(1, (callbackEvents?.page || 1) - 1);
                void applyCallbackFilters(prev);
              }}
            >
              上一页
            </button>
            <button
              className="b-btn bg-white"
              disabled={(callbackEvents?.page || 1) >= (callbackEvents?.totalPages || 1)}
              onClick={() => {
                const next = Math.min(
                  callbackEvents?.totalPages || 1,
                  (callbackEvents?.page || 1) + 1,
                );
                void applyCallbackFilters(next);
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section id="audit-events-section" className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="text-2xl font-black uppercase">审计事件</h3>
          <div className="flex flex-wrap gap-2">
            <input
              className="b-input h-10 w-64"
              value={auditKeyword}
              onChange={(e) => setAuditKeyword(e.target.value)}
              placeholder="关键词筛选（actor/action/resource）"
            />
            <input
              className="b-input h-10 w-40"
              value={auditTraceId}
              onChange={(e) => setAuditTraceId(e.target.value)}
              placeholder="traceId"
            />
            <input
              className="b-input h-10 w-32"
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
              placeholder="action"
            />
            <input
              className="b-input h-10 w-32"
              value={auditResource}
              onChange={(e) => setAuditResource(e.target.value)}
              placeholder="resource"
            />
            <input
              className="b-input h-10 w-36"
              value={auditResourceId}
              onChange={(e) => setAuditResourceId(e.target.value)}
              placeholder="resourceId"
            />
            <input
              className="b-input h-10 w-36"
              value={auditPolicyId}
              onChange={(e) => setAuditPolicyId(e.target.value)}
              placeholder="policyId"
            />
            <input
              type="datetime-local"
              className="b-input h-10 w-56"
              value={auditFrom}
              onChange={(e) => setAuditFrom(e.target.value)}
              title="起始时间"
            />
            <input
              type="datetime-local"
              className="b-input h-10 w-56"
              value={auditTo}
              onChange={(e) => setAuditTo(e.target.value)}
              title="结束时间"
            />
            <select
              className="b-input h-10 w-28"
              value={auditResultFilter}
              onChange={(e) =>
                setAuditResultFilter(e.target.value as "" | "success" | "failure")
              }
            >
              <option value="">全部结果</option>
              <option value="success">success</option>
              <option value="failure">failure</option>
            </select>
            <button
              className="b-btn bg-white"
              onClick={applyAuditFilters}
            >
              查询
            </button>
            <button className="b-btn bg-white" onClick={() => void exportAuditEvents()}>
              导出 CSV
            </button>
          </div>
        </div>

        <SectionErrorBanner
          title="审计事件"
          error={sectionErrors.audit}
          onRetry={() => {
            void loadAuditEvents(auditResult?.page || 1);
          }}
          retryLabel="重试当前页"
        />

        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-black text-white text-xs uppercase">
              <tr>
                <th className="p-3">时间</th>
                <th className="p-3">操作人</th>
                <th className="p-3">动作</th>
                <th className="p-3">资源</th>
                <th className="p-3">资源ID</th>
                <th className="p-3">追踪 ID</th>
                <th className="p-3">结果</th>
                <th className="p-3">联动</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20 text-sm">
              {(auditResult?.data || []).map((item) => {
                const policyId = resolveAuditPolicyId(item);
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="p-3 font-mono text-xs">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">{item.actor}</td>
                    <td className="p-3 font-mono text-xs">{item.action}</td>
                    <td className="p-3 font-mono text-xs">{item.resource}</td>
                    <td className="p-3 font-mono text-xs">{item.resourceId || "-"}</td>
                    <td className="p-3 font-mono text-xs">
                      {item.traceId ? (
                        <button
                          className="underline decoration-dotted"
                          onClick={() => {
                            void jumpToAuditTrace(item.traceId);
                          }}
                        >
                          {item.traceId}
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "font-black text-xs",
                          item.result === "success" ? "text-emerald-600" : "text-red-600",
                        )}
                      >
                        {item.result === "success" ? "成功" : "失败"}
                      </span>
                    </td>
                    <td className="p-3">
                      {policyId ? (
                        <button
                          className="b-btn bg-white text-xs"
                          onClick={() => {
                            void jumpToAuditByPolicy(policyId);
                          }}
                        >
                          查看策略用量
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500">
            共 {auditResult?.total || 0} 条，第 {auditResult?.page || 1}/{auditResult?.totalPages || 1} 页
          </p>
          <div className="flex gap-2">
            <button
              className="b-btn bg-white"
              disabled={(auditResult?.page || 1) <= 1}
              onClick={async () => {
                try {
                  const prev = Math.max(1, (auditResult?.page || 1) - 1);
                  await loadAuditEvents(
                    prev,
                    auditKeyword,
                    auditTraceId,
                    auditAction,
                    auditResource,
                    auditResourceId,
                    auditPolicyId,
                    auditResultFilter,
                    auditFrom,
                    auditTo,
                  );
                } catch {
                  toast.error("审计日志加载失败");
                }
              }}
            >
              上一页
            </button>
            <button
              className="b-btn bg-white"
              disabled={(auditResult?.page || 1) >= (auditResult?.totalPages || 1)}
              onClick={async () => {
                try {
                  const next = Math.min(
                    auditResult?.totalPages || 1,
                    (auditResult?.page || 1) + 1,
                  );
                  await loadAuditEvents(
                    next,
                    auditKeyword,
                    auditTraceId,
                    auditAction,
                    auditResource,
                    auditResourceId,
                    auditPolicyId,
                    auditResultFilter,
                    auditFrom,
                    auditTo,
                  );
                } catch {
                  toast.error("审计日志加载失败");
                }
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <AgentLedgerTraceSection
        sectionId="agentledger-trace-section"
        traceId={agentLedgerTraceInput}
        resolvedTraceId={agentLedgerTraceResolvedTraceId}
        hasQueried={agentLedgerTraceHasQueried}
        loading={agentLedgerTraceLoading}
        sectionError={sectionErrors.agentLedgerTrace}
        outboxApiAvailable={agentLedgerTraceOutboxApiAvailable}
        outbox={agentLedgerTraceOutbox}
        outboxSummary={agentLedgerTraceOutboxSummary}
        attemptApiAvailable={agentLedgerTraceAttemptApiAvailable}
        attempts={agentLedgerTraceAttempts}
        attemptSummary={agentLedgerTraceAttemptSummary}
        replayAuditApiAvailable={agentLedgerTraceReplayAuditApiAvailable}
        replayAudits={agentLedgerTraceReplayAudits}
        replayAuditSummary={agentLedgerTraceReplayAuditSummary}
        traceSummary={agentLedgerTraceSummary}
        auditEvents={agentLedgerTraceAuditEvents}
        readiness={agentLedgerTraceReadiness}
        health={agentLedgerTraceHealth}
        formatOptionalDateTime={formatOptionalDateTime}
        onTraceIdChange={handleAgentLedgerTraceInputChange}
        onSearch={() => {
          void loadAgentLedgerTrace();
        }}
        onReset={() => {
          resetAgentLedgerTraceState({
            clearInput: true,
          });
        }}
        onJumpToOutbox={() => {
          void jumpToAgentLedgerOutboxByTrace(agentLedgerTraceResolvedTraceId);
        }}
        onJumpToReplayAudits={(options) => {
          void jumpToAgentLedgerReplayAudits(options);
        }}
        onJumpToAuditTrace={(traceId) => {
          void jumpToAuditTrace(traceId);
        }}
      />

      <AgentLedgerOutboxSection
        sectionId="agentledger-outbox-section"
        apiAvailable={agentLedgerOutboxApiAvailable}
        sectionError={sectionErrors.agentLedgerOutbox}
        outbox={agentLedgerOutbox}
        outboxSummary={agentLedgerOutboxSummary}
        readiness={agentLedgerOutboxReadiness}
        readinessApiAvailable={agentLedgerOutboxReadinessApiAvailable}
        readinessError={agentLedgerOutboxReadinessError}
        readinessMeta={agentLedgerOutboxReadinessMeta}
        health={agentLedgerOutboxHealth}
        healthApiAvailable={agentLedgerOutboxHealthApiAvailable}
        healthError={agentLedgerOutboxHealthError}
        shouldShowHealthSummary={shouldShowAgentLedgerOutboxHealthSummary}
        getReasonLabel={getAgentLedgerOutboxReasonLabel}
        formatOptionalDateTime={formatOptionalDateTime}
        deliveryStateFilter={agentLedgerOutboxDeliveryStateFilter}
        statusFilter={agentLedgerOutboxStatusFilter}
        providerFilter={agentLedgerOutboxProviderFilter}
        tenantFilter={agentLedgerOutboxTenantFilter}
        traceFilter={agentLedgerOutboxTraceFilter}
        fromFilter={agentLedgerOutboxFromFilter}
        toFilter={agentLedgerOutboxToFilter}
        onDeliveryStateFilterChange={setAgentLedgerOutboxDeliveryStateFilter}
        onStatusFilterChange={setAgentLedgerOutboxStatusFilter}
        onProviderFilterChange={setAgentLedgerOutboxProviderFilter}
        onTenantFilterChange={setAgentLedgerOutboxTenantFilter}
        onTraceFilterChange={setAgentLedgerOutboxTraceFilter}
        onFromFilterChange={setAgentLedgerOutboxFromFilter}
        onToFilterChange={setAgentLedgerOutboxToFilter}
        onApplyFilters={(page = 1) => {
          void applyAgentLedgerOutboxFilters(page);
        }}
        onExport={() => {
          void exportAgentLedgerOutbox();
        }}
        onReplayBatch={() => {
          void replayAgentLedgerOutboxBatch();
        }}
        batchReplaying={agentLedgerOutboxBatchReplaying}
        replayingId={agentLedgerOutboxReplayingId}
        selectedIds={agentLedgerOutboxSelectedIds}
        selectableIds={selectableAgentLedgerOutboxIds}
        allSelectableChecked={allSelectableAgentLedgerOutboxChecked}
        onToggleSelection={toggleAgentLedgerOutboxSelection}
        onToggleAllSelection={toggleAllAgentLedgerOutboxSelection}
        onJumpToAuditTrace={(traceId) => {
          void jumpToAuditTrace(traceId);
        }}
        onJumpToReplayAudits={(options) => {
          void jumpToAgentLedgerReplayAudits(options);
        }}
        onReplayById={(id) => {
          void replayAgentLedgerOutboxById(id);
        }}
        attemptsOpenOutboxId={agentLedgerDeliveryAttemptsOpenOutboxId}
        attempts={agentLedgerDeliveryAttempts}
        attemptSummary={agentLedgerDeliveryAttemptSummary}
        attemptApiAvailable={agentLedgerDeliveryAttemptApiAvailable}
        attemptLoading={agentLedgerDeliveryAttemptLoading}
        attemptError={agentLedgerDeliveryAttemptError}
        onToggleAttemptPanel={(item) => {
          void toggleAgentLedgerDeliveryAttemptPanel(item);
        }}
        onReloadAttemptPanel={(page = 1) => {
          void reloadAgentLedgerDeliveryAttemptPanel(page);
        }}
        onCloseAttemptPanel={closeAgentLedgerDeliveryAttemptPanel}
      />

      <AgentLedgerReplayAuditsSection
        sectionId="agentledger-replay-audits-section"
        apiAvailable={agentLedgerReplayAuditApiAvailable}
        summary={agentLedgerReplayAuditSummary}
        audits={agentLedgerReplayAudits}
        sectionError={sectionErrors.agentLedgerReplayAudits}
        outboxIdFilter={agentLedgerReplayAuditOutboxIdFilter}
        traceFilter={agentLedgerReplayAuditTraceFilter}
        operatorFilter={agentLedgerReplayAuditOperatorFilter}
        resultFilter={agentLedgerReplayAuditResultFilter}
        triggerSourceFilter={agentLedgerReplayAuditTriggerSourceFilter}
        fromFilter={agentLedgerReplayAuditFromFilter}
        toFilter={agentLedgerReplayAuditToFilter}
        onOutboxIdFilterChange={setAgentLedgerReplayAuditOutboxIdFilter}
        onTraceFilterChange={setAgentLedgerReplayAuditTraceFilter}
        onOperatorFilterChange={setAgentLedgerReplayAuditOperatorFilter}
        onResultFilterChange={setAgentLedgerReplayAuditResultFilter}
        onTriggerSourceFilterChange={setAgentLedgerReplayAuditTriggerSourceFilter}
        onFromFilterChange={setAgentLedgerReplayAuditFromFilter}
        onToFilterChange={setAgentLedgerReplayAuditToFilter}
        onApplyFilters={(page = 1) => {
          void applyAgentLedgerReplayAuditFilters(page);
        }}
        onJumpToAuditTrace={(traceId) => {
          void jumpToAuditTrace(traceId);
        }}
        formatOptionalDateTime={formatOptionalDateTime}
      />

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <h3 className="text-2xl font-black uppercase mb-3">计费与配额</h3>
        <p className="text-sm font-bold mb-3">{quotas?.message || "暂无配额信息"}</p>

        <SectionErrorBanner
          title="计费与配额"
          error={sectionErrors.usage}
          onRetry={() => {
            void loadUsageRows({ page: usagePage });
          }}
          retryLabel="重试当前页"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-black p-4">
            <p className="text-xs uppercase text-gray-500">每分钟请求数</p>
            <p className="text-2xl font-black">{quotas?.limits.requestsPerMinute ?? 0}</p>
          </div>
          <div className="border-2 border-black p-4">
            <p className="text-xs uppercase text-gray-500">每日 Token 限额</p>
            <p className="text-2xl font-black">{quotas?.limits.tokensPerDay ?? 0}</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2 items-end">
            <label className="text-xs font-bold uppercase text-gray-500">
              policyId
              <input
                className="b-input h-10 w-full mt-1"
                value={usagePolicyIdFilter}
                onChange={(e) => setUsagePolicyIdFilter(e.target.value)}
                placeholder="可选"
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              bucketType
              <select
                className="b-input h-10 w-full mt-1"
                value={usageBucketTypeFilter}
                onChange={(e) =>
                  setUsageBucketTypeFilter(e.target.value as "" | "minute" | "day")
                }
              >
                <option value="">全部</option>
                <option value="minute">minute</option>
                <option value="day">day</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              provider
              <input
                className="b-input h-10 w-full mt-1"
                value={usageProviderFilter}
                onChange={(e) => setUsageProviderFilter(e.target.value)}
                placeholder="claude/gemini..."
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              model
              <input
                className="b-input h-10 w-full mt-1"
                value={usageModelFilter}
                onChange={(e) => setUsageModelFilter(e.target.value)}
                placeholder="模型名（支持 pattern）"
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              tenantId
              <input
                className="b-input h-10 w-full mt-1"
                value={usageTenantFilter}
                onChange={(e) => setUsageTenantFilter(e.target.value)}
                placeholder="租户 ID"
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              from
              <input
                className="b-input h-10 w-full mt-1"
                type="datetime-local"
                value={usageFromFilter}
                onChange={(e) => setUsageFromFilter(e.target.value)}
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              to
              <input
                className="b-input h-10 w-full mt-1"
                type="datetime-local"
                value={usageToFilter}
                onChange={(e) => setUsageToFilter(e.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button className="b-btn bg-white" onClick={() => void applyUsageFilters()}>
              查询用量
            </button>
          </div>

          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-black text-white uppercase">
                <tr>
                  <th className="p-2">时间窗口</th>
                  <th className="p-2">桶类型</th>
                  <th className="p-2">策略</th>
                  <th className="p-2">请求数</th>
                  <th className="p-2">Token(估算/实际/差值)</th>
                  <th className="p-2">联动</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20">
                {usageRows.map((row) => (
                  <tr key={row.id}>
                    <td className="p-2 font-mono">{formatWindowStart(row.windowStart)}</td>
                    <td className="p-2">{row.bucketType}</td>
                    <td className="p-2">
                      <p className="font-bold">{row.policyName || "-"}</p>
                      <p className="font-mono text-[10px] text-gray-500">{row.policyId}</p>
                    </td>
                    <td className="p-2 font-mono">{row.requestCount}</td>
                    <td className="p-2 font-mono">
                      {(row.estimatedTokenCount ?? row.tokenCount)}/{row.actualTokenCount ?? row.tokenCount}/
                      {row.reconciledDelta ?? 0}
                    </td>
                    <td className="p-2">
                      <button
                        className="b-btn bg-white text-xs"
                        onClick={() => {
                          void jumpToAuditByPolicy(row.policyId);
                        }}
                      >
                        查看审计
                      </button>
                    </td>
                  </tr>
                ))}
                {usageRows.length === 0 ? (
                  <TableFeedbackRow
                    colSpan={6}
                    error={sectionErrors.usage}
                    emptyMessage="暂无配额使用记录"
                    onRetry={() => {
                      void loadUsageRows({ page: usagePage });
                    }}
                    retryLabel="重试当前页"
                  />
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs font-bold">
            <p>
              第 {usagePage}/{usageTotalPages} 页 · 共 {usageTotal} 条
            </p>
            <div className="flex gap-2">
              <button
                className="b-btn bg-white text-xs"
                disabled={usagePage <= 1}
                onClick={async () => {
                  try {
                    await loadUsageRows({ page: Math.max(1, usagePage - 1) });
                  } catch {
                    toast.error("配额使用记录加载失败");
                  }
                }}
              >
                上一页
              </button>
              <button
                className="b-btn bg-white text-xs"
                disabled={usagePage >= usageTotalPages}
                onClick={async () => {
                  try {
                    await loadUsageRows({
                      page: Math.min(usageTotalPages, usagePage + 1),
                    });
                  } catch {
                    toast.error("配额使用记录加载失败");
                  }
                }}
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <h3 className="text-2xl font-black uppercase mb-3">OAuth 路由与执行策略</h3>
        {!selectionPolicy || !routeExecutionPolicy ? (
          <p className="text-sm font-bold text-gray-500">暂无策略配置</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-xs font-bold uppercase text-gray-500">
                默认策略
                <select
                  className="b-input h-10 w-full mt-1"
                  value={selectionPolicy.defaultPolicy}
                  onChange={(e) =>
                    setSelectionPolicy((prev) =>
                      prev
                        ? {
                            ...prev,
                            defaultPolicy: e.target.value as SelectionPolicyData["defaultPolicy"],
                          }
                        : prev,
                    )
                  }
                >
                  <option value="round_robin">round_robin</option>
                  <option value="latest_valid">latest_valid</option>
                  <option value="sticky_user">sticky_user</option>
                </select>
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                失败冷却秒数
                <input
                  type="number"
                  min={0}
                  className="b-input h-10 w-full mt-1"
                  value={selectionPolicy.failureCooldownSec}
                  onChange={(e) =>
                    setSelectionPolicy((prev) =>
                      prev
                        ? {
                            ...prev,
                            failureCooldownSec: Number.parseInt(e.target.value || "0", 10) || 0,
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                失败跨账号重试次数
                <input
                  type="number"
                  min={0}
                  className="b-input h-10 w-full mt-1"
                  value={selectionPolicy.maxRetryOnAccountFailure}
                  onChange={(e) =>
                    setSelectionPolicy((prev) =>
                      prev
                        ? {
                            ...prev,
                            maxRetryOnAccountFailure:
                              Number.parseInt(e.target.value || "0", 10) || 0,
                          }
                        : prev,
                    )
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-xs font-bold uppercase text-gray-500">
                账号失败重试状态码（逗号分隔）
                <input
                  type="text"
                  className="b-input h-10 w-full mt-1"
                  value={routeExecutionPolicy.retryStatusCodes.join(",")}
                  onChange={(e) =>
                    setRouteExecutionPolicy((prev) =>
                      prev
                        ? {
                            ...prev,
                            retryStatusCodes: e.target.value
                              .split(",")
                              .map((item) => Number.parseInt(item.trim(), 10))
                              .filter((item) => Number.isInteger(item) && item >= 100 && item <= 599),
                          }
                        : prev,
                    )
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase text-gray-500">
                Claude bridge 回退状态码（逗号分隔）
                <input
                  type="text"
                  className="b-input h-10 w-full mt-1"
                  value={routeExecutionPolicy.claudeFallbackStatusCodes.join(",")}
                  onChange={(e) =>
                    setRouteExecutionPolicy((prev) =>
                      prev
                        ? {
                            ...prev,
                            claudeFallbackStatusCodes: e.target.value
                              .split(",")
                              .map((item) => Number.parseInt(item.trim(), 10))
                              .filter((item) => Number.isInteger(item) && item >= 100 && item <= 599),
                          }
                        : prev,
                    )
                  }
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-4 text-xs font-bold">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectionPolicy.allowHeaderOverride}
                  onChange={(e) =>
                    setSelectionPolicy((prev) =>
                      prev ? { ...prev, allowHeaderOverride: e.target.checked } : prev,
                    )
                  }
                />
                允许请求头覆盖策略
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectionPolicy.allowHeaderAccountOverride}
                  onChange={(e) =>
                    setSelectionPolicy((prev) =>
                      prev
                        ? { ...prev, allowHeaderAccountOverride: e.target.checked }
                        : prev,
                    )
                  }
                />
                允许请求头指定账号
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={routeExecutionPolicy.emitRouteHeaders}
                  onChange={(e) =>
                    setRouteExecutionPolicy((prev) =>
                      prev ? { ...prev, emitRouteHeaders: e.target.checked } : prev,
                    )
                  }
                />
                输出统一路由响应头
              </label>
            </div>

            <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={saveSelectionPolicy}>
              保存路由策略
            </button>
          </div>
        )}
      </section>

      <OAuthModelGovernanceSection
        actionBusy={oauthGovernanceActionBusy}
        modelAlias={oauthGovernanceModelAlias}
        modelAliasText={oauthGovernanceModelAliasText}
        modelAliasSaving={oauthGovernanceModelAliasSaving}
        modelAliasApiAvailable={oauthGovernanceModelAliasApiAvailable}
        excludedModels={oauthGovernanceExcludedModels}
        excludedModelsText={oauthGovernanceExcludedModelsText}
        excludedModelsSaving={oauthGovernanceExcludedModelsSaving}
        excludedModelsApiAvailable={oauthGovernanceExcludedModelsApiAvailable}
        onRefreshModelAlias={refreshModelAlias}
        onRefreshExcludedModels={refreshExcludedModels}
        onModelAliasTextChange={setOAuthGovernanceModelAliasText}
        onExcludedModelsTextChange={setOAuthGovernanceExcludedModelsText}
        onSaveModelAlias={saveModelAlias}
        onSaveExcludedModels={saveExcludedModels}
      />

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-2xl font-black uppercase">OAuth 能力健康状态</h3>
          <button
            className="b-btn bg-white"
            disabled={capabilityHealthLoading}
            onClick={() => {
              void refreshCapabilityHealth();
            }}
          >
            {capabilityHealthLoading ? "刷新中..." : "刷新健康状态"}
          </button>
        </div>

        <div
          className={cn(
            "border-2 border-black p-4",
            capabilityHealth
              ? capabilityHealth.ok
                ? "bg-emerald-50"
                : "bg-rose-50"
              : "bg-gray-100",
          )}
        >
          <p
            className={cn(
              "text-lg font-black",
              capabilityHealth
                ? capabilityHealth.ok
                  ? "text-emerald-700"
                  : "text-red-700"
                : "text-gray-700",
            )}
          >
            {capabilityHealth ? (capabilityHealth.ok ? "状态正常" : "存在一致性问题") : "待检查"}
          </p>
          <p className="text-xs font-bold text-gray-600 mt-1">
            最近检查时间：
            {capabilityHealth?.checkedAt ? new Date(capabilityHealth.checkedAt).toLocaleString() : "-"}
          </p>
          <p className="text-xs font-bold text-gray-600 mt-1">
            问题总数：{capabilityHealth?.issueCount ?? 0}
          </p>
        </div>

        {capabilityHealthError ? (
          <p className="mt-3 text-xs font-bold text-red-700">{capabilityHealthError}</p>
        ) : null}

        {!capabilityHealthError && !capabilityHealth ? (
          <p className="mt-3 text-sm font-bold text-gray-500">暂无能力健康数据</p>
        ) : null}

        {!capabilityHealthError && capabilityHealth && capabilityHealth.issues.length === 0 ? (
          <p className="mt-3 text-sm font-bold text-emerald-700">
            未发现能力图谱与运行时适配器不一致问题。
          </p>
        ) : null}

        {capabilityHealth && capabilityHealth.issues.length > 0 ? (
          <div className="mt-4 border-2 border-black overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-black text-white uppercase">
                <tr>
                  <th className="p-2">Provider</th>
                  <th className="p-2">问题码</th>
                  <th className="p-2">描述</th>
                  <th className="p-2">能力图谱</th>
                  <th className="p-2">运行时</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/20">
                {capabilityHealth.issues.map((issue, index) => (
                  <tr key={`${issue.provider}-${issue.code}-${index}`}>
                    <td className="p-2 font-mono">{issue.provider}</td>
                    <td className="p-2 font-mono">{issue.code}</td>
                    <td className="p-2">{issue.message}</td>
                    <td className="p-2">
                      {issue.capability ? (
                        <div className="space-y-1 font-mono">
                          <p>flows: {formatFlows(issue.capability.flows)}</p>
                          <p>manual: {String(issue.capability.supportsManualCallback)}</p>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="p-2">
                      {issue.runtime ? (
                        <div className="space-y-1 font-mono">
                          <p>start: {formatFlows(issue.runtime.startFlows)}</p>
                          <p>poll: {formatFlows(issue.runtime.pollFlows)}</p>
                          <p>manual: {String(issue.runtime.supportsManualCallback)}</p>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <h3 className="text-2xl font-black uppercase mb-3">Provider 能力图谱</h3>
        <p className="text-xs font-bold text-gray-500 mb-3">
          直接编辑 JSON，可用于声明每个 Provider 的 flow/chat/model/stream/manualCallback 能力。
        </p>
        <p className="text-xs font-bold text-gray-500 mb-3">
          当前已配置 Provider 数量：{Object.keys(capabilityMap).length}
        </p>
        <textarea
          className="b-input min-h-[220px] w-full font-mono text-xs"
          value={capabilityMapText}
          onChange={(e) => setCapabilityMapText(e.target.value)}
        />
        <div className="flex gap-3 mt-3">
          <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={saveCapabilityMap}>
            保存能力图谱
          </button>
          <button
            className="b-btn bg-white"
            onClick={async () => {
              try {
                const resp = await enterpriseAdminClient.getCapabilityMap();
                if (!resp.ok) throw new Error();
                const json = await resp.json();
                const map = (json.data || {}) as ProviderCapabilityMapData;
                setCapabilityMap(map);
                setCapabilityMapText(JSON.stringify(map, null, 2));

                let healthRefreshFailed = false;
                try {
                  await loadCapabilityHealth();
                } catch {
                  healthRefreshFailed = true;
                  setCapabilityHealthError("能力健康状态加载失败，请稍后重试。");
                }
                toast.success(
                  healthRefreshFailed ? "能力图谱已刷新（健康状态未刷新）" : "能力图谱已刷新",
                );
              } catch {
                toast.error("刷新能力图谱失败");
              }
            }}
          >
            从服务端刷新
          </button>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <h3 className="text-2xl font-black uppercase mb-3">Claude 回退事件</h3>

        <SectionErrorBanner
          title="Claude 回退事件"
          error={sectionErrors.fallback}
          onRetry={() => {
            void applyFallbackFilters(1);
          }}
          retryLabel="重试当前筛选"
        />

        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-xs font-bold uppercase text-gray-500">
              mode
              <select
                className="b-input h-10 w-full mt-1"
                value={fallbackModeFilter}
                onChange={(e) =>
                  setFallbackModeFilter(e.target.value as "" | "api_key" | "bridge")
                }
              >
                <option value="">全部</option>
                <option value="api_key">api_key</option>
                <option value="bridge">bridge</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              phase
              <select
                className="b-input h-10 w-full mt-1"
                value={fallbackPhaseFilter}
                onChange={(e) =>
                  setFallbackPhaseFilter(
                    e.target.value as "" | "attempt" | "success" | "failure" | "skipped",
                  )
                }
              >
                <option value="">全部</option>
                <option value="attempt">attempt</option>
                <option value="success">success</option>
                <option value="failure">failure</option>
                <option value="skipped">skipped</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              reason
              <select
                className="b-input h-10 w-full mt-1"
                value={fallbackReasonFilter}
                onChange={(e) =>
                  setFallbackReasonFilter(
                    e.target.value as
                      | ""
                      | "api_key_bearer_rejected"
                      | "bridge_status_code"
                      | "bridge_cloudflare_signal"
                      | "bridge_circuit_open"
                      | "bridge_http_error"
                      | "bridge_exception"
                      | "unknown",
                  )
                }
              >
                <option value="">全部</option>
                <option value="api_key_bearer_rejected">api_key_bearer_rejected</option>
                <option value="bridge_status_code">bridge_status_code</option>
                <option value="bridge_cloudflare_signal">bridge_cloudflare_signal</option>
                <option value="bridge_circuit_open">bridge_circuit_open</option>
                <option value="bridge_http_error">bridge_http_error</option>
                <option value="bridge_exception">bridge_exception</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              traceId
              <input
                className="b-input h-10 w-full mt-1"
                value={fallbackTraceFilter}
                onChange={(e) => setFallbackTraceFilter(e.target.value)}
                placeholder="按 traceId 精确筛选"
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              step
              <select
                className="b-input h-10 w-full mt-1"
                value={fallbackStep}
                onChange={(e) =>
                  setFallbackStep(e.target.value as "5m" | "15m" | "1h" | "6h" | "1d")
                }
              >
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="6h">6h</option>
                <option value="1d">1d</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-bold uppercase text-gray-500">
              from
              <input
                type="datetime-local"
                className="b-input h-10 w-full mt-1"
                value={fallbackFromFilter}
                onChange={(e) => setFallbackFromFilter(e.target.value)}
              />
            </label>
            <label className="text-xs font-bold uppercase text-gray-500">
              to
              <input
                type="datetime-local"
                className="b-input h-10 w-full mt-1"
                value={fallbackToFilter}
                onChange={(e) => setFallbackToFilter(e.target.value)}
              />
            </label>
            <div className="flex items-end">
              <button className="b-btn bg-white w-full" onClick={() => applyFallbackFilters(1)}>
                应用筛选
              </button>
            </div>
          </div>
        </div>

        {fallbackSummary ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <div className="border-2 border-black p-3 bg-[#FFD500]/20">
              <p className="text-[10px] uppercase text-gray-600">事件总数</p>
              <p className="text-2xl font-black">{fallbackSummary.total}</p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">Mode 分布</p>
              <p className="text-xs font-mono mt-1">
                api_key: {fallbackSummary.byMode.api_key} / bridge: {fallbackSummary.byMode.bridge}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">Phase 分布</p>
              <p className="text-xs font-mono mt-1">
                A:{fallbackSummary.byPhase.attempt} S:{fallbackSummary.byPhase.success} F:
                {fallbackSummary.byPhase.failure} K:{fallbackSummary.byPhase.skipped}
              </p>
            </div>
            <div className="border-2 border-black p-3">
              <p className="text-[10px] uppercase text-gray-600">Reason Top</p>
              <div className="mt-1 space-y-1">
                {(Object.entries(fallbackSummary.byReason) as Array<[string, number]>)
                  .filter(([, count]) => count > 0)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([reason, count]) => (
                    <p key={reason} className="text-xs font-mono">
                      {reason}: {count}
                    </p>
                  ))}
              </div>
            </div>
          </div>
        ) : null}

        {fallbackTimeseries.length > 0 ? (
          <div className="border-2 border-black p-4 mb-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase text-gray-600">回退趋势（{fallbackStep}）</p>
              <p className="text-xs font-mono">
                最近桶：
                {new Date(
                  fallbackTimeseries[fallbackTimeseries.length - 1]?.bucketStart,
                ).toLocaleString()}{" "}
                / total {fallbackTimeseries[fallbackTimeseries.length - 1]?.total || 0} / failure{" "}
                {fallbackTimeseries[fallbackTimeseries.length - 1]?.failure || 0} / bridge{" "}
                {Math.round(
                  (fallbackTimeseries[fallbackTimeseries.length - 1]?.bridgeShare || 0) * 100,
                )}
                %
              </p>
            </div>

            <div className="space-y-2">
              {fallbackTimeseries.slice(-8).map((point) => {
                const failurePercent =
                  point.total > 0 ? Math.round((point.failure / point.total) * 100) : 0;
                const bridgePercent = Math.round(point.bridgeShare * 100);
                return (
                  <div key={point.bucketStart} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
                    <p className="text-xs font-mono md:col-span-2">
                      {new Date(point.bucketStart).toLocaleString()}
                    </p>
                    <p className="text-xs font-mono">T:{point.total} S:{point.success} F:{point.failure}</p>
                    <div className="h-2 bg-gray-200 border border-black">
                      <div
                        className="h-full bg-[#DA0414]"
                        style={{ width: `${failurePercent}%` }}
                      />
                    </div>
                    <p className="text-xs font-mono">失败率 {failurePercent}% / bridge {bridgePercent}%</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="overflow-auto border-2 border-black">
          <table className="w-full text-left text-sm">
            <thead className="bg-black text-[#FFD500] uppercase text-xs">
              <tr>
                <th className="px-3 py-2">时间</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Phase</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">状态码</th>
                <th className="px-3 py-2">模型</th>
                <th className="px-3 py-2">耗时(ms)</th>
                <th className="px-3 py-2">TraceId</th>
              </tr>
            </thead>
            <tbody>
              {(fallbackEvents?.data || []).map((item) => (
                <tr key={item.id} className="border-t border-black/10">
                  <td className="px-3 py-2 whitespace-nowrap">{item.timestamp}</td>
                  <td className="px-3 py-2">{item.mode}</td>
                  <td className="px-3 py-2">{item.phase}</td>
                  <td className="px-3 py-2">{item.reason || "-"}</td>
                  <td className="px-3 py-2">{item.status ?? "-"}</td>
                  <td className="px-3 py-2 max-w-[240px] truncate">{item.model || "-"}</td>
                  <td className="px-3 py-2">{item.latencyMs ?? "-"}</td>
                  <td className="px-3 py-2 max-w-[260px] truncate">{item.traceId || "-"}</td>
                </tr>
              ))}
              {(fallbackEvents?.data || []).length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500 font-bold" colSpan={8}>
                    暂无回退事件
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 mt-3 text-xs font-bold">
          <span>
            共 {fallbackEvents?.total || 0} 条，第 {fallbackEvents?.page || 1}/
            {fallbackEvents?.pageCount || 1} 页
          </span>
          <button
            className="b-btn bg-white"
            disabled={(fallbackEvents?.page || 1) <= 1}
            onClick={() => {
              const prev = Math.max(1, (fallbackEvents?.page || 1) - 1);
              void applyFallbackFilters(prev);
            }}
          >
            上一页
          </button>
          <button
            className="b-btn bg-white"
            disabled={(fallbackEvents?.page || 1) >= (fallbackEvents?.pageCount || 1)}
            onClick={() => {
              const next = Math.min(
                fallbackEvents?.pageCount || 1,
                (fallbackEvents?.page || 1) + 1,
              );
              void applyFallbackFilters(next);
            }}
          >
            下一页
          </button>
        </div>
      </section>
    </div>
  );
}
