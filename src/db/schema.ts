import {
  pgSchema,
  text,
  integer,
  bigint,
  serial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const coreSchema = pgSchema("core");
export const enterpriseSchema = pgSchema("enterprise");

export const credentials = coreSchema.table(
  "credentials",
  {
    id: text("id").primaryKey(), // UUID
    provider: text("provider").notNull(),
    accountId: text("account_id").notNull().default("default"),
    email: text("email"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: bigint("expires_at", { mode: "number" }), // 时间戳（毫秒）
    metadata: text("metadata"), // JSON 字符串

    // 新字段
    status: text("status").default("active"), // active, expired, revoked
    attributes: text("attributes"), // JSON 字符串，用于额外的类型化属性，如 api_key
    nextRefreshAfter: bigint("next_refresh_after", { mode: "number" }), // 智能调度的时间戳
    deviceProfile: text("device_profile"), // 用于持久设备指纹的 JSON 字符串
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastFailureAt: bigint("last_failure_at", { mode: "number" }), // 时间戳（毫秒）
    lastFailureReason: text("last_failure_reason"),

    lastRefresh: text("last_refresh"), // ISO 字符串
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    providerAccountUniqueIdx: uniqueIndex(
      "credentials_provider_account_unique_idx",
    ).on(table.provider, table.accountId),
    providerIdx: index("credentials_provider_idx").on(table.provider),
  }),
);

export const systemLogs = coreSchema.table(
  "system_logs",
  {
    id: serial("id").primaryKey(),
    timestamp: text("timestamp")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    level: text("level").notNull(), // INFO, WARN, ERROR
    source: text("source").notNull(), // System, Auth, Proxy, etc.
    message: text("message").notNull(),
  },
  (table) => ({
    timestampIdx: index("system_logs_timestamp_idx").on(table.timestamp),
  }),
);

export const requestLogs = coreSchema.table(
  "request_logs",
  {
    id: serial("id").primaryKey(),
    timestamp: text("timestamp")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    provider: text("provider"), // claude, gemini, etc.
    method: text("method"), // GET, POST
    path: text("path"),
    status: integer("status"),
    latencyMs: integer("latency_ms"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    model: text("model"),
    traceId: text("trace_id"),
    accountId: text("account_id"),
  },
  (table) => ({
    reqTimestampIdx: index("request_logs_timestamp_idx").on(table.timestamp),
    reqTraceIdIdx: index("request_logs_trace_id_idx").on(table.traceId),
    reqAccountIdIdx: index("request_logs_account_id_idx").on(table.accountId),
  }),
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type SystemLog = typeof systemLogs.$inferSelect;

export const settings = coreSchema.table("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export type Setting = typeof settings.$inferSelect;

export const auditEvents = enterpriseSchema.table(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull().default("system"),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    result: text("result").notNull().default("success"), // success | failure
    details: text("details"), // JSON 字符串
    ip: text("ip"),
    userAgent: text("user_agent"),
    traceId: text("trace_id"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    auditCreatedAtIdx: index("audit_events_created_at_idx").on(table.createdAt),
    auditActionIdx: index("audit_events_action_idx").on(table.action),
    auditResourceIdx: index("audit_events_resource_idx").on(table.resource),
    auditTraceIdIdx: index("audit_events_trace_id_idx").on(table.traceId),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

export const oauthSessions = coreSchema.table(
  "oauth_sessions",
  {
    state: text("state").primaryKey(),
    provider: text("provider").notNull(),
    flowType: text("flow_type").notNull().default("auth_code"),
    verifier: text("verifier"),
    phase: text("phase").notNull().default("pending"),
    status: text("status").notNull().default("pending"), // pending | completed | error
    error: text("error"),
    lastError: text("last_error"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    completedAt: bigint("completed_at", { mode: "number" }),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    oauthProviderIdx: index("oauth_sessions_provider_idx").on(table.provider),
    oauthFlowTypeIdx: index("oauth_sessions_flow_type_idx").on(table.flowType),
    oauthExpiresIdx: index("oauth_sessions_expires_at_idx").on(table.expiresAt),
  }),
);

export const oauthSessionEvents = coreSchema.table(
  "oauth_session_events",
  {
    id: serial("id").primaryKey(),
    state: text("state").notNull(),
    provider: text("provider").notNull(),
    flowType: text("flow_type").notNull(),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    eventType: text("event_type").notNull(),
    error: text("error"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    oauthSessionEventStateIdx: index("oauth_session_events_state_idx").on(table.state),
    oauthSessionEventProviderIdx: index("oauth_session_events_provider_idx").on(
      table.provider,
    ),
    oauthSessionEventCreatedAtIdx: index("oauth_session_events_created_at_idx").on(
      table.createdAt,
    ),
    oauthSessionEventQueryIdx: index("oauth_session_events_query_idx").on(
      table.state,
      table.createdAt,
    ),
  }),
);

export const oauthCallbacks = coreSchema.table(
  "oauth_callbacks",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    state: text("state"),
    code: text("code"),
    error: text("error"),
    source: text("source").notNull(), // aggregate | manual
    status: text("status").notNull(), // success | failure
    raw: text("raw"), // 原始回调内容（JSON 字符串）
    traceId: text("trace_id"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    oauthCallbackProviderIdx: index("oauth_callbacks_provider_idx").on(
      table.provider,
    ),
    oauthCallbackStateIdx: index("oauth_callbacks_state_idx").on(table.state),
    oauthCallbackCreatedAtIdx: index("oauth_callbacks_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const agentLedgerRuntimeOutbox = coreSchema.table(
  "agentledger_runtime_outbox",
  {
    id: serial("id").primaryKey(),
    traceId: text("trace_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    resolvedModel: text("resolved_model").notNull(),
    routePolicy: text("route_policy").notNull(),
    accountId: text("account_id"),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    errorCode: text("error_code"),
    cost: text("cost"),
    idempotencyKey: text("idempotency_key").notNull(),
    specVersion: text("spec_version").notNull().default("v1"),
    keyId: text("key_id").notNull(),
    targetUrl: text("target_url").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    headersJson: text("headers_json").notNull().default("{}"),
    deliveryState: text("delivery_state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastHttpStatus: integer("last_http_status"),
    lastErrorClass: text("last_error_class"),
    lastErrorMessage: text("last_error_message"),
    firstFailedAt: bigint("first_failed_at", { mode: "number" }),
    lastFailedAt: bigint("last_failed_at", { mode: "number" }),
    nextRetryAt: bigint("next_retry_at", { mode: "number" }),
    deliveredAt: bigint("delivered_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    agentLedgerOutboxIdempotencyUniqueIdx: uniqueIndex(
      "agentledger_runtime_outbox_idempotency_unique_idx",
    ).on(table.idempotencyKey),
    agentLedgerOutboxStateIdx: index("agentledger_runtime_outbox_state_idx").on(
      table.deliveryState,
      table.nextRetryAt,
    ),
    agentLedgerOutboxTraceIdx: index("agentledger_runtime_outbox_trace_idx").on(table.traceId),
    agentLedgerOutboxCreatedIdx: index("agentledger_runtime_outbox_created_idx").on(
      table.createdAt,
    ),
  }),
);

export const agentLedgerReplayAudits = coreSchema.table(
  "agentledger_replay_audits",
  {
    id: serial("id").primaryKey(),
    outboxId: integer("outbox_id").notNull(),
    traceId: text("trace_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    operatorId: text("operator_id").notNull(),
    triggerSource: text("trigger_source").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    result: text("result").notNull(),
    httpStatus: integer("http_status"),
    errorClass: text("error_class"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    agentLedgerReplayAuditOutboxIdx: index("agentledger_replay_audits_outbox_id_idx").on(
      table.outboxId,
    ),
    agentLedgerReplayAuditTraceIdx: index("agentledger_replay_audits_trace_id_idx").on(
      table.traceId,
    ),
    agentLedgerReplayAuditCreatedIdx: index("agentledger_replay_audits_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

export const oauthAlertConfigs = coreSchema.table(
  "oauth_alert_configs",
  {
    id: serial("id").primaryKey(),
    enabled: integer("enabled").notNull().default(1),
    warningRateThresholdBps: integer("warning_rate_threshold_bps")
      .notNull()
      .default(2000),
    warningFailureCountThreshold: integer("warning_failure_count_threshold")
      .notNull()
      .default(10),
    criticalRateThresholdBps: integer("critical_rate_threshold_bps")
      .notNull()
      .default(3500),
    criticalFailureCountThreshold: integer("critical_failure_count_threshold")
      .notNull()
      .default(20),
    recoveryRateThresholdBps: integer("recovery_rate_threshold_bps")
      .notNull()
      .default(1000),
    recoveryFailureCountThreshold: integer("recovery_failure_count_threshold")
      .notNull()
      .default(5),
    dedupeWindowSec: integer("dedupe_window_sec").notNull().default(600),
    recoveryConsecutiveWindows: integer("recovery_consecutive_windows")
      .notNull()
      .default(2),
    windowSizeSec: integer("window_size_sec").notNull().default(300),
    quietHoursEnabled: integer("quiet_hours_enabled").notNull().default(0),
    quietHoursStart: text("quiet_hours_start").notNull().default("00:00"),
    quietHoursEnd: text("quiet_hours_end").notNull().default("00:00"),
    quietHoursTimezone: text("quiet_hours_timezone")
      .notNull()
      .default("Asia/Shanghai"),
    muteProviders: text("mute_providers").notNull().default("[]"),
    minDeliverySeverity: text("min_delivery_severity")
      .notNull()
      .default("warning"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    oauthAlertConfigUpdatedAtIdx: index("oauth_alert_configs_updated_at_idx").on(
      table.updatedAt,
    ),
  }),
);

export const oauthAlertEvents = coreSchema.table(
  "oauth_alert_events",
  {
    id: serial("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    provider: text("provider").notNull(),
    phase: text("phase").notNull(),
    severity: text("severity").notNull(),
    totalCount: integer("total_count").notNull(),
    failureCount: integer("failure_count").notNull(),
    failureRateBps: integer("failure_rate_bps").notNull(),
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    windowEnd: bigint("window_end", { mode: "number" }).notNull(),
    statusBreakdown: text("status_breakdown"),
    dedupeKey: text("dedupe_key").notNull(),
    message: text("message"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    oauthAlertEventCreatedAtIdx: index("oauth_alert_events_created_at_idx").on(
      table.createdAt,
    ),
    oauthAlertEventIncidentIdx: index("oauth_alert_events_incident_id_idx").on(
      table.incidentId,
      table.createdAt,
    ),
    oauthAlertEventQueryIdx: index("oauth_alert_events_query_idx").on(
      table.provider,
      table.phase,
      table.createdAt,
    ),
    oauthAlertEventDedupeIdx: index("oauth_alert_events_dedupe_idx").on(
      table.dedupeKey,
      table.createdAt,
    ),
  }),
);

export const oauthAlertDeliveries = coreSchema.table(
  "oauth_alert_deliveries",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    incidentId: text("incident_id").notNull(),
    channel: text("channel").notNull(),
    target: text("target"),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    error: text("error"),
    sentAt: bigint("sent_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    oauthAlertDeliveryEventIdx: index("oauth_alert_deliveries_event_id_idx").on(
      table.eventId,
    ),
    oauthAlertDeliveryIncidentIdx: index("oauth_alert_deliveries_incident_id_idx").on(
      table.incidentId,
      table.sentAt,
    ),
    oauthAlertDeliveryChannelIdx: index("oauth_alert_deliveries_channel_idx").on(
      table.channel,
    ),
    oauthAlertDeliveryAttemptUniqueIdx: uniqueIndex(
      "oauth_alert_deliveries_attempt_unique_idx",
    ).on(table.eventId, table.channel, table.attempt),
    oauthAlertDeliverySentAtIdx: index("oauth_alert_deliveries_sent_at_idx").on(
      table.sentAt,
    ),
  }),
);

export const oauthAlertRuleVersions = coreSchema.table(
  "oauth_alert_rule_versions",
  {
    id: serial("id").primaryKey(),
    version: text("version").notNull(),
    status: text("status").notNull().default("active"),
    description: text("description"),
    muteWindows: text("mute_windows").notNull().default("[]"),
    recoveryPolicy: text("recovery_policy").notNull().default("{}"),
    createdBy: text("created_by"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    activatedAt: bigint("activated_at", { mode: "number" }),
  },
  (table) => ({
    oauthAlertRuleVersionUniqueIdx: uniqueIndex("oauth_alert_rule_versions_version_unique_idx").on(
      table.version,
    ),
    oauthAlertRuleVersionStatusIdx: index("oauth_alert_rule_versions_status_idx").on(
      table.status,
      table.updatedAt,
    ),
  }),
);

export const oauthAlertRuleItems = coreSchema.table(
  "oauth_alert_rule_items",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id").notNull(),
    ruleId: text("rule_id").notNull(),
    name: text("name").notNull(),
    enabled: integer("enabled").notNull().default(1),
    priority: integer("priority").notNull().default(100),
    allConditions: text("all_conditions").notNull().default("[]"),
    anyConditions: text("any_conditions").notNull().default("[]"),
    actions: text("actions").notNull().default("[]"),
    hitCount: bigint("hit_count", { mode: "number" }).notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    oauthAlertRuleItemVersionIdx: index("oauth_alert_rule_items_version_id_idx").on(
      table.versionId,
    ),
    oauthAlertRuleItemPriorityIdx: index("oauth_alert_rule_items_priority_idx").on(
      table.enabled,
      table.priority,
    ),
    oauthAlertRuleItemUniqueIdx: uniqueIndex("oauth_alert_rule_items_unique_idx").on(
      table.versionId,
      table.ruleId,
    ),
  }),
);

export const oauthAlertAlertmanagerConfigs = coreSchema.table(
  "oauth_alert_alertmanager_configs",
  {
    id: serial("id").primaryKey(),
    enabled: integer("enabled").notNull().default(1),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").notNull().default("system"),
    comment: text("comment"),
    configJson: text("config_json").notNull().default("{}"),
    warningWebhookUrl: text("warning_webhook_url").notNull().default(""),
    criticalWebhookUrl: text("critical_webhook_url").notNull().default(""),
    p1WebhookUrl: text("p1_webhook_url").notNull().default(""),
    groupBy: text("group_by")
      .notNull()
      .default('["alertname","service","severity","provider"]'),
    groupWaitSec: integer("group_wait_sec").notNull().default(30),
    groupIntervalSec: integer("group_interval_sec").notNull().default(300),
    repeatIntervalSec: integer("repeat_interval_sec").notNull().default(7200),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    oauthAlertAlertmanagerConfigUpdatedAtIdx: index(
      "oauth_alert_alertmanager_configs_updated_at_idx",
    ).on(table.updatedAt),
  }),
);

export const oauthAlertAlertmanagerSyncHistories = coreSchema.table(
  "oauth_alert_alertmanager_sync_histories",
  {
    id: serial("id").primaryKey(),
    configId: integer("config_id"),
    status: text("status").notNull(),
    actor: text("actor").notNull().default("system"),
    outcome: text("outcome").notNull().default("success"),
    reason: text("reason"),
    traceId: text("trace_id"),
    runtimeJson: text("runtime_json").notNull().default("{}"),
    webhookTargets: text("webhook_targets").notNull().default("[]"),
    error: text("error"),
    rollbackError: text("rollback_error"),
    generatedPath: text("generated_path"),
    rollbackPath: text("rollback_path"),
    details: text("details"),
    startedAt: bigint("started_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    finishedAt: bigint("finished_at", { mode: "number" }),
  },
  (table) => ({
    oauthAlertAlertmanagerSyncStartedAtIdx: index(
      "oauth_alert_alertmanager_sync_started_at_idx",
    ).on(table.startedAt),
    oauthAlertAlertmanagerSyncStatusIdx: index(
      "oauth_alert_alertmanager_sync_status_idx",
    ).on(table.status, table.startedAt),
  }),
);

export const tenants = enterpriseSchema.table(
  "tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    tenantNameIdx: uniqueIndex("tenants_name_unique_idx").on(table.name),
  }),
);

export const organizations = enterpriseSchema.table(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    organizationNameUniqueIdx: uniqueIndex("organizations_name_unique_idx").on(
      table.name,
    ),
    organizationStatusIdx: index("organizations_status_idx").on(table.status),
  }),
);

export const projects = enterpriseSchema.table(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    projectOrgIdx: index("projects_organization_id_idx").on(table.organizationId),
    projectOrgNameUniqueIdx: uniqueIndex("projects_org_name_unique_idx").on(
      table.organizationId,
      table.name,
    ),
    projectStatusIdx: index("projects_status_idx").on(table.status),
  }),
);

export const orgMembers = enterpriseSchema.table(
  "org_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id"),
    email: text("email"),
    displayName: text("display_name"),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    orgMemberOrgIdx: index("org_members_organization_id_idx").on(
      table.organizationId,
    ),
    orgMemberUserIdx: index("org_members_user_id_idx").on(table.userId),
    orgMemberOrgUserUniqueIdx: uniqueIndex("org_members_org_user_unique_idx").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

export const orgMemberProjects = enterpriseSchema.table(
  "org_member_projects",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    memberId: text("member_id").notNull(),
    projectId: text("project_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    orgMemberProjectOrgIdx: index("org_member_projects_organization_id_idx").on(
      table.organizationId,
    ),
    orgMemberProjectMemberIdx: index("org_member_projects_member_id_idx").on(
      table.memberId,
    ),
    orgMemberProjectProjectIdx: index("org_member_projects_project_id_idx").on(
      table.projectId,
    ),
    orgMemberProjectUniqueIdx: uniqueIndex("org_member_projects_unique_idx").on(
      table.memberId,
      table.projectId,
    ),
  }),
);

export const adminUsers = enterpriseSchema.table(
  "admin_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    adminUsernameIdx: uniqueIndex("admin_users_username_unique_idx").on(
      table.username,
    ),
  }),
);

export const adminRoles = enterpriseSchema.table("admin_roles", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  permissions: text("permissions").notNull(), // JSON string
  builtin: integer("builtin").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const adminUserRoles = enterpriseSchema.table(
  "admin_user_roles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleKey: text("role_key").notNull(),
    tenantId: text("tenant_id"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    adminUserRoleUserIdx: index("admin_user_roles_user_id_idx").on(table.userId),
    adminUserRoleRoleIdx: index("admin_user_roles_role_key_idx").on(table.roleKey),
    adminUserRoleTenantIdx: index("admin_user_roles_tenant_id_idx").on(
      table.tenantId,
    ),
    adminUserRoleUniqueIdx: uniqueIndex("admin_user_roles_unique_idx").on(
      table.userId,
      table.roleKey,
      table.tenantId,
    ),
  }),
);

export const adminUserTenants = enterpriseSchema.table(
  "admin_user_tenants",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    adminUserTenantUserIdx: index("admin_user_tenants_user_id_idx").on(
      table.userId,
    ),
    adminUserTenantTenantIdx: index("admin_user_tenants_tenant_id_idx").on(
      table.tenantId,
    ),
    adminUserTenantUniqueIdx: uniqueIndex("admin_user_tenants_unique_idx").on(
      table.userId,
      table.tenantId,
    ),
  }),
);

