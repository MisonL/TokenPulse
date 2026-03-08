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
  "service": "tokenpulse-core",
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

TokenPulse 已内置 Prometheus Exporter (`prom-client`)，指标端点为 `/metrics`，端口与主服务一致（容器内默认 `3000`，`docker compose` 示例映射到宿主 `9009`）。

### Scrape 配置 (prometheus.yml)

```yaml
scrape_configs:
  - job_name: "tokenpulse"
    scrape_interval: 15s
    metrics_path: "/metrics"
    # 生产环境默认 EXPOSE_METRICS=false，此时 /metrics 需要 Bearer API_SECRET。
    # 建议使用 bearer_token_file 注入，避免把密钥写进仓库。
    bearer_token_file: "/etc/prometheus/secrets/tokenpulse_api_secret"
    static_configs:
      - targets: ["host.docker.internal:9009"]
```

说明：

- `bearer_token_file` 文件内容应为 `API_SECRET`（仅一行，不要包含引号/注释）。
- 仓库内 `docker compose --profile monitoring` 示例会挂载 `monitoring/secrets/tokenpulse_api_secret.example` 到该路径；生产环境请替换为真实值并避免提交到 Git。

### 核心指标详情

| 指标名称                                   | 类型      | Labels                                  | 说明               |
| ------------------------------------------ | --------- | --------------------------------------- | ------------------ |
| `tokenpulse_http_requests_total`           | Counter   | `method`, `route`, `status`, `provider` | HTTP 请求总数      |
| `tokenpulse_http_request_duration_seconds` | Histogram | `method`, `route`, `status`, `provider` | 请求耗时分布 (秒)  |
| `tokenpulse_oauth_alert_events_total`      | Counter   | `provider`, `phase`, `severity`, `result`, `reason` | OAuth 告警评估产物 |
| `tokenpulse_oauth_alert_evaluation_duration_seconds` | Histogram | `result` | OAuth 告警评估耗时 |
| `tokenpulse_oauth_alert_delivery_total`    | Counter   | `provider`, `phase`, `severity`, `channel`, `status`, `reason` | OAuth 告警投递状态 |
| `tokenpulse_oauth_alert_delivery_duration_seconds` | Histogram | `provider`, `phase`, `severity`, `channel`, `status` | OAuth 告警投递耗时 |
| `tokenpulse_oauth_alert_compat_route_hits_total` | Counter | `method`, `route` | 兼容路径命中计数（退场观测） |
| `tokenpulse_alertmanager_control_operations_total` | Counter | `operation`, `outcome` | Alertmanager 控制面操作结果（config update / sync / rollback） |
| `tokenpulse_alertmanager_control_operation_duration_seconds` | Histogram | `operation`, `outcome` | Alertmanager 控制面操作耗时 |
| `tokenpulse_alertmanager_control_last_success_timestamp_seconds` | Gauge | `operation` | 最近一次成功 `sync/rollback` 的 Unix 时间戳 |
| `tokenpulse_agentledger_runtime_delivery_total` | Counter | `result`, `reason` | AgentLedger 运行时摘要投递结果 |
| `tokenpulse_agentledger_runtime_delivery_duration_seconds` | Histogram | `result` | AgentLedger 运行时摘要投递耗时 |
| `tokenpulse_agentledger_runtime_replay_total` | Counter | `result` | AgentLedger 手工 replay 结果 |
| `tokenpulse_agentledger_runtime_outbox_backlog` | Gauge | `delivery_state` | AgentLedger outbox 分状态库存 |
| `tokenpulse_agentledger_runtime_open_backlog_total` | Gauge | - | AgentLedger 当前开放积压总量（不含 delivered 历史） |
| `tokenpulse_agentledger_runtime_oldest_open_backlog_age_seconds` | Gauge | - | AgentLedger 最老开放积压年龄（秒） |
| `tokenpulse_agentledger_runtime_last_cycle_timestamp_seconds` | Gauge | - | 最近一次 AgentLedger worker 扫描时间 |
| `tokenpulse_agentledger_runtime_last_success_timestamp_seconds` | Gauge | - | 最近一次 AgentLedger worker 成功投递时间 |
| `tokenpulse_agentledger_runtime_worker_config_state` | Gauge | `state` | AgentLedger worker 配置状态（enabled / delivery_configured） |
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

**兼容路径命中量 (5m)**:

```promql
sum(increase(tokenpulse_oauth_alert_compat_route_hits_total[5m])) by (method, route)
```

