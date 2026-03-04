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
import { client, getApiSecret } from "../lib/client";
import { cn } from "../lib/utils";

interface FeaturePayload {
  edition: "standard" | "advanced";
  features: Record<string, boolean>;
}

interface PermissionItem {
  key: string;
  name: string;
}

interface RoleItem {
  key: string;
  name: string;
  permissions: string[];
}

interface AuditEventItem {
  id: number;
  actor: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  traceId?: string | null;
  result: "success" | "failure";
  createdAt: string;
  details?: Record<string, unknown> | string | null;
}

interface AuditQueryResult {
  data: AuditEventItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface BillingQuotaResult {
  data: {
    mode: string;
    message: string;
    limits: {
      requestsPerMinute: number;
      tokensPerDay: number;
    };
  };
}

interface RoleBindingItem {
  roleKey: string;
  tenantId?: string | null;
}

interface AdminUserItem {
  id: string;
  username: string;
  displayName?: string | null;
  status: "active" | "disabled";
  roles: RoleBindingItem[];
}

interface TenantItem {
  id: string;
  name: string;
  status: "active" | "disabled";
  updatedAt?: string;
}

interface QuotaPolicyItem {
  id: string;
  name: string;
  scopeType: "global" | "tenant" | "role" | "user";
  scopeValue?: string | null;
  provider?: string | null;
  modelPattern?: string | null;
  requestsPerMinute?: number | null;
  tokensPerMinute?: number | null;
  tokensPerDay?: number | null;
  enabled: boolean;
}

interface OAuthCallbackItem {
  id?: number;
  provider: string;
  state?: string | null;
  code?: string | null;
  error?: string | null;
  source: "aggregate" | "manual";
  status: "success" | "failure";
  traceId?: string | null;
  createdAt: string;
}

interface OAuthCallbackQueryResult {
  data: OAuthCallbackItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface SelectionPolicyData {
  defaultPolicy: "round_robin" | "latest_valid" | "sticky_user";
  allowHeaderOverride: boolean;
  allowHeaderAccountOverride: boolean;
  failureCooldownSec: number;
  maxRetryOnAccountFailure: number;
}

interface RouteExecutionPolicyData {
  emitRouteHeaders: boolean;
  retryStatusCodes: number[];
  claudeFallbackStatusCodes: number[];
}

interface ProviderCapabilityItem {
  provider: string;
  flows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
  supportsChat: boolean;
  supportsModelList: boolean;
  supportsStream: boolean;
  supportsManualCallback: boolean;
}

type ProviderCapabilityMapData = Record<string, ProviderCapabilityItem>;

interface CapabilityRuntimeIssueItem {
  provider: string;
  code: string;
  message: string;
  capability?: {
    flows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
    supportsManualCallback: boolean;
  };
  runtime?: {
    startFlows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
    pollFlows: Array<"auth_code" | "device_code" | "manual_key" | "service_account">;
    supportsManualCallback: boolean;
  };
}

interface CapabilityRuntimeHealthData {
  ok: boolean;
  checkedAt: string;
  issueCount: number;
  issues: CapabilityRuntimeIssueItem[];
}

interface ClaudeFallbackEventItem {
  id: string;
  timestamp: string;
  mode: "api_key" | "bridge";
  phase: "attempt" | "success" | "failure" | "skipped";
  reason?:
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown";
  traceId?: string;
  accountId?: string;
  model?: string;
  status?: number;
  latencyMs?: number;
  message?: string;
}

interface ClaudeFallbackQueryResult {
  data: ClaudeFallbackEventItem[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

interface ClaudeFallbackSummary {
  total: number;
  byMode: {
    api_key: number;
    bridge: number;
  };
  byPhase: {
    attempt: number;
    success: number;
    failure: number;
    skipped: number;
  };
  byReason: Record<
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown",
    number
  >;
}

interface ClaudeFallbackTimeseriesPoint {
  bucketStart: string;
  total: number;
  success: number;
  failure: number;
  bridgeShare: number;
}

interface ClaudeFallbackTimeseriesResult {
  step: "5m" | "15m" | "1h" | "6h" | "1d";
  data: ClaudeFallbackTimeseriesPoint[];
}

interface BillingUsageItem {
  id: number;
  policyId: string;
  policyName?: string | null;
  bucketType: "minute" | "day";
  windowStart: number;
  requestCount: number;
  tokenCount: number;
  estimatedTokenCount?: number;
  actualTokenCount?: number;
  reconciledDelta?: number;
}

interface BillingUsageFilterInput {
  policyId?: string;
  bucketType?: "" | "minute" | "day";
  provider?: string;
  model?: string;
  tenantId?: string;
}

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
  const [fallbackEvents, setFallbackEvents] = useState<ClaudeFallbackQueryResult | null>(null);
  const [fallbackSummary, setFallbackSummary] = useState<ClaudeFallbackSummary | null>(null);
  const [usageRows, setUsageRows] = useState<BillingUsageItem[]>([]);
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

  const canLoadEnterprise = useMemo(
    () => enterpriseEnabled && featurePayload?.edition === "advanced",
    [enterpriseEnabled, featurePayload?.edition],
  );

  const normalizeDateTimeParam = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
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
  ) => {
    const fromParam = normalizeDateTimeParam(from);
    const toParam = normalizeDateTimeParam(to);
    const resp = await client.api.admin.audit.events.$get({
      query: {
        page: String(page),
        pageSize: "10",
        keyword: keyword || undefined,
        traceId: traceId || undefined,
        action: action || undefined,
        resource: resource || undefined,
        resourceId: resourceId || undefined,
        policyId: policyId || undefined,
        result: result || undefined,
        from: fromParam,
        to: toParam,
      },
    });
    if (!resp.ok) {
      throw new Error("加载审计日志失败");
    }
    const json = await resp.json();
    setAuditResult(json);
    setAuditPage(json.page);
  };