export const adminSessions = enterpriseSchema.table(
  "admin_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleKey: text("role_key").notNull(),
    tenantId: text("tenant_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    adminSessionUserIdx: index("admin_sessions_user_id_idx").on(table.userId),
    adminSessionExpiresIdx: index("admin_sessions_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

export const quotaPolicies = enterpriseSchema.table(
  "quota_policies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    scopeType: text("scope_type").notNull(), // global | tenant | role | user
    scopeValue: text("scope_value"),
    provider: text("provider"),
    modelPattern: text("model_pattern"),
    requestsPerMinute: integer("requests_per_minute"),
    tokensPerMinute: integer("tokens_per_minute"),
    tokensPerDay: integer("tokens_per_day"),
    enabled: integer("enabled").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    quotaScopeIdx: index("quota_policies_scope_idx").on(
      table.scopeType,
      table.scopeValue,
    ),
    quotaProviderIdx: index("quota_policies_provider_idx").on(table.provider),
  }),
);

export const quotaUsageWindows = enterpriseSchema.table(
  "quota_usage_windows",
  {
    id: serial("id").primaryKey(),
    policyId: text("policy_id").notNull(),
    bucketType: text("bucket_type").notNull(), // minute | day
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    estimatedTokenCount: integer("estimated_token_count").notNull().default(0),
    actualTokenCount: integer("actual_token_count").notNull().default(0),
    reconciledDelta: integer("reconciled_delta").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    quotaUsageQueryIdx: index("quota_usage_windows_query_idx").on(
      table.policyId,
      table.bucketType,
      table.windowStart,
    ),
    quotaUsageUniqueIdx: uniqueIndex("quota_usage_windows_unique_idx").on(
      table.policyId,
      table.bucketType,
      table.windowStart,
    ),
  }),
);