**兼容路径 TopN (24h)**:

```promql
topk(10, sum by (method, route) (increase(tokenpulse_oauth_alert_compat_route_hits_total[24h])))
```

**Alertmanager sync/rollback 失败量 (5m)**:

```promql
sum by (operation, outcome) (
  increase(tokenpulse_alertmanager_control_operations_total{operation=~"sync|rollback", outcome=~"sync_error|internal_error|conflict"}[5m])
)
```

**Alertmanager 超过 24 小时未成功同步**:

```promql
time() - max by (operation) (
  tokenpulse_alertmanager_control_last_success_timestamp_seconds{operation="sync"}
)
```

## Compat 退场观测

### 观测范围

- `tokenpulse_oauth_alert_compat_route_hits_total` 只覆盖兼容管理入口：
  - `/api/admin/oauth/alerts/*`
  - `/api/admin/oauth/alertmanager/*`
- 服务端 compat 行为由 `OAUTH_ALERT_COMPAT_MODE` 控制：
  - `observe`：兼容路径继续返回原业务结果，但会追加 `Deprecation` / `Sunset` / `Link` 响应头，并在 JSON 响应体顶层补 `deprecated=true`、`successorPath`。
  - `enforce`：兼容路径统一返回 `410 Gone`，不再执行业务逻辑；compat counter 仍会累加，便于确认是否还有遗留调用。
- 该指标不覆盖旧 `/api/credentials/auth/*` 路径；后者已由中间件直接返回 `410 Gone`，兼容窗口信息见响应体中的 `deprecatedSince=2026-03-01`、`compatibilityWindowEnd=2026-06-30`、`criticalAfter=2026-07-01`。
- `method` 为真实 HTTP 方法；`route` 为内部归一化键，用于快速定位仍在访问旧入口的功能面。

| `route` 标签 | 对应兼容入口 |
| ------------ | ------------ |
| `oauth_alerts.config` | `/api/admin/oauth/alerts/config` |
| `oauth_alerts.incidents` / `oauth_alerts.deliveries` | `/api/admin/oauth/alerts/incidents`、`/api/admin/oauth/alerts/deliveries` |
| `oauth_alerts.evaluate` / `oauth_alerts.test_delivery` | `/api/admin/oauth/alerts/evaluate`、`/api/admin/oauth/alerts/test-delivery` |
| `oauth_alerts.rules_active` / `oauth_alerts.rules_versions` / `oauth_alerts.rules_rollback` | `/api/admin/oauth/alerts/rules/*` |
| `oauth_alertmanager.config` / `oauth_alertmanager.sync` | `/api/admin/oauth/alertmanager/config`、`/api/admin/oauth/alertmanager/sync` |
| `oauth_alertmanager.sync_history` / `oauth_alertmanager.sync_history_rollback` | `/api/admin/oauth/alertmanager/sync-history*` |

### 观测 / 定位 / 升级流程

1. 观测：
   - 发布窗口、值班交接、兼容窗口周检时都执行上面的 `5m` 与 `24h` 查询。
   - 也可直接运行脚本：

```bash
./scripts/release/check_oauth_alert_compat.sh \
  --prometheus-url "http://127.0.0.1:9090" \
  --mode observe
```

   - 目标值是 `0`；`frontend/src` 与 `scripts/` 已有 `test/oauth-alert-compat-guard.test.ts` 护栏，仓库内一方调用理论上应已清零。
2. 定位：
   - 先按 `route` 判断是配置页、规则、incident/delivery，还是 Alertmanager 控制面残留调用。
   - 再按时间窗口核对当班发布证据、反向代理访问日志、浏览器 Network 记录、外部自动化任务或旧书签。
   - 指标本身不携带 `traceId`；若可复现，请直接用兼容入口重放并保留响应中的 `traceId`，再去 `/api/admin/audit/events`、`/api/admin/oauth/session-events*` 继续追查。
3. 升级：
   - 兼容窗口内（`2026-03-01` 到 `2026-06-30`）首次命中：由 `auditor` 记录 `method/route/时间窗口/疑似来源/处置人`，由 `owner` 跟进调用方迁移。
   - 若确认来自仓库内回归、已发布前端静态资源回退、或当前发布窗口内持续重复命中：当班直接升级为发布阻断项，修复后再继续切流。
   - `2026-07-01` 起仍有命中：按 `critical` 事件处理，默认视为未完成退场或存在未登记外部调用。

