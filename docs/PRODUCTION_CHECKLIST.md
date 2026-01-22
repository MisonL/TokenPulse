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

| 变量名         | 说明              | 默认值                |
| -------------- | ----------------- | --------------------- |
| `DB_FILE_NAME` | SQLite 数据库路径 | `data/credentials.db` |

## 生产部署检查清单

### 启动前检查

- [ ] `API_SECRET` 已设置为强随机密钥 (≥32字符)
- [ ] `NODE_ENV=production` 已设置
- [ ] `BASE_URL` 指向正确的公网地址
- [ ] 如在代理后部署，`TRUST_PROXY=true` 已设置
- [ ] `UNSAFE_DISABLE_TLS_CHECK` **未设置**
- [ ] `ENCRYPTION_SECRET` 已设置为强随机密钥 (≥32字符)
- [ ] 数据卷 `./data` 已挂载并有写权限

### 启动后验证

```bash
# 健康检查
curl http://localhost:9009/health

# 预期输出
# {"status":"ok","service":"oauth2api","providers":[...]}

# 公开端点检查
curl http://localhost:9009/api/credentials/status

# 受保护端点检查 (应返回 401)
curl http://localhost:9009/api/models
```

### 安全验证

```bash
# 验证 API_SECRET 生效
curl -H "Authorization: Bearer wrong-secret" http://localhost:9009/api/models
# 预期: 401 Unauthorized

curl -H "Authorization: Bearer your-actual-secret" http://localhost:9009/api/models
# 预期: 200 OK (或空列表)
```
