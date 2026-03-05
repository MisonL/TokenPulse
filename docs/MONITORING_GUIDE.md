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
| `tokenpulse_oauth_alert_events_total`      | Counter   | `provider`, `phase`, `severity`, `result`, `reason` | OAuth 告警评估产物 |
| `tokenpulse_oauth_alert_evaluation_duration_seconds` | Histogram | `result` | OAuth 告警评估耗时 |
| `tokenpulse_oauth_alert_delivery_total`    | Counter   | `provider`, `phase`, `severity`, `channel`, `status`, `reason` | OAuth 告警投递状态 |
| `tokenpulse_oauth_alert_delivery_duration_seconds` | Histogram | `provider`, `phase`, `severity`, `channel`, `status` | OAuth 告警投递耗时 |
| `tokenpulse_nodejs_active_handles_total`   | Gauge     | -                                       | Node.js 句柄数     |
| `tokenpulse_nodejs_active_requests_total`  | Gauge     | -                                       | Node.js 活跃请求数 |
| `tokenpulse_nodejs_heap_size_total_bytes` | Gauge     | -                                       | 堆内存总量         |

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

**OAuth 告警触发量 (5m)**:

```promql
sum(rate(tokenpulse_oauth_alert_events_total{result="created"}[5m])) by (provider, severity)
```

**OAuth 告警投递失败量 (5m)**:

```promql
sum(rate(tokenpulse_oauth_alert_delivery_total{status="failure"}[5m])) by (provider, channel, reason)
```

## 告警规则示例

### Prometheus Alertmanager

```yaml
groups:
  - name: tokenpulse
    rules:
      - alert: HighErrorRate
        expr: sum(rate(tokenpulse_http_requests_total{status=~"5.."}[5m])) / sum(rate(tokenpulse_http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High 5xx error rate"
          description: "5xx 占比超过 5%（当前值 {{ $value }}）"

      - alert: HighLatency
        expr: histogram_quantile(0.95, sum(rate(tokenpulse_http_request_duration_seconds_bucket[5m])) by (le)) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High request latency"
          description: "95th percentile latency is {{ $value }}s"

      - alert: RateLimitExceeded
        expr: sum(rate(tokenpulse_http_requests_total{status="429"}[5m])) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Rate limiting triggered"
          description: "Rate limit responses: {{ $value }} per second"

      - alert: OAuthAlertCriticalBurst
        expr: sum(rate(tokenpulse_oauth_alert_events_total{result="created",severity="critical"}[5m])) by (provider) > 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "OAuth critical alert burst"
          description: "provider={{ $labels.provider }} 在 5 分钟内持续产生 critical 告警"

      - alert: OAuthAlertDeliveryFailureBurst
        expr: sum(rate(tokenpulse_oauth_alert_delivery_total{status="failure",reason!~"muted_provider|below_min_severity|quiet_hours_suppressed"}[5m])) by (provider,channel) > 0.2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "OAuth alert delivery failures"
          description: "provider={{ $labels.provider }} channel={{ $labels.channel }} 投递失败率过高"
```

## Alertmanager 路由与演练（四段式）

### 目的

- 将 OAuth 告警升级链路固化为可复用配置：`5m` 触发 critical，`15m` 持续触发升级 P1。
- 统一生产路由与演练入口，降低跨班次切换和误报处置成本。
- 对齐旧路径弃用窗口：`2026-03-01` 启动迁移观测、`2026-06-30` 结束兼容窗口、`2026-07-01` 起按 critical 处理遗留调用。

### 步骤

1. 准备监控配置文件：
   - `monitoring/prometheus.yml`
   - `monitoring/alert_rules.yml`
   - `monitoring/alertmanager.yml`
2. 语法校验（推荐在发布前执行）：

