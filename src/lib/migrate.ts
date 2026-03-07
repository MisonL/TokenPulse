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

  `CREATE TABLE IF NOT EXISTS core.oauth_session_events (
    id serial PRIMARY KEY,
    state text NOT NULL,
    provider text NOT NULL,
    flow_type text NOT NULL,
    phase text NOT NULL,
    status text NOT NULL,
    event_type text NOT NULL,
    error text,
    created_at bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS oauth_session_events_state_idx
    ON core.oauth_session_events (state)`,
  `CREATE INDEX IF NOT EXISTS oauth_session_events_provider_idx
    ON core.oauth_session_events (provider)`,
  `CREATE INDEX IF NOT EXISTS oauth_session_events_created_at_idx
    ON core.oauth_session_events (created_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_session_events_query_idx
    ON core.oauth_session_events (state, created_at)`,

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

  `CREATE TABLE IF NOT EXISTS core.agentledger_runtime_outbox (
    id serial PRIMARY KEY,
    trace_id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text,
    provider text NOT NULL,
    model text NOT NULL,
    resolved_model text NOT NULL,
    route_policy text NOT NULL,
    account_id text,
    status text NOT NULL,
    started_at text NOT NULL,
    finished_at text,
    error_code text,
    cost text,
    idempotency_key text NOT NULL,
    spec_version text NOT NULL DEFAULT 'v1',
    key_id text NOT NULL,
    target_url text NOT NULL,
    payload_json text NOT NULL,
    payload_hash text NOT NULL,
    headers_json text NOT NULL DEFAULT '{}',
    delivery_state text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    last_http_status integer,
    last_error_class text,
    last_error_message text,
    first_failed_at bigint,
    last_failed_at bigint,
    next_retry_at bigint,
    delivered_at bigint,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agentledger_runtime_outbox_idempotency_unique_idx
    ON core.agentledger_runtime_outbox (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS agentledger_runtime_outbox_state_idx
    ON core.agentledger_runtime_outbox (delivery_state, next_retry_at)`,
  `CREATE INDEX IF NOT EXISTS agentledger_runtime_outbox_trace_idx
    ON core.agentledger_runtime_outbox (trace_id)`,
  `CREATE INDEX IF NOT EXISTS agentledger_runtime_outbox_created_idx
    ON core.agentledger_runtime_outbox (created_at)`,

  `CREATE TABLE IF NOT EXISTS core.agentledger_replay_audits (
    id serial PRIMARY KEY,
    outbox_id integer NOT NULL,
    trace_id text NOT NULL,
    idempotency_key text NOT NULL,
    operator_id text NOT NULL,
    trigger_source text NOT NULL,
    attempt_number integer NOT NULL,
    result text NOT NULL,
    http_status integer,
    error_class text,
    created_at bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agentledger_replay_audits_outbox_id_idx
    ON core.agentledger_replay_audits (outbox_id)`,
  `CREATE INDEX IF NOT EXISTS agentledger_replay_audits_trace_id_idx
    ON core.agentledger_replay_audits (trace_id)`,
  `CREATE INDEX IF NOT EXISTS agentledger_replay_audits_created_at_idx
    ON core.agentledger_replay_audits (created_at)`,

  `CREATE TABLE IF NOT EXISTS core.agentledger_delivery_attempts (
    id serial PRIMARY KEY,
    outbox_id integer NOT NULL,
    trace_id text NOT NULL,
    idempotency_key text NOT NULL,
    source text NOT NULL,
    attempt_number integer NOT NULL,
    result text NOT NULL,
    http_status integer,
    error_class text,
    error_message text,
    duration_ms integer,
    created_at bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agentledger_delivery_attempts_outbox_id_idx
    ON core.agentledger_delivery_attempts (outbox_id)`,
  `CREATE INDEX IF NOT EXISTS agentledger_delivery_attempts_trace_id_idx
    ON core.agentledger_delivery_attempts (trace_id)`,
  `CREATE INDEX IF NOT EXISTS agentledger_delivery_attempts_created_at_idx
    ON core.agentledger_delivery_attempts (created_at)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_alert_configs (
    id serial PRIMARY KEY,
    enabled integer NOT NULL DEFAULT 1,
    warning_rate_threshold_bps integer NOT NULL DEFAULT 2000,
    warning_failure_count_threshold integer NOT NULL DEFAULT 10,
    critical_rate_threshold_bps integer NOT NULL DEFAULT 3500,
    critical_failure_count_threshold integer NOT NULL DEFAULT 20,
    recovery_rate_threshold_bps integer NOT NULL DEFAULT 1000,
    recovery_failure_count_threshold integer NOT NULL DEFAULT 5,
    dedupe_window_sec integer NOT NULL DEFAULT 600,
    recovery_consecutive_windows integer NOT NULL DEFAULT 2,
    window_size_sec integer NOT NULL DEFAULT 300,
    quiet_hours_enabled integer NOT NULL DEFAULT 0,
    quiet_hours_start text NOT NULL DEFAULT '00:00',
    quiet_hours_end text NOT NULL DEFAULT '00:00',
    quiet_hours_timezone text NOT NULL DEFAULT 'Asia/Shanghai',
    mute_providers text NOT NULL DEFAULT '[]',
    min_delivery_severity text NOT NULL DEFAULT 'warning',
    created_at bigint NOT NULL DEFAULT 0,
    updated_at bigint NOT NULL DEFAULT 0
  )`,
  `ALTER TABLE core.oauth_alert_configs
    ADD COLUMN IF NOT EXISTS quiet_hours_enabled integer NOT NULL DEFAULT 0`,
  `ALTER TABLE core.oauth_alert_configs
    ADD COLUMN IF NOT EXISTS quiet_hours_start text NOT NULL DEFAULT '00:00'`,
  `ALTER TABLE core.oauth_alert_configs
    ADD COLUMN IF NOT EXISTS quiet_hours_end text NOT NULL DEFAULT '00:00'`,
  `ALTER TABLE core.oauth_alert_configs
    ADD COLUMN IF NOT EXISTS quiet_hours_timezone text NOT NULL DEFAULT 'Asia/Shanghai'`,
  `ALTER TABLE core.oauth_alert_configs
    ADD COLUMN IF NOT EXISTS mute_providers text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE core.oauth_alert_configs
    ADD COLUMN IF NOT EXISTS min_delivery_severity text NOT NULL DEFAULT 'warning'`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_configs_updated_at_idx
    ON core.oauth_alert_configs (updated_at)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_alert_events (
    id serial PRIMARY KEY,
    incident_id text NOT NULL,
    provider text NOT NULL,
    phase text NOT NULL,
    severity text NOT NULL,
    total_count integer NOT NULL,
    failure_count integer NOT NULL,
    failure_rate_bps integer NOT NULL,
    window_start bigint NOT NULL,
    window_end bigint NOT NULL,
    status_breakdown text,
    dedupe_key text NOT NULL,
    message text,
    created_at bigint NOT NULL
  )`,
  `ALTER TABLE core.oauth_alert_events
    ADD COLUMN IF NOT EXISTS incident_id text`,
  `UPDATE core.oauth_alert_events
    SET incident_id = 'incident:' || provider || ':' || phase || ':' || id::text
    WHERE incident_id IS NULL OR btrim(incident_id) = ''`,
  `UPDATE core.oauth_alert_events
    SET incident_id = 'incident:' || incident_id
    WHERE incident_id ~ '^[[:alnum:]_-]+:[[:alnum:]_-]+:[0-9]+$'`,
  `UPDATE core.oauth_alert_events
    SET incident_id = 'incident:' || provider || ':' || phase || ':' || substring(incident_id from 8)
    WHERE incident_id ~ '^legacy:[0-9]+$'`,
  `ALTER TABLE core.oauth_alert_events
    ALTER COLUMN incident_id SET NOT NULL`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_events_created_at_idx
    ON core.oauth_alert_events (created_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_events_incident_id_idx
    ON core.oauth_alert_events (incident_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_events_query_idx
    ON core.oauth_alert_events (provider, phase, created_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_events_dedupe_idx
    ON core.oauth_alert_events (dedupe_key, created_at)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_alert_deliveries (
    id serial PRIMARY KEY,
    event_id integer NOT NULL,
    incident_id text NOT NULL,
    channel text NOT NULL,
    target text,
    attempt integer NOT NULL DEFAULT 1,
    status text NOT NULL,
    response_status integer,
    response_body text,
    error text,
    sent_at bigint NOT NULL
  )`,
  `ALTER TABLE core.oauth_alert_deliveries
    ADD COLUMN IF NOT EXISTS incident_id text`,
  `UPDATE core.oauth_alert_deliveries AS delivery
    SET incident_id = event.incident_id
    FROM core.oauth_alert_events AS event
    WHERE delivery.event_id = event.id
      AND (
        delivery.incident_id IS NULL
        OR btrim(delivery.incident_id) = ''
        OR delivery.incident_id ~ '^legacy:[0-9]+$'
        OR delivery.incident_id ~ '^[[:alnum:]_-]+:[[:alnum:]_-]+:[0-9]+$'
      )`,
  `UPDATE core.oauth_alert_deliveries
    SET incident_id = 'incident:' || incident_id
    WHERE incident_id ~ '^[[:alnum:]_-]+:[[:alnum:]_-]+:[0-9]+$'`,
  `UPDATE core.oauth_alert_deliveries
    SET incident_id = 'incident:legacy:delivery:' || event_id::text
    WHERE incident_id IS NULL
      OR btrim(incident_id) = ''
      OR incident_id ~ '^legacy:[0-9]+$'`,
  `ALTER TABLE core.oauth_alert_deliveries
    ALTER COLUMN incident_id SET NOT NULL`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_deliveries_event_id_idx
    ON core.oauth_alert_deliveries (event_id)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_deliveries_incident_id_idx
    ON core.oauth_alert_deliveries (incident_id, sent_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_deliveries_channel_idx
    ON core.oauth_alert_deliveries (channel)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS oauth_alert_deliveries_attempt_unique_idx
    ON core.oauth_alert_deliveries (event_id, channel, attempt)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_deliveries_sent_at_idx
    ON core.oauth_alert_deliveries (sent_at)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_alert_rule_versions (
    id serial PRIMARY KEY,
    version text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    description text,
    mute_windows text NOT NULL DEFAULT '[]',
    recovery_policy text NOT NULL DEFAULT '{}',
    created_by text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    activated_at bigint
  )`,
  `ALTER TABLE core.oauth_alert_rule_versions
    ADD COLUMN IF NOT EXISTS mute_windows text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE core.oauth_alert_rule_versions
    ADD COLUMN IF NOT EXISTS recovery_policy text NOT NULL DEFAULT '{}'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS oauth_alert_rule_versions_version_unique_idx
    ON core.oauth_alert_rule_versions (version)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_rule_versions_status_idx
    ON core.oauth_alert_rule_versions (status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_alert_rule_items (
    id serial PRIMARY KEY,
    version_id integer NOT NULL,
    rule_id text NOT NULL,
    name text NOT NULL,
    enabled integer NOT NULL DEFAULT 1,
    priority integer NOT NULL DEFAULT 100,
    all_conditions text NOT NULL DEFAULT '[]',
    any_conditions text NOT NULL DEFAULT '[]',
    actions text NOT NULL DEFAULT '[]',
    hit_count bigint NOT NULL DEFAULT 0,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_rule_items_version_id_idx
    ON core.oauth_alert_rule_items (version_id)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_rule_items_priority_idx
    ON core.oauth_alert_rule_items (enabled, priority)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS oauth_alert_rule_items_unique_idx
    ON core.oauth_alert_rule_items (version_id, rule_id)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_alert_alertmanager_configs (
    id serial PRIMARY KEY,
    enabled integer NOT NULL DEFAULT 1,
    version integer NOT NULL DEFAULT 1,
    updated_by text NOT NULL DEFAULT 'system',
    comment text,
    config_json text NOT NULL DEFAULT '{}',
    warning_webhook_url text NOT NULL DEFAULT '',
    critical_webhook_url text NOT NULL DEFAULT '',
    p1_webhook_url text NOT NULL DEFAULT '',
    group_by text NOT NULL DEFAULT '["alertname","service","severity","provider"]',
    group_wait_sec integer NOT NULL DEFAULT 30,
    group_interval_sec integer NOT NULL DEFAULT 300,
    repeat_interval_sec integer NOT NULL DEFAULT 7200,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
  )`,
  `ALTER TABLE core.oauth_alert_alertmanager_configs
    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`,
  `ALTER TABLE core.oauth_alert_alertmanager_configs
    ADD COLUMN IF NOT EXISTS updated_by text NOT NULL DEFAULT 'system'`,
  `ALTER TABLE core.oauth_alert_alertmanager_configs
    ADD COLUMN IF NOT EXISTS comment text`,
  `ALTER TABLE core.oauth_alert_alertmanager_configs
    ADD COLUMN IF NOT EXISTS config_json text NOT NULL DEFAULT '{}'`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_alertmanager_configs_updated_at_idx
    ON core.oauth_alert_alertmanager_configs (updated_at)`,

  `CREATE TABLE IF NOT EXISTS core.oauth_alert_alertmanager_sync_histories (
    id serial PRIMARY KEY,
    config_id integer,
    status text NOT NULL,
    actor text NOT NULL DEFAULT 'system',
    outcome text NOT NULL DEFAULT 'success',
    reason text,
    trace_id text,
    runtime_json text NOT NULL DEFAULT '{}',
    webhook_targets text NOT NULL DEFAULT '[]',
    error text,
    rollback_error text,
    generated_path text,
    rollback_path text,
    details text,
    started_at bigint NOT NULL,
    finished_at bigint
  )`,
  `ALTER TABLE core.oauth_alert_alertmanager_sync_histories
    ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT 'system'`,
  `ALTER TABLE core.oauth_alert_alertmanager_sync_histories
    ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'success'`,
  `ALTER TABLE core.oauth_alert_alertmanager_sync_histories
    ADD COLUMN IF NOT EXISTS runtime_json text NOT NULL DEFAULT '{}'`,
  `ALTER TABLE core.oauth_alert_alertmanager_sync_histories
    ADD COLUMN IF NOT EXISTS webhook_targets text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE core.oauth_alert_alertmanager_sync_histories
    ADD COLUMN IF NOT EXISTS error text`,
  `ALTER TABLE core.oauth_alert_alertmanager_sync_histories
    ADD COLUMN IF NOT EXISTS rollback_error text`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_alertmanager_sync_started_at_idx
    ON core.oauth_alert_alertmanager_sync_histories (started_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_alert_alertmanager_sync_status_idx
    ON core.oauth_alert_alertmanager_sync_histories (status, started_at)`,

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

  `CREATE TABLE IF NOT EXISTS enterprise.organizations (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active',
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_unique_idx
    ON enterprise.organizations (name)`,
  `CREATE INDEX IF NOT EXISTS organizations_status_idx
    ON enterprise.organizations (status)`,

  `CREATE TABLE IF NOT EXISTS enterprise.projects (
    id text PRIMARY KEY,
    organization_id text NOT NULL,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active',
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS projects_organization_id_idx
    ON enterprise.projects (organization_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_org_name_unique_idx
    ON enterprise.projects (organization_id, name)`,
  `CREATE INDEX IF NOT EXISTS projects_status_idx
    ON enterprise.projects (status)`,

  `CREATE TABLE IF NOT EXISTS enterprise.org_members (
    id text PRIMARY KEY,
    organization_id text NOT NULL,
    user_id text,
    email text,
    display_name text,
    role text NOT NULL DEFAULT 'member',
    status text NOT NULL DEFAULT 'active',
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS org_members_organization_id_idx
    ON enterprise.org_members (organization_id)`,
  `CREATE INDEX IF NOT EXISTS org_members_user_id_idx
    ON enterprise.org_members (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_user_unique_idx
    ON enterprise.org_members (organization_id, user_id)`,

  `CREATE TABLE IF NOT EXISTS enterprise.org_member_projects (
    id serial PRIMARY KEY,
    organization_id text NOT NULL,
    member_id text NOT NULL,
    project_id text NOT NULL,
    created_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS org_member_projects_organization_id_idx
    ON enterprise.org_member_projects (organization_id)`,
  `CREATE INDEX IF NOT EXISTS org_member_projects_member_id_idx
    ON enterprise.org_member_projects (member_id)`,
  `CREATE INDEX IF NOT EXISTS org_member_projects_project_id_idx
    ON enterprise.org_member_projects (project_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS org_member_projects_unique_idx
    ON enterprise.org_member_projects (member_id, project_id)`,

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
