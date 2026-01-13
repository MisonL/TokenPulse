import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(), // UUID
  provider: text("provider").notNull().unique(), 
  email: text("email"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at"), // Timestamp in milliseconds
  metadata: text("metadata"), // JSON string
  
  // New fields
  status: text("status").default('active'), // active, expired, revoked
  attributes: text("attributes"), // JSON string for extra typed attributes like api_key
  nextRefreshAfter: integer("next_refresh_after"), // Timestamp for intelligent scheduling

  lastRefresh: text("last_refresh"), // ISO string
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const systemLogs = sqliteTable("system_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().$defaultFn(() => new Date().toISOString()),
  level: text("level").notNull(), // INFO, WARN, ERROR
  source: text("source").notNull(), // System, Auth, Proxy, etc.
  message: text("message").notNull(),
}, (table) => ({
  timestampIdx: index("system_logs_timestamp_idx").on(table.timestamp),
}));

export const requestLogs = sqliteTable("request_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().$defaultFn(() => new Date().toISOString()),
  provider: text("provider"), // claude, gemini, etc.
  method: text("method"), // GET, POST
  path: text("path"),
  status: integer("status"),
  latencyMs: integer("latency_ms"),
}, (table) => ({
  reqTimestampIdx: index("request_logs_timestamp_idx").on(table.timestamp),
}));

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type SystemLog = typeof systemLogs.$inferSelect;

export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    description: text('description'),
    updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
});

export type Setting = typeof settings.$inferSelect;