### 自动化与人工边界

| 类别 | 仓库内自动化 | 必须人工完成 |
| ---- | ------------ | ------------ |
| 指标采集 | 兼容入口会自动累加 `tokenpulse_oauth_alert_compat_route_hits_total` | 无 |
| compat 响应提示 | `observe` 模式会自动附带 `Deprecation` / `Sunset` / `Link` 与 `deprecated/successorPath` | 调用方按 `successorPath` 完成迁移 |
| 仓库内残留防回归 | `test/oauth-alert-compat-guard.test.ts` 阻止 `frontend/src` 与 `scripts/` 继续引用兼容入口 | 无 |
| 发布前快速观测 | `scripts/release/check_oauth_alert_compat.sh --prometheus-url ...` 可汇总 `5m/24h` 命中并在 `strict` / `critical-after` 下阻断 | 判断 Prometheus 地址、调用方归因与是否继续切流 |
| 调用方归因 | 无 | 根据 `route`、日志、书签、外部脚本、值班记录确认真实来源 |
| 退场决策 | 无 | `owner` / `auditor` 判断是继续观察、切换 `OAUTH_ALERT_COMPAT_MODE=enforce`、修复发布、还是按 `critical` 升级 |

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

1. 准备监控配置文件，并明确三类用途：
   - 仓库示例配置：
     - `monitoring/alertmanager.yml`
     - `monitoring/alertmanager.slack.example.yml`
     - `monitoring/alertmanager.wecom.example.yml`
     - 这些文件只用于语法示例与字段说明，保留 `example.invalid` 或占位值，不能直接用于发布。
   - 本地演练配置：
     - `monitoring/alertmanager.webhook.local.example.yml`
     - 只允许打到本机 `webhook sink`，用于本地演练，不允许带入发布窗口。
   - 生产注入配置：
     - 仓库模板：`monitoring/runtime/alertmanager.prod.example.yml`
     - 通过 Secret Manager、部署平台或 CI/CD 在运行时生成，例如 `monitoring/runtime/alertmanager.prod.yml`。
     - `ALERTMANAGER_CONFIG_PATH` 在发布前必须指向这类未纳入版本控制的生产文件。
   - 模板目录：
     - `ALERTMANAGER_TEMPLATES_PATH` 默认可指向 `monitoring/alertmanager-templates/`，也可指向部署后的模板副本目录。
2. 发布前先执行离线预检（必须）：

```bash
ALERTMANAGER_CONFIG_PATH=./monitoring/runtime/alertmanager.prod.yml \
ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates \
  ./scripts/release/preflight_alertmanager_config.sh
```

该预检会检查：

- `ALERTMANAGER_CONFIG_PATH` 是否存在且为文件。
- `ALERTMANAGER_TEMPLATES_PATH` 是否存在且为目录。
- 配置中是否仍含 `example.invalid`、`example.com`、`example.local`、本地 webhook sink、空 URL、`REPLACE_WITH` / `REPLACE_ME` / `CHANGE_ME` / `TODO` 等明显占位值。

3. 语法校验（推荐在发布前执行）：

```bash
docker run --rm --entrypoint promtool \
  -v "$PWD/monitoring:/etc/prometheus:ro" \
  prom/prometheus:v2.53.2 check config /etc/prometheus/prometheus.yml

docker run --rm --entrypoint promtool \
  -v "$PWD/monitoring:/etc/prometheus:ro" \
  prom/prometheus:v2.53.2 check rules /etc/prometheus/alert_rules.yml

docker run --rm --entrypoint amtool \
  -v "$PWD/monitoring:/etc/alertmanager:ro" \
  prom/alertmanager:v0.28.1 check-config /etc/alertmanager/runtime/alertmanager.prod.yml

# 校验其他示例配置（任选其一）
docker run --rm --entrypoint amtool \
  -v "$PWD/monitoring:/etc/alertmanager:ro" \
  prom/alertmanager:v0.28.1 check-config /etc/alertmanager/alertmanager.slack.example.yml

docker run --rm --entrypoint amtool \
  -v "$PWD/monitoring:/etc/alertmanager:ro" \
  prom/alertmanager:v0.28.1 check-config /etc/alertmanager/alertmanager.wecom.example.yml

docker run --rm --entrypoint amtool \
  -v "$PWD/monitoring:/etc/alertmanager:ro" \
  prom/alertmanager:v0.28.1 check-config /etc/alertmanager/alertmanager.webhook.local.example.yml
```

