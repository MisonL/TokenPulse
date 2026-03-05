# TokenPulse 生产环境配置清单

## 必需环境变量

| 变量名       | 说明         | 默认值                  | 生产要求                        |
| ------------ | ------------ | ----------------------- | ------------------------------- |
| `API_SECRET` | API 访问密钥 | (开发环境有默认值)      | ⚠️ **必须设置强密钥** (≥32字符) |
| `NODE_ENV`   | 运行环境     | `development`           | **必须设为 `production`**       |
| `PORT`       | 服务端口     | `3000`                  | 建议保持默认                    |
| `BASE_URL`   | 公网访问地址 | `http://localhost:3000` | 设置为实际部署域名              |

## 安全相关变量

| 变量名                     | 说明           | 默认值      | 生产要求                        |
| -------------------------- | -------------- | ----------- | ------------------------------- |
| `TRUST_PROXY`              | 信任代理层     | `false`     | 在 Nginx/LB 后部署时设为 `true` |
| `UNSAFE_DISABLE_TLS_CHECK` | 禁用 TLS 校验  | `undefined` | ⛔ **生产环境禁止设置**         |
| `ENCRYPTION_SECRET`        | 数据库加密密钥 | (无)        | ⚠️ **必须设置强密钥**(≥32字符)  |

## 企业域/组织域变量（双服务）

| 变量名                   | 说明                     | 默认值                    | 生产要求 |
| ------------------------ | ------------------------ | ------------------------- | -------- |
| `ENABLE_ADVANCED`        | 高级版总开关             | `false`                   | 组织域上线时必须为 `true` |
| `ENTERPRISE_BASE_URL`    | Core 转发到 enterprise 地址 | `http://127.0.0.1:9010` | 指向 enterprise 内网地址 |
| `ENTERPRISE_SHARED_KEY`  | Core/enterprise 内部鉴权密钥 | (无)                    | 建议强随机密钥，双端一致 |
| `ENTERPRISE_PROXY_TIMEOUT_MS` | Core 转发 enterprise 超时 | `5000`               | 建议按内网 RTT 调整（通常 3000-10000） |
| `ADMIN_TRUST_HEADER_AUTH` | 管理端头部透传鉴权开关   | `false`                   | 仅在可信反向代理链路启用 |

## OAuth 提供商配置

| 变量名                      | 用途                     | 必需性     |
| --------------------------- | ------------------------ | ---------- |
| `ANTIGRAVITY_CLIENT_ID`     | Google Antigravity OAuth | 使用时必需 |
| `ANTIGRAVITY_CLIENT_SECRET` | Google Antigravity OAuth | 使用时必需 |
| `GEMINI_CLIENT_ID`          | Google Gemini OAuth      | 使用时必需 |
| `GEMINI_CLIENT_SECRET`      | Google Gemini OAuth      | 使用时必需 |
| `CLAUDE_CLIENT_ID`          | Anthropic Claude OAuth   | 使用时必需 |
| `IFLOW_CLIENT_ID`           | iFlow OAuth              | 使用时必需 |
| `IFLOW_CLIENT_SECRET`       | iFlow OAuth              | 使用时必需 |

## 网络配置

| 变量名           | 说明           | 默认值                                 |
| ---------------- | -------------- | -------------------------------------- |
| `HTTP_PROXY`     | HTTP 代理      | (无)                                   |
| `HTTPS_PROXY`    | HTTPS 代理     | (无)                                   |
| `KIRO_ENDPOINT`  | Kiro OIDC 端点 | `https://oidc.us-east-1.amazonaws.com` |
| `KIRO_START_URL` | Kiro 起始 URL  | `https://view.awsapps.com/start`       |

## 数据持久化

| 变量名              | 说明              | 默认值                |
| ------------------- | ----------------- | --------------------- |
| `DATABASE_URL`      | PostgreSQL 连接串 | `postgresql://tokenpulse:***@db:5432/tokenpulse` |
| `ENCRYPTION_SECRET` | 数据库加密密钥    | (无)                  |

## 生产部署检查清单

### 启动前检查

