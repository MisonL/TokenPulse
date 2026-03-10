import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
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
  countModelAliasEntries,
  formatExcludedModelsEditorText,
  formatModelAliasEditorText,
  ORG_DOMAIN_READONLY_FALLBACK_MESSAGE,
  parseExcludedModelsEditorText,
  parseModelAliasEditorText,
  resolveOrgDomainPanelState,
} from "./enterpriseGovernance";
import {
  AGENTLEDGER_OUTBOX_READINESS_STATUS_META,
  getAgentLedgerOutboxReasonLabel,
  normalizeAgentLedgerReplayBatchResult,
} from "./enterpriseAgentLedgerAdapters";
import { createEnterpriseAgentLedgerLoaders } from "./enterpriseAgentLedgerLoaders";
import { createEnterpriseAgentLedgerTraceController } from "./enterpriseAgentLedgerTraceController";
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
  normalizeOrgOverviewData,
  normalizeProjectItem,
  planOrgMemberBindingMutation,
  resolveOrgDomainWriteGuardState,
  resolveOrgDomainLoadResult,
  resolveOrgMemberEditingState,
  resolveAdminUserLabel,
  resolveOrganizationDisplayName,
  resolveProjectDisplay,
  shouldRefreshOrgDomainAfterMutationError,
} from "./enterpriseOrgAdapters";
import {
  buildAgentLedgerOutboxBaseQuery,
} from "./enterpriseQueryBuilders";
import { createEnterpriseFallbackLoaders } from "./enterpriseFallbackLoaders";
import {
  extractListData,
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
  buildCreateOAuthAlertRuleVersionConfirmationMessage,
  buildEvaluateOAuthAlertsConfirmationMessage,
  buildReplayAgentLedgerOutboxBatchConfirmationMessage,
  buildReplayAgentLedgerOutboxConfirmationMessage,
  buildSaveAlertmanagerConfigConfirmationMessage,
  buildSaveCapabilityMapConfirmationMessage,
  buildSaveExcludedModelsConfirmationMessage,
  buildSaveModelAliasConfirmationMessage,
  buildSaveOAuthAlertConfigConfirmationMessage,
  buildSaveRoutePoliciesConfirmationMessage,
  buildRollbackAlertmanagerSyncHistoryConfirmationMessage,
  buildRollbackOAuthAlertRuleVersionConfirmationMessage,
  buildTriggerAlertmanagerSyncConfirmationMessage,
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
import { AlertmanagerControlSection } from "../components/enterprise/AlertmanagerControlSection";
import { AuditEventsSection } from "../components/enterprise/AuditEventsSection";
import { BillingUsageSection } from "../components/enterprise/BillingUsageSection";
import { CapabilityHealthSection } from "../components/enterprise/CapabilityHealthSection";
import { ClaudeFallbackSection } from "../components/enterprise/ClaudeFallbackSection";
import { EnterpriseAdminLoginSection } from "../components/enterprise/EnterpriseAdminLoginSection";
import { EnterpriseAvailabilityState } from "../components/enterprise/EnterpriseAvailabilityState";
import { EnterpriseConsoleHeader } from "../components/enterprise/EnterpriseConsoleHeader";
import { EnterpriseFeatureFlagsSection } from "../components/enterprise/EnterpriseFeatureFlagsSection";
import { EnterpriseOrgDomainSection } from "../components/enterprise/EnterpriseOrgDomainSection";
import { EnterpriseRolesPermissionsSection } from "../components/enterprise/EnterpriseRolesPermissionsSection";
import {
  useEnterpriseAdminSessionState,
  useEnterpriseFeatureGateState,
} from "./EnterprisePage.hooks";
import { OAuthAlertCenterSection } from "../components/enterprise/OAuthAlertCenterSection";
import { OAuthCallbackEventsSection } from "../components/enterprise/OAuthCallbackEventsSection";
import { QuotaPoliciesSection } from "../components/enterprise/QuotaPoliciesSection";
import { OAuthRoutePoliciesSection } from "../components/enterprise/OAuthRoutePoliciesSection";
import { OAuthSessionEventsSection } from "../components/enterprise/OAuthSessionEventsSection";
import { OAuthModelGovernanceSection } from "../components/enterprise/OAuthModelGovernanceSection";
import { OrgMembersSection } from "../components/enterprise/OrgMembersSection";
import { OrgOrganizationsSection } from "../components/enterprise/OrgOrganizationsSection";
import { OrgProjectsSection } from "../components/enterprise/OrgProjectsSection";
import { ProviderCapabilityMapSection } from "../components/enterprise/ProviderCapabilityMapSection";
import { TenantManagementSection } from "../components/enterprise/TenantManagementSection";
import { UserManagementSection } from "../components/enterprise/UserManagementSection";
import { SectionErrorBanner } from "../components/enterprise/EnterpriseSectionFeedback";
import {
  buildSessionEventStatePatch,
  normalizeBoundedPage,
  type SessionEventFilterPatch,
} from "./enterpriseEventFilters";

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
  const location = useLocation();
  const {
    featurePayload,
    setFeaturePayload,
    loading,
    setLoading,
    enterpriseEnabled,
    setEnterpriseEnabled,
  } = useEnterpriseFeatureGateState();
  const {
    adminAuthenticated,
    setAdminAuthenticated,
    adminUsername,
    setAdminUsername,
    adminPassword,
    setAdminPassword,
    authSubmitting,
    setAuthSubmitting,
  } = useEnterpriseAdminSessionState();
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
  const [agentLedgerOutboxProjectFilter, setAgentLedgerOutboxProjectFilter] = useState("");
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
  const [usageProjectIdFilter, setUsageProjectIdFilter] = useState("");
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
  const orgDomainWriteGuard = resolveOrgDomainWriteGuardState({
    loading: orgLoading,
    readOnlyFallback: orgDomainReadOnlyFallback,
  });
  const orgDomainWriteDisabled = orgDomainWriteGuard.blocked;
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
    const orgLoadResult = resolveOrgDomainLoadResult({
      results,
      previous: {
        organizations: orgOrganizations,
        projects: orgProjects,
        members: orgMemberBindings,
        bindingRows: orgMemberProjectBindings,
      },
    });
    try {
      await loadOrgOverview(orgLoadResult.overviewFallback);
    } catch {
      // ignore: fallback 已生效
    }
    setOrgDomainApiAvailable(orgLoadResult.availability.apiAvailable);
    setOrgDomainReadOnlyFallback(orgLoadResult.availability.readOnlyFallback);
    const editingState = resolveOrgMemberEditingState({
      editingMemberId: orgMemberEditingId,
      loadFailed: orgLoadResult.failedSectionCount > 0,
      readOnlyFallback: orgLoadResult.availability.readOnlyFallback,
      availableMemberIds: orgLoadResult.members.map((item) => item.memberId),
    });
    if (editingState.shouldResetForm) {
      setOrgMemberEditingId(editingState.nextEditingMemberId);
      setOrgMemberEditForm({ organizationId: "", projectIds: [] });
    }
    if (orgLoadResult.failedSectionCount > 0) {
      setOrgError(orgLoadResult.errorMessage);
      if (!silent) {
        toast.error(ORG_DOMAIN_READONLY_FALLBACK_MESSAGE);
      }
    } else if (!silent) {
      toast.success("组织域数据已刷新");
    }
    setOrgLoading(false);
  };

  const ensureOrgDomainWritable = () => {
    if (!orgDomainWriteGuard.blocked) return true;
    toast.error(orgDomainWriteGuard.message);
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
      const resultPayload = await enterpriseAdminClient.listAuditEventsResult({
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
      if (!resultPayload.ok) {
        throw new Error(resultPayload.error || "加载审计日志失败");
      }
      const json = resultPayload.data;
      setAuditResult(json);
      setAuditPage(json.page);
    }, "加载审计日志失败");

  const loadCallbackEvents = async (page = 1) =>
    runSectionLoad("callbackEvents", async () => {
      const result = await enterpriseAdminClient.listCallbackEventsResult({
        page,
        pageSize: 10,
        provider: callbackProviderFilter || undefined,
        status: callbackStatusFilter || undefined,
        state: callbackStateFilter || undefined,
        traceId: callbackTraceFilter || undefined,
      });
      if (!result.ok) throw new Error(result.error || "加载 OAuth 回调事件失败");
      setCallbackEvents(result.data as OAuthCallbackQueryResult);
    }, "加载 OAuth 回调事件失败");

  const loadOAuthAlertCenterConfig = async () =>
    runSectionLoad("oauthAlertConfig", async () => {
      const result = await oauthAlertCenterClient.getConfigResult();
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertConfig(DEFAULT_OAUTH_ALERT_CENTER_CONFIG);
        return;
      }
      if (!result.ok) throw new Error(result.error || "加载 OAuth 告警配置失败");
      setOAuthAlertConfig(
        normalizeOAuthAlertConfig(result.payload, DEFAULT_OAUTH_ALERT_CENTER_CONFIG),
      );
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警配置失败");

  const loadOAuthAlertIncidents = async (page = 1) =>
    runSectionLoad("oauthAlertIncidents", async () => {
      const fromParam = normalizeDateTimeParam(oauthAlertIncidentFromFilter);
      const toParam = normalizeDateTimeParam(oauthAlertIncidentToFilter);
      const result = await oauthAlertCenterClient.listIncidentsResult({
        page,
        pageSize: 10,
        provider: oauthAlertIncidentProviderFilter.trim() || undefined,
        phase: oauthAlertIncidentPhaseFilter.trim() || undefined,
        severity: oauthAlertIncidentSeverityFilter || undefined,
        from: fromParam,
        to: toParam,
      });
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertIncidents(null);
        return;
      }
      if (!result.ok) throw new Error(result.error || "加载 OAuth 告警 incidents 失败");
      setOAuthAlertIncidents(normalizeOAuthAlertIncidentResult(result.payload));
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警 incidents 失败");

  const loadOAuthAlertDeliveries = async (page = 1) =>
    runSectionLoad("oauthAlertDeliveries", async () => {
      const fromParam = normalizeDateTimeParam(oauthAlertDeliveryFromFilter);
      const toParam = normalizeDateTimeParam(oauthAlertDeliveryToFilter);
      const result = await oauthAlertCenterClient.listDeliveriesResult({
        page,
        pageSize: 10,
        eventId: oauthAlertDeliveryEventIdFilter.trim() || undefined,
        incidentId: oauthAlertDeliveryIncidentIdFilter.trim() || undefined,
        channel: oauthAlertDeliveryChannelFilter.trim() || undefined,
        status: oauthAlertDeliveryStatusFilter || undefined,
        from: fromParam,
        to: toParam,
      });
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertDeliveries(null);
        return;
      }
      if (!result.ok) throw new Error(result.error || "加载 OAuth 告警 deliveries 失败");
      setOAuthAlertDeliveries(normalizeOAuthAlertDeliveryResult(result.payload));
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警 deliveries 失败");

  const loadAlertmanagerConfig = async () =>
    runSectionLoad("alertmanager", async () => {
      const result = await oauthAlertCenterClient.getAlertmanagerConfigResult();
      if (result.status === 404 || result.status === 405) {
        setAlertmanagerApiAvailable(false);
        setAlertmanagerConfig(null);
        setAlertmanagerStructuredDraft(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT);
        setAlertmanagerConfigText(DEFAULT_ALERTMANAGER_CONFIG_TEXT);
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "加载 Alertmanager 配置失败");
      }
      const normalized = normalizeAlertmanagerStoredConfig(result.payload);
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
        const result = await oauthAlertCenterClient.listAlertmanagerSyncHistoryResult({
          page: safePage,
          pageSize: alertmanagerHistoryPageSize,
        });
        if (result.status === 404 || result.status === 405) {
          setAlertmanagerApiAvailable(false);
          setAlertmanagerSyncHistory([]);
          setAlertmanagerLatestSync(null);
          setAlertmanagerHistoryPage(1);
          setAlertmanagerHistoryTotal(0);
          setAlertmanagerHistoryTotalPages(1);
          setAlertmanagerHistoryPageInput("1");
          return;
        }
        if (!result.ok) {
          throw new Error(result.error || "加载 Alertmanager 同步历史失败");
        }
        const normalized = normalizeAlertmanagerHistoryQueryResult(result.payload);
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
      const result = await oauthAlertCenterClient.getAlertRuleActiveResult();
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        setOAuthAlertRuleActiveVersion(null);
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "加载 OAuth 告警规则当前版本失败");
      }
      const root = toObject(result.payload);
      const data = toObject(root.data);
      setOAuthAlertRuleActiveVersion(normalizeOAuthAlertRuleVersionSummary(data));
      setOAuthAlertCenterApiAvailable(true);
    }, "加载 OAuth 告警规则当前版本失败");

  const loadOAuthAlertRuleVersions = async (page = 1) =>
    runSectionLoad("oauthAlertRules", async () => {
      const safePage = Math.max(1, Math.floor(page || 1));
      setOAuthAlertRulePageLoading(true);
      try {
        const result = await oauthAlertCenterClient.listAlertRuleVersionsResult({
          page: safePage,
          pageSize: 20,
        });
        if (result.status === 404 || result.status === 405) {
          setOAuthAlertCenterApiAvailable(false);
          setOAuthAlertRuleVersions(null);
          setOAuthAlertRulePageInput("1");
          return;
        }
        if (!result.ok) {
          throw new Error(result.error || "加载 OAuth 告警规则版本失败");
        }
        const normalized = normalizeOAuthAlertRuleVersionList(result.payload);
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
      const result = await enterpriseAdminClient.listSessionEventsResult({
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
      if (result.status === 404 || result.status === 405) {
        setSessionEventsApiAvailable(false);
        setSessionEvents(null);
        return;
      }
      if (!result.ok) throw new Error(result.error || "加载 OAuth 会话事件失败");
      setSessionEvents(result.data as OAuthSessionEventQueryResult);
      setSessionEventsApiAvailable(true);
    }, "加载 OAuth 会话事件失败");

  const {
    closeAgentLedgerDeliveryAttemptPanel,
    loadAgentLedgerDeliveryAttempts,
    loadAgentLedgerOutbox,
    loadAgentLedgerReplayAudits,
  } = createEnterpriseAgentLedgerLoaders({
    runSectionLoad,
    getErrorMessage,
    deliveryAttempt: {
      requestIdRef: agentLedgerDeliveryAttemptRequestIdRef,
      openOutboxId: agentLedgerDeliveryAttemptsOpenOutboxId,
      setOpenOutboxId: setAgentLedgerDeliveryAttemptsOpenOutboxId,
      setAttempts: setAgentLedgerDeliveryAttempts,
      setSummary: setAgentLedgerDeliveryAttemptSummary,
      setApiAvailable: setAgentLedgerDeliveryAttemptApiAvailable,
      setLoading: setAgentLedgerDeliveryAttemptLoading,
      setError: setAgentLedgerDeliveryAttemptError,
    },
    outbox: {
      deliveryStateFilter: agentLedgerOutboxDeliveryStateFilter,
      statusFilter: agentLedgerOutboxStatusFilter,
      providerFilter: agentLedgerOutboxProviderFilter,
      tenantFilter: agentLedgerOutboxTenantFilter,
      projectIdFilter: agentLedgerOutboxProjectFilter,
      traceFilter: agentLedgerOutboxTraceFilter,
      fromFilter: agentLedgerOutboxFromFilter,
      toFilter: agentLedgerOutboxToFilter,
      setOutbox: setAgentLedgerOutbox,
      setSummary: setAgentLedgerOutboxSummary,
      setApiAvailable: setAgentLedgerOutboxApiAvailable,
      setSelectedIds: setAgentLedgerOutboxSelectedIds,
      setReadiness: setAgentLedgerOutboxReadiness,
      setReadinessApiAvailable: setAgentLedgerOutboxReadinessApiAvailable,
      setReadinessError: setAgentLedgerOutboxReadinessError,
      setHealth: setAgentLedgerOutboxHealth,
      setHealthApiAvailable: setAgentLedgerOutboxHealthApiAvailable,
      setHealthError: setAgentLedgerOutboxHealthError,
    },
    replayAudits: {
      outboxIdFilter: agentLedgerReplayAuditOutboxIdFilter,
      traceFilter: agentLedgerReplayAuditTraceFilter,
      operatorFilter: agentLedgerReplayAuditOperatorFilter,
      resultFilter: agentLedgerReplayAuditResultFilter,
      triggerSourceFilter: agentLedgerReplayAuditTriggerSourceFilter,
      fromFilter: agentLedgerReplayAuditFromFilter,
      toFilter: agentLedgerReplayAuditToFilter,
      setAudits: setAgentLedgerReplayAudits,
      setSummary: setAgentLedgerReplayAuditSummary,
      setApiAvailable: setAgentLedgerReplayAuditApiAvailable,
    },
  });

  const {
    resetAgentLedgerTraceState,
    handleAgentLedgerTraceInputChange,
    loadAgentLedgerTrace,
  } = createEnterpriseAgentLedgerTraceController({
    requestIdRef: agentLedgerTraceRequestIdRef,
    traceIdInput: agentLedgerTraceInput,
    hasSectionError: Boolean(sectionErrors.agentLedgerTrace),
    setTraceIdInput: setAgentLedgerTraceInput,
    setResolvedTraceId: setAgentLedgerTraceResolvedTraceId,
    setHasQueried: setAgentLedgerTraceHasQueried,
    setLoading: setAgentLedgerTraceLoading,
    setSummary: setAgentLedgerTraceSummary,
    setAuditEvents: setAgentLedgerTraceAuditEvents,
    setReadiness: setAgentLedgerTraceReadiness,
    setHealth: setAgentLedgerTraceHealth,
    setOutbox: setAgentLedgerTraceOutbox,
    setOutboxSummary: setAgentLedgerTraceOutboxSummary,
    setOutboxApiAvailable: setAgentLedgerTraceOutboxApiAvailable,
    setAttempts: setAgentLedgerTraceAttempts,
    setAttemptSummary: setAgentLedgerTraceAttemptSummary,
    setAttemptApiAvailable: setAgentLedgerTraceAttemptApiAvailable,
    setReplayAudits: setAgentLedgerTraceReplayAudits,
    setReplayAuditSummary: setAgentLedgerTraceReplayAuditSummary,
    setReplayAuditApiAvailable: setAgentLedgerTraceReplayAuditApiAvailable,
    setSectionError,
    clearSectionError,
    getErrorMessage,
  });

  const deepLinkHandledSearchRef = useRef<string | null>(null);
  const loadAgentLedgerTraceRef = useRef(loadAgentLedgerTrace);
  loadAgentLedgerTraceRef.current = loadAgentLedgerTrace;

  useEffect(() => {
    if (loading || !enterpriseEnabled || !canLoadEnterprise || !adminAuthenticated) {
      return;
    }

    const search = location.search || "";
    if (!search || deepLinkHandledSearchRef.current === search) {
      return;
    }

    const params = new URLSearchParams(search);
    const tenantId = params.get("tenantId")?.trim() || "";
    const projectId = params.get("projectId")?.trim() || "";
    const traceId = params.get("traceId")?.trim() || "";

    if (!tenantId && !projectId && !traceId) {
      return;
    }

    deepLinkHandledSearchRef.current = search;

    if (tenantId) {
      setAgentLedgerOutboxTenantFilter(tenantId);
    }

    if (projectId) {
      setAgentLedgerOutboxProjectFilter(projectId);
    }

    if (traceId) {
      setAgentLedgerTraceInput(traceId);
      setAgentLedgerOutboxTraceFilter(traceId);
      if (typeof document !== "undefined") {
        const section = document.getElementById("agentledger-trace-section");
        if (section && typeof section.scrollIntoView === "function") {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      void loadAgentLedgerTraceRef.current(traceId);
    }
  }, [
    adminAuthenticated,
    canLoadEnterprise,
    enterpriseEnabled,
    loading,
    location.search,
  ]);

  const {
    loadFallbackEvents,
    loadFallbackSummary,
    loadFallbackTimeseriesForBootstrap,
    applyFallbackFilters,
  } = createEnterpriseFallbackLoaders({
    runSectionLoad,
    filters: {
      mode: fallbackModeFilter,
      phase: fallbackPhaseFilter,
      reason: fallbackReasonFilter,
      traceId: fallbackTraceFilter,
      from: fallbackFromFilter,
      to: fallbackToFilter,
      step: fallbackStep,
    },
    state: {
      setEvents: setFallbackEvents,
      setSummary: setFallbackSummary,
      setTimeseries: setFallbackTimeseries,
    },
  });

  const loadUsageRows = async (filters?: BillingUsageFilterInput) =>
    runSectionLoad("usage", async () => {
      const policyId = (filters?.policyId ?? usagePolicyIdFilter).trim();
      const bucketType = filters?.bucketType ?? usageBucketTypeFilter;
      const provider = (filters?.provider ?? usageProviderFilter).trim();
      const model = (filters?.model ?? usageModelFilter).trim();
      let tenantId = (filters?.tenantId ?? usageTenantFilter).trim();
      const projectId = (filters?.projectId ?? usageProjectIdFilter).trim();
      if (tenantId && projectId) {
        tenantId = "";
      }
      const from = filters?.from ?? usageFromFilter;
      const to = filters?.to ?? usageToFilter;
      const page = Math.max(1, Math.floor(filters?.page ?? usagePage));
      const pageSize = Math.min(
        500,
        Math.max(1, Math.floor(filters?.pageSize ?? usagePageSize)),
      );
      const fromParam = normalizeDateTimeParam(from);
      const toParam = normalizeDateTimeParam(to);

      const result = await enterpriseAdminClient.listBillingUsageResult({
        policyId: policyId || undefined,
        bucketType: bucketType || undefined,
        provider: provider || undefined,
        model: model || undefined,
        tenantId: tenantId || undefined,
        projectId: projectId || undefined,
        from: fromParam,
        to: toParam,
        page,
        pageSize,
      });
      if (!result.ok) throw new Error(result.error || "加载配额使用记录失败");
      const json = result.data as BillingUsageQueryResult;
      setUsageRows((json.data || []) as BillingUsageItem[]);
      setUsagePage(json.page || page);
      setUsageTotal(json.total || 0);
      setUsageTotalPages(Math.max(1, json.totalPages || 1));
    }, "加载配额使用记录失败");

  const loadCapabilityHealth = async () => {
    const result = await enterpriseAdminClient.getCapabilityHealthResult();
    if (!result.ok) {
      throw new Error(result.error || "加载能力健康状态失败");
    }
    const json = result.payload;
    const health = (json.data || null) as CapabilityRuntimeHealthData | null;
    setCapabilityHealth(health);
    setCapabilityHealthError("");
    return health;
  };

  const loadModelAlias = async () => {
    const result = await enterpriseAdminClient.getModelAliasResult();
    if (result.status === 404 || result.status === 405) {
      setOAuthGovernanceModelAliasApiAvailable(false);
      setOAuthGovernanceModelAlias({});
      setOAuthGovernanceModelAliasText("{}");
      return {};
    }
    if (!result.ok) {
      throw new Error(result.error || "加载模型别名规则失败");
    }
    const payload = formatModelAliasEditorText(toObject(result.payload).data);
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
    const result = await enterpriseAdminClient.getExcludedModelsResult();
    if (result.status === 404 || result.status === 405) {
      setOAuthGovernanceExcludedModelsApiAvailable(false);
      setOAuthGovernanceExcludedModels([]);
      setOAuthGovernanceExcludedModelsText("");
      return [];
    }
    if (!result.ok) {
      throw new Error(result.error || "加载禁用模型列表失败");
    }
    const normalized = parseExcludedModelsEditorText(
      formatExcludedModelsEditorText(toObject(result.payload).data),
    );
    setOAuthGovernanceExcludedModels(normalized);
    setOAuthGovernanceExcludedModelsText(normalized.join("\n"));
    setOAuthGovernanceExcludedModelsApiAvailable(true);
    return normalized;
  };

  const loadUsers = async () => {
    const result = await enterpriseAdminClient.listUsersResult();
    if (!result.ok) throw new Error(result.error || "加载用户失败");
    setUsers((result.data || []) as AdminUserItem[]);
  };

  const loadTenants = async () => {
    const result = await enterpriseAdminClient.listTenantsResult();
    if (!result.ok) throw new Error(result.error || "加载租户失败");
    setTenants((result.data || []) as TenantItem[]);
  };

  const loadPolicies = async () => {
    const result = await enterpriseAdminClient.listPoliciesResult();
    if (!result.ok) throw new Error(result.error || "加载配额策略失败");
    const normalized = ((result.data || []) as QuotaPolicyItem[]).map((item) => ({
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

    const meResult = await enterpriseAdminClient.getAdminSessionResult();
    if (meResult.status === 503) {
      toast.error("企业后端不可用，请检查 enterprise 服务与代理配置");
      setSectionError("baseData", "企业后端不可用，请检查 enterprise 服务与代理配置。");
      setLoading(false);
      setAdminAuthenticated(false);
      return;
    }
    const meJson = (meResult.payload || { authenticated: false }) as {
      authenticated?: boolean;
    };
    if (!meResult.ok || meJson.authenticated !== true) {
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
      enterpriseAdminClient.listRolesResult(),
      enterpriseAdminClient.listPermissionsResult(),
      enterpriseAdminClient.getBillingQuotasResult(),
      enterpriseAdminClient.getRoutePoliciesResult(),
      enterpriseAdminClient.getCapabilityMapResult(),
      enterpriseAdminClient.getCapabilityHealthResult(),
      loadModelAlias(),
      loadExcludedModels(),
      enterpriseAdminClient.listUsersResult(),
      enterpriseAdminClient.listTenantsResult(),
      enterpriseAdminClient.listPoliciesResult(),
    ]);

    if (roleRes.status === "fulfilled" && roleRes.value.ok) {
      setRoles(roleRes.value.data || []);
    }
    if (permRes.status === "fulfilled" && permRes.value.ok) {
      setPermissions(permRes.value.data || []);
    }
    if (quotaRes.status === "fulfilled" && quotaRes.value.ok) {
      setQuotas(quotaRes.value.data || null);
    }
    if (routePoliciesRes.status === "fulfilled" && routePoliciesRes.value.ok) {
      const data = toObject(routePoliciesRes.value.data);
      setSelectionPolicy((data.selection || null) as SelectionPolicyData | null);
      setRouteExecutionPolicy(
        (data.execution || null) as RouteExecutionPolicyData | null,
      );
    }
    if (capabilityRes.status === "fulfilled" && capabilityRes.value.ok) {
      const map = (capabilityRes.value.data || {}) as ProviderCapabilityMapData;
      setCapabilityMap(map);
      setCapabilityMapText(JSON.stringify(map, null, 2));
    }
    if (capabilityHealthRes.status === "fulfilled" && capabilityHealthRes.value.ok) {
      setCapabilityHealth(
        (capabilityHealthRes.value.data || null) as unknown as CapabilityRuntimeHealthData | null,
      );
      setCapabilityHealthError("");
    } else {
      setCapabilityHealth(null);
      setCapabilityHealthError("能力健康状态加载失败，请稍后重试。");
    }
    if (userRes.status === "fulfilled" && userRes.value.ok) {
      setUsers((userRes.value.data || []) as AdminUserItem[]);
    }
    if (tenantRes.status === "fulfilled" && tenantRes.value.ok) {
      setTenants((tenantRes.value.data || []) as TenantItem[]);
    }
    if (policyRes.status === "fulfilled" && policyRes.value.ok) {
      const normalized = ((policyRes.value.data || []) as QuotaPolicyItem[]).map((item) => ({
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
      const result = await enterpriseAdminClient.loginResult({
        username: adminUsername.trim(),
        password: adminPassword,
      });
      if (!result.ok) {
        toast.error(result.error || "管理员登录失败");
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
    await enterpriseAdminClient.logoutResult();
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
      const result = await enterpriseAdminClient.createAuditEventResult({
        action: "admin.audit.write",
        resource: "enterprise-panel",
        result: "success",
        details: { source: "enterprise-ui", type: "manual-check" },
      });
      if (!result.ok) {
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
    if (!confirm(buildSaveRoutePoliciesConfirmationMessage(selectionPolicy.defaultPolicy))) {
      return;
    }
    try {
      const result = await enterpriseAdminClient.updateRoutePoliciesResult({
        selection: selectionPolicy,
        execution: routeExecutionPolicy,
      });
      if (!result.ok) {
        toast.error("保存路由策略失败");
        return;
      }
      const data = toObject(result.data);
      setSelectionPolicy((data.selection || selectionPolicy) as SelectionPolicyData);
      setRouteExecutionPolicy(
        (data.execution || routeExecutionPolicy) as RouteExecutionPolicyData,
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
    if (!confirm(buildSaveCapabilityMapConfirmationMessage(Object.keys(parsed).length))) {
      return;
    }

    try {
      const result = await enterpriseAdminClient.updateCapabilityMapResult(parsed);
      if (!result.ok) {
        toast.error("保存能力图谱失败");
        return;
      }
      const json = result.payload;
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

  const refreshCapabilityMapFromServer = async () => {
    try {
      const result = await enterpriseAdminClient.getCapabilityMapResult();
      if (!result.ok) throw new Error(result.error || "刷新能力图谱失败");
      const map = (result.data || {}) as ProviderCapabilityMapData;
      setCapabilityMap(map);
      setCapabilityMapText(JSON.stringify(map, null, 2));

      let healthRefreshFailed = false;
      try {
        await loadCapabilityHealth();
      } catch {
        healthRefreshFailed = true;
        setCapabilityHealthError("能力健康状态加载失败，请稍后重试。");
      }
      toast.success(healthRefreshFailed ? "能力图谱已刷新（健康状态未刷新）" : "能力图谱已刷新");
    } catch {
      toast.error("刷新能力图谱失败");
    }
  };

  const saveModelAlias = async () => {
    const parsed = parseModelAliasEditorText(oauthGovernanceModelAliasText);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    if (!confirm(buildSaveModelAliasConfirmationMessage(countModelAliasEntries(parsed.value)))) {
      return;
    }

    setOAuthGovernanceModelAliasSaving(true);
    try {
      const result = await enterpriseAdminClient.updateModelAliasResult(parsed.value);
      if (result.status === 404 || result.status === 405) {
        setOAuthGovernanceModelAliasApiAvailable(false);
        toast.error("后端尚未开放模型别名治理接口");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "保存模型别名规则失败");
      }

      await loadModelAlias();
      const traceId = result.traceId;
      toast.success(traceId ? `模型别名规则已保存（traceId: ${traceId}）` : "模型别名规则已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存模型别名规则失败");
    } finally {
      setOAuthGovernanceModelAliasSaving(false);
    }
  };

  const saveExcludedModels = async () => {
    const payload = parseExcludedModelsEditorText(oauthGovernanceExcludedModelsText);
    const excludedCount = Array.isArray(payload)
      ? payload.length
      : Object.keys(payload || {}).length;
    if (!confirm(buildSaveExcludedModelsConfirmationMessage(excludedCount))) {
      return;
    }
    setOAuthGovernanceExcludedModelsSaving(true);
    try {
      const result = await enterpriseAdminClient.updateExcludedModelsResult(payload);
      if (result.status === 404 || result.status === 405) {
        setOAuthGovernanceExcludedModelsApiAvailable(false);
        toast.error("后端尚未开放禁用模型治理接口");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "保存禁用模型列表失败");
      }

      await loadExcludedModels();
      const traceId = result.traceId;
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
      const result = await enterpriseAdminClient.createUserResult(payload.value);
      if (!result.ok) {
        toast.error(result.error || "创建用户失败");
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
      const result = await enterpriseAdminClient.deleteUserResult(userId);
      if (!result.ok) {
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
      const result = await enterpriseAdminClient.updateUserResult(
        userId,
        buildAdminUserUpdatePayload(userEditForm),
      );
      if (!result.ok) {
        toast.error(result.error || "更新用户失败");
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
      const result = await enterpriseAdminClient.createTenantResult(payload.value);
      if (!result.ok) {
        toast.error(result.error || "创建租户失败");
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
      const result = await enterpriseAdminClient.deleteTenantResult(tenantId);
      if (!result.ok) {
        toast.error(result.error || "删除租户失败");
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
      const result = await enterpriseAdminClient.createPolicyResult(payload.value);
      if (!result.ok) {
        toast.error(result.error || "创建策略失败");
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
      const result = await enterpriseAdminClient.deletePolicyResult(policyId);
      if (!result.ok) {
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
      const result = await enterpriseAdminClient.updatePolicyResult(policy.id, payload.value);
      if (!result.ok) {
        toast.error(result.error || "更新策略失败");
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
    if (!confirm(buildSaveOAuthAlertConfigConfirmationMessage())) {
      return;
    }
    setOAuthAlertConfigSaving(true);
    try {
      const result = await oauthAlertCenterClient.updateConfigResult({
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
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        toast.error("后端尚未启用 OAuth 告警中心接口");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "保存 OAuth 告警配置失败");
      }
      const json = result.payload;
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
    if (!confirm(buildEvaluateOAuthAlertsConfirmationMessage(oauthAlertEvaluateForm.provider))) {
      return;
    }
    setOAuthAlertEvaluating(true);
    try {
      const result = await oauthAlertCenterClient.evaluateResult({
        provider: oauthAlertEvaluateForm.provider.trim() || undefined,
      });
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        throw new Error("后端尚未启用 OAuth 告警评估接口");
      }
      const json = result.payload;
      if (!result.ok) {
        throw new Error(result.error || "OAuth 告警手动评估失败");
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
    const target = normalizeBoundedPage(page, oauthAlertRuleVersions?.totalPages || 1);
    try {
      await loadOAuthAlertRuleVersions(target);
    } catch {
      toast.error("规则版本分页加载失败");
    }
  };

  const gotoAlertmanagerHistoryPage = async (page: number) => {
    const target = normalizeBoundedPage(page, alertmanagerHistoryTotalPages || 1);
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
    if (!confirm(buildSaveAlertmanagerConfigConfirmationMessage(alertmanagerConfig?.version))) {
      return;
    }

    setAlertmanagerConfigSaving(true);
    try {
      const result = await oauthAlertCenterClient.updateAlertmanagerConfigResult({
        config: parsed,
      });
      if (result.status === 404 || result.status === 405) {
        setAlertmanagerApiAvailable(false);
        toast.error("后端尚未启用 Alertmanager 配置接口");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "保存 Alertmanager 配置失败");
      }
      const json = result.payload;
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
    if (!confirm(buildTriggerAlertmanagerSyncConfirmationMessage(alertmanagerConfig?.version))) {
      return;
    }
    setAlertmanagerSyncing(true);
    try {
      const result = await oauthAlertCenterClient.syncAlertmanagerConfigResult({});
      if (result.status === 404 || result.status === 405) {
        setAlertmanagerApiAvailable(false);
        toast.error("后端尚未启用 Alertmanager 同步接口");
        return;
      }
      const json = result.payload;
      if (!result.ok) {
        throw new Error(result.error || "Alertmanager 同步失败");
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
    if (!confirm(buildCreateOAuthAlertRuleVersionConfirmationMessage(payload))) {
      return;
    }

    setOAuthAlertRuleCreating(true);
    try {
      const result = await oauthAlertCenterClient.createAlertRuleVersionResult(payload);
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        toast.error("后端尚未启用规则版本接口");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "创建规则版本失败");
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
      const result = await oauthAlertCenterClient.rollbackAlertRuleVersionResult(versionId);
      if (result.status === 404 || result.status === 405) {
        setOAuthAlertCenterApiAvailable(false);
        toast.error("后端尚未启用规则回滚接口");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "规则版本回滚失败");
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
      const result = await oauthAlertCenterClient.rollbackAlertmanagerSyncHistoryResult(normalizedId, {
        reason: "ui-history-rollback",
      });
      if (result.status === 404 || result.status === 405) {
        setAlertmanagerApiAvailable(false);
        toast.error("后端尚未启用 Alertmanager 历史回滚接口");
        return;
      }
      const json = result.payload;
      if (!result.ok) {
        throw new Error(result.error || "Alertmanager 历史回滚失败");
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
    void applySessionEventFilters(1, buildSessionEventStatePatch(normalized));
  };

  const changeAuditPage = async (page: number) => {
    try {
      await loadAuditEvents(
        normalizeBoundedPage(page, auditResult?.totalPages || 1),
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

  const changeUsagePage = async (page: number) => {
    try {
      await loadUsageRows({ page: normalizeBoundedPage(page, usageTotalPages) });
    } catch {
      toast.error("配额使用记录加载失败");
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
            projectId: agentLedgerOutboxProjectFilter,
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
      const result = await enterpriseAdminClient.replayAgentLedgerOutboxItemResult(id);
      if (!result.ok) {
        throw new Error(result.error || "AgentLedger replay 失败");
      }

      const traceId = result.traceId;
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
      const result = await enterpriseAdminClient.replayAgentLedgerOutboxBatchResult(ids);
      if (!result.ok) {
        throw new Error(result.error || "AgentLedger 批量 replay 失败");
      }

      const batchResult = normalizeAgentLedgerReplayBatchResult(result.payload);
      const traceId = result.traceId;
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

  const applyUsageFilters = async () => {
    try {
      await loadUsageRows({ page: 1 });
    } catch {
      toast.error("配额使用记录加载失败");
    }
  };

  const exportUsageRows = async () => {
    try {
      const policyId = usagePolicyIdFilter.trim();
      const bucketType = usageBucketTypeFilter;
      const provider = usageProviderFilter.trim();
      const model = usageModelFilter.trim();
      let tenantId = usageTenantFilter.trim();
      const projectId = usageProjectIdFilter.trim();
      if (tenantId && projectId) {
        tenantId = "";
      }
      const fromParam = normalizeDateTimeParam(usageFromFilter);
      const toParam = normalizeDateTimeParam(usageToFilter);
      const defaultFilename = `billing-usage-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

      const { blob, filename } = await downloadWithApiSecret(
        enterpriseAdminClient.buildBillingUsageExportPath({
          policyId: policyId || undefined,
          bucketType: bucketType || undefined,
          provider: provider || undefined,
          model: model || undefined,
          tenantId: tenantId || undefined,
          projectId: projectId || undefined,
          from: fromParam || undefined,
          to: toParam || undefined,
          limit: 2000,
        }),
        {
          method: "GET",
        },
        {
          fallbackErrorMessage: "用量 CSV 导出失败",
          defaultFilename,
        },
      );

      triggerBlobDownload(blob, filename || defaultFilename);
      toast.success("用量 CSV 导出完成");
    } catch (error) {
      const typed = error as Error & { status?: number };
      if (typed.status === 404 || typed.status === 405) {
        toast.error("后端尚未启用用量导出接口");
        return;
      }
      toast.error(typed.message || "用量 CSV 导出失败");
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

  const jumpToUsageByPolicy = async (policyId?: string | null) => {
    const normalizedPolicyId = policyId?.trim();
    if (!normalizedPolicyId) return;

    setUsagePolicyIdFilter(normalizedPolicyId);
    setUsageBucketTypeFilter("");
    setUsageProviderFilter("");
    setUsageModelFilter("");
    setUsageTenantFilter("");
    setUsageProjectIdFilter("");
    setUsageFromFilter("");
    setUsageToFilter("");

    if (typeof document !== "undefined") {
      document
        .getElementById("billing-usage-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      await loadUsageRows({
        policyId: normalizedPolicyId,
        bucketType: "",
        provider: "",
        model: "",
        tenantId: "",
        projectId: "",
        from: "",
        to: "",
        page: 1,
      });
    } catch {
      toast.error("按策略 ID 联动配额用量失败");
    }
  };

  const jumpToUsageByProjectId = async (projectId?: string | null) => {
    const normalizedProjectId = projectId?.trim();
    if (!normalizedProjectId) return;

    setUsageProjectIdFilter(normalizedProjectId);
    setUsageTenantFilter("");

    if (typeof document !== "undefined") {
      document
        .getElementById("billing-usage-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      await loadUsageRows({
        tenantId: "",
        projectId: normalizedProjectId,
        page: 1,
      });
    } catch {
      toast.error("按项目 ID 联动配额用量失败");
    }
  };

  const jumpToAuditByPolicy = async (policyId?: string | null) => {
    const normalizedPolicyId = policyId?.trim();
    if (!normalizedPolicyId) return;

    setAuditKeyword("");
    setAuditTraceId("");
    setAuditAction("");
    setAuditResourceId("");
    setAuditPolicyId(normalizedPolicyId);
    setAuditResource("gateway.request");
    setAuditResultFilter("");

    if (typeof document !== "undefined") {
      document
        .getElementById("audit-events-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      await loadAuditEvents(
        1,
        "",
        "",
        "",
        "gateway.request",
        "",
        normalizedPolicyId,
        "",
        auditFrom,
        auditTo,
      );
    } catch {
      toast.error("按策略 ID 联动审计失败");
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
      <EnterpriseAvailabilityState
        edition={enterpriseEnabled ? featurePayload?.edition : undefined}
        enterpriseBackend={featurePayload?.enterpriseBackend}
      />
    );
  }

  if (!adminAuthenticated) {
    return (
      <EnterpriseAdminLoginSection
        username={adminUsername}
        password={adminPassword}
        submitting={authSubmitting}
        onUsernameChange={setAdminUsername}
        onPasswordChange={setAdminPassword}
        onSubmit={() => {
          void handleAdminLogin();
        }}
      />
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
      <EnterpriseConsoleHeader
        onWriteTestAuditEvent={() => {
          void writeTestAuditEvent();
        }}
        onLogout={() => {
          void handleAdminLogout();
        }}
      />

      <SectionErrorBanner
        title="基础管理数据"
        error={sectionErrors.baseData}
        onRetry={() => {
          void bootstrap();
        }}
        retryLabel="重新加载基础数据"
      />

      <EnterpriseFeatureFlagsSection entries={featureEntries} />

      <EnterpriseRolesPermissionsSection roles={roles} permissions={permissions} />

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <UserManagementSection
          roles={roles}
          tenants={tenants}
          users={users}
          createForm={userForm}
          editForm={userEditForm}
          editingUserId={userEditingId}
          onCreateFormChange={(patch) => {
            setUserForm((prev) => ({
              ...prev,
              ...patch,
            }));
          }}
          onEditFormChange={(patch) => {
            setUserEditForm((prev) => ({
              ...prev,
              ...patch,
            }));
          }}
          onCreate={() => {
            void createUser();
          }}
          onStartEdit={startEditUser}
          onSaveEdit={(userId) => {
            void saveUserEdit(userId);
          }}
          onCancelEdit={() => {
            setUserEditingId(null);
            setUserEditForm(resetEnterpriseUserEditForm());
          }}
          onRemove={(user) => {
            void removeUser(user.id, user.username);
          }}
        />

        <TenantManagementSection
          createForm={tenantForm}
          tenants={tenants}
          onCreateFormChange={(patch) => {
            setTenantForm((prev) => ({
              ...prev,
              ...patch,
            }));
          }}
          onCreate={() => {
            void createTenant();
          }}
          onRemove={(tenant) => {
            void removeTenant(tenant.id);
          }}
        />
      </section>

      <EnterpriseOrgDomainSection
        loading={orgLoading}
        error={orgError}
        summaryText={orgDomainPanelState.summaryText}
        readOnlyBanner={orgDomainPanelState.readOnlyBanner || ""}
        overview={orgOverview}
        overviewFromFallback={orgOverviewFromFallback}
        readOnlyFallback={orgDomainReadOnlyFallback}
        overviewFallbackHint={orgDomainPanelState.overviewFallbackHint || ""}
        onRefresh={() => {
          void refreshOrgDomain();
        }}
      >
          <OrgOrganizationsSection
            writeHint={orgDomainPanelState.organizationWriteHint || ""}
            writeDisabled={orgDomainWriteDisabled}
            organizations={orgOrganizations}
            formName={orgForm.name}
            onFormNameChange={(value) => {
              setOrgForm({ name: value });
            }}
            onCreate={() => {
              void createOrganization();
            }}
            onViewAudit={(organization) => {
              void jumpToAuditByResource({
                resource: "organization",
                resourceId: organization.id,
                keyword: organization.name,
              });
            }}
            onViewStatusAudit={(organization) => {
              void jumpToAuditByAction({
                action: "org.organization.update",
                resource: "organization",
                resourceId: organization.id,
                keyword: organization.name,
              });
            }}
            onToggleStatus={(organization) => {
              void toggleOrganizationStatus(organization);
            }}
            onRemove={(organization) => {
              void removeOrganization(organization);
            }}
          />

          <OrgProjectsSection
            writeHint={orgDomainPanelState.projectWriteHint || ""}
            writeDisabled={orgDomainWriteDisabled}
            organizations={orgOrganizations}
            form={orgProjectForm}
            filterOrganizationId={orgProjectFilterOrganizationId}
            filteredProjects={filteredOrgProjects}
            resolveOrganizationDisplayName={resolveOrganizationDisplayName}
            onFormChange={(patch) => {
              setOrgProjectForm((prev) => ({
                ...prev,
                ...patch,
              }));
            }}
            onCreate={() => {
              void createOrgProject();
            }}
            onFilterOrganizationIdChange={setOrgProjectFilterOrganizationId}
            onViewUsage={(project) => {
              void jumpToUsageByProjectId(project.id);
            }}
            onViewAudit={(project) => {
              void jumpToAuditByResource({
                resource: "project",
                resourceId: project.id,
                keyword: project.name,
              });
            }}
            onViewStatusAudit={(project) => {
              void jumpToAuditByAction({
                action: "org.project.update",
                resource: "project",
                resourceId: project.id,
                keyword: project.name,
              });
            }}
            onToggleStatus={(project) => {
              void toggleOrgProjectStatus(project);
            }}
            onRemove={(project) => {
              void removeOrgProject(project);
            }}
          />

          <OrgMembersSection
            writeHint={orgDomainPanelState.memberBindingWriteHint || ""}
            writeDisabled={orgDomainWriteDisabled}
            organizations={orgOrganizations}
            users={users}
            projects={orgProjects}
            editableProjectsForMember={editableProjectsForMember}
            memberBindings={orgMemberBindings}
            createForm={orgMemberCreateForm}
            editForm={orgMemberEditForm}
            editingMemberId={orgMemberEditingId}
            resolveAdminUserLabel={resolveAdminUserLabel}
            resolveOrganizationDisplayName={resolveOrganizationDisplayName}
            resolveProjectDisplay={resolveProjectDisplay}
            onCreateFormChange={(patch) => {
              setOrgMemberCreateForm((prev) => ({
                ...prev,
                ...patch,
              }));
            }}
            onCreate={() => {
              void createOrgMember();
            }}
            onStartEdit={startEditOrgMemberBinding}
            onCancelEdit={() => setOrgMemberEditingId(null)}
            onEditOrganizationChange={(nextOrganizationId) => {
              setOrgMemberEditForm((prev) => ({
                organizationId: nextOrganizationId,
                projectIds: prev.projectIds.filter((projectId) =>
                  orgProjects.some(
                    (project) =>
                      project.id === projectId && project.organizationId === nextOrganizationId,
                  ),
                ),
              }));
            }}
            onToggleEditProject={(projectId, checked) => {
              setOrgMemberEditForm((prev) => {
                const current = new Set(prev.projectIds);
                if (checked) {
                  current.add(projectId);
                } else {
                  current.delete(projectId);
                }
                return {
                  ...prev,
                  projectIds: Array.from(current),
                };
              });
            }}
            onSaveEdit={(memberId) => {
              void saveOrgMemberBinding(memberId);
            }}
            onViewAudit={(member) => {
              void jumpToAuditByResource({
                resource: "org_member",
                resourceId: member.memberId,
                keyword: member.username,
              });
            }}
            onViewBindingAudit={(member) => {
              const primaryProjectId = member.projectIds[0] || "";
              void jumpToAuditByResource({
                resource: primaryProjectId ? "org_member_project" : "org_member",
                resourceId: primaryProjectId
                  ? `${member.memberId}:${primaryProjectId}`
                  : member.memberId,
                keyword: member.username,
              });
            }}
            onRemove={(member) => {
              void removeOrgMember(member);
            }}
          />
      </EnterpriseOrgDomainSection>

      <QuotaPoliciesSection
        policies={policies}
        orgProjects={orgProjects}
        createForm={policyForm}
        editForm={policyEditForm}
        editingPolicyId={policyEditingId}
        onCreateFormChange={(patch) => {
          setPolicyForm((prev) => ({
            ...prev,
            ...patch,
          }));
        }}
        onEditFormChange={(patch) => {
          setPolicyEditForm((prev) => ({
            ...prev,
            ...patch,
          }));
        }}
        onCreate={() => {
          void createPolicy();
        }}
        onStartEdit={startEditPolicy}
        onSaveEdit={(policy) => {
          void savePolicyEdit(policy);
        }}
        onCancelEdit={() => {
          setPolicyEditingId(null);
          setPolicyEditForm(resetEnterprisePolicyEditForm());
        }}
        onRemove={(policy) => {
          void removePolicy(policy.id);
        }}
        onJumpToUsageByPolicy={(policyId) => {
          void jumpToUsageByPolicy(policyId);
        }}
        onJumpToAuditByPolicy={(policyId) => {
          void jumpToAuditByPolicy(policyId);
        }}
      />

      <OAuthAlertCenterSection
        apiAvailable={oauthAlertCenterApiAvailable}
        sectionError={oauthAlertSectionError}
        config={oauthAlertConfig}
        configSaving={oauthAlertConfigSaving}
        evaluateForm={oauthAlertEvaluateForm}
        evaluating={oauthAlertEvaluating}
        lastEvaluateResult={oauthAlertLastEvaluateResult}
        incidents={oauthAlertIncidents}
        deliveries={oauthAlertDeliveries}
        incidentProviderFilter={oauthAlertIncidentProviderFilter}
        incidentPhaseFilter={oauthAlertIncidentPhaseFilter}
        incidentSeverityFilter={oauthAlertIncidentSeverityFilter}
        incidentFromFilter={oauthAlertIncidentFromFilter}
        incidentToFilter={oauthAlertIncidentToFilter}
        deliveryIncidentIdFilter={oauthAlertDeliveryIncidentIdFilter}
        deliveryEventIdFilter={oauthAlertDeliveryEventIdFilter}
        deliveryChannelFilter={oauthAlertDeliveryChannelFilter}
        deliveryStatusFilter={oauthAlertDeliveryStatusFilter}
        deliveryFromFilter={oauthAlertDeliveryFromFilter}
        deliveryToFilter={oauthAlertDeliveryToFilter}
        activeVersion={oauthAlertRuleActiveVersion}
        versions={oauthAlertRuleVersions}
        rulePageLoading={oauthAlertRulePageLoading}
        rulePageInput={oauthAlertRulePageInput}
        ruleActionBusy={oauthAlertRuleActionBusy}
        ruleCreating={oauthAlertRuleCreating}
        ruleRollingVersionId={oauthAlertRuleRollingVersionId}
        useStructuredRuleEditor={useStructuredOAuthAlertRuleEditor}
        ruleCreateText={oauthAlertRuleCreateText}
        ruleStructuredDraft={oauthAlertRuleStructuredDraft}
        setConfig={setOAuthAlertConfig}
        setEvaluateForm={setOAuthAlertEvaluateForm}
        setIncidentProviderFilter={setOAuthAlertIncidentProviderFilter}
        setIncidentPhaseFilter={setOAuthAlertIncidentPhaseFilter}
        setIncidentSeverityFilter={setOAuthAlertIncidentSeverityFilter}
        setIncidentFromFilter={setOAuthAlertIncidentFromFilter}
        setIncidentToFilter={setOAuthAlertIncidentToFilter}
        setDeliveryIncidentIdFilter={setOAuthAlertDeliveryIncidentIdFilter}
        setDeliveryEventIdFilter={setOAuthAlertDeliveryEventIdFilter}
        setDeliveryChannelFilter={setOAuthAlertDeliveryChannelFilter}
        setDeliveryStatusFilter={setOAuthAlertDeliveryStatusFilter}
        setDeliveryFromFilter={setOAuthAlertDeliveryFromFilter}
        setDeliveryToFilter={setOAuthAlertDeliveryToFilter}
        setRulePageInput={setOAuthAlertRulePageInput}
        setRuleCreateText={setOAuthAlertRuleCreateText}
        setRuleStructuredDraft={setOAuthAlertRuleStructuredDraft}
        onRefreshCenter={() => {
          void refreshOAuthAlertCenter();
        }}
        onSaveConfig={() => {
          void saveOAuthAlertConfig();
        }}
        onEvaluate={() => {
          void evaluateOAuthAlertsManually();
        }}
        onRefreshRules={() => {
          void refreshOAuthAlertRuleVersions();
        }}
        onCreateRuleVersion={() => {
          void createOAuthAlertRuleVersion();
        }}
        onSwitchToStructuredRuleEditor={switchToStructuredOAuthAlertRuleEditor}
        onSwitchToAdvancedRuleEditor={switchToAdvancedOAuthAlertRuleEditor}
        onRollbackRuleVersion={(item) => {
          void rollbackOAuthAlertRuleVersion(item);
        }}
        onGotoRulePage={(page) => {
          void gotoOAuthAlertRulePage(page);
        }}
        onInvalidRulePageInput={() => {
          toast.error("页码非法");
        }}
        onApplyIncidentFilters={(page = 1) => {
          void applyOAuthAlertIncidentFilters(page);
        }}
        onApplyDeliveryFilters={(page = 1) => {
          void applyOAuthAlertDeliveryFilters(page);
        }}
        onLinkIncidentToSessionEvents={(incident) => {
          void linkIncidentToSessionEvents({
            provider: incident.provider,
            phase: incident.phase,
          } as OAuthAlertIncidentItem);
        }}
        onJumpToDeliveriesByIncident={(incidentId) => {
          void jumpToOAuthAlertDeliveriesByIncident(incidentId);
        }}
        onJumpToAuditByKeyword={(keyword) => {
          void jumpToAuditByKeyword(keyword);
        }}
      />

      <AlertmanagerControlSection
        sectionId="alertmanager-control-section"
        apiAvailable={alertmanagerApiAvailable}
        actionBusy={alertmanagerActionBusy}
        configSaving={alertmanagerConfigSaving}
        syncing={alertmanagerSyncing}
        historyPageLoading={alertmanagerHistoryPageLoading}
        useStructuredEditor={useStructuredAlertmanagerEditor}
        structuredDraft={alertmanagerStructuredDraft}
        receiverOptions={alertmanagerReceiverOptions}
        hasMaskedManagedWebhook={hasMaskedManagedAlertmanagerWebhook}
        configText={alertmanagerConfigText}
        config={alertmanagerConfig}
        latestSync={alertmanagerLatestSync}
        syncHistory={alertmanagerSyncHistory}
        historyTotal={alertmanagerHistoryTotal}
        historyPage={alertmanagerHistoryPage}
        historyTotalPages={alertmanagerHistoryTotalPages}
        historyPageInput={alertmanagerHistoryPageInput}
        historyRollingId={alertmanagerHistoryRollingId}
        renderSyncSummary={renderAlertmanagerSyncSummary}
        setStructuredDraft={setAlertmanagerStructuredDraft}
        setConfigText={setAlertmanagerConfigText}
        setHistoryPageInput={setAlertmanagerHistoryPageInput}
        onReadConfig={() => {
          void refreshAlertmanagerCenter();
        }}
        onSaveConfig={() => {
          void saveAlertmanagerConfig();
        }}
        onTriggerSync={() => {
          void triggerAlertmanagerSync();
        }}
        onSwitchToStructuredEditor={switchToStructuredAlertmanagerEditor}
        onSwitchToAdvancedEditor={switchToAdvancedAlertmanagerEditor}
        onRollbackHistory={(item) => {
          void rollbackAlertmanagerSyncHistoryById(item);
        }}
        onGotoHistoryPage={(page) => {
          void gotoAlertmanagerHistoryPage(page);
        }}
        onInvalidPageInput={() => {
          toast.error("页码非法");
        }}
      />

      <OAuthSessionEventsSection
        sectionId="oauth-session-events-panel"
        apiAvailable={sessionEventsApiAvailable}
        sectionError={sectionErrors.sessionEvents}
        result={sessionEvents}
        providerFilter={sessionEventProviderFilter}
        stateFilter={sessionEventStateFilter}
        flowFilter={sessionEventFlowFilter}
        phaseFilter={sessionEventPhaseFilter}
        statusFilter={sessionEventStatusFilter}
        typeFilter={sessionEventTypeFilter}
        fromFilter={sessionEventFromFilter}
        toFilter={sessionEventToFilter}
        setProviderFilter={setSessionEventProviderFilter}
        setStateFilter={setSessionEventStateFilter}
        setFlowFilter={setSessionEventFlowFilter}
        setPhaseFilter={setSessionEventPhaseFilter}
        setStatusFilter={setSessionEventStatusFilter}
        setTypeFilter={setSessionEventTypeFilter}
        setFromFilter={setSessionEventFromFilter}
        setToFilter={setSessionEventToFilter}
        onApplyFilters={(page = 1) => {
          void applySessionEventFilters(page);
        }}
        onRetry={() => {
          void applySessionEventFilters(sessionEvents?.page || 1);
        }}
        onExport={() => {
          void exportSessionEvents();
        }}
        onTraceByState={traceSessionEventsByState}
      />

      <OAuthCallbackEventsSection
        sectionError={sectionErrors.callbackEvents}
        result={callbackEvents}
        providerFilter={callbackProviderFilter}
        statusFilter={callbackStatusFilter}
        stateFilter={callbackStateFilter}
        traceFilter={callbackTraceFilter}
        setProviderFilter={setCallbackProviderFilter}
        setStatusFilter={setCallbackStatusFilter}
        setStateFilter={setCallbackStateFilter}
        setTraceFilter={setCallbackTraceFilter}
        onApplyFilters={(page = 1) => {
          void applyCallbackFilters(page);
        }}
        onRetry={() => {
          void applyCallbackFilters(callbackEvents?.page || 1);
        }}
        onJumpToAuditTrace={(traceId) => {
          void jumpToAuditTrace(traceId);
        }}
      />

      <AuditEventsSection
        sectionId="audit-events-section"
        sectionError={sectionErrors.audit}
        result={auditResult}
        keyword={auditKeyword}
        traceId={auditTraceId}
        action={auditAction}
        resource={auditResource}
        resourceId={auditResourceId}
        policyId={auditPolicyId}
        resultFilter={auditResultFilter}
        from={auditFrom}
        to={auditTo}
        setKeyword={setAuditKeyword}
        setTraceId={setAuditTraceId}
        setAction={setAuditAction}
        setResource={setAuditResource}
        setResourceId={setAuditResourceId}
        setPolicyId={setAuditPolicyId}
        setResultFilter={setAuditResultFilter}
        setFrom={setAuditFrom}
        setTo={setAuditTo}
        resolvePolicyId={resolveAuditPolicyId}
        onApplyFilters={applyAuditFilters}
        onRetry={() => {
          void changeAuditPage(auditResult?.page || 1);
        }}
        onExport={() => {
          void exportAuditEvents();
        }}
        onJumpToAuditTrace={(traceId) => {
          void jumpToAuditTrace(traceId);
        }}
        onJumpToPolicy={(policyId) => {
          void jumpToUsageByPolicy(policyId);
        }}
        onPageChange={(page) => {
          void changeAuditPage(page);
        }}
      />

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
        projectIdFilter={agentLedgerOutboxProjectFilter}
        traceFilter={agentLedgerOutboxTraceFilter}
        fromFilter={agentLedgerOutboxFromFilter}
        toFilter={agentLedgerOutboxToFilter}
        onDeliveryStateFilterChange={setAgentLedgerOutboxDeliveryStateFilter}
        onStatusFilterChange={setAgentLedgerOutboxStatusFilter}
        onProviderFilterChange={setAgentLedgerOutboxProviderFilter}
        onTenantFilterChange={setAgentLedgerOutboxTenantFilter}
        onProjectIdFilterChange={setAgentLedgerOutboxProjectFilter}
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

      <BillingUsageSection
        sectionId="billing-usage-section"
        sectionError={sectionErrors.usage}
        quotas={quotas}
        rows={usageRows}
        page={usagePage}
        total={usageTotal}
        totalPages={usageTotalPages}
        policyIdFilter={usagePolicyIdFilter}
        bucketTypeFilter={usageBucketTypeFilter}
        providerFilter={usageProviderFilter}
        modelFilter={usageModelFilter}
        tenantFilter={usageTenantFilter}
        projectIdFilter={usageProjectIdFilter}
        fromFilter={usageFromFilter}
        toFilter={usageToFilter}
        setPolicyIdFilter={setUsagePolicyIdFilter}
        setBucketTypeFilter={setUsageBucketTypeFilter}
        setProviderFilter={setUsageProviderFilter}
        setModelFilter={setUsageModelFilter}
        setTenantFilter={setUsageTenantFilter}
        setProjectIdFilter={setUsageProjectIdFilter}
        setFromFilter={setUsageFromFilter}
        setToFilter={setUsageToFilter}
        formatWindowStart={formatWindowStart}
        onApplyFilters={() => {
          void applyUsageFilters();
        }}
        onExport={() => {
          void exportUsageRows();
        }}
        onRetry={() => {
          void loadUsageRows({ page: usagePage });
        }}
        onJumpToAuditByPolicy={(policyId) => {
          void jumpToAuditByPolicy(policyId);
        }}
        onPageChange={(page) => {
          void changeUsagePage(page);
        }}
      />

      <OAuthRoutePoliciesSection
        selectionPolicy={selectionPolicy}
        routeExecutionPolicy={routeExecutionPolicy}
        onSelectionPolicyChange={setSelectionPolicy}
        onRouteExecutionPolicyChange={setRouteExecutionPolicy}
        onSave={() => {
          void saveSelectionPolicy();
        }}
      />

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

      <CapabilityHealthSection
        capabilityHealth={capabilityHealth}
        capabilityHealthLoading={capabilityHealthLoading}
        capabilityHealthError={capabilityHealthError}
        formatFlows={formatFlows}
        onRefresh={() => {
          void refreshCapabilityHealth();
        }}
      />

      <ProviderCapabilityMapSection
        capabilityMap={capabilityMap}
        capabilityMapText={capabilityMapText}
        onCapabilityMapTextChange={setCapabilityMapText}
        onSave={() => {
          void saveCapabilityMap();
        }}
        onRefreshFromServer={() => {
          void refreshCapabilityMapFromServer();
        }}
      />

      <ClaudeFallbackSection
        sectionError={sectionErrors.fallback}
        modeFilter={fallbackModeFilter}
        phaseFilter={fallbackPhaseFilter}
        reasonFilter={fallbackReasonFilter}
        traceFilter={fallbackTraceFilter}
        fromFilter={fallbackFromFilter}
        toFilter={fallbackToFilter}
        step={fallbackStep}
        summary={fallbackSummary}
        timeseries={fallbackTimeseries}
        events={fallbackEvents}
        onModeFilterChange={setFallbackModeFilter}
        onPhaseFilterChange={setFallbackPhaseFilter}
        onReasonFilterChange={setFallbackReasonFilter}
        onTraceFilterChange={setFallbackTraceFilter}
        onFromFilterChange={setFallbackFromFilter}
        onToFilterChange={setFallbackToFilter}
        onStepChange={setFallbackStep}
        onApplyFilters={(page) => {
          void applyFallbackFilters(page);
        }}
      />
    </div>
  );
}
