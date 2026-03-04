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

# 组织域只读 smoke（需 API_SECRET，管理员身份可用会话或可信头）
curl -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: deploy-checker" \
  -H "x-admin-role: owner" \
  http://localhost:9009/api/org/organizations

# 组织域写入 smoke（创建后可立即删除）
curl -X POST "http://localhost:9009/api/org/organizations" \
  -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: deploy-checker" \
  -H "x-admin-role: owner" \
  -H "Content-Type: application/json" \
  -d '{"id":"smoke-org","name":"Smoke Org"}'

curl -X DELETE "http://localhost:9009/api/org/organizations/smoke-org" \
  -H "Authorization: Bearer <API_SECRET>" \
  -H "x-admin-user: deploy-checker" \
  -H "x-admin-role: owner"
```

说明：若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请改为先通过 `/api/admin/auth/login` 建立管理员会话后再执行组织域 smoke。

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
3. 执行组织域只读 smoke（`GET /api/org/organizations`）与写入 smoke（`POST /api/org/organizations` + 删除回收）。
4. 观察审计链路（`traceId` 可在 `GET /api/admin/audit/events?traceId=...` 回溯）。

回滚建议步骤：

1. 快速熔断：将 `ENABLE_ADVANCED=false` 并重启 core（组织域读接口转为 `503`、写接口转为 `404`）。
2. 版本回滚：将 `ENTERPRISE_BASE_URL` 指回上一版本 enterprise，重启 core 并重测 `/api/admin/features`。
3. 数据保护：保留 enterprise 数据库，不在回滚时执行 destructive SQL。
4. 验证回滚结果：`GET /api/org/organizations` 符合预期（熔断场景为 `503` + `ADVANCED_DISABLED_READONLY`）。

### 8. 发布灰度收口脚本（四段式）

#### 目的

- 统一执行组织域发布 smoke：覆盖高级版探针、组织域只读检查、写入创建与删除回收。
- 在灰度切流前（pre）与切流后（post）执行一致的 gate 检查，降低“可用但不可回滚”的上线风险。

#### 步骤

1. 赋予脚本执行权限。
2. 切流前执行 `pre` 检查（可同时检查 active 与 candidate）。
3. 切流后执行 `post` 检查（默认附带写入 smoke）。

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
  --with-smoke false

# 4) 灰度 post（切流后，默认 with-smoke=true）
./scripts/release/canary_gate.sh \
  --phase post \
  --active-base-url "http://core-stable.internal:9009" \
  --candidate-base-url "http://core-canary.internal:9009" \
  --api-secret "$API_SECRET" \
  --admin-user "release-bot" \
  --admin-role "owner"
```

说明：

- 若未启用 `ADMIN_TRUST_HEADER_AUTH=true`，请改用 `--cookie "tp_admin_session=<session-id>"` 方式执行脚本。
- 若是自签名测试环境，可加 `--insecure`。
- 所有脚本支持 `--help` 查看参数。

#### 验证

- `smoke_org.sh` 成功时会打印 `组织域 smoke 通过`，且创建资源会在脚本内自动回收。
- `canary_gate.sh` 成功时会打印 `灰度检查通过`，并标记当前 `phase` 与 `with_smoke`。
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