- [ ] `API_SECRET` 已设置为强随机密钥 (≥32字符)
- [ ] `NODE_ENV=production` 已设置
- [ ] `BASE_URL` 指向正确的公网地址
- [ ] 如在代理后部署，`TRUST_PROXY=true` 已设置
- [ ] `UNSAFE_DISABLE_TLS_CHECK` **未设置**
- [ ] `ENCRYPTION_SECRET` 已设置为强随机密钥 (≥32字符)
- [ ] 数据卷 `./data` 已挂载并有写权限
- [ ] 组织域上线时：`ENABLE_ADVANCED=true`
- [ ] 组织域上线时：`ENTERPRISE_BASE_URL` 指向可达的 enterprise 服务
- [ ] 组织域上线时：`ENTERPRISE_SHARED_KEY` 已在 Core 与 Enterprise 同步
- [ ] 组织域上线时：已准备可回切的上一版本 enterprise 地址或镜像
- [ ] 双服务发布顺序已确认为“先 enterprise，后 core”
- [ ] OAuth 告警配置已核对：`minDeliverySeverity`、`muteProviders`、`quietHours*`

### 启动后验证

```bash
# Core/Enterprise 健康检查
curl http://localhost:9009/health
curl http://localhost:9010/health

# 高级版与企业后端探针（核心检查项）
curl http://localhost:9009/api/admin/features

# 公开端点检查
curl http://localhost:9009/api/credentials/status

# 受保护端点检查 (应返回 401)
curl http://localhost:9009/api/models

# 组织域读写 smoke（自动创建并自动回收）
./scripts/release/smoke_org.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "prod-checker" \
  --admin-role "owner" \
  --org-prefix "prod-smoke"

# 企业域边界回归最小检查（权限边界/绑定冲突/traceId 追溯/自动清理）
./scripts/release/check_enterprise_boundary.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "prod-checker" \
  --admin-role "owner" \
  --auditor-user "prod-auditor" \
  --auditor-role "auditor" \
  --case-prefix "prod-boundary"
```

说明：若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请先通过 `/api/admin/auth/login` 获取管理员会话；`check_enterprise_boundary.sh` 需同时传入 `--owner-cookie` 与 `--auditor-cookie`。

判定标准：

- [ ] `/health` 返回 `status=ok`
- [ ] `/api/admin/features` 返回 `features.enterprise=true`
- [ ] `/api/admin/features` 返回 `enterpriseBackend.reachable=true`
- [ ] `GET /api/org/organizations` 不返回 `ADVANCED_DISABLED_READONLY`
- [ ] 组织域写接口返回 `success=true` 且响应包含 `traceId`
- [ ] `GET /api/admin/observability/oauth-alerts/config` 可读，且阈值/静默配置符合当班策略

## 发布灰度收口（四段式）

### 目的

- 将灰度切流检查流程脚本化，减少人工 curl 漏项。
- 固化组织域上线必检项：高级版探针、组织域只读、组织域写入 smoke、企业域边界最小回归。

### 步骤

- [ ] 赋权脚本：`chmod +x scripts/release/*.sh`
- [ ] 切流前执行 `pre` gate（`with-boundary=auto` 默认执行边界检查，建议 `with-smoke=false`）：

```bash
./scripts/release/canary_gate.sh \
  --phase pre \
  --active-base-url "http://core-stable.internal:9009" \
  --candidate-base-url "http://core-canary.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner" \
  --auditor-user "release-auditor" \
  --auditor-role "auditor" \
  --with-boundary auto \
  --with-smoke false
```

- [ ] 切流后执行 `post` gate（默认 `with-smoke=true`、`with-boundary=false`）：

```bash
./scripts/release/canary_gate.sh \
  --phase post \
  --active-base-url "http://core-stable.internal:9009" \
  --candidate-base-url "http://core-canary.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner"
```

- [ ] 如需切流后复核边界，追加执行 `post + with-boundary=true`：

```bash
./scripts/release/canary_gate.sh \
  --phase post \
  --active-base-url "http://core-stable.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner" \
  --auditor-user "release-auditor" \
  --auditor-role "auditor" \
  --with-smoke false \
  --with-boundary true
```

- [ ] 必要时单独执行发布 smoke：

```bash
./scripts/release/smoke_org.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner" \
  --org-prefix "release-smoke"
```

- [ ] 发布主路径优先走 `canary_gate.sh` 联动边界；仅在值班接管或排障时单独执行 `check_enterprise_boundary.sh`。

