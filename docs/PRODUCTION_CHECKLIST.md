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

# 组织域读接口（需带鉴权）
curl -H "Authorization: Bearer your-actual-secret" \
  -H "x-admin-user: prod-checker" \
  -H "x-admin-role: owner" \
  http://localhost:9009/api/org/organizations

# 组织域写入 smoke（创建 + 删除）
curl -X POST "http://localhost:9009/api/org/organizations" \
  -H "Authorization: Bearer your-actual-secret" \
  -H "x-admin-user: prod-checker" \
  -H "x-admin-role: owner" \
  -H "Content-Type: application/json" \
  -d '{"id":"check-org","name":"Check Org"}'

curl -X DELETE "http://localhost:9009/api/org/organizations/check-org" \
  -H "Authorization: Bearer your-actual-secret" \
  -H "x-admin-user: prod-checker" \
  -H "x-admin-role: owner"
```

说明：若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请先通过 `/api/admin/auth/login` 获取管理员会话，再执行组织域 smoke。

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
- 固化组织域上线必检项：高级版探针、组织域只读、组织域写入创建 + 删除回收。

### 步骤

- [ ] 赋权脚本：`chmod +x scripts/release/*.sh`
- [ ] 切流前执行 `pre` gate（建议 `with-smoke=false`）：

```bash
./scripts/release/canary_gate.sh \
  --phase pre \
  --active-base-url "http://core-stable.internal:9009" \
  --candidate-base-url "http://core-canary.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner" \
  --with-smoke false
```

- [ ] 切流后执行 `post` gate（默认 `with-smoke=true`）：

```bash
./scripts/release/canary_gate.sh \
  --phase post \
  --active-base-url "http://core-stable.internal:9009" \
  --candidate-base-url "http://core-canary.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner"
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

说明：若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请改用 `--cookie "tp_admin_session=<session-id>"`。

### 验证

- [ ] `smoke_org.sh` 输出 `组织域 smoke 通过`
- [ ] `canary_gate.sh` 输出 `灰度检查通过`
- [ ] `post` 阶段 `features.enterprise=true` 且 `enterpriseBackend.reachable=true`
- [ ] 组织域写入链路可创建并回收，未残留临时数据
- [ ] 关键操作可用 `traceId` 在 `/api/admin/audit/events` 追溯

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

## OAuth 会话事件值班诊断（四段式）

### 目的

- [ ] 在 OAuth 异常（失败回调、轮询超时、重复 state）时，按统一流程收敛定位路径。
- [ ] 形成可交接证据：筛选结果、`state` 聚合视图、CSV、`traceId` 审计链路。

### 步骤

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

- [ ] 执行升级演练脚本：

```bash
./scripts/release/drill_oauth_alert_escalation.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "oncall-bot" \
  --admin-role "owner"
```

### 验证

- [ ] `http://127.0.0.1:9090/-/ready` 返回 `200`
- [ ] `http://127.0.0.1:9093/-/ready` 返回 `200`
- [ ] `/metrics` 存在 `tokenpulse_oauth_alert_events_total` 与 `tokenpulse_oauth_alert_delivery_total`
- [ ] 演练退出码符合升级策略：`11`（warning）/ `15`（critical）/ `20`（P1）

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
