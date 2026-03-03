CREATE TABLE `oauth_sessions` (
  `state` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `verifier` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `error` text,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_sessions_provider_idx` ON `oauth_sessions` (`provider`);
--> statement-breakpoint
CREATE INDEX `oauth_sessions_expires_at_idx` ON `oauth_sessions` (`expires_at`);
--> statement-breakpoint

CREATE TABLE `tenants` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_name_unique_idx` ON `tenants` (`name`);
--> statement-breakpoint

CREATE TABLE `admin_users` (
  `id` text PRIMARY KEY NOT NULL,
  `username` text NOT NULL,
  `password_hash` text NOT NULL,
  `display_name` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_unique_idx` ON `admin_users` (`username`);
--> statement-breakpoint

CREATE TABLE `admin_roles` (
  `key` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `permissions` text NOT NULL,
  `builtin` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint

CREATE TABLE `admin_user_roles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `role_key` text NOT NULL,
  `tenant_id` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_user_roles_user_id_idx` ON `admin_user_roles` (`user_id`);
--> statement-breakpoint
CREATE INDEX `admin_user_roles_role_key_idx` ON `admin_user_roles` (`role_key`);
--> statement-breakpoint
CREATE INDEX `admin_user_roles_tenant_id_idx` ON `admin_user_roles` (`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_roles_unique_idx` ON `admin_user_roles` (`user_id`, `role_key`, `tenant_id`);
--> statement-breakpoint

CREATE TABLE `admin_user_tenants` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` text NOT NULL,
  `tenant_id` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_user_tenants_user_id_idx` ON `admin_user_tenants` (`user_id`);
--> statement-breakpoint
CREATE INDEX `admin_user_tenants_tenant_id_idx` ON `admin_user_tenants` (`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_tenants_unique_idx` ON `admin_user_tenants` (`user_id`, `tenant_id`);
--> statement-breakpoint

CREATE TABLE `admin_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `role_key` text NOT NULL,
  `tenant_id` text,
  `ip` text,
  `user_agent` text,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_sessions_user_id_idx` ON `admin_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_at_idx` ON `admin_sessions` (`expires_at`);
--> statement-breakpoint

CREATE TABLE `quota_policies` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `scope_type` text NOT NULL,
  `scope_value` text,
  `provider` text,
  `model_pattern` text,
  `requests_per_minute` integer,
  `tokens_per_minute` integer,
  `tokens_per_day` integer,
  `enabled` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_policies_scope_idx` ON `quota_policies` (`scope_type`, `scope_value`);
--> statement-breakpoint
CREATE INDEX `quota_policies_provider_idx` ON `quota_policies` (`provider`);
--> statement-breakpoint

CREATE TABLE `quota_usage_windows` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `policy_id` text NOT NULL,
  `bucket_type` text NOT NULL,
  `window_start` integer NOT NULL,
  `request_count` integer DEFAULT 0 NOT NULL,
  `token_count` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quota_usage_windows_query_idx` ON `quota_usage_windows` (`policy_id`, `bucket_type`, `window_start`);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_usage_windows_unique_idx` ON `quota_usage_windows` (`policy_id`, `bucket_type`, `window_start`);
--> statement-breakpoint

INSERT OR IGNORE INTO `admin_roles` (`key`, `name`, `permissions`, `builtin`, `created_at`, `updated_at`) VALUES
  ('owner', '所有者', '["admin.dashboard.read","admin.users.manage","admin.billing.manage","admin.audit.read","admin.audit.write"]', 1, datetime('now'), datetime('now')),
  ('auditor', '审计员', '["admin.dashboard.read","admin.audit.read"]', 1, datetime('now'), datetime('now')),
  ('operator', '运维员', '["admin.dashboard.read","admin.users.manage"]', 1, datetime('now'), datetime('now'));
--> statement-breakpoint
INSERT OR IGNORE INTO `tenants` (`id`, `name`, `status`, `created_at`, `updated_at`) VALUES
  ('default', '默认租户', 'active', datetime('now'), datetime('now'));