说明：若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，`canary_gate.sh` 在边界检查场景需同时提供 `--cookie`（owner）与 `--auditor-cookie`（auditor）；`smoke_org.sh` 仅需 `--cookie`。

```bash
./scripts/release/canary_gate.sh \
  --phase pre \
  --active-base-url "http://core-stable.internal:9009" \
  --candidate-base-url "http://core-canary.internal:9009" \
  --api-secret "$API_SECRET" \
  --cookie "tp_admin_session=<owner-session-id>" \
  --auditor-cookie "tp_admin_session=<auditor-session-id>" \
  --with-smoke false \
  --with-boundary true
```

### 验证

- [ ] `smoke_org.sh` 输出 `组织域 smoke 通过`
- [ ] `canary_gate.sh` 输出 `灰度检查通过（phase=..., with_smoke=..., with_boundary=...）`
- [ ] 当 `with_boundary=true` 时，日志出现 `企业域边界回归最小检查通过`
- [ ] `post` 阶段 `features.enterprise=true` 且 `enterpriseBackend.reachable=true`
- [ ] 组织域写入链路可创建并回收，未残留临时数据
- [ ] 关键操作可用 `traceId` 在 `/api/admin/audit/events` 追溯
- [ ] 企业域边界回归最小检查通过（权限边界/绑定冲突/traceId 三项均达标）

### 回滚

- [ ] LB/网关流量立即回切上一稳定版本
- [ ] 执行只读 gate 确认回滚目标健康：

```bash
./scripts/release/canary_gate.sh \
  --phase post \
  --active-base-url "http://core-stable.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner" \
  --with-smoke false
```

- [ ] 若需熔断组织域：`ENABLE_ADVANCED=false` 并重启 Core
- [ ] 验证 `GET /api/org/* => 503`、写接口 `=> 404`
- [ ] 保留审计记录与变更单，停止继续切流

## 企业域边界回归最小检查（发布/值班共用）

### 目的

- [ ] 通过单脚本验证企业域权限边界、绑定冲突与审计追溯能力。
- [ ] 自动回收临时数据，避免发布窗口遗留组织/项目/成员/绑定脏数据。

### 步骤

- [ ] 发布阶段优先由 `canary_gate.sh --with-boundary auto/true` 联动执行；值班接管阶段可单独执行：

```bash
./scripts/release/check_enterprise_boundary.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner" \
  --auditor-user "release-auditor" \
  --auditor-role "auditor" \
  --case-prefix "release-boundary"
```

- [ ] 若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，改用双会话模式：

```bash
./scripts/release/check_enterprise_boundary.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --owner-cookie "tp_admin_session=<owner-session-id>" \
  --auditor-cookie "tp_admin_session=<auditor-session-id>" \
  --case-prefix "release-boundary"
```

- [ ] 脚本失败时再使用以下最小命令集排障：

```bash
# 1) 权限边界：auditor 写组织应返回 403 + required=admin.org.manage
curl -X POST "http://127.0.0.1:9009/api/org/organizations" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: release-auditor" \
  -H "x-admin-role: auditor" \
  -H "Content-Type: application/json" \
  -d '{"id":"manual-boundary-org","name":"Manual Boundary Org"}'

# 2) 绑定冲突：第二次同参数绑定应返回 409
curl -X POST "http://127.0.0.1:9009/api/org/member-project-bindings" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: release-bot" \
  -H "x-admin-role: owner" \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"<orgId>","memberId":"<memberId>","projectId":"<projectId>"}'

# 3) traceId 追溯：审计查询应命中创建事件
curl -G "http://127.0.0.1:9009/api/admin/audit/events" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: release-bot" \
  -H "x-admin-role: owner" \
  --data-urlencode "traceId=<traceId>" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20" \
  | jq '.data | length'
```

### 验证

- [ ] 脚本退出码 `0`，并输出 `企业域边界回归最小检查通过`
- [ ] auditor 写组织被拒绝：`403` 且 `required=admin.org.manage`
- [ ] 重复 `POST /api/org/member-project-bindings` 的第二次调用返回 `409`
- [ ] `traceId` 可在 `/api/admin/audit/events?traceId=...` 检索到组织创建事件
- [ ] 脚本结束后日志包含自动清理结果（`回收 ... -> 200/404`）

### 回滚

