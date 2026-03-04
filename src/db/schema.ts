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
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminRole = typeof adminRoles.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
export type QuotaPolicy = typeof quotaPolicies.$inferSelect;