  const loadCallbackEvents = async (page = 1) => {
    const resp = await client.api.admin.oauth["callback-events"].$get({
      query: {
        page: String(page),
        pageSize: "10",
        provider: callbackProviderFilter || undefined,
        status: callbackStatusFilter || undefined,
        state: callbackStateFilter || undefined,
        traceId: callbackTraceFilter || undefined,
      },
    });
    if (!resp.ok) throw new Error("加载 OAuth 回调事件失败");
    const json = await resp.json();
    setCallbackEvents(json as OAuthCallbackQueryResult);
  };

  const loadFallbackEvents = async (page = 1) => {
    const fromParam = normalizeDateTimeParam(fallbackFromFilter);
    const toParam = normalizeDateTimeParam(fallbackToFilter);
    const resp = await client.api.admin.observability["claude-fallbacks"].$get({
      query: {
        page: String(page),
        pageSize: "10",
        mode: fallbackModeFilter || undefined,
        phase: fallbackPhaseFilter || undefined,
        reason: fallbackReasonFilter || undefined,
        traceId: fallbackTraceFilter || undefined,
        from: fromParam,
        to: toParam,
      },
    });
    if (!resp.ok) throw new Error("加载 Claude 回退事件失败");
    const json = await resp.json();
    setFallbackEvents(json as ClaudeFallbackQueryResult);
  };

  const loadFallbackSummary = async () => {
    const fromParam = normalizeDateTimeParam(fallbackFromFilter);
    const toParam = normalizeDateTimeParam(fallbackToFilter);
    const resp = await client.api.admin.observability["claude-fallbacks"].summary.$get({
      query: {
        mode: fallbackModeFilter || undefined,
        phase: fallbackPhaseFilter || undefined,
        reason: fallbackReasonFilter || undefined,
        traceId: fallbackTraceFilter || undefined,
        from: fromParam,
        to: toParam,
      },
    });
    if (!resp.ok) throw new Error("加载 Claude 回退聚合失败");
    const json = await resp.json();
    setFallbackSummary((json.data || null) as ClaudeFallbackSummary | null);
  };

  const loadFallbackTimeseries = async () => {
    const fromParam = normalizeDateTimeParam(fallbackFromFilter);
    const toParam = normalizeDateTimeParam(fallbackToFilter);
    const resp = await client.api.admin.observability["claude-fallbacks"].timeseries.$get({
      query: {
        mode: fallbackModeFilter || undefined,
        phase: fallbackPhaseFilter || undefined,
        reason: fallbackReasonFilter || undefined,
        traceId: fallbackTraceFilter || undefined,
        from: fromParam,
        to: toParam,
        step: fallbackStep,
      },
    });
    if (!resp.ok) throw new Error("加载 Claude 回退趋势失败");
    const json = (await resp.json()) as ClaudeFallbackTimeseriesResult;
    setFallbackTimeseries(json.data || []);
  };

  const loadFallbackTimeseriesSafely = async () => {
    try {
      await loadFallbackTimeseries();
    } catch {
      setFallbackTimeseries([]);
      toast.error("Claude 回退趋势加载失败");
    }
  };

  const loadUsageRows = async (filters?: BillingUsageFilterInput) => {
    const policyId = (filters?.policyId ?? usagePolicyIdFilter).trim();
    const bucketType = filters?.bucketType ?? usageBucketTypeFilter;
    const provider = (filters?.provider ?? usageProviderFilter).trim();
    const model = (filters?.model ?? usageModelFilter).trim();
    const tenantId = (filters?.tenantId ?? usageTenantFilter).trim();

    const resp = await client.api.admin.billing.usage.$get({
      query: {
        policyId: policyId || undefined,
        bucketType: bucketType || undefined,
        provider: provider || undefined,
        model: model || undefined,
        tenantId: tenantId || undefined,
        limit: "20",
      },
    });
    if (!resp.ok) throw new Error("加载配额使用记录失败");
    const json = await resp.json();
    setUsageRows((json.data || []) as BillingUsageItem[]);
  };