> 本节默认示例以“发布前校验运行时生产文件”为准；若只是本地 webhook sink 演练，可仅校验 `alertmanager.webhook.local.example.yml`。

4. 启动监控 profile 并加载配置：

```bash
# 仓库默认值会挂载 monitoring/alertmanager.webhook.local.example.yml，仅用于本地 webhook sink 演练，不可直接用于发布
docker compose --profile monitoring up -d prometheus alertmanager

# 本地演练：切换到 webhook sink 示例配置
ALERTMANAGER_CONFIG_PATH=./monitoring/alertmanager.webhook.local.example.yml \
  docker compose --profile monitoring up -d prometheus alertmanager

# 生产发布：显式指向运行时注入的生产配置文件
ALERTMANAGER_CONFIG_PATH=./monitoring/runtime/alertmanager.prod.yml \
ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates \
  docker compose --profile monitoring up -d prometheus alertmanager
```

#### 本地演练：不发真实通知（webhook sink）

1. 启动本机 webhook sink（默认监听 `18080`）：

```bash
bun run monitoring:webhook-sink
```

2. 选择本地 webhook 示例配置启动 Alertmanager：

```bash
ALERTMANAGER_CONFIG_PATH=./monitoring/alertmanager.webhook.local.example.yml \
  docker compose --profile monitoring up -d prometheus alertmanager
```

说明：该配置仅用于本机演练，`preflight_alertmanager_config.sh` 会在发布前拒绝它。

3. 用 amtool 人工发一条测试告警（不会发到真实渠道，只会打到本机 sink）：

```bash
docker exec tokenpulse-alertmanager amtool \
  --alertmanager.url=http://127.0.0.1:9093 \
  alert add \
  alertname="LocalDrill" severity="warning" service="tokenpulse" provider="manual" \
  --annotation summary="本地演练" \
  --annotation description="这是一条不会发到真实通知渠道的测试告警"
```

预期：`monitoring:webhook-sink` 的输出里能看到 `POST /alertmanager/...` 的 JSON 内容。

5. 进入生产窗口前，由平台 / 值班负责人完成人工替换与双人复核：

- `warning`、`critical`、`P1` 三类 Secret 引用必须分别指向真实值班通道；禁止全部落到同一测试群、本地 sink 或 `example.*` 域名。
- `warning` 通道用于当班群 / 值班 IM；`critical` 通道用于需要立即关注的真实升级群；`P1` 通道必须对应真实电话、语音或 PagerDuty / Opsgenie 一类叫醒链路。
- 变更单 / 值班工单中至少登记：Secret 引用名、通道用途、值班负责人、回滚目标、预计演练时间窗。
- 若当前存在真实 P1、通道负责人未确认、静默窗口会吞掉演练通知，或未获当班批准，不执行真实链路演练。

6. 通过发布脚本读取 Secret Manager 并完成 Alertmanager config + sync：

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
  --config-template "./monitoring/alertmanager.yml" \
  --secret-helper "/usr/local/bin/read-alertmanager-secret" \
  --comment "monitoring release publish"
```

说明：

- `--secret-helper` 调用约定为 `<helper> <secret_ref>`，stdout 必须只输出 webhook URL。
- `--config-template` 默认就是 `./monitoring/alertmanager.yml`；发布脚本会先在本地渲染这份仓库基线，再把最终 JSON 推到控制面。
- 仓库已提供 env-backed helper 模板：`scripts/release/read_alertmanager_secret_from_env.example.sh`。
- 若未启用 `ADMIN_TRUST_HEADER_AUTH=true`（或不在可信代理链路），发布窗口可改用 `RW_OWNER_COOKIE` / `RW_AUDITOR_COOKIE`，并省略 header 模式的 user/role 参数。
- 脚本会拒绝 Secret 引用名中的非法字符，避免命令模板替换后出现注入风险。
- 脚本会拒绝解析后仍指向 `example.invalid` / `example.com` / `localhost` / `127.0.0.1` / `host.docker.internal` 的 webhook URL，防止把演练地址误下发到发布窗口。
- `preflight_release_window_oauth_alerts.sh` 现在也会调用同一套渲染逻辑先产出临时 YAML 再做文件预检，因此预检与实际发布的 Alertmanager 基线完全一致。
- `--secret-cmd-template` 仍可兼容旧流程，但已弃用，且不再通过 `bash -lc` 执行任意模板。

7. 执行 OAuth 告警升级演练脚本：

```bash
./scripts/release/drill_oauth_alert_escalation.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "oncall-bot" \
  --admin-role "owner"
