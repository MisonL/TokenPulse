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

### 安全验证

```bash
# 验证 API_SECRET 生效
curl -H "Authorization: Bearer wrong-secret" http://localhost:9009/api/models
# 预期: 401 Unauthorized

curl -H "Authorization: Bearer your-actual-secret" http://localhost:9009/api/models
# 预期: 200 OK (或空列表)
```

## 组织域回滚检查清单

- [ ] 回滚开关前，确认 enterprise 数据已备份
- [ ] 将 `ENABLE_ADVANCED=false` 并重启 Core
- [ ] 验证 `GET /api/org/*` 返回 `503` 且 `code=ADVANCED_DISABLED_READONLY`
- [ ] 验证 `POST/PUT/PATCH/DELETE /api/org/*` 返回 `404`
- [ ] 若为版本回滚：`ENTERPRISE_BASE_URL` 已指向上一版本并通过 `/api/admin/features` 复检 `enterpriseBackend.reachable=true`
- [ ] 观察主链路 `/v1/*` 与 `/api/oauth/*` 未受影响
