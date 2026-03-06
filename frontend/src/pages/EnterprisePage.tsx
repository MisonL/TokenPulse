import { useEffect, useMemo, useState } from "react";
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
  client,
  downloadWithApiSecret,
  enterpriseAdminClient,
  oauthAlertCenterClient,
  requestJsonWithApiSecret,
} from "../lib/client";
import type {
  AdminUserItem,
  AlertmanagerConfigPayload,
  AlertmanagerStoredConfig,
  AlertmanagerSyncHistoryItem,
  AlertmanagerSyncHistoryQueryResult,
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
  OAuthAlertDeliveryItem,
  OAuthAlertDeliveryQueryResult,
  OAuthAlertIncidentItem,
  OAuthAlertIncidentQueryResult,
  OAuthAlertRuleVersionListResult,
  OAuthAlertRuleVersionSummaryItem,
  OAuthCallbackQueryResult,
  OAuthSessionEventQueryResult,
  OrgMemberBindingItem,
  OrgMemberProjectBindingRow,
  OrgOrganizationItem,
  OrgOverviewBucket,
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

interface OAuthAlertRuleStructuredDraft {
  version: string;
  description: string;
  activate: boolean;
  recoveryConsecutiveWindows: string;
  muteWindowEnabled: boolean;
  muteWindowId: string;
  muteWindowName: string;
  muteWindowStart: string;
  muteWindowEnd: string;
  muteWindowTimezone: string;
  muteWindowWeekdaysText: string;
  muteWindowSeveritiesText: string;
  ruleId: string;
  name: string;
  enabled: boolean;
  priority: string;
  provider: string;
  failureRateBps: string;
  severity: "warning" | "critical" | "recovery";
  channel: "" | "webhook" | "wecom";
}

interface AlertmanagerStructuredDraft {
  defaultReceiver: string;
  groupByText: string;
  groupWaitSec: string;
  groupIntervalSec: string;
  repeatIntervalSec: string;
  warningWebhookUrl: string;
  criticalWebhookUrl: string;
  p1WebhookUrl: string;
  templatesText: string;
}

type EnterpriseLoadSection =
  | "baseData"
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

interface SectionErrorBannerProps {
  title: string;
  error?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

interface TableFeedbackRowProps {
  colSpan: number;
  error?: string;
  emptyMessage: string;
  onRetry?: () => void;
  retryLabel?: string;
}

function SectionErrorBanner({
  title,
  error,
  onRetry,
  retryLabel = "重试加载",
}: SectionErrorBannerProps) {
  if (!error) return null;

  return (
    <div className="flex flex-col gap-3 border-2 border-black bg-[#FFE0E0] p-4 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">{title}</p>
        <p className="text-xs font-bold text-red-700">{error}</p>
      </div>
      {onRetry ? (
        <button
          className="b-btn bg-white text-xs"
          onClick={() => {
            onRetry();
          }}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

function TableFeedbackRow({
  colSpan,
  error,
  emptyMessage,
  onRetry,
  retryLabel = "重试",
}: TableFeedbackRowProps) {
  if (!error) {
    return (
      <tr>
        <td className="p-3 text-gray-500 font-bold" colSpan={colSpan}>
          {emptyMessage}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="p-3" colSpan={colSpan}>
        <div className="flex flex-col gap-3 border-2 border-black bg-[#FFE0E0] p-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1 text-red-700">
            <p className="text-xs font-black uppercase tracking-[0.16em]">加载失败</p>
            <p className="text-xs font-bold">{error}</p>
          </div>
          {onRetry ? (
            <button
              className="b-btn bg-white text-xs"
              onClick={() => {
                onRetry();
              }}
            >
              {retryLabel}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

const EMPTY_ENTERPRISE_SECTION_ERRORS: EnterpriseSectionErrors = {
  baseData: "",
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

const DEFAULT_OAUTH_ALERT_RULE_CREATE_PAYLOAD = {
  version: "ops-default-v1",
  activate: true,
  description: "默认规则版本",
  recoveryPolicy: {
    consecutiveWindows: 3,
  },
  muteWindows: [],
  rules: [
    {
      ruleId: "critical-escalate",
      name: "高失败率升级",
      enabled: true,
      priority: 200,
      allConditions: [{ field: "failureRateBps", op: "gte", value: 3500 }],
      actions: [{ type: "escalate", severity: "critical" }],
    },
  ],
} satisfies Record<string, unknown>;

const DEFAULT_OAUTH_ALERT_RULE_CREATE_TEXT = JSON.stringify(
  DEFAULT_OAUTH_ALERT_RULE_CREATE_PAYLOAD,
  null,
  2,
);

const DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT: OAuthAlertRuleStructuredDraft = {
  version: "ops-default-v1",
  description: "默认规则版本",
  activate: true,
  recoveryConsecutiveWindows: "3",
  muteWindowEnabled: false,
  muteWindowId: "night-shift",
  muteWindowName: "夜间静默",
  muteWindowStart: "23:00",
  muteWindowEnd: "08:00",
  muteWindowTimezone: "Asia/Shanghai",
  muteWindowWeekdaysText: "1,2,3,4,5",
  muteWindowSeveritiesText: "warning",
  ruleId: "critical-escalate",
  name: "高失败率升级",
  enabled: true,
  priority: "200",
  provider: "",
  failureRateBps: "3500",
  severity: "critical",
  channel: "",
};

const DEFAULT_ALERTMANAGER_CONFIG_TEXT = JSON.stringify(
  { route: { receiver: "warning-webhook" }, receivers: [] },
  null,
  2,
);

const DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT: AlertmanagerStructuredDraft = {
  defaultReceiver: "warning-webhook",
  groupByText: "alertname, provider, severity",
  groupWaitSec: "30",
  groupIntervalSec: "300",
  repeatIntervalSec: "14400",
  warningWebhookUrl: "",
  criticalWebhookUrl: "",
  p1WebhookUrl: "",
  templatesText: "",
};

const MANAGED_ALERTMANAGER_RECEIVER_NAMES = [
  "warning-webhook",
  "critical-webhook",
  "p1-webhook",
] as const;
const HHMM_TEXT_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
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
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [policies, setPolicies] = useState<QuotaPolicyItem[]>([]);
  const [callbackEvents, setCallbackEvents] = useState<OAuthCallbackQueryResult | null>(null);
  const [sessionEvents, setSessionEvents] = useState<OAuthSessionEventQueryResult | null>(null);
  const [sessionEventsApiAvailable, setSessionEventsApiAvailable] = useState(true);
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
  const [userForm, setUserForm] = useState({
    username: "",
    password: "",
    roleKey: "operator",
    tenantId: "default",
    status: "active" as "active" | "disabled",
  });
  const [tenantForm, setTenantForm] = useState({
    name: "",
    status: "active" as "active" | "disabled",
  });
  const [policyForm, setPolicyForm] = useState({
    name: "",
    scopeType: "global" as "global" | "tenant" | "role" | "user",
    scopeValue: "",
    provider: "",
    modelPattern: "",
    requestsPerMinute: "",
    tokensPerMinute: "",
    tokensPerDay: "",
    enabled: true,
  });
  const [userEditingId, setUserEditingId] = useState<string | null>(null);
  const [userEditForm, setUserEditForm] = useState({
    roleKey: "operator",
    tenantId: "default",
    roleBindingsText: "operator@default",
    tenantIdsText: "default",
    status: "active" as "active" | "disabled",
    password: "",
  });
  const [policyEditingId, setPolicyEditingId] = useState<string | null>(null);
  const [policyEditForm, setPolicyEditForm] = useState({
    requestsPerMinute: "",
    tokensPerMinute: "",
    tokensPerDay: "",
    enabled: true,
  });
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
  const [orgMemberProjectBindingApiAvailable, setOrgMemberProjectBindingApiAvailable] =
    useState(true);
  const [orgOverview, setOrgOverview] = useState<OrgOverviewData | null>(null);
  const [orgOverviewApiAvailable, setOrgOverviewApiAvailable] = useState(true);
  const [orgOverviewFromFallback, setOrgOverviewFromFallback] = useState(false);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState("");
  const [orgForm, setOrgForm] = useState({ name: "" });
  const [orgProjectForm, setOrgProjectForm] = useState({
    name: "",
    organizationId: "",
  });
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

  const canLoadEnterprise = useMemo(
    () =>
      enterpriseEnabled &&
      featurePayload?.edition === "advanced" &&
      featurePayload?.enterpriseBackend?.reachable === true,
    [enterpriseEnabled, featurePayload?.edition, featurePayload?.enterpriseBackend?.reachable],
  );

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return fallback;
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

  const normalizeDateTimeParam = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  };

  const parseOptionalNonNegativeInteger = (
    rawValue: string,
    label: string,
  ): { ok: true; value: number | undefined } | { ok: false; error: string } => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return { ok: true, value: undefined };
    }
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, error: `${label} 必须是非负整数` };
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value)) {
      return { ok: false, error: `${label} 数值过大` };
    }
    return { ok: true, value };
  };

  const normalizePolicyScopeInput = (
    scopeType: QuotaPolicyItem["scopeType"],
    scopeValue: string,
  ): { ok: true; value: string | undefined } | { ok: false; error: string } => {
    const trimmed = scopeValue.trim();
    if (scopeType === "global") {
      if (trimmed) {
        return { ok: false, error: "scopeType=global 时 scopeValue 必须留空" };
      }
      return { ok: true, value: undefined };
    }
    if (!trimmed) {
      return { ok: false, error: `scopeType=${scopeType} 时必须填写 scopeValue` };
    }
    if (scopeType === "role") {
      return { ok: true, value: trimmed.toLowerCase() };
    }
    return { ok: true, value: trimmed };
  };

  const toText = (value: unknown) => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  };

  const toObject = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  };

  const toTextArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => toText(item).trim()).filter(Boolean);
  };

  const extractListData = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    const root = toObject(value);
    if (Array.isArray(root.data)) return root.data;
    if (Array.isArray(root.items)) return root.items;
    const nestedData = toObject(root.data);
    if (Array.isArray(nestedData.items)) return nestedData.items;
    return [];
  };

  const toBoolean = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    const normalized = toText(value).trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return fallback;
  };

  const toNonNegativeNumber = (value: unknown, fallback: number) => {
    const parsed = Number(toText(value).trim());
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  };

  const splitEditorText = (value: string) =>
    value
      .split(/[\n,，]/)
      .map((item) => item.trim())
      .filter(Boolean);

  const isValidTimeZone = (value: string) => {
    try {
      Intl.DateTimeFormat("zh-CN", { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  };

  const parseAlertmanagerDurationSec = (value: unknown, fallback: number) => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    const text = toText(value).trim().toLowerCase();
    if (!text) return fallback;
    if (/^\d+$/.test(text)) return Math.floor(Number(text));
    const matched = text.match(/^(\d+)(s|m|h|d)$/);
    if (!matched) return fallback;
    const amount = Number(matched[1]);
    const unit = matched[2];
    const multiplier = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
    return Math.floor(amount * multiplier);
  };

  const formatAlertmanagerDurationSec = (value: number) => `${Math.max(0, Math.floor(value))}s`;

  const isManagedAlertmanagerReceiverName = (value: string) =>
    MANAGED_ALERTMANAGER_RECEIVER_NAMES.includes(
      value as (typeof MANAGED_ALERTMANAGER_RECEIVER_NAMES)[number],
    );

  const isMaskedWebhookUrl = (value: string) => value.includes("***");

  const extractTraceIdFromResponse = (resp: Response, payload: unknown) =>
    toText(toObject(payload).traceId).trim() || resp.headers.get("x-request-id")?.trim() || "";

  const buildTraceableErrorMessage = (payload: unknown, fallback: string, traceIdHint?: string) => {
    const root = toObject(payload);
    const message = toText(root.error).trim() || fallback;
    const traceId = toText(root.traceId).trim() || traceIdHint?.trim() || "";
    return traceId ? `${message}（traceId: ${traceId}）` : message;
  };

  const readJsonSafely = async (resp: Response) =>
    (await resp.json().catch(() => ({}))) as Record<string, unknown>;

  const normalizeOAuthAlertRuleStructuredDraft = (
    value: unknown,
  ): OAuthAlertRuleStructuredDraft => {
    const root = toObject(value);
    const firstRule = toObject(Array.isArray(root.rules) ? root.rules[0] : undefined);
    const allConditions = Array.isArray(firstRule.allConditions)
      ? firstRule.allConditions.map((item) => toObject(item))
      : [];
    const actions = Array.isArray(firstRule.actions)
      ? firstRule.actions.map((item) => toObject(item))
      : [];
    const muteWindow = toObject(Array.isArray(root.muteWindows) ? root.muteWindows[0] : undefined);
    const recoveryPolicy = toObject(root.recoveryPolicy);
    const providerCondition = allConditions.find((item) => toText(item.field).trim() === "provider");
    const failureRateCondition = allConditions.find(
      (item) => toText(item.field).trim() === "failureRateBps",
    );
    const severityAction =
      actions.find((item) => {
        const type = toText(item.type).trim();
        return type === "escalate" || type === "emit";
      }) || {};
    const channelAction = actions.find((item) => toText(item.type).trim() === "set_channel") || {};
    const channelValues = Array.isArray(channelAction.channels)
      ? channelAction.channels.map((item) => toText(item).trim())
      : [];
    const severityText = toText(severityAction.severity).trim().toLowerCase();
    const severity =
      severityText === "warning" || severityText === "critical" || severityText === "recovery"
        ? severityText
        : DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.severity;
    const channel =
      channelValues.find((item) => item === "webhook" || item === "wecom") ||
      DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.channel;

    return {
      ...DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT,
      version: toText(root.version).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.version,
      description: toText(root.description).trim(),
      activate: toBoolean(root.activate, DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.activate),
      recoveryConsecutiveWindows: String(
        Math.max(
          1,
          Math.floor(
            toNonNegativeNumber(
              recoveryPolicy.consecutiveWindows,
              Number(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.recoveryConsecutiveWindows),
            ),
          ),
        ),
      ),
      muteWindowEnabled: Object.keys(muteWindow).length > 0,
      muteWindowId: toText(muteWindow.id).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowId,
      muteWindowName:
        toText(muteWindow.name).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowName,
      muteWindowStart:
        toText(muteWindow.start).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowStart,
      muteWindowEnd:
        toText(muteWindow.end).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowEnd,
      muteWindowTimezone:
        toText(muteWindow.timezone).trim() ||
        DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowTimezone,
      muteWindowWeekdaysText: Array.isArray(muteWindow.weekdays)
        ? muteWindow.weekdays.map((item) => toText(item).trim()).filter(Boolean).join(",")
        : DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowWeekdaysText,
      muteWindowSeveritiesText: Array.isArray(muteWindow.severities)
        ? muteWindow.severities.map((item) => toText(item).trim()).filter(Boolean).join(",")
        : DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.muteWindowSeveritiesText,
      ruleId: toText(firstRule.ruleId).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.ruleId,
      name: toText(firstRule.name).trim() || DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.name,
      enabled: toBoolean(firstRule.enabled, DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.enabled),
      priority: String(
        Math.max(
          0,
          Math.floor(
            toNonNegativeNumber(firstRule.priority, Number(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.priority)),
          ),
        ),
      ),
      provider: toText(providerCondition?.value).trim(),
      failureRateBps: String(
        Math.max(
          0,
          Math.floor(
            toNonNegativeNumber(
              failureRateCondition?.value,
              Number(DEFAULT_OAUTH_ALERT_RULE_STRUCTURED_DRAFT.failureRateBps),
            ),
          ),
        ),
      ),
      severity,
      channel: channel as OAuthAlertRuleStructuredDraft["channel"],
    };
  };

  const buildStructuredOAuthAlertRulePayload = (
    draft: OAuthAlertRuleStructuredDraft,
  ): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } => {
    const version = draft.version.trim();
    const description = draft.description.trim();
    const ruleId = draft.ruleId.trim();
    const name = draft.name.trim();
    const provider = draft.provider.trim().toLowerCase();
    const priority = Number(draft.priority.trim());
    const failureRateBps = Number(draft.failureRateBps.trim());
    const recoveryConsecutiveWindows = Number(draft.recoveryConsecutiveWindows.trim());
    if (!version) return { ok: false, error: "版本号不能为空" };
    if (!ruleId) return { ok: false, error: "规则 ID 不能为空" };
    if (!/^[a-zA-Z0-9._:-]+$/.test(ruleId)) {
      return { ok: false, error: "规则 ID 仅支持字母、数字、点、下划线、冒号和连字符" };
    }
    if (!name) return { ok: false, error: "规则名称不能为空" };
    if (!Number.isInteger(priority) || priority < 0 || priority > 10000) {
      return { ok: false, error: "优先级必须是 0-10000 的整数" };
    }
    if (!Number.isInteger(failureRateBps) || failureRateBps < 0 || failureRateBps > 10000) {
      return { ok: false, error: "失败率阈值必须是 0-10000 的整数" };
    }
    if (
      !Number.isInteger(recoveryConsecutiveWindows) ||
      recoveryConsecutiveWindows < 1 ||
      recoveryConsecutiveWindows > 1000
    ) {
      return { ok: false, error: "恢复连续窗口数必须是 1-1000 的整数" };
    }

    const rules: Array<Record<string, unknown>> = [
      {
        ruleId,
        name,
        enabled: draft.enabled,
        priority,
        allConditions: [
          ...(provider ? [{ field: "provider", op: "eq", value: provider }] : []),
          { field: "failureRateBps", op: "gte", value: failureRateBps },
        ],
        actions: [
          { type: "escalate", severity: draft.severity },
          ...(draft.channel ? [{ type: "set_channel", channels: [draft.channel] }] : []),
        ],
      },
    ];

    const hasMuteWindow =
      draft.muteWindowEnabled ||
      [
        draft.muteWindowId,
        draft.muteWindowName,
        draft.muteWindowStart,
        draft.muteWindowEnd,
        draft.muteWindowTimezone,
        draft.muteWindowWeekdaysText,
        draft.muteWindowSeveritiesText,
      ].some((item) => item.trim());

    const muteWindows: Array<Record<string, unknown>> = [];
    if (hasMuteWindow) {
      const start = draft.muteWindowStart.trim();
      const end = draft.muteWindowEnd.trim();
      const timezone = draft.muteWindowTimezone.trim() || "Asia/Shanghai";
      if (!HHMM_TEXT_PATTERN.test(start) || !HHMM_TEXT_PATTERN.test(end)) {
        return { ok: false, error: "静默窗口开始/结束时间必须为 HH:mm" };
      }
      if (!isValidTimeZone(timezone)) {
        return { ok: false, error: "静默窗口时区非法" };
      }
      const weekdays = splitEditorText(draft.muteWindowWeekdaysText).map((item) => Number(item));
      if (weekdays.some((item) => !Number.isInteger(item) || item < 0 || item > 6)) {
        return { ok: false, error: "静默窗口 weekdays 仅支持 0-6" };
      }
      const severities = splitEditorText(draft.muteWindowSeveritiesText).map((item) =>
        item.toLowerCase(),
      );
      if (
        severities.some(
          (item) => item !== "warning" && item !== "critical" && item !== "recovery",
        )
      ) {
        return { ok: false, error: "静默窗口 severities 仅支持 warning、critical、recovery" };
      }
      muteWindows.push({
        ...(draft.muteWindowId.trim() ? { id: draft.muteWindowId.trim() } : {}),
        ...(draft.muteWindowName.trim() ? { name: draft.muteWindowName.trim() } : {}),
        start,
        end,
        timezone,
        weekdays,
        severities,
      });
    }

    return {
      ok: true,
      payload: {
        version,
        ...(description ? { description } : {}),
        activate: draft.activate,
        recoveryPolicy: {
          consecutiveWindows: recoveryConsecutiveWindows,
        },
        muteWindows,
        rules,
      },
    };
  };

  const getAlertmanagerReceiverUrl = (value: unknown) => {
    const receiver = toObject(value);
    const webhookConfig = toObject(Array.isArray(receiver.webhook_configs) ? receiver.webhook_configs[0] : undefined);
    const url = toText(webhookConfig.url).trim();
    return isMaskedWebhookUrl(url) ? "" : url;
  };

  const normalizeAlertmanagerStructuredDraft = (
    value: AlertmanagerConfigPayload | null | undefined,
  ): AlertmanagerStructuredDraft => {
    const source = toObject(value);
    const route = toObject(source.route);
    const receivers = Array.isArray(source.receivers) ? source.receivers.map((item) => toObject(item)) : [];
    const getReceiverByName = (name: string) =>
      receivers.find((item) => toText(item.name).trim() === name);
    return {
      ...DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT,
      defaultReceiver:
        toText(route.receiver).trim() || DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.defaultReceiver,
      groupByText: Array.isArray(route.group_by)
        ? route.group_by.map((item) => toText(item).trim()).filter(Boolean).join(", ")
        : DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupByText,
      groupWaitSec: String(
        parseAlertmanagerDurationSec(
          route.group_wait,
          Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupWaitSec),
        ),
      ),
      groupIntervalSec: String(
        parseAlertmanagerDurationSec(
          route.group_interval,
          Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupIntervalSec),
        ),
      ),
      repeatIntervalSec: String(
        parseAlertmanagerDurationSec(
          route.repeat_interval,
          Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.repeatIntervalSec),
        ),
      ),
      warningWebhookUrl: getAlertmanagerReceiverUrl(getReceiverByName("warning-webhook")),
      criticalWebhookUrl: getAlertmanagerReceiverUrl(getReceiverByName("critical-webhook")),
      p1WebhookUrl: getAlertmanagerReceiverUrl(getReceiverByName("p1-webhook")),
      templatesText: Array.isArray(source.templates)
        ? source.templates.map((item) => toText(item).trim()).filter(Boolean).join("\n")
        : "",
    };
  };

  const isManagedAlertmanagerRoute = (value: Record<string, unknown>) => {
    const receiver = toText(value.receiver).trim();
    if (isManagedAlertmanagerReceiverName(receiver)) return true;
    const matchers = Array.isArray(value.matchers)
      ? value.matchers.map((item) => toText(item).trim())
      : [];
    return matchers.some(
      (item) =>
        item.includes('severity="warning"') ||
        item.includes('severity="critical"') ||
        item.includes('priority="p1"'),
    );
  };

  const buildStructuredAlertmanagerPayload = (
    draft: AlertmanagerStructuredDraft,
    currentConfig?: AlertmanagerConfigPayload | null,
  ): { ok: true; payload: AlertmanagerConfigPayload } | { ok: false; error: string } => {
    const defaultReceiver = draft.defaultReceiver.trim();
    if (!defaultReceiver) return { ok: false, error: "默认接收器不能为空" };

    const groupWaitParsed = parseOptionalNonNegativeInteger(
      draft.groupWaitSec,
      "group_wait 秒数",
    );
    if (!groupWaitParsed.ok) return groupWaitParsed;
    const groupIntervalParsed = parseOptionalNonNegativeInteger(
      draft.groupIntervalSec,
      "group_interval 秒数",
    );
    if (!groupIntervalParsed.ok) return groupIntervalParsed;
    const repeatIntervalParsed = parseOptionalNonNegativeInteger(
      draft.repeatIntervalSec,
      "repeat_interval 秒数",
    );
    if (!repeatIntervalParsed.ok) return repeatIntervalParsed;

    const receiverUrlEntries = [
      ["warning-webhook", draft.warningWebhookUrl.trim()],
      ["critical-webhook", draft.criticalWebhookUrl.trim()],
      ["p1-webhook", draft.p1WebhookUrl.trim()],
    ] as const;

    for (const [receiverName, url] of receiverUrlEntries) {
      if (!url) continue;
      if (isMaskedWebhookUrl(url)) {
        return { ok: false, error: `${receiverName} 仍是脱敏地址，请重新填写真实 webhook URL` };
      }
      try {
        new URL(url);
      } catch {
        return { ok: false, error: `${receiverName} URL 非法` };
      }
    }

    if (
      receiverUrlEntries.every(([, url]) => !url) &&
      !currentConfig?.receivers?.some((item) => {
        const name = toText(toObject(item).name).trim();
        return name && !isManagedAlertmanagerReceiverName(name);
      })
    ) {
      return { ok: false, error: "至少需要配置一个接收器" };
    }

    if (
      isManagedAlertmanagerReceiverName(defaultReceiver) &&
      !receiverUrlEntries.some(([name, url]) => name === defaultReceiver && Boolean(url))
    ) {
      return { ok: false, error: `默认接收器 ${defaultReceiver} 缺少 URL` };
    }

    const groupBy = splitEditorText(draft.groupByText);
    const managedReceivers = receiverUrlEntries
      .filter(([, url]) => Boolean(url))
      .map(([name, url]) => ({
        name,
        webhook_configs: [
          {
            url,
            send_resolved: true,
          },
        ],
      }));

    const currentReceivers = Array.isArray(currentConfig?.receivers)
      ? currentConfig.receivers.map((item) => toObject(item))
      : [];
    const extraReceivers = currentReceivers.filter((item) => {
      const name = toText(item.name).trim();
      return name && !isManagedAlertmanagerReceiverName(name);
    });
    if (
      !isManagedAlertmanagerReceiverName(defaultReceiver) &&
      !extraReceivers.some((item) => toText(item.name).trim() === defaultReceiver)
    ) {
      return {
        ok: false,
        error: "结构化模式仅支持当前已有的自定义默认接收器，请改用高级 JSON 模式调整",
      };
    }

    const currentRoute = toObject(currentConfig?.route);
    const currentRoutes = Array.isArray(currentRoute.routes)
      ? currentRoute.routes.map((item) => toObject(item))
      : [];
    const extraRoutes = currentRoutes.filter((item) => !isManagedAlertmanagerRoute(item));
    const managedRoutes: Array<Record<string, unknown>> = [];
    if (draft.warningWebhookUrl.trim() && defaultReceiver !== "warning-webhook") {
      managedRoutes.push({
        receiver: "warning-webhook",
        matchers: ['severity="warning"'],
      });
    }
    if (draft.criticalWebhookUrl.trim() && defaultReceiver !== "critical-webhook") {
      managedRoutes.push({
        receiver: "critical-webhook",
        matchers: ['severity="critical"'],
      });
    }
    if (draft.p1WebhookUrl.trim() && defaultReceiver !== "p1-webhook") {
      managedRoutes.push({
        receiver: "p1-webhook",
        matchers: ['priority="p1"'],
      });
    }

    const payload: AlertmanagerConfigPayload = {
      route: {
        receiver: defaultReceiver,
        group_by: groupBy.length > 0 ? groupBy : splitEditorText(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupByText),
        group_wait: formatAlertmanagerDurationSec(
          groupWaitParsed.value ?? Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupWaitSec),
        ),
        group_interval: formatAlertmanagerDurationSec(
          groupIntervalParsed.value ?? Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.groupIntervalSec),
        ),
        repeat_interval: formatAlertmanagerDurationSec(
          repeatIntervalParsed.value ?? Number(DEFAULT_ALERTMANAGER_STRUCTURED_DRAFT.repeatIntervalSec),
        ),
        ...(managedRoutes.length > 0 || extraRoutes.length > 0
          ? { routes: [...managedRoutes, ...extraRoutes] }
          : {}),
      },
      receivers: [...managedReceivers, ...extraReceivers],
    };

    if (currentConfig?.global && Object.keys(currentConfig.global).length > 0) {
      payload.global = currentConfig.global;
    }
    if (Array.isArray(currentConfig?.inhibit_rules) && currentConfig.inhibit_rules.length > 0) {
      payload.inhibit_rules = currentConfig.inhibit_rules;
    }
    if (
      Array.isArray(currentConfig?.mute_time_intervals) &&
      currentConfig.mute_time_intervals.length > 0
    ) {
      payload.mute_time_intervals = currentConfig.mute_time_intervals;
    }
    if (Array.isArray(currentConfig?.time_intervals) && currentConfig.time_intervals.length > 0) {
      payload.time_intervals = currentConfig.time_intervals;
    }
    const templates = draft.templatesText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (templates.length > 0) {
      payload.templates = templates;
    }
    return { ok: true, payload };
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

  const normalizeOAuthAlertConfig = (value: unknown): OAuthAlertCenterConfigPayload => {
    const root = toObject(value);
    const data = toObject(root.data);
    const source = Object.keys(data).length > 0 ? data : root;
    const muteProvidersFromArray = toTextArray(source.muteProviders).map((item) =>
      item.trim().toLowerCase(),
    );
    const muteProvidersFromText = toText(source.muteProviders)
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const muteProviders = Array.from(
      new Set(
        (muteProvidersFromArray.length > 0 ? muteProvidersFromArray : muteProvidersFromText).filter(
          Boolean,
        ),
      ),
    );
    const minDeliverySeverityRaw = toText(source.minDeliverySeverity).trim().toLowerCase();
    const minDeliverySeverity =
      minDeliverySeverityRaw === "critical" || minDeliverySeverityRaw === "warning"
        ? (minDeliverySeverityRaw as "warning" | "critical")
        : DEFAULT_OAUTH_ALERT_CENTER_CONFIG.minDeliverySeverity;
    return {
      enabled: toBoolean(source.enabled, DEFAULT_OAUTH_ALERT_CENTER_CONFIG.enabled),
      warningRateThresholdBps: Math.max(
        1,
        Math.floor(
          toNonNegativeNumber(
            source.warningRateThresholdBps,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.warningRateThresholdBps,
          ),
        ),
      ),
      warningFailureCountThreshold: Math.max(
        1,
        Math.floor(
          toNonNegativeNumber(
            source.warningFailureCountThreshold,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.warningFailureCountThreshold,
          ),
        ),
      ),
      criticalRateThresholdBps: Math.max(
        1,
        Math.floor(
          toNonNegativeNumber(
            source.criticalRateThresholdBps,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.criticalRateThresholdBps,
          ),
        ),
      ),
      criticalFailureCountThreshold: Math.max(
        1,
        Math.floor(
          toNonNegativeNumber(
            source.criticalFailureCountThreshold,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.criticalFailureCountThreshold,
          ),
        ),
      ),
      recoveryRateThresholdBps: Math.max(
        0,
        Math.floor(
          toNonNegativeNumber(
            source.recoveryRateThresholdBps,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.recoveryRateThresholdBps,
          ),
        ),
      ),
      recoveryFailureCountThreshold: Math.max(
        0,
        Math.floor(
          toNonNegativeNumber(
            source.recoveryFailureCountThreshold,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.recoveryFailureCountThreshold,
          ),
        ),
      ),
      dedupeWindowSec: Math.max(
        0,
        Math.floor(
          toNonNegativeNumber(
            source.dedupeWindowSec,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.dedupeWindowSec,
          ),
        ),
      ),
      recoveryConsecutiveWindows: Math.max(
        1,
        Math.floor(
          toNonNegativeNumber(
            source.recoveryConsecutiveWindows,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.recoveryConsecutiveWindows,
          ),
        ),
      ),
      windowSizeSec: Math.max(
        60,
        Math.floor(
          toNonNegativeNumber(
            source.windowSizeSec,
            DEFAULT_OAUTH_ALERT_CENTER_CONFIG.windowSizeSec,
          ),
        ),
      ),
      quietHoursEnabled: toBoolean(
        source.quietHoursEnabled,
        DEFAULT_OAUTH_ALERT_CENTER_CONFIG.quietHoursEnabled,
      ),
      quietHoursStart:
        toText(source.quietHoursStart).trim() || DEFAULT_OAUTH_ALERT_CENTER_CONFIG.quietHoursStart,
      quietHoursEnd:
        toText(source.quietHoursEnd).trim() || DEFAULT_OAUTH_ALERT_CENTER_CONFIG.quietHoursEnd,
      quietHoursTimezone:
        toText(source.quietHoursTimezone).trim() ||
        DEFAULT_OAUTH_ALERT_CENTER_CONFIG.quietHoursTimezone,
      muteProviders,
      minDeliverySeverity,
    };
  };

  const normalizeOAuthAlertIncidentItem = (value: unknown): OAuthAlertIncidentItem | null => {
    const row = toObject(value);
    const id = Number(row.id);
    if (!Number.isFinite(id)) return null;
    const provider = toText(row.provider).trim() || "unknown";
    const phase = toText(row.phase).trim() || "unknown";
    return {
      id,
      incidentId: toText(row.incidentId).trim() || `${provider}:${phase}:${id}`,
      provider,
      phase,
      severity: toText(row.severity).trim() || "warning",
      totalCount: Number.isFinite(Number(row.totalCount)) ? Number(row.totalCount) : 0,
      failureCount: Number.isFinite(Number(row.failureCount)) ? Number(row.failureCount) : 0,
      failureRateBps: Number.isFinite(Number(row.failureRateBps)) ? Number(row.failureRateBps) : 0,
      windowStart: Number.isFinite(Number(row.windowStart)) ? Number(row.windowStart) : Date.now(),
      windowEnd: Number.isFinite(Number(row.windowEnd)) ? Number(row.windowEnd) : Date.now(),
      dedupeKey: toText(row.dedupeKey).trim() || undefined,
      message: toText(row.message).trim() || null,
      createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : Date.now(),
    };
  };

  const normalizeOAuthAlertIncidentResult = (value: unknown): OAuthAlertIncidentQueryResult => {
    const root = toObject(value);
    const rows = extractListData(value)
      .map((item) => normalizeOAuthAlertIncidentItem(item))
      .filter((item): item is OAuthAlertIncidentItem => Boolean(item));
    const page = Math.max(1, Math.floor(Number(root.page) || 1));
    const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || rows.length || 10));
    const total = Math.max(rows.length, Math.floor(Number(root.total) || rows.length));
    const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
    return {
      data: rows,
      page,
      pageSize,
      total,
      totalPages,
    };
  };

  const normalizeOAuthAlertDeliveryItem = (value: unknown): OAuthAlertDeliveryItem | null => {
    const row = toObject(value);
    const id = Number(row.id);
    const eventId = Number(row.eventId);
    if (!Number.isFinite(id) || !Number.isFinite(eventId)) return null;
    return {
      id,
      eventId,
      incidentId: toText(row.incidentId).trim() || `legacy:${eventId}`,
      provider: toText(row.provider).trim() || null,
      phase: toText(row.phase).trim() || null,
      severity: toText(row.severity).trim() || null,
      channel: toText(row.channel).trim() || "webhook",
      target: toText(row.target).trim() || null,
      status: toText(row.status).trim() || "failure",
      attempt: Number.isFinite(Number(row.attempt)) ? Number(row.attempt) : 1,
      responseStatus: Number.isFinite(Number(row.responseStatus)) ? Number(row.responseStatus) : null,
      responseBody: toText(row.responseBody).trim() || null,
      error: toText(row.error).trim() || null,
      sentAt: Number.isFinite(Number(row.sentAt)) ? Number(row.sentAt) : Date.now(),
    };
  };

  const normalizeOAuthAlertDeliveryResult = (value: unknown): OAuthAlertDeliveryQueryResult => {
    const root = toObject(value);
    const rows = extractListData(value)
      .map((item) => normalizeOAuthAlertDeliveryItem(item))
      .filter((item): item is OAuthAlertDeliveryItem => Boolean(item));
    const page = Math.max(1, Math.floor(Number(root.page) || 1));
    const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || rows.length || 10));
    const total = Math.max(rows.length, Math.floor(Number(root.total) || rows.length));
    const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
    return {
      data: rows,
      page,
      pageSize,
      total,
      totalPages,
    };
  };

  const toAlertmanagerConfigPayload = (
    value: Record<string, unknown>,
  ): AlertmanagerConfigPayload | null => {
    const route = toObject(value.route);
    if (Object.keys(route).length === 0) return null;
    if (!Array.isArray(value.receivers)) return null;
    const receivers = value.receivers
      .map((item) => toObject(item))
      .filter((item) => Object.keys(item).length > 0);
    if (receivers.length === 0) return null;

    const payload: AlertmanagerConfigPayload = {
      route,
      receivers,
    };
    const global = toObject(value.global);
    if (Object.keys(global).length > 0) payload.global = global;
    if (Array.isArray(value.inhibit_rules)) {
      payload.inhibit_rules = value.inhibit_rules
        .map((item) => toObject(item))
        .filter((item) => Object.keys(item).length > 0);
    }
    if (Array.isArray(value.mute_time_intervals)) {
      payload.mute_time_intervals = value.mute_time_intervals
        .map((item) => toObject(item))
        .filter((item) => Object.keys(item).length > 0);
    }
    if (Array.isArray(value.time_intervals)) {
      payload.time_intervals = value.time_intervals
        .map((item) => toObject(item))
        .filter((item) => Object.keys(item).length > 0);
    }
    if (Array.isArray(value.templates)) {
      payload.templates = value.templates
        .map((item) => toText(item).trim())
        .filter(Boolean);
    }
    return payload;
  };

  const normalizeAlertmanagerStoredConfig = (value: unknown): AlertmanagerStoredConfig | null => {
    const root = toObject(value);
    const data = toObject(root.data);
    const source = Object.keys(data).length > 0 ? data : root;
    if (Object.keys(source).length === 0) return null;
    const configValue = toObject(source.config);
    return {
      version: Number.isFinite(Number(source.version)) ? Number(source.version) : undefined,
      updatedAt: toText(source.updatedAt).trim() || undefined,
      updatedBy: toText(source.updatedBy).trim() || undefined,
      comment: toText(source.comment).trim() || undefined,
      config: toAlertmanagerConfigPayload(configValue),
    };
  };

  const toAlertmanagerHistoryItem = (row: unknown): AlertmanagerSyncHistoryItem => {
    const item = toObject(row);
    return {
      id: toText(item.id).trim() || undefined,
      ts: toText(item.ts).trim() || undefined,
      outcome: toText(item.outcome).trim() || undefined,
      reason: toText(item.reason).trim() || undefined,
      error: toText(item.error).trim() || undefined,
      rollbackError: toText(item.rollbackError).trim() || undefined,
    };
  };

  const normalizeAlertmanagerHistory = (value: unknown): AlertmanagerSyncHistoryItem[] => {
    const rows = extractListData(value);
    return rows.map((row) => toAlertmanagerHistoryItem(row));
  };

  const normalizeAlertmanagerHistoryQueryResult = (
    value: unknown,
  ): AlertmanagerSyncHistoryQueryResult => {
    const root = toObject(value);
    const data = normalizeAlertmanagerHistory(value);
    const page = Math.max(1, Math.floor(Number(root.page) || 1));
    const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || data.length || 20));
    const total = Math.max(data.length, Math.floor(Number(root.total) || data.length));
    const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
    return {
      data,
      page,
      pageSize,
      total,
      totalPages,
    };
  };

  const normalizeOAuthAlertRuleVersionSummary = (
    value: unknown,
  ): OAuthAlertRuleVersionSummaryItem | null => {
    const row = toObject(value);
    const id = Number(row.id);
    if (!Number.isFinite(id)) return null;
    return {
      id,
      version: toText(row.version).trim() || `v-${id}`,
      status: toText(row.status).trim() || "inactive",
      description: toText(row.description).trim() || null,
      createdBy: toText(row.createdBy).trim() || null,
      createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : undefined,
      updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : undefined,
      activatedAt: Number.isFinite(Number(row.activatedAt))
        ? Number(row.activatedAt)
        : null,
      totalRules: Number.isFinite(Number(row.totalRules)) ? Number(row.totalRules) : undefined,
      enabledRules: Number.isFinite(Number(row.enabledRules)) ? Number(row.enabledRules) : undefined,
      totalHits: Number.isFinite(Number(row.totalHits)) ? Number(row.totalHits) : undefined,
    };
  };

  const normalizeOAuthAlertRuleVersionList = (
    value: unknown,
  ): OAuthAlertRuleVersionListResult => {
    const root = toObject(value);
    const rows = extractListData(value)
      .map((row) => normalizeOAuthAlertRuleVersionSummary(row))
      .filter((row): row is OAuthAlertRuleVersionSummaryItem => Boolean(row));
    const page = Math.max(1, Math.floor(Number(root.page) || 1));
    const pageSize = Math.max(1, Math.floor(Number(root.pageSize) || rows.length || 20));
    const total = Math.max(rows.length, Math.floor(Number(root.total) || rows.length));
    const totalPages = Math.max(1, Math.floor(Number(root.totalPages) || Math.ceil(total / pageSize)));
    return {
      data: rows,
      page,
      pageSize,
      total,
      totalPages,
    };
  };

  const renderAlertmanagerSyncSummary = (item?: AlertmanagerSyncHistoryItem) => {
    if (!item) return "暂无同步记录";
    const base = toText(item.outcome).trim() || "unknown";
    const reason = toText(item.reason).trim();
    const error = toText(item.error).trim();
    if (error) return `${base}: ${error}`;
    if (reason) return `${base}: ${reason}`;
    return base;
  };

  const requestOrgApi = async (path: string, init?: RequestInit) =>
    requestJsonWithApiSecret<Record<string, unknown>>(path, init);

  const requestOrgListWithFallback = async (paths: string[]) => {
    let lastError: (Error & { status?: number }) | null = null;
    for (const path of paths) {
      try {
        const json = await requestOrgApi(path);
        return extractListData(json);
      } catch (error) {
        const typed = error as Error & { status?: number };
        lastError = typed;
        if (typed.status === 404 || typed.status === 405) {
          continue;
        }
        throw typed;
      }
    }
    throw lastError || new Error("组织域接口不可用");
  };

  const normalizeOrganizationItem = (value: unknown): OrgOrganizationItem | null => {
    const row = toObject(value);
    const id = toText(row.id || row.organizationId || row.orgId || row.tenantId)
      .trim()
      .toLowerCase();
    if (!id) return null;
    return {
      id,
      name: toText(row.name || row.organizationName || row.orgName || row.tenantName).trim() || id,
      status: toText(row.status).trim() === "disabled" ? "disabled" : "active",
      updatedAt: toText(row.updatedAt || row.updateTime || row.modifiedAt).trim() || undefined,
    };
  };

  const normalizeProjectItem = (value: unknown): OrgProjectItem | null => {
    const row = toObject(value);
    const id = toText(row.id || row.projectId).trim();
    if (!id) return null;
    const organizationId = toText(
      row.organizationId || row.orgId || row.tenantId || toObject(row.organization).id,
    )
      .trim()
      .toLowerCase();
    return {
      id,
      name: toText(row.name || row.projectName).trim() || id,
      organizationId,
      status: toText(row.status).trim() === "disabled" ? "disabled" : "active",
      updatedAt: toText(row.updatedAt || row.updateTime || row.modifiedAt).trim() || undefined,
    };
  };

  const normalizeMemberBindingItem = (value: unknown): OrgMemberBindingItem | null => {
    const row = toObject(value);
    const memberId = toText(row.memberId || row.id || row.userId).trim().toLowerCase();
    if (!memberId) return null;
    const projectsFromObjects = Array.isArray(row.projects)
      ? row.projects
          .map((item) => toText(toObject(item).id || toObject(item).projectId).trim())
          .filter(Boolean)
      : [];
    const projectIds = Array.from(
      new Set([...toTextArray(row.projectIds), ...projectsFromObjects]),
    );
    return {
      memberId,
      username:
        toText(
          row.username || row.displayName || row.name || row.userName || row.email || row.userId,
        ).trim() ||
        memberId,
      organizationId: toText(row.organizationId || row.orgId || row.tenantId)
        .trim()
        .toLowerCase(),
      projectIds,
    };
  };

  const normalizeMemberProjectBindingRow = (
    value: unknown,
  ): OrgMemberProjectBindingRow | null => {
    const row = toObject(value);
    const rawId = row.id;
    const parsedId =
      typeof rawId === "number"
        ? rawId
        : Number.parseInt(toText(rawId).trim(), 10);
    if (!Number.isFinite(parsedId) || parsedId <= 0) return null;
    const memberId = toText(row.memberId || row.orgMemberId).trim().toLowerCase();
    const projectId = toText(row.projectId).trim();
    if (!memberId || !projectId) return null;
    return {
      id: parsedId,
      organizationId: toText(row.organizationId || row.orgId || row.tenantId)
        .trim()
        .toLowerCase(),
      memberId,
      projectId,
    };
  };

  const normalizeOrgOverviewBucket = (value: unknown): OrgOverviewBucket | null => {
    const row = toObject(value);
    const total = Number(toText(row.total).trim());
    const active = Number(toText(row.active).trim());
    const disabled = Number(toText(row.disabled).trim());
    if (![total, active, disabled].every((item) => Number.isFinite(item))) {
      return null;
    }
    return {
      total: Math.max(0, Math.floor(total)),
      active: Math.max(0, Math.floor(active)),
      disabled: Math.max(0, Math.floor(disabled)),
    };
  };

  const normalizeOrgOverviewData = (value: unknown): OrgOverviewData | null => {
    const root = toObject(value);
    const data = toObject(root.data);
    const organizationsBucket = normalizeOrgOverviewBucket(data.organizations);
    const projectsBucket = normalizeOrgOverviewBucket(data.projects);
    const membersBucket = normalizeOrgOverviewBucket(data.members);
    const bindingsRaw = toObject(data.bindings);
    const bindingsTotal = Number(toText(bindingsRaw.total).trim());
    if (
      !organizationsBucket ||
      !projectsBucket ||
      !membersBucket ||
      !Number.isFinite(bindingsTotal)
    ) {
      return null;
    }
    return {
      organizations: organizationsBucket,
      projects: projectsBucket,
      members: membersBucket,
      bindings: {
        total: Math.max(0, Math.floor(bindingsTotal)),
      },
    };
  };

  const buildOrgOverviewFallback = (
    organizationsData: OrgOrganizationItem[],
    projectsData: OrgProjectItem[],
    membersData: OrgMemberBindingItem[],
    bindingsData: OrgMemberProjectBindingRow[],
  ): OrgOverviewData => {
    const orgTotal = organizationsData.length;
    const orgActive = organizationsData.filter((item) => item.status === "active").length;
    const projectTotal = projectsData.length;
    const projectActive = projectsData.filter((item) => item.status === "active").length;
    const memberTotal = membersData.length;
    const memberActive = membersData.filter((item) => {
      const normalized = item.organizationId.trim().toLowerCase();
      if (!normalized) return true;
      const organization = organizationsData.find((row) => row.id === normalized);
      if (!organization) return true;
      return organization.status === "active";
    }).length;
    const bindingTotal =
      bindingsData.length > 0
        ? bindingsData.length
        : membersData.reduce((acc, item) => acc + item.projectIds.length, 0);

    return {
      organizations: {
        total: orgTotal,
        active: orgActive,
        disabled: Math.max(0, orgTotal - orgActive),
      },
      projects: {
        total: projectTotal,
        active: projectActive,
        disabled: Math.max(0, projectTotal - projectActive),
      },
      members: {
        total: memberTotal,
        active: memberActive,
        disabled: Math.max(0, memberTotal - memberActive),
      },
      bindings: {
        total: Math.max(0, bindingTotal),
      },
    };
  };

  const loadOrgOverview = async (fallback: OrgOverviewData) => {
    try {
      const json = await requestOrgApi("/api/org/overview");
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
    const rows = await requestOrgListWithFallback([
      "/api/org/organizations",
      "/api/org/orgs",
    ]);
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
    setOrgProjectFilterOrganizationId((prev) => {
      const current = prev.trim().toLowerCase();
      if (!current) return prev;
      return normalized.some((item) => item.id === current) ? prev : "";
    });
    return normalized;
  };

  const loadOrgProjects = async () => {
    const rows = await requestOrgListWithFallback(["/api/org/projects"]);
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
    const memberRows = await requestOrgListWithFallback([
      "/api/org/members",
      "/api/org/member-bindings",
    ]);
    const normalizedMembers = memberRows
      .map((item) => normalizeMemberBindingItem(item))
      .filter((item): item is OrgMemberBindingItem => Boolean(item));

    let bindingRows: unknown[] = [];
    let bindingApiAvailable = true;
    try {
      bindingRows = await requestOrgListWithFallback(["/api/org/member-project-bindings"]);
    } catch (error) {
      const typed = error as Error & { status?: number };
      if (typed.status === 404 || typed.status === 405) {
        bindingRows = [];
        bindingApiAvailable = false;
      } else {
        throw typed;
      }
    }
    const normalizedBindingRows = bindingRows
      .map((item) => normalizeMemberProjectBindingRow(item))
      .filter((item): item is OrgMemberProjectBindingRow => Boolean(item));
    setOrgMemberProjectBindingApiAvailable(bindingApiAvailable);
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
    const query = new URLSearchParams({ memberId }).toString();
    const rows = await requestOrgListWithFallback([
      `/api/org/member-project-bindings?${query}`,
    ]);
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
    if (failed.length > 0) {
      setOrgError("组织域接口加载失败，请检查 /api/org 服务状态或权限配置。");
      if (!silent) {
        toast.error("组织域数据加载失败");
      }
    } else if (!silent) {
      toast.success("组织域数据已刷新");
    }
    setOrgLoading(false);
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
      setOAuthAlertConfig(normalizeOAuthAlertConfig(json));
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

  const bootstrap = async () => {
    setLoading(true);
    setAdminAuthenticated(false);
    setCapabilityHealthError("");
    setSectionErrors(EMPTY_ENTERPRISE_SECTION_ERRORS);
    const featureRes = await enterpriseAdminClient.getFeatures();

    if (!featureRes.ok) {
      toast.error("企业能力加载失败");
      setSectionError("baseData", "企业能力加载失败，请刷新后重试。");
      setLoading(false);
      return;
    }

    const featureJson = await featureRes.json();
    setFeaturePayload(featureJson);
    const advancedEnabled =
      featureJson?.edition === "advanced" &&
      featureJson?.features?.enterprise === true;
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
      { label: "用户", result: userRes },
      { label: "租户", result: tenantRes },
      { label: "配额策略", result: policyRes },
    ]);

    if (baseDataErrors.length > 0) {
      setSectionError("baseData", baseDataErrors.join("；"));
    } else {
      clearSectionError("baseData");
    }

    try {
      await loadOAuthAlertCenterConfig();
      await loadOAuthAlertIncidents(1);
      await loadOAuthAlertDeliveries(1);
      await loadOAuthAlertRuleActiveVersion();
      await loadOAuthAlertRuleVersions(1);
      await loadAlertmanagerConfig();
      await loadAlertmanagerSyncHistory();
      await loadAuditEvents(1, auditKeyword);
      await loadCallbackEvents(1);
      await loadSessionEvents(1);
      await loadFallbackEvents(1);
      await loadFallbackSummary();
      await loadUsageRows();
    } catch {
      toast.error("审计或观测日志加载失败");
    } finally {
      await loadOrgDomainData(true);
      await loadFallbackTimeseriesSafely();
      setLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    if (!adminUsername.trim() || !adminPassword) {
      toast.error("请输入管理员账号和密码");
      return;
    }

    setAuthSubmitting(true);
    try {
      const resp = await client.api.admin.auth.login.$post({
        json: {
          username: adminUsername.trim(),
          password: adminPassword,
        },
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
      await client.api.admin.auth.logout.$post();
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
    setUsers([]);
    setTenants([]);
    setPolicies([]);
    setCallbackEvents(null);
    setSessionEvents(null);
    setSessionEventsApiAvailable(true);
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
    setOrgMemberProjectBindingApiAvailable(true);
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
      const resp = await client.api.admin.audit.events.$post({
        json: {
          action: "admin.audit.write",
          resource: "enterprise-panel",
          result: "success",
          details: { source: "enterprise-ui", type: "manual-check" },
        },
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
      const resp = await client.api.admin.oauth["route-policies"].$put({
        json: {
          selection: selectionPolicy,
          execution: routeExecutionPolicy,
        },
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
      const resp = await client.api.admin.oauth["capability-map"].$put({
        json: parsed,
      });
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
    if (!userForm.username.trim() || !userForm.password.trim()) {
      toast.error("请填写用户名与密码");
      return;
    }
    try {
      const resp = await client.api.admin.users.$post({
        json: {
          username: userForm.username.trim(),
          password: userForm.password,
          roleKey: userForm.roleKey,
          tenantId: userForm.tenantId,
          status: userForm.status,
        },
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "创建用户失败" }));
        toast.error((json as { error?: string }).error || "创建用户失败");
        return;
      }
      toast.success("用户已创建");
      setUserForm((prev) => ({ ...prev, username: "", password: "" }));
      await loadUsers();
    } catch {
      toast.error("创建用户失败");
    }
  };

  const removeUser = async (userId: string, username: string) => {
    if (!confirm(`确认删除用户 ${username} 吗？`)) return;
    try {
      const resp = await client.api.admin.users[":id"].$delete({
        param: { id: userId },
      });
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
    const firstBinding = user.roles[0];
    const roleBindingsText =
      user.roles.length > 0
        ? user.roles
            .map((item) => `${item.roleKey}@${item.tenantId || "default"}`)
            .join(",")
        : "operator@default";
    const tenantIdsText = Array.from(
      new Set(
        user.roles.map((item) => item.tenantId || "default").filter(Boolean),
      ),
    ).join(",");
    setUserEditingId(user.id);
    setUserEditForm({
      roleKey: firstBinding?.roleKey || "operator",
      tenantId: firstBinding?.tenantId || "default",
      roleBindingsText,
      tenantIdsText: tenantIdsText || "default",
      status: user.status,
      password: "",
    });
  };

  const saveUserEdit = async (userId: string) => {
    const roleBindings = userEditForm.roleBindingsText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [roleRaw, tenantRaw] = item.split("@");
        return {
          roleKey: (roleRaw || "operator").trim().toLowerCase(),
          tenantId: (tenantRaw || "default").trim(),
        };
      });
    const tenantIds = userEditForm.tenantIdsText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    try {
      const resp = await client.api.admin.users[":id"].$put({
        param: { id: userId },
        json: {
          roleKey: userEditForm.roleKey,
          tenantId: userEditForm.tenantId,
          roleBindings,
          tenantIds,
          status: userEditForm.status,
          password: userEditForm.password || undefined,
        },
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "更新用户失败" }));
        toast.error((json as { error?: string }).error || "更新用户失败");
        return;
      }
      toast.success("用户已更新");
      setUserEditingId(null);
      setUserEditForm({
        roleKey: "operator",
        tenantId: "default",
        roleBindingsText: "operator@default",
        tenantIdsText: "default",
        status: "active",
        password: "",
      });
      await loadUsers();
    } catch {
      toast.error("更新用户失败");
    }
  };

  const createTenant = async () => {
    if (!tenantForm.name.trim()) {
      toast.error("请填写租户名称");
      return;
    }
    try {
      const resp = await client.api.admin.tenants.$post({
        json: {
          name: tenantForm.name.trim(),
          status: tenantForm.status,
        },
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "创建租户失败" }));
        toast.error((json as { error?: string }).error || "创建租户失败");
        return;
      }
      toast.success("租户已创建");
      setTenantForm({ name: "", status: "active" });
      await loadTenants();
    } catch {
      toast.error("创建租户失败");
    }
  };

  const removeTenant = async (tenantId: string) => {
    if (!confirm(`确认删除租户 ${tenantId} 吗？`)) return;
    try {
      const resp = await client.api.admin.tenants[":id"].$delete({
        param: { id: tenantId },
      });
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
    const name = orgForm.name.trim();
    if (!name) {
      toast.error("请填写组织名称");
      return;
    }

    try {
      await requestOrgApi("/api/org/organizations", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      toast.success("组织已创建");
      setOrgForm({ name: "" });
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建组织失败");
    }
  };

  const removeOrganization = async (organization: OrgOrganizationItem) => {
    if (!confirm(`确认删除组织 ${organization.name} (${organization.id}) 吗？`)) return;
    try {
      await requestOrgApi(`/api/org/organizations/${encodeURIComponent(organization.id)}`, {
        method: "DELETE",
      });
      toast.success("组织已删除");
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除组织失败");
    }
  };

  const createOrgProject = async () => {
    const name = orgProjectForm.name.trim();
    const organizationId = orgProjectForm.organizationId.trim().toLowerCase();
    if (!organizationId) {
      toast.error("请先选择组织");
      return;
    }
    if (!name) {
      toast.error("请填写项目名称");
      return;
    }

    try {
      await requestOrgApi("/api/org/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          organizationId,
        }),
      });
      toast.success("项目已创建");
      setOrgProjectForm((prev) => ({ ...prev, name: "" }));
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建项目失败");
    }
  };

  const removeOrgProject = async (project: OrgProjectItem) => {
    if (!confirm(`确认删除项目 ${project.name} (${project.id}) 吗？`)) return;
    try {
      await requestOrgApi(`/api/org/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
      toast.success("项目已删除");
      await loadOrgDomainData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除项目失败");
    }
  };

  const startEditOrgMemberBinding = (member: OrgMemberBindingItem) => {
    const organizationId =
      member.organizationId ||
      orgOrganizations[0]?.id ||
      orgProjectForm.organizationId ||
      "";
    const validProjectIds = new Set(
      orgProjects
        .filter((item) =>
          organizationId ? item.organizationId === organizationId : true,
        )
        .map((item) => item.id),
    );
    setOrgMemberEditingId(member.memberId);
    setOrgMemberEditForm({
      organizationId,
      projectIds: member.projectIds.filter((item) => validProjectIds.has(item)),
    });
  };

  const tryUpdateOrgMemberOrganization = async (
    memberId: string,
    organizationId: string,
  ) => {
    try {
      await requestOrgApi(`/api/org/members/${encodeURIComponent(memberId)}`, {
        method: "PUT",
        body: JSON.stringify({ organizationId }),
      });
      return true;
    } catch (error) {
      const typed = error as Error & { status?: number };
      if (typed.status === 400 || typed.status === 404 || typed.status === 405) {
        return false;
      }
      throw typed;
    }
  };

  const saveOrgMemberBinding = async (memberId: string) => {
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

    const allowedProjects = new Set(
      orgProjects
        .filter((item) => item.organizationId === organizationId)
        .map((item) => item.id),
    );
    const projectIds = Array.from(
      new Set(orgMemberEditForm.projectIds.filter((item) => allowedProjects.has(item))),
    );
    const payload = { organizationId, projectIds };
    const memberIdEncoded = encodeURIComponent(memberId);
    const replacementCandidates = [
      `/api/org/members/${memberIdEncoded}/bindings`,
      `/api/org/member-bindings/${memberIdEncoded}`,
      `/api/org/members/${memberIdEncoded}`,
    ];
    let replacementError: (Error & { status?: number }) | null = null;

    for (const endpoint of replacementCandidates) {
      try {
        await requestOrgApi(endpoint, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success("成员绑定已更新");
        setOrgMemberEditingId(null);
        await loadOrgDomainData(true);
        return;
      } catch (error) {
        const typed = error as Error & { status?: number };
        replacementError = typed;
        if (typed.status === 400 || typed.status === 404 || typed.status === 405) {
          continue;
        }
        toast.error(typed.message || "成员绑定更新失败");
        return;
      }
    }

    if (!orgMemberProjectBindingApiAvailable) {
      toast.error(replacementError?.message || "当前接口不支持成员绑定更新");
      return;
    }

    let existingRows: OrgMemberProjectBindingRow[] = orgMemberProjectBindings.filter(
      (item) => item.memberId === memberId,
    );
    try {
      existingRows = await loadOrgMemberProjectBindingsByMember(memberId);
    } catch (error) {
      const typed = error as Error & { status?: number };
      toast.error(typed.message || "加载成员绑定失败");
      return;
    }

    const currentOrganizationId = targetMember.organizationId.trim().toLowerCase();
    if (currentOrganizationId && currentOrganizationId !== organizationId) {
      try {
        const updated = await tryUpdateOrgMemberOrganization(memberId, organizationId);
        if (!updated && projectIds.length === 0) {
          toast.error("当前接口不支持仅修改成员组织，请至少绑定一个项目");
          return;
        }
      } catch (error) {
        const typed = error as Error & { status?: number };
        toast.error(typed.message || "更新成员组织失败");
        return;
      }
    }

    const targetProjectSet = new Set(projectIds);
    const rowsToDelete = existingRows.filter(
      (item) =>
        item.organizationId !== organizationId || !targetProjectSet.has(item.projectId),
    );
    const existingProjectSet = new Set(
      existingRows
        .filter((item) => item.organizationId === organizationId)
        .map((item) => item.projectId),
    );
    const projectsToCreate = projectIds.filter((projectId) => !existingProjectSet.has(projectId));

    try {
      for (const row of rowsToDelete) {
        await requestOrgApi(`/api/org/member-project-bindings/${row.id}`, {
          method: "DELETE",
        });
      }

      for (const projectId of projectsToCreate) {
        try {
          await requestOrgApi("/api/org/member-project-bindings", {
            method: "POST",
            body: JSON.stringify({
              organizationId,
              memberId,
              projectId,
            }),
          });
        } catch (error) {
          const typed = error as Error & { status?: number };
          if (typed.status === 409) {
            continue;
          }
          throw typed;
        }
      }

      toast.success("成员绑定已更新");
      setOrgMemberEditingId(null);
      await loadOrgDomainData(true);
    } catch (error) {
      const typed = error as Error & { status?: number };
      toast.error(typed.message || "成员绑定更新失败");
    }
  };

  const refreshOrgDomain = async () => {
    await loadOrgDomainData(false);
  };

  const createPolicy = async () => {
    if (!policyForm.name.trim()) {
      toast.error("请填写策略名称");
      return;
    }
    const scopeValidation = normalizePolicyScopeInput(
      policyForm.scopeType,
      policyForm.scopeValue,
    );
    if (!scopeValidation.ok) {
      toast.error(scopeValidation.error);
      return;
    }
    const rpm = parseOptionalNonNegativeInteger(policyForm.requestsPerMinute, "RPM");
    if (!rpm.ok) {
      toast.error(rpm.error);
      return;
    }
    const tpm = parseOptionalNonNegativeInteger(policyForm.tokensPerMinute, "TPM");
    if (!tpm.ok) {
      toast.error(tpm.error);
      return;
    }
    const tpd = parseOptionalNonNegativeInteger(policyForm.tokensPerDay, "TPD");
    if (!tpd.ok) {
      toast.error(tpd.error);
      return;
    }
    try {
      const payload = {
        name: policyForm.name.trim(),
        scopeType: policyForm.scopeType,
        scopeValue: scopeValidation.value,
        provider: policyForm.provider.trim() || undefined,
        modelPattern: policyForm.modelPattern.trim() || undefined,
        requestsPerMinute: rpm.value,
        tokensPerMinute: tpm.value,
        tokensPerDay: tpd.value,
        enabled: policyForm.enabled,
      };
      const resp = await client.api.admin.billing.policies.$post({
        json: payload,
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "创建策略失败" }));
        toast.error((json as { error?: string }).error || "创建策略失败");
        return;
      }
      toast.success("配额策略已创建");
      setPolicyForm({
        name: "",
        scopeType: "global",
        scopeValue: "",
        provider: "",
        modelPattern: "",
        requestsPerMinute: "",
        tokensPerMinute: "",
        tokensPerDay: "",
        enabled: true,
      });
      await loadPolicies();
    } catch {
      toast.error("创建策略失败");
    }
  };

  const removePolicy = async (policyId: string) => {
    if (!confirm(`确认删除策略 ${policyId} 吗？`)) return;
    try {
      const resp = await client.api.admin.billing.policies[":id"].$delete({
        param: { id: policyId },
      });
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
    setPolicyEditForm({
      requestsPerMinute:
        policy.requestsPerMinute === null || policy.requestsPerMinute === undefined
          ? ""
          : String(policy.requestsPerMinute),
      tokensPerMinute:
        policy.tokensPerMinute === null || policy.tokensPerMinute === undefined
          ? ""
          : String(policy.tokensPerMinute),
      tokensPerDay:
        policy.tokensPerDay === null || policy.tokensPerDay === undefined
          ? ""
          : String(policy.tokensPerDay),
      enabled: policy.enabled !== false,
    });
  };

  const savePolicyEdit = async (policy: QuotaPolicyItem) => {
    const rpm = parseOptionalNonNegativeInteger(policyEditForm.requestsPerMinute, "RPM");
    if (!rpm.ok) {
      toast.error(rpm.error);
      return;
    }
    const tpm = parseOptionalNonNegativeInteger(policyEditForm.tokensPerMinute, "TPM");
    if (!tpm.ok) {
      toast.error(tpm.error);
      return;
    }
    const tpd = parseOptionalNonNegativeInteger(policyEditForm.tokensPerDay, "TPD");
    if (!tpd.ok) {
      toast.error(tpd.error);
      return;
    }
    try {
      const resp = await client.api.admin.billing.policies[":id"].$put({
        param: { id: policy.id },
        json: {
          requestsPerMinute: rpm.value,
          tokensPerMinute: tpm.value,
          tokensPerDay: tpd.value,
          enabled: policyEditForm.enabled,
        },
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ error: "更新策略失败" }));
        toast.error((json as { error?: string }).error || "更新策略失败");
        return;
      }
      toast.success("策略已更新");
      setPolicyEditingId(null);
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
      setOAuthAlertConfig(hasConfigField ? normalizeOAuthAlertConfig(json) : oauthAlertConfig);
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
        (toBoolean(data.triggered, false) ? "评估完成：触发告警" : "评估完成：未触发告警");
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

  const rollbackOAuthAlertRuleVersion = async (versionId: number) => {
    if (oauthAlertRuleActionBusy) {
      toast.error("规则版本操作进行中，请稍后重试");
      return;
    }
    if (!Number.isFinite(versionId) || versionId <= 0) {
      toast.error("versionId 非法");
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

  const rollbackAlertmanagerSyncHistoryById = async (historyId: string) => {
    if (alertmanagerActionBusy) {
      toast.error("Alertmanager 操作进行中，请稍后重试");
      return;
    }
    const normalizedId = historyId.trim();
    if (!normalizedId) {
      toast.error("历史记录 ID 非法");
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
      const query = new URLSearchParams();
      if (auditKeyword.trim()) query.set("keyword", auditKeyword.trim());
      if (auditTraceId.trim()) query.set("traceId", auditTraceId.trim());
      if (auditAction.trim()) query.set("action", auditAction.trim());
      if (auditResource.trim()) query.set("resource", auditResource.trim());
      if (auditResourceId.trim()) query.set("resourceId", auditResourceId.trim());
      if (auditPolicyId.trim()) query.set("policyId", auditPolicyId.trim());
      if (auditResultFilter) query.set("result", auditResultFilter);
      const fromParam = normalizeDateTimeParam(auditFrom);
      const toParam = normalizeDateTimeParam(auditTo);
      if (fromParam) query.set("from", fromParam);
      if (toParam) query.set("to", toParam);
      query.set("limit", "2000");

      const defaultFilename = `audit-events-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.csv`;
      const { blob, filename } = await downloadWithApiSecret(
        `/api/admin/audit/export?${query.toString()}`,
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
      const query = new URLSearchParams();
      if (sessionEventStateFilter.trim()) query.set("state", sessionEventStateFilter.trim());
      if (sessionEventProviderFilter.trim()) query.set("provider", sessionEventProviderFilter.trim());
      if (sessionEventFlowFilter) query.set("flowType", sessionEventFlowFilter);
      if (sessionEventPhaseFilter) query.set("phase", sessionEventPhaseFilter);
      if (sessionEventStatusFilter) query.set("status", sessionEventStatusFilter);
      if (sessionEventTypeFilter) query.set("eventType", sessionEventTypeFilter);
      const fromParam = normalizeDateTimeParam(sessionEventFromFilter);
      const toParam = normalizeDateTimeParam(sessionEventToFilter);
      if (fromParam) query.set("from", fromParam);
      if (toParam) query.set("to", toParam);
      query.set("limit", "2000");

      const defaultFilename = `oauth-session-events-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.csv`;
      const { blob, filename } = await downloadWithApiSecret(
        `/api/admin/oauth/session-events/export?${query.toString()}`,
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

  const formatFlows = (
    flows?: Array<"auth_code" | "device_code" | "manual_key" | "service_account">,
  ) => {
    if (!flows || flows.length === 0) {
      return "-";
    }
    return flows.join(", ");
  };

  const formatWindowStart = (windowStart: number) => {
    const timestamp = windowStart < 1_000_000_000_000 ? windowStart * 1000 : windowStart;
    return new Date(timestamp).toLocaleString();
  };

  const parseAuditDetails = (
    details?: Record<string, unknown> | string | null,
  ): Record<string, unknown> | null => {
    if (!details) return null;
    if (typeof details === "object") return details;
    if (typeof details !== "string") return null;
    try {
      const parsed = JSON.parse(details) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  const resolveAuditPolicyId = (item: AuditEventItem): string | null => {
    const details = parseAuditDetails(item.details);
    const fromDetails = details?.policyId;
    if (typeof fromDetails === "string" && fromDetails.trim()) {
      return fromDetails.trim();
    }
    if (typeof item.resourceId === "string" && item.resourceId.trim()) {
      return item.resourceId.trim();
    }
    return null;
  };

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

  const resolveOrganizationName = (organizationId: string) => {
    const id = organizationId.trim().toLowerCase();
    if (!id) return "-";
    const matched = orgOrganizations.find((item) => item.id === id);
    return matched ? `${matched.name} (${matched.id})` : id;
  };

  const resolveProjectDisplay = (projectIds: string[]) => {
    if (!projectIds.length) return "-";
    const nameMap = new Map(orgProjects.map((item) => [item.id, item.name]));
    return projectIds
      .map((item) => nameMap.get(item) ? `${nameMap.get(item)} (${item})` : item)
      .join(", ");
  };

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
                    <td className="p-2 font-bold">{user.username}</td>
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
                              onClick={() => setUserEditingId(null)}
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
            通过 <code>/api/org/*</code> 管理组织、项目与成员项目绑定。
          </p>
        )}

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
                来源:{orgOverviewFromFallback ? "fallback" : "overview"}
              </p>
            </div>
          </div>
        ) : null}

        {!orgOverviewApiAvailable ? (
          <p className="text-[10px] font-bold text-gray-500">
            当前后端未提供 <code>/api/org/overview</code>，已降级为前端本地统计。
          </p>
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">组织列表</h4>
            <div className="flex flex-col gap-2">
              <input
                className="b-input h-10"
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
                  <button
                    className="b-btn bg-white text-xs"
                    onClick={() => {
                      void removeOrganization(organization);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                    删除
                  </button>
                </div>
              ))}
              {orgOrganizations.length === 0 ? (
                <p className="text-xs font-bold text-gray-500">暂无组织</p>
              ) : null}
            </div>
          </div>

          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">项目列表</h4>
            <div className="grid grid-cols-1 gap-2">
              <select
                className="b-input h-10"
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
                  <option key={organization.id} value={organization.id}>
                    {organization.name} ({organization.id})
                  </option>
                ))}
              </select>
              <input
                className="b-input h-10"
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
                      {project.id} · {resolveOrganizationName(project.organizationId)}
                    </p>
                  </div>
                  <button
                    className="b-btn bg-white text-xs"
                    onClick={() => {
                      void removeOrgProject(project);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                    删除
                  </button>
                </div>
              ))}
              {filteredOrgProjects.length === 0 ? (
                <p className="text-xs font-bold text-gray-500">暂无项目</p>
              ) : null}
            </div>
          </div>

          <div className="border-2 border-black p-4 space-y-3">
            <h4 className="text-lg font-black uppercase">成员绑定</h4>
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
                      </td>
                      <td className="p-2">
                        {orgMemberEditingId === member.memberId ? (
                          <select
                            className="b-input h-8 text-xs w-40"
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
                              <option key={organization.id} value={organization.id}>
                                {organization.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono">
                            {resolveOrganizationName(member.organizationId)}
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
                                  <span className="font-mono text-[10px]">{project.name}</span>
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
                          <span className="font-mono">{resolveProjectDisplay(member.projectIds)}</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-2">
                          {orgMemberEditingId === member.memberId ? (
                            <>
                              <button
                                className="b-btn bg-[#FFD500] text-xs"
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
                            <button
                              className="b-btn bg-white text-xs"
                              onClick={() => startEditOrgMemberBinding(member)}
                            >
                              编辑绑定
                            </button>
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
                    <p className="font-bold">{policy.name}</p>
                    <p className="font-mono text-xs text-gray-500">{policy.id}</p>
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {policy.scopeType}
                    {policy.scopeValue ? `:${policy.scopeValue}` : ""}
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
                            onClick={() => setPolicyEditingId(null)}
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
                          void rollbackOAuthAlertRuleVersion(item.id);
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
                            void rollbackAlertmanagerSyncHistoryById(item.id);
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
                          {item.incidentId}
                        </button>
                        <p className="text-[10px] text-gray-500 truncate">
                          event={item.id} {item.dedupeKey ? `| ${item.dedupeKey}` : ""}
                        </p>
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

          <div className="border-2 border-black p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-lg font-black uppercase">Deliveries</h4>
              <button className="b-btn bg-white text-xs" onClick={() => void applyOAuthAlertDeliveryFilters(1)}>
                查询
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="b-input h-9"
                value={oauthAlertDeliveryEventIdFilter}
                onChange={(e) => setOAuthAlertDeliveryEventIdFilter(e.target.value)}
                placeholder="eventId"
              />
              <input
                className="b-input h-9"
                value={oauthAlertDeliveryIncidentIdFilter}
                onChange={(e) => setOAuthAlertDeliveryIncidentIdFilter(e.target.value)}
                placeholder="incidentId"
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
                    <th className="p-2">incident/event/channel</th>
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
                        {item.incidentId}
                        <p className="text-[10px] text-gray-500">
                          event={item.eventId} / channel={item.channel}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">{item.target || "-"}</p>
                        <p className="text-[10px] text-gray-500">
                          {(item.provider || "-") + " / " + (item.phase || "-")}
                        </p>
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

      <section className="bg-white border-4 border-black p-6 b-shadow">
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