```

8. 记录生产演练证据（`auditor` 先核对历史，`owner` 负责必要回滚；推荐直接保留 `release_window_oauth_alerts.sh --evidence-file` 的产物）：

```bash
RUN_TAG="release-window-20260306T020000Z"
WINDOW_FROM="2026-03-06T02:00:00Z"

curl -sS "http://127.0.0.1:9009/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=1" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: oncall-auditor" \
  -H "x-admin-role: auditor"

curl -G "http://127.0.0.1:9009/api/admin/audit/events" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: oncall-auditor" \
  -H "x-admin-role: auditor" \
  --data-urlencode "action=oauth.alert.alertmanager.sync" \
  --data-urlencode "keyword=${RUN_TAG}" \
  --data-urlencode "from=${WINDOW_FROM}" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=5"
```

说明：

- `sync-history` 用于确认 `historyId/historyReason`，不应直接当作 `traceId` 证据源。
- `traceId` 应结合 `/api/admin/audit/events` 或直接从 `release_window_oauth_alerts.sh --evidence-file` 中提取。
- 若执行 `rollback`，`release_window_oauth_alerts.sh --evidence-file` 的顶层 `traceId` 会优先采用 rollback 接口返回值，并同时保留 `rollbackTraceId`；即使 rollback 失败，也要把该 `traceId` 留作排障锚点。
- 若演练命中升级，证据里还应保留 `incidentId`、`incidentCreatedAt`，方便继续联动 `incidents` / `deliveries` 排障。
- `warning-secret-ref`、`critical-secret-ref`、`p1-secret-ref` 必须分别映射到不同真实通道，不得复用同一 Secret ref；真实 webhook URL 只能由 Secret Manager / helper 在运行时注入。
- 自动化证据最小字段固定为 `historyId`、`historyReason`、`traceId`、`drillExitCode`、`rollbackResult`、`incidentId`；即使未命中升级，证据结构中也应保留 `incidentId` 字段。

建议至少记录两类证据：

- 自动化证据：`historyId`、`historyReason`、`traceId`、`incidentId`（若命中升级）、`incidentCreatedAt`（若命中升级）、执行人（owner/auditor）、窗口时间、演练退出码、回滚结论；若执行 rollback，还需记录 `rollbackTraceId`、`rollbackHttpCode`，失败时再追加 `rollbackError`。
- 人工证据：真实值班群消息截图或消息 ID、Pager / 电话系统事件号、接收人确认时间、值班工单编号。只有自动化证据而没有真实接收确认，不能算“真实链路演练完成”。

### 真实值班通道替换与真实链路演练边界

| 类别 | 仓库内自动化 | 必须生产人工完成 |
| ---- | ------------ | ---------------- |
| 文件 / 参数预检 | `preflight_alertmanager_config.sh`、`preflight_release_window_oauth_alerts.sh` 校验配置、参数与占位值 | 无 |
| Secret 读取与 sync | `publish_alertmanager_secret_sync.sh` 读取 helper、更新配置并执行 sync | 真实 Secret 引用创建、授权、轮换、删除 |
| 演练结论 | `drill_oauth_alert_escalation.sh` / `release_window_oauth_alerts.sh` 输出 `drillExitCode`、`historyReason`、`traceId`、可选 rollback 证据 | 判断是否进入真实窗口、是否继续、是否需要人工终止 |
| 真实通知送达 | 无 | 确认 warning / critical / P1 通道真实收到、有人响应、必要时人工挂断 / 关闭演练事件 |
| 责任闭环 | 无 | `owner` 执行变更与回滚，`auditor` 复核 history/evidence，通道负责人确认接收，值班经理批准窗口 |

### 验证

- `http://127.0.0.1:9090/-/ready` 与 `http://127.0.0.1:9093/-/ready` 返回 `200`。
- `/metrics` 中存在 `tokenpulse_oauth_alert_events_total`、`tokenpulse_oauth_alert_delivery_total`、`tokenpulse_alertmanager_control_operations_total`，以及 `tokenpulse_agentledger_runtime_open_backlog_total` / `tokenpulse_agentledger_runtime_last_cycle_timestamp_seconds`。
- 真实链路演练时，`warning` / `critical` / `P1` 中本次目标通道至少有一条人工确认回执；仅有脚本成功或 `sync-history` 成功不算真实送达。
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
| `/api/admin/observability/oauth-alerts/rules/versions` | POST | `owner` | 创建规则版本（支持 `muteWindows/recoveryPolicy`，冲突返回 `409`） |
| `/api/admin/observability/oauth-alerts/rules/versions/:versionId/rollback` | POST | `owner` | 回滚并激活指定规则版本 |
| `/api/admin/observability/oauth-alerts/alertmanager/config` | GET/PUT | GET: `owner/auditor`；PUT: `owner` | 读取/更新 Alertmanager 控制面配置（Webhook 自动脱敏） |
| `/api/admin/observability/oauth-alerts/alertmanager/sync` | POST | `owner` | 执行写文件->reload->ready，同步失败自动回滚 |
| `/api/admin/observability/oauth-alerts/alertmanager/sync-history` | GET | `owner/auditor` | 查询同步历史（支持 `page/pageSize`，兼容 `limit=1..200`） |
| `/api/admin/observability/oauth-alerts/alertmanager/sync-history/:historyId/rollback` | POST | `owner` | 按历史记录回滚配置并执行一次同步校验（请求体支持可选 `reason/comment`） |