- [ ] 先按发布回滚流程回切流量与版本。
- [ ] 回滚后复跑 `check_enterprise_boundary.sh`，确认权限边界与审计链路恢复正常。
- [ ] 若脚本失败，保留 `case_id/traceId` 并使用 `GET /api/admin/audit/events?traceId=...` 继续定位。

## OAuth 会话事件值班诊断（四段式）

### 目的

- [ ] 在 OAuth 异常（失败回调、轮询超时、重复 state）时，按统一流程收敛定位路径。
- [ ] 形成可交接证据：筛选结果、`state` 聚合视图、CSV、`traceId` 审计链路。

### 步骤

- [ ] 值班接手后先执行“企业域边界回归最小检查”（至少完成权限边界 + `traceId` 追溯）。
- [ ] 先做会话事件筛选（`GET /api/admin/oauth/session-events`）：

```bash
curl -G "http://localhost:9009/api/admin/oauth/session-events" \
  -H "Authorization: Bearer your-actual-secret" \
  -H "x-admin-user: prod-oncall" \
  -H "x-admin-role: owner" \
  --data-urlencode "provider=claude" \
  --data-urlencode "flowType=auth_code" \
  --data-urlencode "status=error" \
  --data-urlencode "from=2026-03-04T00:00:00.000Z" \
  --data-urlencode "to=2026-03-04T23:59:59.000Z" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20"
```

- [ ] 再做回调事件筛选（`GET /api/admin/oauth/callback-events`）并拿到 `traceId`：

```bash
curl -G "http://localhost:9009/api/admin/oauth/callback-events" \
  -H "Authorization: Bearer your-actual-secret" \
  -H "x-admin-user: prod-oncall" \
  -H "x-admin-role: owner" \
  --data-urlencode "provider=claude" \
  --data-urlencode "status=failure" \
  --data-urlencode "source=aggregate" \
  --data-urlencode "from=2026-03-04T00:00:00.000Z" \
  --data-urlencode "to=2026-03-04T23:59:59.000Z" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20"
```

- [ ] 按 `state` 聚合复盘单会话（`GET /api/admin/oauth/session-events/:state`）。
- [ ] 导出 CSV（`GET /api/admin/oauth/session-events/export`，`limit` 建议 `1000~2000`，上限 `5000`）。
- [ ] 使用 `traceId` 到审计接口追溯（`GET /api/admin/audit/events?traceId=...`）。

### 验证

- [ ] `session-events` 与 `callback-events` 能筛出同一故障窗口的数据。
- [ ] `session-events/:state` 能还原该会话阶段流转。
- [ ] CSV 文件可打开且行数不超过 `limit`。
- [ ] `traceId` 在 `/api/admin/audit/events` 可检索到对应记录。

### 回滚

- [ ] 排障链路超时或压力过高时，回退到“单 `state` 点查 + 小分页（`pageSize=20`）”。
- [ ] 暂停 CSV 导出，仅保留在线筛选与 `traceId` 追溯。
- [ ] 记录已确认的 `state/traceId` 到值班工单，避免重复扫描全量窗口。

### 安全验证

```bash
# 验证 API_SECRET 生效
curl -H "Authorization: Bearer wrong-secret" http://localhost:9009/api/models
# 预期: 401 Unauthorized

curl -H "Authorization: Bearer your-actual-secret" http://localhost:9009/api/models
# 预期: 200 OK (或空列表)
```

## Alertmanager 路由与 OAuth 升级演练（四段式）

### 目的

- [ ] 固化 OAuth 告警升级节奏：`5m` 进入 `critical`，`15m` 升级 `P1`。
- [ ] 统一 Prometheus/Alertmanager 的路由配置与演练入口，减少班次交接断层。
- [ ] 对齐兼容窗口：`2026-03-01`（迁移观测起点）/ `2026-06-30`（兼容结束）/ `2026-07-01`（遗留调用按 critical 处理）。

### 步骤

- [ ] 配置文件就绪：`monitoring/prometheus.yml`、`monitoring/alert_rules.yml`、`monitoring/alertmanager.yml`
- [ ] 语法校验通过：

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

- [ ] 启动监控组件：

```bash
docker compose --profile monitoring up -d prometheus alertmanager
```

- [ ] 基于模板生成本地参数文件并填值（D1 离线准备，不执行真实替换）：

