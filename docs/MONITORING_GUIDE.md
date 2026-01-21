# TokenPulse 监控与告警配置指南

## 健康检查

### 端点

| 端点                      | 方法 | 认证 | 说明                 |
| ------------------------- | ---- | ---- | -------------------- |
| `/health`                 | GET  | 否   | 服务健康状态         |
| `/api/credentials/status` | GET  | 否   | 各 Provider 凭证状态 |

### 健康检查响应格式

```json
{
  "status": "ok",
  "service": "oauth2api",
  "providers": [
    "claude",
    "gemini",
    "antigravity",
    "kiro",
    "codex",
    "qwen",
    "iflow",
    "aistudio",
    "vertex",
    "copilot"
  ]
}
```

### Docker Compose 健康检查

```yaml
services:
  tokenpulse:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

### Kubernetes Liveness/Readiness Probe

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

## 日志配置

### 日志级别

通过 `log_level` 设置（在设置 API 中配置）：

| 级别    | 说明                 |
| ------- | -------------------- |
| `DEBUG` | 详细调试信息         |
| `INFO`  | 常规操作信息（默认） |
| `WARN`  | 警告信息             |
| `ERROR` | 错误信息             |

### 日志格式

```
[2026-01-21T14:00:42.661Z] [INFO] [Migration] 正在执行数据库迁移...
[时间戳] [级别] [模块] 消息
```

### Docker 日志收集

```bash
# 实时查看日志
docker logs -f tokenpulse

# 查看最近 100 行
docker logs tokenpulse --tail 100

# 导出到文件
docker logs tokenpulse > tokenpulse.log 2>&1
```

### 日志聚合建议

| 工具               | 配置方式                                     |
| ------------------ | -------------------------------------------- |
| **ELK Stack**      | Filebeat → Logstash → Elasticsearch → Kibana |
| **Loki + Grafana** | Docker logging driver: `loki`                |
| **CloudWatch**     | `awslogs` driver                             |

## 限流监控

### 当前配置

| 参数           | 值       | 说明                   |
| -------------- | -------- | ---------------------- |
| `WINDOW_MS`    | 60,000ms | 时间窗口               |
| `MAX_REQUESTS` | 100      | 每 IP 每分钟最大请求数 |
| `MAX_STATIONS` | 5,000    | 内存中最大唯一 IP 数   |

### 限流触发响应

```http
HTTP/1.1 429 Too Many Requests
Content-Type: text/plain

Too Many Requests
```

### 监控指标建议

| 指标         | Prometheus 格式                 | 告警阈值 |
| ------------ | ------------------------------- | -------- |
| 请求总数     | `http_requests_total`           | -        |
| 429 响应数   | `http_responses_429_total`      | > 10/min |
| 平均响应时间 | `http_request_duration_seconds` | > 5s     |
| 活跃连接数   | `active_connections`            | > 1000   |

## Prometheus 监控配置

TokenPulse 已内置 Prometheus Exporter (`prom-client`)，端口暴露于主服务端口 (默认 3000)。

### Scrape 配置 (prometheus.yml)

```yaml
scrape_configs:
  - job_name: "tokenpulse"
    scrape_interval: 15s
    metrics_path: "/metrics"
    static_configs:
      - targets: ["host.docker.internal:3000"]
```

### 核心指标详情

| 指标名称                                   | 类型      | Labels                                  | 说明               |
| ------------------------------------------ | --------- | --------------------------------------- | ------------------ |
| `tokenpulse_http_requests_total`           | Counter   | `method`, `route`, `status`, `provider` | HTTP 请求总数      |
| `tokenpulse_http_request_duration_seconds` | Histogram | `method`, `route`, `status`, `provider` | 请求耗时分布 (秒)  |
| `active_handles_total`                     | Gauge     | -                                       | Node.js 句柄数     |
| `active_requests_total`                    | Gauge     | -                                       | Node.js 活跃请求数 |
| `nodejs_heap_size_total_bytes`             | Gauge     | -                                       | 堆内存总量         |

### Grafana 查询示例

**RPS (每秒请求数)**:

```promql
sum(rate(tokenpulse_http_requests_total[1m])) by (method, route)
```

**P95 延迟 (按 Provider)**:

```promql
histogram_quantile(0.95, sum(rate(tokenpulse_http_request_duration_seconds_bucket[5m])) by (le, provider))
```

**错误率 (5xx)**:

```promql
sum(rate(tokenpulse_http_requests_total{status=~"5.."}[5m])) / sum(rate(tokenpulse_http_requests_total[5m]))
```

## 告警规则示例

### Prometheus Alertmanager

```yaml
groups:
  - name: tokenpulse
    rules:
      - alert: HighErrorRate
        expr: rate(http_responses_5xx_total[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High 5xx error rate"
          description: "5xx error rate is {{ $value }} per second"

      - alert: HighLatency
        expr: histogram_quantile(0.95, http_request_duration_seconds_bucket) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High request latency"
          description: "95th percentile latency is {{ $value }}s"

      - alert: RateLimitExceeded
        expr: rate(http_responses_429_total[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Rate limiting triggered"
          description: "Rate limit responses: {{ $value }} per second"
```

## 凭证状态监控

### 检查脚本

```bash
#!/bin/bash
# check_credentials.sh

RESPONSE=$(curl -s http://localhost:9009/api/credentials/status)
INACTIVE=$(echo $RESPONSE | jq 'to_entries | map(select(.value == false)) | length')

if [ "$INACTIVE" -gt 0 ]; then
  echo "WARNING: $INACTIVE providers are inactive"
  echo $RESPONSE | jq 'to_entries | map(select(.value == false)) | .[].key'
  exit 1
fi

echo "OK: All providers active"
exit 0
```

### Cron 定时检查

```bash
# 每 5 分钟检查一次
*/5 * * * * /path/to/check_credentials.sh >> /var/log/tokenpulse-creds.log 2>&1
```

## 推荐监控架构

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ TokenPulse  │───▶│ Prometheus   │───▶│  Grafana    │
│  Container  │    │  (metrics)   │    │ (dashboard) │
└─────────────┘    └──────────────┘    └─────────────┘
       │
       ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Loki      │───▶│  Grafana     │───▶│ Alertmanager│
│   (logs)    │    │  (explore)   │    │  (alerts)   │
└─────────────┘    └──────────────┘    └─────────────┘
```