```bash
docker run --rm --entrypoint promtool \
  -v "$PWD/monitoring:/etc/prometheus:ro" \
  prom/prometheus:v2.53.2 check config /etc/prometheus/prometheus.yml

docker run --rm --entrypoint promtool \
  -v "$PWD/monitoring:/etc/prometheus:ro" \
  prom/prometheus:v2.53.2 check rules /etc/prometheus/alert_rules.yml

docker run --rm --entrypoint amtool \
  -v "$PWD/monitoring:/etc/alertmanager:ro" \
  prom/alertmanager:v0.28.1 check-config /etc/alertmanager/alertmanager.yml
```

3. 启动监控 profile 并加载配置：

```bash
docker compose --profile monitoring up -d prometheus alertmanager
```

4. 通过发布脚本读取 Secret Manager 并完成 Alertmanager config + sync：

> 生产环境只允许运行时注入 webhook，仓库只存 `example.invalid` 占位值或 secret 引用名，不提交真实密钥/地址。

```bash
./scripts/release/publish_alertmanager_secret_sync.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "oncall-bot" \
  --admin-role "owner" \
  --warning-secret-ref "tokenpulse/prod/alertmanager_warning_webhook_url" \
  --critical-secret-ref "tokenpulse/prod/alertmanager_critical_webhook_url" \
  --p1-secret-ref "tokenpulse/prod/alertmanager_p1_webhook_url" \
  --secret-cmd-template 'secret-manager read {{secret_ref}}' \
  --comment "monitoring release publish"
```

5. 执行 OAuth 告警升级演练脚本：

```bash
./scripts/release/drill_oauth_alert_escalation.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "oncall-bot" \
  --admin-role "owner"
```

### 验证

- `http://127.0.0.1:9090/-/ready` 与 `http://127.0.0.1:9093/-/ready` 返回 `200`。
- `/metrics` 中存在 `tokenpulse_oauth_alert_events_total` 与 `tokenpulse_oauth_alert_delivery_total`。
- 演练脚本输出升级结论，并按窗口返回退出码：
  - `11`：warning（critical 出现但未满 5 分钟）
  - `15`：critical（持续 `>=5` 且 `<15` 分钟）
  - `20`：P1（持续 `>=15` 分钟）

### 回滚

1. 立即停用监控 profile：

```bash
docker compose --profile monitoring down
```

2. 回滚 `monitoring/*.yml` 到上一稳定版本，重新执行 `promtool/amtool` 校验。
3. 临时关闭升级规则时，仅保留基础采集：注释 `alert_rules.yml` 中 OAuth 升级规则并 reload Prometheus。

## OAuth 告警中心值班

### 管理接口

| 端点 | 方法 | 权限 | 说明 |
| ---- | ---- | ---- | ---- |
| `/api/admin/observability/oauth-alerts/config` | GET/PUT | GET: `owner/auditor`；PUT: `owner` | 读取/更新 OAuth 告警阈值、静默时段与投递抑制配置 |
| `/api/admin/observability/oauth-alerts/evaluate` | POST | `owner` | 手动触发一次评估 |
| `/api/admin/observability/oauth-alerts/test-delivery` | POST | `owner` | 发送测试告警通知 |
| `/api/admin/observability/oauth-alerts/incidents` | GET | `owner/auditor` | 查询 incident 列表（支持分页与条件过滤） |
| `/api/admin/observability/oauth-alerts/deliveries` | GET | `owner/auditor` | 查询投递记录（支持分页与条件过滤） |
| `/api/admin/observability/oauth-alerts/rules/active` | GET | `owner/auditor` | 查询当前激活规则版本（含 `rules/muteWindows/recoveryPolicy`） |
| `/api/admin/observability/oauth-alerts/rules/versions` | GET | `owner/auditor` | 分页查询规则版本（`page/pageSize/status`） |
| `/api/admin/observability/oauth-alerts/rules/versions` | POST | `owner` | 创建规则版本（支持 `muteWindows/recoveryPolicy`） |
| `/api/admin/observability/oauth-alerts/rules/versions/:versionId/rollback` | POST | `owner` | 回滚并激活指定规则版本 |
| `/api/admin/observability/oauth-alerts/alertmanager/config` | GET/PUT | GET: `owner/auditor`；PUT: `owner` | 读取/更新 Alertmanager 控制面配置（Webhook 自动脱敏） |
| `/api/admin/observability/oauth-alerts/alertmanager/sync` | POST | `owner` | 执行写文件->reload->ready，同步失败自动回滚 |
| `/api/admin/observability/oauth-alerts/alertmanager/sync-history` | GET | `owner/auditor` | 查询同步历史（支持 `page/pageSize`，兼容 `limit=1..200`） |
| `/api/admin/observability/oauth-alerts/alertmanager/sync-history/:historyId/rollback` | POST | `owner` | 按历史记录回滚配置并执行一次同步校验（请求体支持可选 `reason/comment`） |

