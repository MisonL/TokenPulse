# TokenPulse AI Gateway - 部署文档

## 系统要求

- Docker 20.10+
- Docker Compose 2.0+
- 至少 512MB RAM
- 至少 1GB 可用磁盘空间

## 快速开始

### 1. 克隆仓库

```bash
git clone <repository-url>
cd TokenPulse
```

### 2. 配置环境变量

创建 `.env` 文件：

```env
# 服务器配置
PORT=9009
BASE_URL=http://localhost:9009

# 数据库配置
DATABASE_URL=postgresql://tokenpulse:tokenpulse@127.0.0.1:5432/tokenpulse

# API 密钥（生产环境必须修改）
API_SECRET=your-secret-key-here

# 高级版与企业服务（组织域）
ENABLE_ADVANCED=false
ENTERPRISE_BASE_URL=http://127.0.0.1:9010
ENTERPRISE_SHARED_KEY=

# 代理配置（可选）
HTTP_PROXY=
HTTPS_PROXY=
```

### 3. 启动服务

```bash
docker-compose up -d
```

### 4. 访问应用

- 前端界面: http://localhost:9009
- API 文档: http://localhost:9009/docs/API.md

### 5. 双服务部署（Core + Enterprise，组织域推荐）

当需要启用组织域（`/api/org/*`）与企业管理能力时，建议拆分运行：

```bash
# 终端 1：Core（对外入口）
bun run start:core

# 终端 2：Enterprise（企业域后端）
PORT=9010 bun run start:enterprise
```

核心配置要求：

- `ENABLE_ADVANCED=true`
- `ENTERPRISE_BASE_URL=http://127.0.0.1:9010`
- `ENTERPRISE_SHARED_KEY=<强随机密钥>`（Core 与 Enterprise 保持一致）

上线顺序建议：

1. 先启动 Enterprise，再启动 Core。
2. 先验证 `http://<enterprise-host>:9010/health`，再验证 `http://<core-host>:9009/health`。
3. 验证 `GET /api/admin/features` 中 `features.enterprise=true` 且 `enterpriseBackend.reachable=true`。
4. 执行组织域 smoke（读 + 写）后再切流。

## Docker 部署

### 使用 Docker Compose

```bash
# 构建并启动
docker-compose up -d --build

# 如需启用 Go uTLS bridge（可选）
docker-compose --profile bridge-go up -d --build

# 查看日志
docker-compose logs -f tokenpulse
docker-compose logs -f claude-bridge-go

# 停止服务
docker-compose down

# 重启服务
docker-compose restart
```

### 启用 Claude Go uTLS bridge（推荐用于严格 TLS 拟真）

```bash
# 1) 在 .env 中设置
CLAUDE_TLS_MODE=strict
CLAUDE_BRIDGE_URL=http://127.0.0.1:9460
CLAUDE_BRIDGE_SHARED_KEY=<请设置强随机串>

# 2) 启动可选 profile
docker-compose --profile bridge-go up -d claude-bridge-go

# 3) 健康检查
curl http://127.0.0.1:9460/health
```

### 单独使用 Docker

```bash
# 构建镜像
docker build -t tokenpulse .

# 运行容器
docker run -d \
  --name tokenpulse \
  -p 9009:3000 \
  -v $(pwd)/data:/app/data \
  -e PORT=3000 \
  -e API_SECRET=your-secret-key \
  tokenpulse
```

## 生产环境部署

### 1. 环境变量配置

生产环境必须配置以下环境变量：

```env
# 服务器配置
PORT=3000
BASE_URL=https://your-domain.com
NODE_ENV=production

# 安全配置
API_SECRET=<强随机密钥，至少32字符>

# 代理信任配置（在 Nginx/LB 后部署时启用）
TRUST_PROXY=true

# 数据库配置
DATABASE_URL=postgresql://tokenpulse:tokenpulse@postgres:5432/tokenpulse

# 高级版/企业服务（组织域）
ENABLE_ADVANCED=true
ENTERPRISE_BASE_URL=http://127.0.0.1:9010
ENTERPRISE_SHARED_KEY=<强随机密钥，Core/Enterprise 一致>

# 代理配置（如需要）
HTTP_PROXY=
HTTPS_PROXY=

# TLS 配置（⚠️ 生产环境禁止设置！）
# UNSAFE_DISABLE_TLS_CHECK=1

# Claude bridge（可选）
CLAUDE_TLS_MODE=strict
CLAUDE_BRIDGE_URL=http://127.0.0.1:9460
CLAUDE_BRIDGE_SHARED_KEY=<与 bridge 保持一致>
CLAUDE_BRIDGE_TIMEOUT_MS=12000

# OAuth 告警调度（静默时段/抑制策略通过管理接口配置）
OAUTH_ALERT_EVAL_INTERVAL_SEC=60

# Webhook 地址注入（示例占位；真实值通过环境变量/secret manager 注入）
ALERTMANAGER_WARNING_WEBHOOK_URL=https://example.invalid/alertmanager/warning
OAUTH_ALERT_WEBHOOK_URL=https://example.invalid/oauth/webhook
```