### Alertmanager sync/rollback 状态码判定

| 状态码 | `POST /alertmanager/sync` | `POST /alertmanager/sync-history/:historyId/rollback` | 值班动作 |
| ---- | ---- | ---- | ---- |
| `400` | JSON 参数校验失败；或请求未带可解析 `config` 且当前无已存配置（`缺少可同步的 Alertmanager 配置`） | JSON 参数校验失败；或 `historyId` 为空/非法（`historyId 非法`） | 修正参数后重试，不做回滚决策。 |
| `404` | 无该业务判定（此接口业务异常不返回 `404`） | `historyId` 不存在，或该历史记录缺少可回滚配置（`目标同步历史不存在或缺少可回滚配置`） | 先用 `sync-history` 复核条目，再选择有效 `historyId`。 |
| `409` | 并发锁冲突，响应 `code=alertmanager_sync_in_progress` | 并发锁冲突，响应 `code=alertmanager_sync_in_progress` | 视为“已有任务在跑”，等待后重试，避免并发触发。 |
| `500` | 同步执行失败；若属于同步失败分支，响应含 `rollbackSucceeded/rollbackError` | 回滚触发的同步失败；若属于同步失败分支，响应含 `rollbackSucceeded/rollbackError` | 立即保留 `traceId` 与错误体；若是 release window 编排产物，还要确认 `rollbackTraceId` 与 `rollbackError` 已写入 evidence。 |

### 推荐值班流程

1. 在企业管理页“OAuth 告警中心”先执行手动评估，确认 incidents 是否产生。
2. 若命中 incident，优先按 `provider/phase` 联动 `/api/admin/oauth/session-events` 排查根因。
3. 检查 delivery：`success` 为送达成功，`failure` 需按 `responseStatus/error` 排障。
4. 若 `failure.error` 为 `quiet_hours_suppressed/muted_provider/below_min_severity`，先核对抑制策略是否符合值班预期。
5. 若 compat 指标在当前窗口 `>0`，按上文“Compat 退场观测”流程记录来源、责任人与升级结论，不把它混同为告警投递故障。