export type OauthSession = typeof oauthSessions.$inferSelect;
export type OauthSessionEvent = typeof oauthSessionEvents.$inferSelect;
export type OauthCallback = typeof oauthCallbacks.$inferSelect;
export type AgentLedgerRuntimeOutbox = typeof agentLedgerRuntimeOutbox.$inferSelect;
export type NewAgentLedgerRuntimeOutbox = typeof agentLedgerRuntimeOutbox.$inferInsert;
export type AgentLedgerReplayAudit = typeof agentLedgerReplayAudits.$inferSelect;
export type NewAgentLedgerReplayAudit = typeof agentLedgerReplayAudits.$inferInsert;
export type OauthAlertConfig = typeof oauthAlertConfigs.$inferSelect;
export type NewOauthAlertConfig = typeof oauthAlertConfigs.$inferInsert;
export type OauthAlertEvent = typeof oauthAlertEvents.$inferSelect;
export type NewOauthAlertEvent = typeof oauthAlertEvents.$inferInsert;
export type OauthAlertDelivery = typeof oauthAlertDeliveries.$inferSelect;
export type NewOauthAlertDelivery = typeof oauthAlertDeliveries.$inferInsert;
export type OauthAlertRuleVersion = typeof oauthAlertRuleVersions.$inferSelect;
export type NewOauthAlertRuleVersion = typeof oauthAlertRuleVersions.$inferInsert;
export type OauthAlertRuleItem = typeof oauthAlertRuleItems.$inferSelect;
export type NewOauthAlertRuleItem = typeof oauthAlertRuleItems.$inferInsert;
export type OauthAlertAlertmanagerConfig = typeof oauthAlertAlertmanagerConfigs.$inferSelect;
export type NewOauthAlertAlertmanagerConfig = typeof oauthAlertAlertmanagerConfigs.$inferInsert;
export type OauthAlertAlertmanagerSyncHistory =
  typeof oauthAlertAlertmanagerSyncHistories.$inferSelect;
export type NewOauthAlertAlertmanagerSyncHistory =
  typeof oauthAlertAlertmanagerSyncHistories.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminRole = typeof adminRoles.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
export type QuotaPolicy = typeof quotaPolicies.$inferSelect;
