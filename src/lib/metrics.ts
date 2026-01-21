import { Registry, Counter, Histogram } from "prom-client";

// 初始化 Registry
export const register = new Registry();

// 启用默认指标 (CPU, Memory, Event Loop 等)
import { collectDefaultMetrics } from "prom-client";
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
import { Gauge } from "prom-client";
export const activeCredentialsGauge = new Gauge({
  name: "tokenpulse_active_providers",
  help: "Number of active providers",
  labelNames: ["provider"],
  registers: [register],
});
