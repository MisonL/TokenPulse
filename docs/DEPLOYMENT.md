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

当需要启用组织域（`/api/org/*`）与企业管理能力时，默认按双服务运行：

```bash
# 本地联调可直接一键拉起
bun run dev:stack

# 生产/容器编排中仍建议拆成两个独立进程
bun run start:core
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
4. 验证 `GET /api/auth/verify-secret` 与 `/api/admin/auth/*` 均经 `core` 正常工作。
5. 执行组织域 smoke（读 + 写）后再切流。

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
# OAuth 告警 compat 路径退场模式：observe=继续服务但标记弃用，enforce=统一 410
OAUTH_ALERT_COMPAT_MODE=observe
# 直连 webhook / 企业微信投递（可选；若走 Alertmanager 发布窗口可留空）
OAUTH_ALERT_WEBHOOK_URL=
OAUTH_ALERT_WEBHOOK_SECRET=
OAUTH_ALERT_WECOM_WEBHOOK_URL=
OAUTH_ALERT_WECOM_MENTIONED_LIST=

# Alertmanager Secret helper 示例映射（仅 scripts/release/read_alertmanager_secret_from_env.example.sh 使用）
# 生产建议改为真实 Secret Manager helper，不要把 webhook URL 固定写在仓库示例配置里。
TOKENPULSE_ALERTMANAGER_WARNING_SECRET_REF=tokenpulse/prod/alertmanager_warning_webhook_url
TOKENPULSE_ALERTMANAGER_CRITICAL_SECRET_REF=tokenpulse/prod/alertmanager_critical_webhook_url
TOKENPULSE_ALERTMANAGER_P1_SECRET_REF=tokenpulse/prod/alertmanager_p1_webhook_url
TOKENPULSE_ALERTMANAGER_WARNING_WEBHOOK_URL=
TOKENPULSE_ALERTMANAGER_CRITICAL_WEBHOOK_URL=
TOKENPULSE_ALERTMANAGER_P1_WEBHOOK_URL=

# Alertmanager docker compose 挂载路径（发布前请改为运行时注入的生产文件/目录）
ALERTMANAGER_CONFIG_PATH=./monitoring/runtime/alertmanager.prod.yml
ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates
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
3. 执行 `canary_gate.sh` 的 `pre/post`，默认联动组织域 smoke 与企业域边界回归（`--with-smoke auto`、`--with-boundary auto`）；如需兼容路径退场护栏，可追加 `--with-compat observe|strict --prometheus-url ...`。
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
2. 在本地或合并前，先执行一次统一自动化发布回归：`bun run test:release:full`。
3. 切流前执行 `pre` 检查（可同时检查 active 与 candidate，`with-boundary=auto` 会自动执行边界检查）。
4. 切流后执行 `post` 检查（默认 `with-smoke=true`、`with-boundary=false`）。
5. 需要额外复核时，再执行一次 `post + with-boundary=true`。

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
  --with-compat observe \
  --prometheus-url "http://127.0.0.1:9090" \
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

说明：

- `bun run test:release` 覆盖发布脚本语法检查与 `release-common / canary / release-window / compat` 定向回归；`bun run test:release:full` 会额外包含 compat 退场护栏与 package scripts 声明校验。
- `canary_gate.sh` 默认 `--with-compat=false`；推荐先用 `observe` 做发布窗口观测，确认 compat 指标连续归零后再升级到 `strict`。
- `canary_gate.sh --with-compat observe|strict` 只控制发布 gate；服务端 compat 路径真实行为由 `OAUTH_ALERT_COMPAT_MODE=observe|enforce` 控制，二者独立。
- 推荐切换顺序：先保持 `OAUTH_ALERT_COMPAT_MODE=observe`，直到 compat 指标连续归零并完成外部调用方清点，再切到 `enforce`。
- 若 Prometheus 抓取 `/metrics` 需要鉴权，可额外传 `--prometheus-bearer-token "<token>"`。
- `2026-07-01` 起若 compat 指标仍命中，`observe/strict` 都会按阻断处理。

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

1. 准备监控配置文件，并明确用途边界：
   - 仓库示例配置：
     - `monitoring/alertmanager.yml`
     - `monitoring/alertmanager.slack.example.yml`
     - `monitoring/alertmanager.wecom.example.yml`
     - `release_window_oauth_alerts.sh` / `publish_alertmanager_secret_sync.sh` 会以 `monitoring/alertmanager.yml` 为单一基线，再用 Secret Manager 的实际 webhook URL 渲染后发布。
     - 仓库中仍只保留 `example.invalid` 或占位值，不能直接进入发布窗口。
   - 本地演练配置：
     - `monitoring/alertmanager.webhook.local.example.yml`
     - 只允许打到本机 webhook sink，用于开发/演练，不允许用于生产发布。
   - 运行时挂载配置：
     - 仓库模板：`monitoring/runtime/alertmanager.prod.example.yml`
     - 由 Secret Manager、部署平台或 CI/CD 在运行时生成，例如 `monitoring/runtime/alertmanager.prod.yml`。
     - 该文件主要用于容器挂载 / `amtool` 校验；发布窗口脚本不再把它作为唯一基线来源。
2. 发布前执行离线预检：

```bash
ALERTMANAGER_CONFIG_PATH=./monitoring/runtime/alertmanager.prod.yml \
ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates \
  ./scripts/release/preflight_alertmanager_config.sh
```

该预检会在进入 release window 前阻断以下风险：

- `ALERTMANAGER_CONFIG_PATH` 不是文件或不存在。
- `ALERTMANAGER_TEMPLATES_PATH` 不是目录或不存在。
- 配置里仍有 `example.invalid`、`example.com`、`example.local`、本地 webhook sink、空 URL、`REPLACE_WITH` / `REPLACE_ME` / `CHANGE_ME` / `TODO` 等明显占位值。

3. 发布前执行语法校验：

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
```

> 若只是本地 webhook sink 演练，可把目标文件替换为 `/etc/alertmanager/alertmanager.webhook.local.example.yml`；进入灰度/生产窗口前，必须校验运行时生产文件。

4. 启动监控 profile：

```bash
# 默认值挂载 monitoring/alertmanager.webhook.local.example.yml，仅适合本地 webhook sink 演练
docker compose --profile monitoring up -d prometheus alertmanager

# 生产发布时请显式切到运行时注入配置
ALERTMANAGER_CONFIG_PATH=./monitoring/runtime/alertmanager.prod.yml \
ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates \
  docker compose --profile monitoring up -d prometheus alertmanager
```

5. 使用 `owner` 发布或回滚 OAuth 告警规则版本（支持 `muteWindows/recoveryPolicy`）：

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

6. 从参数模板生成本地文件并填值（D1 离线准备）：

> 安全要求：生产环境仅通过 Secret Manager 运行时注入 webhook。仓库与文档中仅保留 `example.invalid` 占位值或 secret 引用名，禁止提交真实地址/密钥。

```bash
cp scripts/release/release_window_oauth_alerts.env.example \
  scripts/release/release_window_oauth_alerts.env

# 编辑并替换 __REPLACE_WITH_*__ 占位值
${EDITOR:-vi} scripts/release/release_window_oauth_alerts.env
```

> `scripts/release/release_window_oauth_alerts.env` 已加入 `.gitignore`；预检脚本也会阻断“已被 Git 跟踪”的参数文件，避免把真实密钥/地址误提交到仓库。
>
> 如需快速接入 `--secret-helper`，可复制 `scripts/release/read_alertmanager_secret_from_env.example.sh` 并按实际 Secret 引用名调整映射；该模板只从环境变量读取 webhook，不会把真实值写回仓库。

7. 先执行离线预检脚本，确认必填参数已填完，且 Alertmanager 发布基线渲染后也通过预检：

```bash
./scripts/release/preflight_release_window_oauth_alerts.sh \
  --env-file scripts/release/release_window_oauth_alerts.env
```

说明：

- 该脚本现在会先校验 `RW_*` 参数，再调用 `publish_alertmanager_secret_sync.sh --render-only`，用 `ALERTMANAGER_CONFIG_TEMPLATE_PATH`（默认 `./monitoring/alertmanager.yml`）渲染出临时配置，并继续检查 `ALERTMANAGER_TEMPLATES_PATH`。
- 若 `RW_WITH_COMPAT != false`，预检还会校验 `RW_PROMETHEUS_URL`、`RW_COMPAT_CRITICAL_AFTER`、`RW_COMPAT_SHOW_LIMIT`，并把 compat 参数自动拼进下一步命令。
- 若基线渲染后仍出现 `example.invalid/example.com/example.local`、本地 webhook sink，或 `REPLACE_WITH/REPLACE_ME/CHANGE_ME` 等显式占位 webhook 标记，脚本会直接失败并返回非 0。

#### 真实链路演练前人工收口

- `RW_WARNING_SECRET_REF`、`RW_CRITICAL_SECRET_REF`、`RW_P1_SECRET_REF` 已在生产 Secret Manager 中指向真实值班通道，不得共用测试群或本地 sink。
- `owner`、`auditor`、真实通道接收人（值班同学 / Pager 平台负责人）均已确认窗口时间。
- 已检查静默窗口、`muteProviders`、最小投递级别，不会把本次演练直接吞掉；若需临时放行，先记录恢复时间。
- 若存在真实 P1 / 大故障、发布冻结、或通道负责人未在线，不执行真实链路演练。

8. 预检通过后，再执行生产窗口编排脚本（Secret 下发 + 演练 + sync-history + 可选回滚 + 证据输出）：

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
  --config-template "${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-./monitoring/alertmanager.yml}" \
  --secret-helper "${RW_SECRET_HELPER}" \
  --with-compat "${RW_WITH_COMPAT:-false}" \
  --prometheus-url "${RW_PROMETHEUS_URL}" \
  --prometheus-bearer-token "${RW_PROMETHEUS_BEARER_TOKEN}" \
  --compat-critical-after "${RW_COMPAT_CRITICAL_AFTER:-2026-07-01}" \
  --compat-show-limit "${RW_COMPAT_SHOW_LIMIT:-10}" \
  --with-rollback "${RW_WITH_ROLLBACK:-false}" \
  --evidence-file "${RW_EVIDENCE_FILE:-./artifacts/release-window-evidence.json}"
```

> `RW_SECRET_HELPER` 调用约定为 `<helper> <secret_ref>`，stdout 必须只输出 webhook URL。
>
> 兼容旧模板参数仍可使用：`RW_SECRET_CMD_TEMPLATE='secret-manager read %s'`，但已弃用。
>
> 如需传入租户或窗口标识，可追加：`--owner-tenant "${RW_OWNER_TENANT}"`、`--auditor-tenant "${RW_AUDITOR_TENANT}"`、`--run-tag "${RW_RUN_TAG}"`。
>
> 若未启用 `ADMIN_TRUST_HEADER_AUTH=true`（或不在可信代理链路），可改用双会话 Cookie：`--owner-cookie "tp_admin_session=<owner-session-id>" --auditor-cookie "tp_admin_session=<auditor-session-id>"`；此时可省略 `--owner-user/--owner-role/--auditor-user/--auditor-role`。
>
> `--config-template` 默认指向 `monitoring/alertmanager.yml`。发布与窗口预检都会以这份仓库基线为准，再在本地渲染出真实 webhook URL，避免“预检通过但实际发布的不是同一份配置”。
>
> `publish_alertmanager_secret_sync.sh` 会额外阻断两类风险：Secret 引用名包含非法字符；或 Secret Manager 解析出的 webhook 仍是 `example.invalid` / `example.com` / `example.local` / 本地 webhook sink / `REPLACE_WITH` / `REPLACE_ME` / `CHANGE_ME` 等显式占位 URL。
>
> `release_window_oauth_alerts.sh` 默认 `--with-compat=false`；建议正式窗口至少使用 `observe`，并在证据中保留 compat 观测结果。若 Prometheus 不需要鉴权，可把 `RW_PROMETHEUS_BEARER_TOKEN` 留空。
>
> `release_window_oauth_alerts.sh` 抓取 `sync-history` 时会按本次 `RUN_TAG` / `sync_reason` 绑定目标条目，避免并发发布窗口误回滚到其他班次的配置。
>
> 编排脚本内部会调用 `publish_alertmanager_secret_sync.sh`、`drill_oauth_alert_escalation.sh` 与可选的 compat 观测，并自动抓取 `sync-history`、通过审计补 `traceId`；若演练命中升级，还会补 `incidentId` / `incidentCreatedAt` 作为证据锚点。若执行 `rollback`，证据中的顶层 `traceId` 会优先采用 rollback 接口返回值，同时显式保留 `rollbackTraceId`，即使 rollback 失败也不丢失。

#### 自动化 / 人工职责边界

| 类别 | 仓库内自动化 | 必须生产人工完成 |
| --- | --- | --- |
| 配置与参数预检 | `preflight_alertmanager_config.sh`、`preflight_release_window_oauth_alerts.sh` | 确认生产运行时文件、模板目录、值班窗口已获批准 |
| Secret 读取与 sync | `publish_alertmanager_secret_sync.sh`、`release_window_oauth_alerts.sh` | 创建 / 更新真实 Secret、授权 helper、审批真实通道映射 |
| 演练证据 | `--evidence-file` 自动输出 `historyId/historyReason/traceId/drillExitCode/rollbackResult` | 截图 / 留档真实消息、Pager 事件号、电话日志、工单号、接收确认 |
| 回滚执行 | `release_window_oauth_alerts.sh --with-rollback true` 或接口回滚 | 判断是否需要回滚、确认回滚后通知已撤销 / 事件已关闭 |
| compat 归因 | 指标自动累加、测试阻止仓库内兼容路径回归 | 根据 `route`、访问日志、外部脚本、旧书签确认真实来源并推动迁移 |

#### 角色职责

| 角色 | 职责 |
| --- | --- |
| `owner` | 执行 Secret 下发、sync、必要 rollback，确认配置变更与工单状态一致 |
| `auditor` | 核对 `sync-history`、`historyReason`、`traceId`、回滚结果，负责证据归档 |
| 通道负责人 / 值班接收人 | 确认真实 warning / critical / P1 通道已收到演练通知，并回写接收时间 |
| 平台 / Secret 管理员 | 维护 Secret 引用、helper 权限、真实通道映射与失效回收 |

#### 验证

- `http://127.0.0.1:9090/-/ready` 与 `http://127.0.0.1:9093/-/ready` 返回 `200`。
- `/metrics` 中存在 `tokenpulse_oauth_alert_events_total` 与 `tokenpulse_oauth_alert_delivery_total`。
- 若 Prometheus 抓取 `/metrics` 返回 `404`，通常是生产默认 `EXPOSE_METRICS=false` 导致需要 `Bearer API_SECRET`；请为 Prometheus 配置 `bearer_token_file`（见 `monitoring/prometheus.yml` 示例）或在受控环境显式开启 `EXPOSE_METRICS=true`。
- `GET /api/admin/observability/oauth-alerts/rules/active` 返回当前生效版本；`GET /rules/versions` 可分页查询历史版本。
- `GET /api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=5` 返回最近同步记录（兼容 `limit=5`）。
- `POST /api/admin/observability/oauth-alerts/alertmanager/sync-history/:historyId/rollback` 可按历史条目执行回滚（owner）。
- 若并发触发 `sync/rollback`，后端返回 `409` 且错误码为 `alertmanager_sync_in_progress`。
- 角色门禁生效：`auditor` 访问读接口返回 `200`，访问 `POST/PUT` 返回 `403`。
- `sync-history` 只用于确认 `historyId/historyReason`；`traceId` 应来自 `release_window_oauth_alerts.sh --evidence-file` 或 `/api/admin/audit/events` 检索。
- `release_window_oauth_alerts.sh` 的 stdout 与 `--evidence-file`（如配置）至少包含：`historyId`、`historyReason`、`traceId`、`drillExitCode`、`rollbackResult`；若启用 compat，还应包含 `compatCheckMode`、`compat5mHits`、`compat24hHits`、`compatGateResult`、`compatCheckedAt`；若命中升级，还会包含 `incidentId`、`incidentCreatedAt`。
- 真实链路演练完成必须额外具备人工证据：真实值班群消息截图或消息 ID、Pager / 电话平台事件号、接收人确认时间、值班工单编号。没有这些人工证据时，只能算“脚本演练完成”，不能算“真实链路闭环”。
- 若 `--with-rollback=true`，需额外核对 rollback 证据：
  - success：`rollbackResult=success`、`rollbackHttpCode=200`、`rollbackTraceId` 非空。
  - failure：`rollbackResult=failure`，且同时保留 `rollbackHttpCode`、`rollbackTraceId`、`rollbackError`，便于继续追查。
- 编排脚本中的演练段使用标准退出码：
  - `0`：未命中升级（时间窗口内无 critical incidents）
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
| historyReason | `release window sync release-window-20260305T143000Z` | 与本次 `RUN_TAG` 绑定的历史原因 |
| traceId | `trace-alert-sync-xxxx` | 来自证据文件；未执行 rollback 时取 sync 审计 traceId，执行 rollback 时优先取 rollback 接口 traceId |
| drillExitCode | `0/11/15/20` | 升级演练退出码 |
| incidentId | `incident:drill:error:1741234567890` | 命中升级时关联的 incident 锚点 |
| incidentCreatedAt | `1741234567890` | 命中升级时 incident 的创建时间戳（毫秒） |
| rollbackResult | `success/skip/failure` | 回滚演练结果 |
| rollbackTraceId | `trace-rollback-xxxx` | 执行 rollback 时保留接口返回的 traceId；失败分支也必须留档 |
| rollbackHttpCode | `200/4xx/5xx` | rollback 接口返回状态码 |
| rollbackError | `rollback downstream failed` | 仅 rollback 失败时记录 |
| 消息 / 电话证据 | `msg-123` / `incident-456` / `call-log-789` | 真实通道接收确认的人工留档 |

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

6. 兼容路径与主路径字段一致，可在灰度期短期观察 `/api/admin/oauth/alerts/*` 与 `/api/admin/oauth/alertmanager/*`，但新脚本与新入口一律使用 `/api/admin/observability/oauth-alerts/*`。
7. `OAUTH_ALERT_COMPAT_MODE=observe` 时，兼容路径会追加 `Deprecation` / `Sunset` / `Link`，并在 JSON 响应里返回 `deprecated=true`、`successorPath`；当调用方全部迁移后再切到 `enforce`。
8. `OAUTH_ALERT_COMPAT_MODE=enforce` 后，兼容路径统一返回 `410 Gone` 且不再执行业务逻辑，但 `tokenpulse_oauth_alert_compat_route_hits_total` 仍会累加，可继续用于排查残留访问。
9. 若回滚前发现 compat 指标仍有新增命中，先冻结继续切流，再按 `method/route` 定位调用方；`2026-07-01` 起一律按 `critical` 事件处理。

### 11. TokenPulse × AgentLedger 协作边界（四段式）

#### 目的

1. 明确 TokenPulse 与 AgentLedger 的部署职责，避免两个系统同时承接同一类治理或网关能力。
2. 为后续 OIDC / 深链跳转 / 运行时摘要事件联动预留统一约束。

#### 步骤

1. 将 TokenPulse 视为“渠道接入与运行时控制面”：
   - Provider OAuth
   - 凭据金库
   - 模型路由 / 选路策略 / 执行策略
   - 渠道侧审计、配额、OAuth 告警与 Alertmanager 控制面
2. 将 AgentLedger 视为“企业终端 AI 治理与账本面”：
   - CLI / IDE / Agent 会话采集
   - usage / cost / session / source 统一账本
   - 身份、设备、预算、规则资产、MCP、Quality、Replay、审计合规
3. 当前部署只允许以下松耦合集成：
   - SSO / 深链跳转
   - TokenPulse 输出运行时摘要事件供 AgentLedger 消费
   - traceId / tenantId / projectId 作为跨系统追溯键
4. 当前阶段禁止以下反向耦合：
   - 让 AgentLedger 代理 TokenPulse 的模型流量
   - 让 AgentLedger 下发路由策略直接控制 TokenPulse 网关
   - 在 TokenPulse 内重做预算、数据主权、MCP、Replay 这类账本治理能力

#### 验证

1. EnterprisePage 中的 OAuth 模型治理、路由策略、能力图谱、OAuth 告警继续由 TokenPulse 自治。
2. 对接文档中的最小事件草案字段保持稳定：`tenantId/projectId?/traceId/provider/model/resolvedModel/routePolicy/accountId?/status/startedAt/finishedAt?/errorCode?/cost?`。
3. 若启用 `TOKENPULSE_AGENTLEDGER_ENABLED=true`，发布前必须执行 `./scripts/release/drill_agentledger_runtime_webhook.sh --env-file ... --evidence-file ./artifacts/agentledger-runtime-drill-evidence.json`，并验证首发 `202`、重放 `200`。
4. `canary_gate.sh` 会检查 `GET /api/admin/observability/agentledger-outbox/readiness`：`candidate` 与 `post-active` 必须返回 `200 + ready=true`；`pre-active` 与 `rollback-target` 若仍是未升级旧版本，返回 `404` 时只告警跳过。
5. `monitoring/alert_rules.yml` 当前还包含 AgentLedger worker / backlog 规则，至少覆盖 `delivery_not_configured`、`worker_stale`、`open_backlog_stale`、`replay_required_backlog` 四类异常。
6. 新增联调方案时，必须先检查是否违反“TokenPulse 做执行面、AgentLedger 做治理面”的边界。

#### 回滚

1. 若发现新方案开始让 AgentLedger 反向控制 TokenPulse 网关，立即回退到“仅消费运行时摘要事件”的模式。
2. 若联调导致部署链路出现强依赖，优先移除跨系统阻塞调用，恢复为文档约定的松耦合深链 / 事件协作。

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