```bash
cp scripts/release/release_window_oauth_alerts.env.example \
  scripts/release/release_window_oauth_alerts.env

# 编辑并替换 __REPLACE_WITH_*__ 占位值
${EDITOR:-vi} scripts/release/release_window_oauth_alerts.env
```

- [ ] 先运行预检，确认必填参数已填完且不再使用默认占位值：

```bash
./scripts/release/preflight_release_window_oauth_alerts.sh \
  --env-file scripts/release/release_window_oauth_alerts.env
```

- [ ] 预检通过后，再执行统一编排脚本完成下发、演练、history 抓取与证据输出（仓库不落真实 webhook）：

```bash
source scripts/release/release_window_oauth_alerts.env

./scripts/release/release_window_oauth_alerts.sh \
  --base-url "${RW_BASE_URL}" \
  --api-secret "${RW_API_SECRET}" \
  --owner-user "${RW_OWNER_USER}" \
  --owner-role "${RW_OWNER_ROLE}" \
  --auditor-user "${RW_AUDITOR_USER}" \
  --auditor-role "${RW_AUDITOR_ROLE}" \
  --warning-secret-ref "${RW_WARNING_SECRET_REF}" \
  --critical-secret-ref "${RW_CRITICAL_SECRET_REF}" \
  --p1-secret-ref "${RW_P1_SECRET_REF}" \
  --secret-cmd-template "${RW_SECRET_CMD_TEMPLATE}" \
  --with-rollback "${RW_WITH_ROLLBACK:-false}" \
  --evidence-file "${RW_EVIDENCE_FILE:-./artifacts/release-window-evidence.json}"
```

- [ ] 如需演练回滚，将 `--with-rollback` 改为 `true`

### 验证

- [ ] `http://127.0.0.1:9090/-/ready` 返回 `200`
- [ ] `http://127.0.0.1:9093/-/ready` 返回 `200`
- [ ] `/metrics` 存在 `tokenpulse_oauth_alert_events_total` 与 `tokenpulse_oauth_alert_delivery_total`
- [ ] 若 Prometheus 抓取 `/metrics` 返回 `404`，确认已配置 `bearer_token_file`（并与 `API_SECRET` 一致），或在受控环境显式开启 `EXPOSE_METRICS=true`
- [ ] `sync-history` 可查询最新记录（含 `historyId/outcome/startedAt`）
- [ ] 编排脚本 stdout 与 `--evidence-file` 已落档：`historyId + traceId + drillExitCode + rollbackResult`
- [ ] `drillExitCode` 符合升级策略：`11`（warning）/ `15`（critical）/ `20`（P1）
- [ ] 若 `--with-rollback=true`，`rollbackResult=success` 或已记录失败原因

#### Alertmanager sync/rollback 异常判定

| 状态码 | 判定口径 |
| ---- | ---- |
| `400` | 参数校验失败：`sync` 为请求体非法或无可同步配置；`rollback` 为请求体非法或 `historyId` 非法。 |
| `404` | 仅 `rollback` 使用：`historyId` 不存在，或历史条目缺少可回滚配置。 |
| `409` | `sync/rollback` 并发冲突，错误码 `alertmanager_sync_in_progress`。 |
| `500` | `sync/rollback` 执行失败；同步失败分支会附带 `rollbackSucceeded/rollbackError`。 |

### 回滚

- [ ] 执行 `docker compose --profile monitoring down` 停用监控 profile
- [ ] 回滚 `monitoring/*.yml` 到上一稳定版本并重新执行 `promtool/amtool` 校验
- [ ] 必要时注释 `alert_rules.yml` 中 OAuth 升级规则，仅保留采集
- [ ] 记录变更单与当班处置结论（含演练退出码与时间窗口）

## 组织域回滚检查清单

- [ ] 回滚开关前，确认 enterprise 数据已备份
- [ ] 将 `ENABLE_ADVANCED=false` 并重启 Core
- [ ] 验证 `GET /api/org/*` 返回 `503` 且 `code=ADVANCED_DISABLED_READONLY`
- [ ] 验证 `POST/PUT/PATCH/DELETE /api/org/*` 返回 `404`
- [ ] 若为版本回滚：`ENTERPRISE_BASE_URL` 已指向上一版本并通过 `/api/admin/features` 复检 `enterpriseBackend.reachable=true`
- [ ] 观察主链路 `/v1/*` 与 `/api/oauth/*` 未受影响
