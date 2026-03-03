import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(), // UUID
  provider: text("provider").notNull().unique(),
  email: text("email"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at"), // 时间戳（毫秒）
  metadata: text("metadata"), // JSON 字符串

  // 新字段
  status: text("status").default("active"), // active, expired, revoked
  attributes: text("attributes"), // JSON 字符串，用于额外的类型化属性，如 api_key
  nextRefreshAfter: integer("next_refresh_after"), // 智能调度的时间戳
  deviceProfile: text("device_profile"), // 用于持久设备指纹的 JSON 字符串

  lastRefresh: text("last_refresh"), // ISO 字符串
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const systemLogs = sqliteTable(
  "system_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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

export const requestLogs = sqliteTable(
  "request_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
  },
  (table) => ({
    reqTimestampIdx: index("request_logs_timestamp_idx").on(table.timestamp),
  }),
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type SystemLog = typeof systemLogs.$inferSelect;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export type Setting = typeof settings.$inferSelect;

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull().default("system"),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    result: text("result").notNull().default("success"), // success | failure
    details: text("details"), // JSON 字符串
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    auditCreatedAtIdx: index("audit_events_created_at_idx").on(table.createdAt),
    auditActionIdx: index("audit_events_action_idx").on(table.action),
    auditResourceIdx: index("audit_events_resource_idx").on(table.resource),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

export const oauthSessions = sqliteTable(
  "oauth_sessions",
  {
    state: text("state").primaryKey(),
    provider: text("provider").notNull(),
    verifier: text("verifier"),
    status: text("status").notNull().default("pending"), // pending | completed | error
    error: text("error"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => ({
    oauthProviderIdx: index("oauth_sessions_provider_idx").on(table.provider),
    oauthExpiresIdx: index("oauth_sessions_expires_at_idx").on(table.expiresAt),
  }),
);

export const tenants = sqliteTable(
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

export const adminUsers = sqliteTable(
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

export const adminRoles = sqliteTable(
  "admin_roles",
  {
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
  },
);

export const adminUserRoles = sqliteTable(
  "admin_user_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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

export const adminUserTenants = sqliteTable(
  "admin_user_tenants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleKey: text("role_key").notNull(),
    tenantId: text("tenant_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => ({
    adminSessionUserIdx: index("admin_sessions_user_id_idx").on(table.userId),
    adminSessionExpiresIdx: index("admin_sessions_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

export const quotaPolicies = sqliteTable(
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

export const quotaUsageWindows = sqliteTable(
  "quota_usage_windows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    policyId: text("policy_id").notNull(),
    bucketType: text("bucket_type").notNull(), // minute | day
    windowStart: integer("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
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
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminRole = typeof adminRoles.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
export type QuotaPolicy = typeof quotaPolicies.$inferSelect;
