import { sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "./logger";

const MIGRATION_SQL = [
  `CREATE SCHEMA IF NOT EXISTS core`,
  `CREATE SCHEMA IF NOT EXISTS enterprise`,

  `CREATE TABLE IF NOT EXISTS core.credentials (
    id text PRIMARY KEY,
    provider text NOT NULL,
    account_id text NOT NULL DEFAULT 'default',
    email text,
    access_token text,
    refresh_token text,
    expires_at bigint,
    metadata text,
    status text DEFAULT 'active',
    attributes text,
    next_refresh_after bigint,
    device_profile text,
    consecutive_failures integer NOT NULL DEFAULT 0,
    last_failure_at bigint,
    last_failure_reason text,
    last_refresh text,
    created_at text,
    updated_at text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credentials_provider_account_unique_idx
    ON core.credentials (provider, account_id)`,
  `CREATE INDEX IF NOT EXISTS credentials_provider_idx
    ON core.credentials (provider)`,

  `CREATE TABLE IF NOT EXISTS core.system_logs (
    id serial PRIMARY KEY,
    timestamp text NOT NULL,
    level text NOT NULL,
    source text NOT NULL,
    message text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS system_logs_timestamp_idx
    ON core.system_logs (timestamp)`,

  `CREATE TABLE IF NOT EXISTS core.request_logs (
    id serial PRIMARY KEY,
    timestamp text NOT NULL,
    provider text,
    method text,
    path text,
    status integer,
    latency_ms integer,
    prompt_tokens integer,
    completion_tokens integer,
    model text,
    trace_id text,
    account_id text
  )`,
  `CREATE INDEX IF NOT EXISTS request_logs_timestamp_idx
    ON core.request_logs (timestamp)`,
  `CREATE INDEX IF NOT EXISTS request_logs_trace_id_idx
    ON core.request_logs (trace_id)`,
  `CREATE INDEX IF NOT EXISTS request_logs_account_id_idx
    ON core.request_logs (account_id)`,

  `CREATE TABLE IF NOT EXISTS core.settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    description text,
    updated_at text
  )`,

  `CREATE TABLE IF NOT EXISTS core.oauth_sessions (
    state text PRIMARY KEY,
    provider text NOT NULL,
    flow_type text NOT NULL DEFAULT 'auth_code',
    verifier text,
    phase text NOT NULL DEFAULT 'pending',
    status text NOT NULL DEFAULT 'pending',
    error text,
    last_error text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    completed_at bigint,
    expires_at bigint NOT NULL
  )`,
  `ALTER TABLE core.oauth_sessions
    ADD COLUMN IF NOT EXISTS flow_type text NOT NULL DEFAULT 'auth_code'`,
  `ALTER TABLE core.oauth_sessions
    ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE core.oauth_sessions
    ADD COLUMN IF NOT EXISTS last_error text`,
  `ALTER TABLE core.oauth_sessions
    ADD COLUMN IF NOT EXISTS updated_at bigint NOT NULL DEFAULT 0`,
  `ALTER TABLE core.oauth_sessions
    ADD COLUMN IF NOT EXISTS completed_at bigint`,
  `CREATE INDEX IF NOT EXISTS oauth_sessions_provider_idx
    ON core.oauth_sessions (provider)`,
  `CREATE INDEX IF NOT EXISTS oauth_sessions_flow_type_idx
    ON core.oauth_sessions (flow_type)`,
  `CREATE INDEX IF NOT EXISTS oauth_sessions_expires_at_idx
    ON core.oauth_sessions (expires_at)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_callbacks (
    id serial PRIMARY KEY,
    provider text NOT NULL,
    state text,
    code text,
    error text,
    source text NOT NULL,
    status text NOT NULL,
    raw text,
    trace_id text,
    created_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS oauth_callbacks_provider_idx
    ON core.oauth_callbacks (provider)`,
  `CREATE INDEX IF NOT EXISTS oauth_callbacks_state_idx
    ON core.oauth_callbacks (state)`,
  `CREATE INDEX IF NOT EXISTS oauth_callbacks_created_at_idx
    ON core.oauth_callbacks (created_at)`,

  `CREATE TABLE IF NOT EXISTS enterprise.audit_events (
    id serial PRIMARY KEY,
    actor text NOT NULL DEFAULT 'system',
    action text NOT NULL,
    resource text NOT NULL,
    resource_id text,
    result text NOT NULL DEFAULT 'success',
    details text,
    ip text,
    user_agent text,
    trace_id text,
    created_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
    ON enterprise.audit_events (created_at)`,
  `CREATE INDEX IF NOT EXISTS audit_events_action_idx
    ON enterprise.audit_events (action)`,
  `CREATE INDEX IF NOT EXISTS audit_events_resource_idx
    ON enterprise.audit_events (resource)`,
  `CREATE INDEX IF NOT EXISTS audit_events_trace_id_idx
    ON enterprise.audit_events (trace_id)`,

  `CREATE TABLE IF NOT EXISTS enterprise.tenants (
    id text PRIMARY KEY,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tenants_name_unique_idx
    ON enterprise.tenants (name)`,

  `CREATE TABLE IF NOT EXISTS enterprise.admin_users (
    id text PRIMARY KEY,
    username text NOT NULL,
    password_hash text NOT NULL,
    display_name text,
    status text NOT NULL DEFAULT 'active',
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_unique_idx
    ON enterprise.admin_users (username)`,

  `CREATE TABLE IF NOT EXISTS enterprise.admin_roles (
    key text PRIMARY KEY,
    name text NOT NULL,
    permissions text NOT NULL,
    builtin integer NOT NULL DEFAULT 0,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS enterprise.admin_user_roles (
    id serial PRIMARY KEY,
    user_id text NOT NULL,
    role_key text NOT NULL,
    tenant_id text,
    created_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS admin_user_roles_user_id_idx
    ON enterprise.admin_user_roles (user_id)`,
  `CREATE INDEX IF NOT EXISTS admin_user_roles_role_key_idx
    ON enterprise.admin_user_roles (role_key)`,
  `CREATE INDEX IF NOT EXISTS admin_user_roles_tenant_id_idx
    ON enterprise.admin_user_roles (tenant_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS admin_user_roles_unique_idx
    ON enterprise.admin_user_roles (user_id, role_key, tenant_id)`,

  `CREATE TABLE IF NOT EXISTS enterprise.admin_user_tenants (
    id serial PRIMARY KEY,
    user_id text NOT NULL,
    tenant_id text NOT NULL,
    created_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS admin_user_tenants_user_id_idx
    ON enterprise.admin_user_tenants (user_id)`,
  `CREATE INDEX IF NOT EXISTS admin_user_tenants_tenant_id_idx
    ON enterprise.admin_user_tenants (tenant_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS admin_user_tenants_unique_idx
    ON enterprise.admin_user_tenants (user_id, tenant_id)`,

  `CREATE TABLE IF NOT EXISTS enterprise.admin_sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    role_key text NOT NULL,
    tenant_id text,
    ip text,
    user_agent text,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    last_seen_at bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS admin_sessions_user_id_idx
    ON enterprise.admin_sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx
    ON enterprise.admin_sessions (expires_at)`,

  `CREATE TABLE IF NOT EXISTS enterprise.quota_policies (
    id text PRIMARY KEY,
    name text NOT NULL,
    scope_type text NOT NULL,
    scope_value text,
    provider text,
    model_pattern text,
    requests_per_minute integer,
    tokens_per_minute integer,
    tokens_per_day integer,
    enabled integer NOT NULL DEFAULT 1,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS quota_policies_scope_idx
    ON enterprise.quota_policies (scope_type, scope_value)`,
  `CREATE INDEX IF NOT EXISTS quota_policies_provider_idx
    ON enterprise.quota_policies (provider)`,

  `CREATE TABLE IF NOT EXISTS enterprise.quota_usage_windows (
    id serial PRIMARY KEY,
    policy_id text NOT NULL,
    bucket_type text NOT NULL,
    window_start bigint NOT NULL,
    request_count integer NOT NULL DEFAULT 0,
    token_count integer NOT NULL DEFAULT 0,
    estimated_token_count integer NOT NULL DEFAULT 0,
    actual_token_count integer NOT NULL DEFAULT 0,
    reconciled_delta integer NOT NULL DEFAULT 0,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `ALTER TABLE enterprise.quota_usage_windows
    ADD COLUMN IF NOT EXISTS estimated_token_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE enterprise.quota_usage_windows
    ADD COLUMN IF NOT EXISTS actual_token_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE enterprise.quota_usage_windows
    ADD COLUMN IF NOT EXISTS reconciled_delta integer NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS quota_usage_windows_query_idx
    ON enterprise.quota_usage_windows (policy_id, bucket_type, window_start)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS quota_usage_windows_unique_idx
    ON enterprise.quota_usage_windows (policy_id, bucket_type, window_start)`,
];

async function main() {
  try {
    logger.info("正在执行 PostgreSQL 数据库迁移...", "迁移");
    for (const statement of MIGRATION_SQL) {
      await db.execute(sql.raw(statement));
    }
    logger.info("数据库迁移完成。", "迁移");
    logger.info("数据库迁移已成功应用。", "迁移");
  } catch (e: any) {
    logger.error(`迁移失败: ${e}`, "迁移");
    logger.error(`数据库迁移失败: ${e?.message || String(e)}`, "迁移");
    process.exit(1);
  }
}

main();