  const loadCapabilityHealth = async () => {
    const resp = await client.api.admin.oauth["capability-health"].$get();
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
    const resp = await client.api.admin.users.$get();
    if (!resp.ok) throw new Error("加载用户失败");
    const json = await resp.json();
    setUsers((json.data || []) as AdminUserItem[]);
  };

  const loadTenants = async () => {
    const resp = await client.api.admin.tenants.$get();
    if (!resp.ok) throw new Error("加载租户失败");
    const json = await resp.json();
    setTenants((json.data || []) as TenantItem[]);
  };

  const loadPolicies = async () => {
    const resp = await client.api.admin.billing.policies.$get();
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
    const featureRes = await client.api.admin.features.$get();

    if (!featureRes.ok) {
      toast.error("企业能力加载失败");
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

    const meRes = await client.api.admin.auth.me.$get();
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
      client.api.admin.rbac.roles.$get(),
      client.api.admin.rbac.permissions.$get(),
      client.api.admin.billing.quotas.$get(),
      client.api.admin.oauth["route-policies"].$get(),
      client.api.admin.oauth["capability-map"].$get(),
      client.api.admin.oauth["capability-health"].$get(),
      client.api.admin.users.$get(),
      client.api.admin.tenants.$get(),
      client.api.admin.billing.policies.$get(),
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

    try {
      await loadAuditEvents(1, auditKeyword);
      await loadCallbackEvents(1);
      await loadFallbackEvents(1);
      await loadFallbackSummary();
      await loadUsageRows();
    } catch {
      toast.error("审计或观测日志加载失败");
    } finally {
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
    setFallbackEvents(null);
    setFallbackSummary(null);
    setFallbackTimeseries([]);
    setUsageRows([]);
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

  const createPolicy = async () => {
    if (!policyForm.name.trim()) {
      toast.error("请填写策略名称");
      return;
    }
    try {
      const payload = {
        name: policyForm.name.trim(),
        scopeType: policyForm.scopeType,
        scopeValue: policyForm.scopeValue.trim() || undefined,
        provider: policyForm.provider.trim() || undefined,
        modelPattern: policyForm.modelPattern.trim() || undefined,
        requestsPerMinute: policyForm.requestsPerMinute
          ? Number.parseInt(policyForm.requestsPerMinute, 10)
          : undefined,
        tokensPerMinute: policyForm.tokensPerMinute
          ? Number.parseInt(policyForm.tokensPerMinute, 10)
          : undefined,
        tokensPerDay: policyForm.tokensPerDay
          ? Number.parseInt(policyForm.tokensPerDay, 10)
          : undefined,
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
    try {
      const resp = await client.api.admin.billing.policies[":id"].$put({
        param: { id: policy.id },
        json: {
          requestsPerMinute: policyEditForm.requestsPerMinute
            ? Number.parseInt(policyEditForm.requestsPerMinute, 10)
            : undefined,
          tokensPerMinute: policyEditForm.tokensPerMinute
            ? Number.parseInt(policyEditForm.tokensPerMinute, 10)
            : undefined,
          tokensPerDay: policyEditForm.tokensPerDay
            ? Number.parseInt(policyEditForm.tokensPerDay, 10)
            : undefined,
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

      const token = getApiSecret();
      const resp = await fetch(`/api/admin/audit/export?${query.toString()}`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: "include",
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "审计导出失败");
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const now = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `audit-events-${now}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
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
      await loadUsageRows();
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
      await loadUsageRows({ policyId });
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
        <section className="bg-white border-4 border-black p-8 b-shadow">
          <p className="text-2xl font-black mb-2">当前为标准版</p>
          <p className="text-sm font-bold text-gray-600">
            请在服务端设置环境变量 <code>ENABLE_ADVANCED=true</code> 后重启，即可启用 RBAC、审计与配额管理能力。
          </p>
        </section>
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

      <section className="bg-white border-4 border-black p-6 b-shadow">
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
            onChange={(e) =>
              setPolicyForm((prev) => ({
                ...prev,
                scopeType: e.target.value as QuotaPolicyItem["scopeType"],
              }))
            }
          >
            <option value="global">global</option>
            <option value="tenant">tenant</option>
            <option value="role">role</option>
            <option value="user">user</option>
          </select>
          <input
            className="b-input h-10"
            placeholder="scopeValue（可选）"
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
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
                  <tr>
                    <td className="p-3 text-gray-500 font-bold" colSpan={6}>
                      暂无配额使用记录
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
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
                const resp = await client.api.admin.oauth["capability-map"].$get();
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