### 推荐值班流程

1. 在企业管理页“OAuth 告警中心”先执行手动评估，确认 incidents 是否产生。
2. 若命中 incident，优先按 `provider/phase` 联动 `/api/admin/oauth/session-events` 排查根因。
3. 检查 delivery：`success` 为送达成功，`failure` 需按 `responseStatus/error` 排障。
4. 若 `failure.error` 为 `quiet_hours_suppressed/muted_provider/below_min_severity`，先核对抑制策略是否符合值班预期。

> 兼容路径：前端仍可使用 `/api/admin/oauth/alerts/*`，后端会映射到同一套告警处理逻辑。
> 兼容路径同样覆盖规则与 Alertmanager 控制面：`/api/admin/oauth/alerts/rules/*`、`/api/admin/oauth/alertmanager/*`。
> 规则版本 `POST /rules/versions` 支持 `muteWindows`（静默窗口）与 `recoveryPolicy.consecutiveWindows`（恢复连续窗口覆盖）两个可选字段。
> Alertmanager 支持 `POST /alertmanager/sync-history/:historyId/rollback` 执行历史记录回滚，请求体可传 `{ "reason"?: string, "comment"?: string }`；并发执行 `sync/rollback` 时会返回 `409 + alertmanager_sync_in_progress`；推荐先由 `auditor` 核对历史条目，再由 `owner` 执行回滚。
> 弃用窗口：`2026-03-01` 至 `2026-06-30` 为兼容观测期，`2026-07-01` 起仍命中兼容路径建议按 `critical` 处理。

### 关键指标（OAuth 告警中心）

| 指标 | 说明 | 常用分组 |
| ---- | ---- | -------- |
| `tokenpulse_oauth_alert_events_total{result="created"}` | 告警触发速率 | `provider,severity` |
| `tokenpulse_oauth_alert_events_total{result="skipped",reason="dedupe_suppressed"}` | 去重抑制命中 | `provider,phase` |
| `tokenpulse_oauth_alert_delivery_total{status="failure"}` | 投递失败速率 | `provider,channel,reason` |
| `tokenpulse_oauth_alert_delivery_total{status="suppressed"}` | 策略抑制命中 | `provider,reason` |
| `tokenpulse_oauth_alert_evaluation_duration_seconds` | 评估耗时分布 | `result` |

### Critical 升级策略（建议）

1. 连续 5 分钟命中 `critical`：通知当班值班群并开排障工单。
2. 连续 15 分钟仍命中 `critical` 或投递链路失败：升级到 P1（电话或语音拉起）。
3. 若命中抑制策略仍连续触发 `critical`：立即复核静默窗口与 `muteProviders`，必要时临时解除抑制。

### 建议告警分级

| 条件 | 分级 | 处置时限 |
| ---- | ---- | -------- |
| `severity=critical` 且同 provider 连续触发 2 个窗口以上 | P1 | 5 分钟内响应 |
| `severity=warning` 且同 provider 连续出现 3 次以上 | P2 | 30 分钟内处理 |
| `delivery.status=failure` 且非抑制原因连续 5 次以上 | P2 | 15 分钟内修复通知链路 |
| 命中静默抑制后仍持续出现 critical incident | P3 | 当班内确认静默窗口配置 |

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