> 兼容路径：后端仍兼容 `/api/admin/oauth/alerts/*`，但新开发与前端默认必须使用 `/api/admin/observability/oauth-alerts/*`。
> 兼容路径同样覆盖规则与 Alertmanager 控制面：`/api/admin/oauth/alerts/rules/*`、`/api/admin/oauth/alertmanager/*`。
> 兼容路径命中会累计到 `tokenpulse_oauth_alert_compat_route_hits_total{method,route}`，用于灰度期观察遗留调用量。
> `OAUTH_ALERT_COMPAT_MODE=observe` 时，兼容入口响应会附带 `Deprecation` / `Sunset` / `Link`，并在 JSON 响应体补 `deprecated=true`、`successorPath`；切到 `enforce` 后兼容入口统一返回 `410 Gone`。
> 规则版本 `POST /rules/versions` 支持 `muteWindows`（静默窗口）与 `recoveryPolicy.consecutiveWindows`（恢复连续窗口覆盖）两个可选字段。冲突返回 `409`，响应体字段为 `{ error, code, details? }`，`code` 取值为 `oauth_alert_rule_version_already_exists` 或 `oauth_alert_rule_mute_window_conflict`。
> Alertmanager 支持 `POST /alertmanager/sync-history/:historyId/rollback` 执行历史记录回滚，请求体可传 `{ "reason"?: string, "comment"?: string }`；`sync/rollback` 成功返回 `{ success, data, traceId }`（`rollback` 的 `data` 额外包含 `sourceHistoryId`），异常判定见上表。推荐先由 `auditor` 核对历史条目，再由 `owner` 执行回滚；无论 success/failure，都应把 rollback 响应中的 `traceId` 留在证据里。
> 企业控制台默认使用结构化表单维护“规则版本管理”和“Alertmanager 同步”两块高频配置；只有在需要编辑复杂规则 DSL 或复杂 Alertmanager 路由树时，才切换到“高级 JSON”模式。
> 控制台中的失败提示会直接展示 `traceId`，便于跳转 `Audit` / `session-events` 继续追查。Alertmanager 已保存配置中的 Webhook URL 会按控制面规则自动脱敏；若在结构化模式下再次保存，必须重新输入真实 URL。
> 弃用窗口：`2026-03-01` 至 `2026-06-30` 为兼容观测期，`2026-07-01` 起仍命中兼容路径建议按 `critical` 处理。
> `monitoring/alertmanager-templates/tokenpulse.tmpl` 当前会把 `category`、`escalation` 与 `details` 带入通知正文；AgentLedger 告警命中后，值班消息里应直接出现 `delivery_configured`、`last_cycle_stale_seconds`、`oldest_open_backlog_age_seconds` 或 `replay_required_count` 等诊断字段。

### 关键指标（OAuth 告警中心）

| 指标 | 说明 | 常用分组 |
| ---- | ---- | -------- |
| `tokenpulse_oauth_alert_events_total{result="created"}` | 告警触发速率 | `provider,severity` |
| `tokenpulse_oauth_alert_events_total{result="skipped",reason="dedupe_suppressed"}` | 去重抑制命中 | `provider,phase` |
| `tokenpulse_oauth_alert_delivery_total{status="failure"}` | 投递失败速率 | `provider,channel,reason` |
| `tokenpulse_oauth_alert_delivery_total{status="suppressed"}` | 策略抑制命中 | `provider,reason` |
| `tokenpulse_oauth_alert_evaluation_duration_seconds` | 评估耗时分布 | `result` |
| `tokenpulse_alertmanager_control_operations_total{operation="sync"}` | Alertmanager sync 结果 | `outcome` |
| `tokenpulse_alertmanager_control_operations_total{operation="rollback"}` | Alertmanager rollback 结果 | `outcome` |
| `tokenpulse_alertmanager_control_last_success_timestamp_seconds{operation="sync"}` | 最近一次成功 sync 时间 | `operation` |
| `tokenpulse_agentledger_runtime_open_backlog_total` | AgentLedger 开放积压总量 | - |
| `tokenpulse_agentledger_runtime_oldest_open_backlog_age_seconds` | AgentLedger 最老开放积压年龄 | - |
| `tokenpulse_agentledger_runtime_last_cycle_timestamp_seconds` | AgentLedger worker 最近扫描时间 | - |
| `tokenpulse_agentledger_runtime_last_success_timestamp_seconds` | AgentLedger worker 最近成功投递时间 | - |
| `tokenpulse_agentledger_runtime_outbox_backlog{delivery_state="replay_required"}` | 需人工 replay 的积压 | `delivery_state` |

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
| AgentLedger worker 已启用但 `delivery_configured=0` 持续 5 分钟 | P2 | 15 分钟内补齐 ingest URL / 签名密钥 |
| AgentLedger worker 超过 5 分钟无心跳 | P2 | 15 分钟内恢复调度器 |
| AgentLedger `open_backlog_total>0` 且最老积压超过 5 分钟 | P2 | 15 分钟内确认下游与重试链路 |
| AgentLedger `replay_required` 积压持续存在 | P2 | 15 分钟内进入控制面执行人工 replay |

> 若 `replay_required` 告警触发且企业控制面暂不可用，可改走 `./scripts/release/replay_agentledger_outbox.sh --base-url ... --api-secret ... --ids ... --evidence-file ./artifacts/agentledger-outbox-replay-evidence.json`，按 outbox id 批量 replay 并留档 evidence。

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