### 2. 使用反向代理

#### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Caddy 配置示例

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

### 3. HTTPS 配置

使用 Let's Encrypt 免费证书：

```bash
# 安装 certbot
sudo apt-get install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

### 4. 数据持久化

```bash
# PostgreSQL 数据卷由 docker-compose 中的 `pg_data` 管理。
```

### 5. 日志管理

```bash
# 查看容器日志
docker logs -f tokenpulse

# 配置日志轮转
docker run -d \
  --name tokenpulse \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  tokenpulse
```

### 6. 健康检查

```bash
# Core 健康检查
curl http://localhost:9009/health

# Enterprise 健康检查
curl http://localhost:9010/health

# 检查高级版能力探针（核心检查项）
curl http://localhost:9009/api/admin/features

# 组织域读写 smoke（自动创建并自动回收）
./scripts/release/smoke_org.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "deploy-checker" \
  --admin-role "owner" \
  --org-prefix "deploy-smoke"

# 企业域边界回归最小检查（权限边界/绑定冲突/traceId 追溯/自动清理）
./scripts/release/check_enterprise_boundary.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "deploy-checker" \
  --admin-role "owner" \
  --auditor-user "deploy-auditor" \
  --auditor-role "auditor" \
  --case-prefix "deploy-boundary"
```

说明：若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请先通过 `/api/admin/auth/login` 建立管理员会话，然后：

- `smoke_org.sh` 使用 `--cookie "tp_admin_session=<owner-session-id>"`。
- `check_enterprise_boundary.sh` 同时提供 `--owner-cookie` 与 `--auditor-cookie`（两种角色会话）。

预期：

- `/health` 返回 `status=ok`。
- `/api/admin/features` 中 `features.enterprise=true`。
- `/api/admin/features` 中 `enterpriseBackend.reachable=true`。
- 组织域接口在已鉴权请求下不应返回 `ADVANCED_DISABLED_READONLY`。
- 组织域写入接口返回 `success=true` 且包含 `traceId`。

核心健康响应示例：

```json
{
  "status": "ok",
  "service": "tokenpulse-core",
  "edition": "advanced"
}
```

### 7. 组织域上线与回滚

上线建议步骤：

1. 先启动 enterprise，再启动 core。
2. 验证 `GET /api/admin/features` 的 `enterpriseBackend.reachable=true`。
3. 执行 `canary_gate.sh` 的 `pre/post`，默认联动组织域 smoke 与企业域边界回归（`--with-smoke auto`、`--with-boundary auto`）。
4. 如需在切流后复核边界，追加一次 `--phase post --with-boundary true --with-smoke false`。
5. 观察审计链路（`traceId` 可在 `GET /api/admin/audit/events?traceId=...` 回溯）。

回滚建议步骤：

1. 快速熔断：将 `ENABLE_ADVANCED=false` 并重启 core（组织域读接口转为 `503`、写接口转为 `404`）。
2. 版本回滚：将 `ENTERPRISE_BASE_URL` 指回上一版本 enterprise，重启 core 并重测 `/api/admin/features`。
3. 数据保护：保留 enterprise 数据库，不在回滚时执行 destructive SQL。
4. 验证回滚结果：`GET /api/org/organizations` 符合预期（熔断场景为 `503` + `ADVANCED_DISABLED_READONLY`）。

### 8. 发布灰度收口脚本（四段式）

#### 目的

- 统一执行组织域发布 gate：覆盖高级版探针、组织域只读、写入 smoke、企业域边界最小回归。
- 在灰度切流前（pre）与切流后（post）执行可配置检查，降低“可用但不可回滚”的上线风险。

#### 步骤

1. 赋予脚本执行权限。
2. 切流前执行 `pre` 检查（可同时检查 active 与 candidate，`with-boundary=auto` 会自动执行边界检查）。
3. 切流后执行 `post` 检查（默认 `with-smoke=true`、`with-boundary=false`）。
4. 需要额外复核时，再执行一次 `post + with-boundary=true`。

```bash
# 1) 初始化
chmod +x scripts/release/*.sh

# 2) 独立 smoke（组织域读写 + 回收）
./scripts/release/smoke_org.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner" \
  --org-prefix "release-smoke"

# 3) 灰度 pre（切流前）
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

# 4) 灰度 post（切流后，默认 with-smoke=true）
./scripts/release/canary_gate.sh \
  --phase post \
  --active-base-url "http://core-stable.internal:9009" \
  --candidate-base-url "http://core-canary.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner"

# 5) 如需切流后再跑企业域边界回归（可选）
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

若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请改用双会话 Cookie（owner + auditor）：

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

#### 企业域边界回归最小检查（canary_gate 联动主路径）

默认通过 `canary_gate.sh` 在 `pre` 阶段联动执行 `check_enterprise_boundary.sh`（`with-boundary=auto`）。值班接手或排障时可改为 `--with-boundary true`，也可单独运行边界脚本。边界脚本会覆盖权限边界、绑定冲突、`traceId` 追溯，并在退出时自动清理临时资源。

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

若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请改用双会话模式：

```bash
./scripts/release/check_enterprise_boundary.sh \
  --base-url "http://127.0.0.1:9009" \
  --api-secret "$API_SECRET" \
  --owner-cookie "tp_admin_session=<owner-session-id>" \
  --auditor-cookie "tp_admin_session=<auditor-session-id>" \
  --case-prefix "release-boundary"
```

最小验收标准：

- 脚本退出码为 `0`，并输出 `企业域边界回归最小检查通过`。
- 权限边界检查中 auditor 写入返回 `403` 且 `required=admin.org.manage`。
- 重复绑定检查第二次写入返回 `409`。
- `traceId` 可在 `GET /api/admin/audit/events?traceId=...` 检索到组织创建事件。
- 日志末尾出现自动回收结果（`回收 ... -> 200/404`）。

脚本失败时，可用以下最小命令集做人工排障：

```bash
# 1) 权限边界：auditor 写入应返回 403
curl -X POST "http://127.0.0.1:9009/api/org/organizations" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: release-auditor" \
  -H "x-admin-role: auditor" \
  -H "Content-Type: application/json" \
  -d '{"id":"manual-boundary-org","name":"Manual Boundary Org"}'

# 2) 绑定冲突：第二次相同绑定应返回 409
curl -X POST "http://127.0.0.1:9009/api/org/member-project-bindings" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: release-bot" \
  -H "x-admin-role: owner" \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"<orgId>","memberId":"<memberId>","projectId":"<projectId>"}'

# 3) traceId 追溯：审计检索
curl -G "http://127.0.0.1:9009/api/admin/audit/events" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: release-bot" \
  -H "x-admin-role: owner" \
  --data-urlencode "traceId=<traceId>" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20"
```

说明：

- 若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，`check_enterprise_boundary.sh` 需同时提供 `--owner-cookie` 与 `--auditor-cookie`。
- 若是自签名测试环境，可加 `--insecure`。
- 所有脚本支持 `--help` 查看参数。

#### 验证

- `smoke_org.sh` 成功时会打印 `组织域 smoke 通过`，且创建资源会在脚本内自动回收。
- `canary_gate.sh` 成功时会打印 `灰度检查通过`，并标记当前 `phase`、`with_smoke`、`with_boundary`。
- 当 `with_boundary=true` 时，日志需出现 `企业域边界回归最小检查通过`。
- `post` 阶段建议附加检查：
  - `GET /api/admin/features` 返回 `features.enterprise=true` 且 `enterpriseBackend.reachable=true`。
  - `GET /api/org/organizations` 鉴权下返回 `200`（不是 `ADVANCED_DISABLED_READONLY`）。

#### 回滚

1. 立即回切入口流量到上一稳定版本（LB/网关层）。
2. 保持 `candidate` 可访问，执行只读 gate（`--phase post --with-smoke false`）确认回滚目标健康。
3. 将 `ENABLE_ADVANCED=false`（仅熔断组织域时）并重启 Core，验证：
   - `GET /api/org/*` 为 `503`（`ADVANCED_DISABLED_READONLY`）。
   - `POST/PUT/PATCH/DELETE /api/org/*` 为 `404`。
4. 使用 `traceId` 在 `/api/admin/audit/events` 中回溯失败发布动作，保留变更证据。

### 9. OAuth 会话事件诊断流程（四段式）

#### 目的

- 在 OAuth 登录失败、回调异常、轮询超时场景下，统一值班排障路径。
- 固化“筛选 -> 按 state 聚合 -> CSV 导出 -> traceId 追溯”步骤，降低跨班次交接成本。

#### 步骤

1. 值班接手或发布后首个巡检窗口，先执行“企业域边界回归最小检查”（见上一节，至少覆盖权限边界 + `traceId` 追溯）。
2. 会话事件初筛（按 provider/flowType/phase/status/eventType/time range）：

```bash
curl -G "http://localhost:9009/api/admin/oauth/session-events" \
  -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner" \
  --data-urlencode "provider=claude" \
  --data-urlencode "flowType=auth_code" \
  --data-urlencode "status=error" \
  --data-urlencode "from=2026-03-04T00:00:00.000Z" \
  --data-urlencode "to=2026-03-04T23:59:59.000Z" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20"
```

3. 回调事件复核（补充 `source/state/traceId` 维度）：

```bash
curl -G "http://localhost:9009/api/admin/oauth/callback-events" \
  -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner" \
  --data-urlencode "provider=claude" \
  --data-urlencode "status=failure" \
  --data-urlencode "source=aggregate" \
  --data-urlencode "from=2026-03-04T00:00:00.000Z" \
  --data-urlencode "to=2026-03-04T23:59:59.000Z" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20"
```

4. 按 `state` 聚合诊断（定位单条会话全链路）：

```bash
curl -G "http://localhost:9009/api/admin/oauth/session-events/<state>" \
  -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner" \
  --data-urlencode "from=2026-03-04T00:00:00.000Z" \
  --data-urlencode "to=2026-03-04T23:59:59.000Z" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=200"
```

5. 导出 CSV（用于工单与复盘）：

```bash
curl -G "http://localhost:9009/api/admin/oauth/session-events/export" \
  -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner" \
  --data-urlencode "provider=claude" \
  --data-urlencode "status=error" \
  --data-urlencode "from=2026-03-04T00:00:00.000Z" \
  --data-urlencode "to=2026-03-04T23:59:59.000Z" \
  --data-urlencode "limit=2000" \
  -o oauth-session-events-20260304.csv
```

6. `traceId` 追溯（关联审计）：

```bash
curl -G "http://localhost:9009/api/admin/audit/events" \
  -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner" \
  --data-urlencode "traceId=<从 callback-events 或 session-events 获取>" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=20"
```

说明：

- `from/to` 建议使用 ISO 8601（含时区）且满足 `from <= to`。
- `session-events/export` 默认 `limit=1000`，最大 `5000`。
- 若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请先通过 `/api/admin/auth/login` 获取管理员会话。

#### 验证

- 同一 `state` 在 `GET /api/admin/oauth/session-events/:state` 可看到完整阶段流转。
- `GET /api/admin/oauth/callback-events` 返回的失败事件可对应到具体 `state` 与 `traceId`。
- CSV 可被表格工具直接打开，且行数不超过 `limit`。
- `traceId` 可在 `/api/admin/audit/events` 检索到对应审计记录。

#### 回滚

1. 诊断流量过大或接口超时时，立即回退为“窄窗口 + 小分页 + 不导出”：
   - 时间窗口收敛到最近 `15m`。
   - `pageSize` 降为 `20`，`limit` 降为 `<=500`。
2. 暂停 CSV 导出，仅保留 `session-events/:state` 与 `callback-events?state=...` 点查。
3. 将已生成的 CSV 文件名、`state`、`traceId` 写入值班工单，后续离线分析继续。

### 10. Alertmanager 路由与 OAuth 升级演练（四段式）

#### 目的

- 固化 OAuth 告警升级节奏：`5m` 进入 `critical`，`15m` 升级 `P1`。
- 统一 Prometheus/Alertmanager 路由、规则与演练入口，降低发布后值班切换成本。
- 对齐旧路径弃用窗口：`2026-03-01` 启动迁移观测、`2026-06-30` 结束兼容窗口、`2026-07-01` 起按 `critical` 处理遗留调用。

#### 步骤

1. 准备监控配置文件：
   - `monitoring/prometheus.yml`
   - `monitoring/alert_rules.yml`
   - `monitoring/alertmanager.yml`
2. 发布前执行语法校验：

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

3. 启动监控 profile：

```bash
docker compose --profile monitoring up -d prometheus alertmanager
```

4. 使用 `owner` 发布或回滚 OAuth 告警规则版本（支持 `muteWindows/recoveryPolicy`）：

```bash
curl -sS -X POST "http://127.0.0.1:9009/api/admin/observability/oauth-alerts/rules/versions" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner" \
  --data '{
    "version":"release-20260305",
    "activate":true,
    "description":"release publish",
    "muteWindows":[{"id":"night","timezone":"Asia/Shanghai","start":"00:00","end":"06:00","weekdays":[1,2,3,4,5],"severities":["warning"]}],
    "recoveryPolicy":{"consecutiveWindows":3},
    "rules":[{"ruleId":"critical-up","name":"critical escalate","enabled":true,"priority":200,"allConditions":[{"field":"failureRateBps","op":"gte","value":3500}],"actions":[{"type":"escalate","severity":"critical"}]}]
  }'
```

5. 从参数模板生成本地文件并填值（D1 离线准备）：

> 安全要求：生产环境仅通过 Secret Manager 运行时注入 webhook。仓库与文档中仅保留 `example.invalid` 占位值或 secret 引用名，禁止提交真实地址/密钥。

```bash
cp scripts/release/release_window_oauth_alerts.env.example \
  scripts/release/release_window_oauth_alerts.env

# 编辑并替换 __REPLACE_WITH_*__ 占位值
${EDITOR:-vi} scripts/release/release_window_oauth_alerts.env
```

6. 先执行离线预检脚本，确认必填参数已填完且不再是默认占位值：

```bash
./scripts/release/preflight_release_window_oauth_alerts.sh \
  --env-file scripts/release/release_window_oauth_alerts.env
```

7. 预检通过后，再执行生产窗口编排脚本（Secret 下发 + 演练 + sync-history + 可选回滚 + 证据输出）：

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

> 若平台模板更适合 `%s` 占位符，可使用：`RW_SECRET_CMD_TEMPLATE='secret-manager read %s'`。
>
> 如需传入租户或窗口标识，可追加：`--owner-tenant "${RW_OWNER_TENANT}"`、`--auditor-tenant "${RW_AUDITOR_TENANT}"`、`--run-tag "${RW_RUN_TAG}"`。
>
> 编排脚本内部会调用 `publish_alertmanager_secret_sync.sh` 与 `drill_oauth_alert_escalation.sh`，并自动抓取最新 `sync-history`。

#### 验证

- `http://127.0.0.1:9090/-/ready` 与 `http://127.0.0.1:9093/-/ready` 返回 `200`。
- `/metrics` 中存在 `tokenpulse_oauth_alert_events_total` 与 `tokenpulse_oauth_alert_delivery_total`。
- `GET /api/admin/observability/oauth-alerts/rules/active` 返回当前生效版本；`GET /rules/versions` 可分页查询历史版本。
- `GET /api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=5` 返回最近同步记录（兼容 `limit=5`）。
- `POST /api/admin/observability/oauth-alerts/alertmanager/sync-history/:historyId/rollback` 可按历史条目执行回滚（owner）。
- 若并发触发 `sync/rollback`，后端返回 `409` 且错误码为 `alertmanager_sync_in_progress`。
- 角色门禁生效：`auditor` 访问读接口返回 `200`，访问 `POST/PUT` 返回 `403`。
- `release_window_oauth_alerts.sh` 的 stdout 与 `--evidence-file`（如配置）包含：`historyId`、`traceId`、`drillExitCode`、`rollbackResult`。
- 编排脚本中的演练段使用标准退出码：
  - `11`：warning（critical 出现但未满 5 分钟）
  - `15`：critical（持续 `>=5` 且 `<15` 分钟）
  - `20`：P1（持续 `>=15` 分钟）

建议记录模板：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| 窗口时间 | `2026-03-05 22:30-23:00` | 生产执行窗口 |
| owner | `oncall-bot` | 配置下发与回滚执行人 |
| auditor | `oncall-auditor` | 复核与证据记录人 |
| historyId | `history-20260305-001` | 来自 `sync-history` |
| traceId | `trace-alert-sync-xxxx` | 来自 `sync/rollback` 响应 |
| drillExitCode | `11/15/20` | 升级演练退出码 |
| rollbackResult | `success/skip/failure` | 回滚演练结果 |

#### 回滚

1. 停用监控 profile：

```bash
docker compose --profile monitoring down
```

2. 回滚 `monitoring/*.yml` 到上一稳定版本，并重新执行 `promtool/amtool` 校验。
3. 若需临时降级，只保留采集并停用升级规则：注释 `monitoring/alert_rules.yml` 中 OAuth 升级规则后 reload Prometheus。
4. 若需回退控制面变更，执行规则版本回滚：

```bash
curl -sS -X POST "http://127.0.0.1:9009/api/admin/observability/oauth-alerts/rules/versions/<versionId>/rollback" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner"
```

5. 若需按历史同步记录回退 Alertmanager 配置：

```bash
curl -sS -X POST "http://127.0.0.1:9009/api/admin/observability/oauth-alerts/alertmanager/sync-history/<historyId>/rollback" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -H "x-admin-user: oncall-bot" \
  -H "x-admin-role: owner" \
  --data '{"reason":"incident-rollback"}'
```

6. 兼容路径与主路径字段一致，可在灰度期使用 `/api/admin/oauth/alerts/rules/*` 与 `/api/admin/oauth/alertmanager/*`。

## 端口映射

| 服务        | 容器端口 | 宿主机端口 | 说明           |
| ----------- | -------- | ---------- | -------------- |
| 主应用      | 3000     | 9009       | Web 界面和 API |
| Enterprise  | 9010     | 9010       | 企业域后端     |
| Claude 回调 | 54545    | 54545      | OAuth 回调     |
| Gemini 回调 | 8085     | 8085       | OAuth 回调     |
| Codex 回调  | 1455     | 1455       | OAuth 回调     |
| iFlow 回调  | 11451    | 11451      | OAuth 回调     |

## 监控和维护

### 查看日志

```bash
# 实时日志
docker-compose logs -f

# 最近 100 行
docker-compose logs --tail=100

# 查看特定服务
docker-compose logs tokenpulse
```

### 备份数据

```bash
# 备份数据库
docker exec tokenpulse-postgres pg_dump -U tokenpulse tokenpulse > backup-$(date +%Y%m%d).sql

# 恢复数据库
cat backup-20260113.sql | docker exec -i tokenpulse-postgres psql -U tokenpulse -d tokenpulse
```

### 更新应用

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build

# 清理旧镜像
docker image prune -f
```

## 故障排除

### 容器无法启动

```bash
# 查看详细日志
docker-compose logs tokenpulse

# 检查端口占用
netstat -tlnp | grep 9009

# 检查磁盘空间
df -h
```

### OAuth 回调失败

1. 确认回调端口未被占用
2. 检查防火墙设置
3. 验证 BASE_URL 配置正确
4. 查看浏览器控制台错误信息

### 数据库错误

```bash
# 检查 PostgreSQL 连接
docker exec tokenpulse-postgres pg_isready -U tokenpulse -d tokenpulse

# 重新初始化数据库（谨慎）
docker-compose down -v
docker-compose up -d --build
```

### 性能问题

```bash
# 查看容器资源使用
docker stats tokenpulse

# 增加内存限制
docker-compose up -d --memory=1g
```

## 安全建议

1. **修改默认密钥**: 生产环境必须修改 `API_SECRET`
2. **使用 HTTPS**: 生产环境必须启用 HTTPS
3. **启用代理信任**: 如在 Nginx/LB 后部署，设置 `TRUST_PROXY=true`
4. **禁止 TLS 关闭**: 生产环境绝不设置 `UNSAFE_DISABLE_TLS_CHECK`
5. **限制访问**: 使用防火墙限制访问 IP
6. **定期备份**: 定期备份数据库
7. **更新依赖**: 定期更新 Docker 镜像和依赖
8. **监控日志**: 监控异常访问和错误日志

## 性能优化

### 1. 启用缓存

缓存已默认启用，减少数据库查询 80%

### 2. 调整速率限制

修改 `src/middleware/rate-limiter.ts` 中的配置

### 3. 使用 CDN

为静态资源配置 CDN

### 4. 数据库优化

定期清理过期日志数据

## 支持与反馈

- GitHub Issues: <repository-url>/issues
- 文档: <repository-url>/docs
- API 文档: <repository-url>/docs/API.md
