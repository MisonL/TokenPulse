import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// 初始化 Registry
export const register = new Registry();

// 启用默认指标 (CPU, Memory, Event Loop 等)
collectDefaultMetrics({ register, prefix: "tokenpulse_" });

// 定义 HTTP 请求总数计数器
export const httpRequestCounter = new Counter({
  name: "tokenpulse_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status", "provider"],
  registers: [register],
});

// 定义 HTTP 请求耗时直方图
export const httpRequestDuration = new Histogram({
  name: "tokenpulse_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status", "provider"],
  //buckets: [0.1, 0.3, 0.5, 1, 3, 5, 10], // 默认 buckets
  registers: [register],
});

// 定义凭证状态 Gauge (可选，稍后可扩展)
export const activeCredentialsGauge = new Gauge({
  name: "tokenpulse_active_providers",
  help: "Number of active providers",
  labelNames: ["provider"],
  registers: [register],
});

// OAuth 告警评估产物计数：created/skipped/failed 统一进入同一指标。
export const oauthAlertEventsCounter = new Counter({
  name: "tokenpulse_oauth_alert_events_total",
  help: "OAuth alert evaluation event lifecycle counter",
  labelNames: ["provider", "phase", "severity", "result", "reason"],
  registers: [register],
});

// OAuth 告警评估耗时（秒）。
export const oauthAlertEvaluationDuration = new Histogram({
  name: "tokenpulse_oauth_alert_evaluation_duration_seconds",
  help: "OAuth alert evaluation duration in seconds",
  labelNames: ["result"],
  buckets: [0.005, 0.01, 0.03, 0.1, 0.3, 1, 3, 10],
  registers: [register],
});

// OAuth 告警投递计数：success/failure/suppressed。
export const oauthAlertDeliveryCounter = new Counter({
  name: "tokenpulse_oauth_alert_delivery_total",
  help: "OAuth alert delivery lifecycle counter",
  labelNames: ["provider", "phase", "severity", "channel", "status", "reason"],
  registers: [register],
});

// OAuth 告警投递耗时（秒）。
export const oauthAlertDeliveryDuration = new Histogram({
  name: "tokenpulse_oauth_alert_delivery_duration_seconds",
  help: "OAuth alert delivery duration in seconds",
  labelNames: ["provider", "phase", "severity", "channel", "status"],
  buckets: [0.005, 0.01, 0.03, 0.1, 0.3, 1, 3, 10],
  registers: [register],
});

// OAuth 告警兼容路径命中计数，用于观察遗留前端/脚本是否仍在访问旧入口。
export const oauthAlertCompatRouteCounter = new Counter({
  name: "tokenpulse_oauth_alert_compat_route_hits_total",
  help: "OAuth alert compatibility route hit counter",
  labelNames: ["method", "route"],
  registers: [register],
});

// Alertmanager 控制面操作计数：配置保存、同步、回滚。
export const alertmanagerControlOperationsCounter = new Counter({
  name: "tokenpulse_alertmanager_control_operations_total",
  help: "Alertmanager control plane operation counter",
  labelNames: ["operation", "outcome"],
  registers: [register],
});

// Alertmanager 控制面操作耗时（秒）。
export const alertmanagerControlOperationDuration = new Histogram({
  name: "tokenpulse_alertmanager_control_operation_duration_seconds",
  help: "Alertmanager control plane operation duration in seconds",
  labelNames: ["operation", "outcome"],
  buckets: [0.005, 0.01, 0.03, 0.1, 0.3, 1, 3, 10],
  registers: [register],
});

// 最近一次成功的 sync / rollback 时间戳（Unix 秒）。
export const alertmanagerControlLastSuccessTimestampGauge = new Gauge({
  name: "tokenpulse_alertmanager_control_last_success_timestamp_seconds",
  help: "Timestamp of last successful Alertmanager control plane operation",
  labelNames: ["operation"],
  registers: [register],
});

// AgentLedger 运行时摘要投递计数。
export const agentLedgerRuntimeDeliveryCounter = new Counter({
  name: "tokenpulse_agentledger_runtime_delivery_total",
  help: "AgentLedger runtime summary delivery result counter",
  labelNames: ["result", "reason"],
  registers: [register],
});

// AgentLedger 运行时摘要投递耗时（秒）。
export const agentLedgerRuntimeDeliveryDuration = new Histogram({
  name: "tokenpulse_agentledger_runtime_delivery_duration_seconds",
  help: "AgentLedger runtime summary delivery duration in seconds",
  labelNames: ["result"],
  buckets: [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30],
  registers: [register],
});

// AgentLedger 人工 replay 结果计数。
export const agentLedgerRuntimeReplayCounter = new Counter({
  name: "tokenpulse_agentledger_runtime_replay_total",
  help: "AgentLedger runtime summary manual replay result counter",
  labelNames: ["result"],
  registers: [register],
});

// AgentLedger outbox 入库结果计数。
export const agentLedgerRuntimeOutboxWriteCounter = new Counter({
  name: "tokenpulse_agentledger_runtime_outbox_write_total",
  help: "AgentLedger runtime outbox write result counter",
  labelNames: ["result", "reason"],
  registers: [register],
});

// AgentLedger outbox 当前积压量。
export const agentLedgerRuntimeOutboxBacklogGauge = new Gauge({
  name: "tokenpulse_agentledger_runtime_outbox_backlog",
  help: "Current AgentLedger runtime outbox backlog grouped by delivery state",
  labelNames: ["delivery_state"],
  registers: [register],
});

// AgentLedger worker 配置状态。
export const agentLedgerRuntimeWorkerConfigStateGauge = new Gauge({
  name: "tokenpulse_agentledger_runtime_worker_config_state",
  help: "AgentLedger worker configuration state gauge",
  labelNames: ["state"],
  registers: [register],
});

export const agentLedgerRuntimeLastCycleTimestampGauge = new Gauge({
  name: "tokenpulse_agentledger_runtime_last_cycle_timestamp_seconds",
  help: "Timestamp of last AgentLedger outbox worker cycle",
  registers: [register],
});

export const agentLedgerRuntimeLastSuccessTimestampGauge = new Gauge({
  name: "tokenpulse_agentledger_runtime_last_success_timestamp_seconds",
  help: "Timestamp of last successful AgentLedger outbox delivery cycle",
  registers: [register],
});

export const agentLedgerRuntimeOldestOpenBacklogAgeGauge = new Gauge({
  name: "tokenpulse_agentledger_runtime_oldest_open_backlog_age_seconds",
  help: "Age in seconds of the oldest open AgentLedger outbox backlog item",
  registers: [register],
});

export const agentLedgerRuntimeOpenBacklogTotalGauge = new Gauge({
  name: "tokenpulse_agentledger_runtime_open_backlog_total",
  help: "Total number of open AgentLedger outbox backlog items",
  registers: [register],
});
