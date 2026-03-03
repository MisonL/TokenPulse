import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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
