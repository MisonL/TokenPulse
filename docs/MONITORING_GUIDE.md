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
- 配置中是否仍含 `example.invalid`、`example.com`、本地 webhook sink、空 URL、`REPLACE_WITH` 等明显占位值。

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

5. 通过发布脚本读取 Secret Manager 并完成 Alertmanager config + sync：

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
  --secret-helper "/usr/local/bin/read-alertmanager-secret" \
  --comment "monitoring release publish"
```

说明：

- `--secret-helper` 调用约定为 `<helper> <secret_ref>`，stdout 必须只输出 webhook URL。
- 仓库已提供 env-backed helper 模板：`scripts/release/read_alertmanager_secret_from_env.example.sh`。
- 若未启用 `ADMIN_TRUST_HEADER_AUTH=true`（或不在可信代理链路），发布窗口可改用 `RW_OWNER_COOKIE` / `RW_AUDITOR_COOKIE`，并省略 header 模式的 user/role 参数。
- 脚本会拒绝 Secret 引用名中的非法字符，避免命令模板替换后出现注入风险。
- 脚本会拒绝解析后仍指向 `example.invalid` / `example.com` / `localhost` / `127.0.0.1` / `host.docker.internal` 的 webhook URL，防止把演练地址误下发到发布窗口。
- `--secret-cmd-template` 仍可兼容旧流程，但已弃用，且不再通过 `bash -lc` 执行任意模板。

6. 执行 OAuth 告警升级演练脚本：

```bash
./scripts/release/drill_oauth_alert_escalation.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "oncall-bot" \
  --admin-role "owner"
```

7. 记录生产演练证据（`auditor` 先核对历史，`owner` 负责必要回滚；推荐直接保留 `release_window_oauth_alerts.sh --evidence-file` 的产物）：

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

建议至少记录：`historyId`、`historyReason`、`traceId`、`incidentId`（若命中升级）、`incidentCreatedAt`（若命中升级）、执行人（owner/auditor）、窗口时间、演练退出码、回滚结论；若执行 rollback，还需记录 `rollbackTraceId`、`rollbackHttpCode`，失败时再追加 `rollbackError`。

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

> 兼容路径：后端仍兼容 `/api/admin/oauth/alerts/*`，但新开发与前端默认必须使用 `/api/admin/observability/oauth-alerts/*`。
> 兼容路径同样覆盖规则与 Alertmanager 控制面：`/api/admin/oauth/alerts/rules/*`、`/api/admin/oauth/alertmanager/*`。
> 兼容路径命中会累计到 `tokenpulse_oauth_alert_compat_route_hits_total{method,route}`，用于灰度期观察遗留调用量。
> 规则版本 `POST /rules/versions` 支持 `muteWindows`（静默窗口）与 `recoveryPolicy.consecutiveWindows`（恢复连续窗口覆盖）两个可选字段。冲突返回 `409`，响应体字段为 `{ error, code, details? }`，`code` 取值为 `oauth_alert_rule_version_already_exists` 或 `oauth_alert_rule_mute_window_conflict`。
> Alertmanager 支持 `POST /alertmanager/sync-history/:historyId/rollback` 执行历史记录回滚，请求体可传 `{ "reason"?: string, "comment"?: string }`；`sync/rollback` 成功返回 `{ success, data, traceId }`（`rollback` 的 `data` 额外包含 `sourceHistoryId`），异常判定见上表。推荐先由 `auditor` 核对历史条目，再由 `owner` 执行回滚；无论 success/failure，都应把 rollback 响应中的 `traceId` 留在证据里。
> 企业控制台默认使用结构化表单维护“规则版本管理”和“Alertmanager 同步”两块高频配置；只有在需要编辑复杂规则 DSL 或复杂 Alertmanager 路由树时，才切换到“高级 JSON”模式。
> 控制台中的失败提示会直接展示 `traceId`，便于跳转 `Audit` / `session-events` 继续追查。Alertmanager 已保存配置中的 Webhook URL 会按控制面规则自动脱敏；若在结构化模式下再次保存，必须重新输入真实 URL。
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
