# TokenPulse 故障排查手册

## 快速诊断

```bash
# 1. 检查服务状态
docker ps | grep tokenpulse

# 2. 检查健康端点
curl -s http://localhost:9009/health | jq

# 3. 检查最近日志
docker logs tokenpulse --tail 50
```

## 常见问题

### 1. 服务无法启动

**症状**：容器启动后立即退出

**诊断**：

```bash
docker logs tokenpulse
```

**常见原因与解决**：

| 错误信息                    | 原因                     | 解决方案                   |
| --------------------------- | ------------------------ | -------------------------- |
| `API_SECRET is required`    | 生产环境未设置密钥       | 设置 `API_SECRET` 环境变量 |
| `EACCES: permission denied` | 数据目录权限问题         | `chmod 755 ./data`         |
| `ENOENT: no such file`      | 数据目录不存在           | `mkdir -p ./data`          |
| `Decryption failed`         | `ENCRYPTION_SECRET` 错误 | 确认为初始加密时使用的密钥 |

### 2. 401 Unauthorized

**症状**：所有 API 请求返回 401

**诊断**：

```bash
# 检查 API_SECRET 是否正确传递
docker exec tokenpulse printenv API_SECRET
```

**解决**：

- 确认 Authorization header 格式：`Bearer <your-secret>`
- 确认 `API_SECRET` 环境变量与请求中的值一致

### 3. OAuth 回调失败

**症状**：Provider 授权后跳转报错

**诊断**：

```bash
# 检查回调端口是否暴露
docker port tokenpulse

# 检查 BASE_URL 配置
docker exec tokenpulse printenv BASE_URL
```

**解决**：

- 确认 `BASE_URL` 与实际访问地址一致
- 确认回调端口已正确映射 (8085, 54545, 1455, 11451)

### 4. Token 刷新失败

**症状**：Provider 显示 `active` 但请求失败

**诊断**：

```bash
# 检查 token 过期时间
sqlite3 ./data/credentials.db "SELECT provider, expiresAt FROM credentials"
```

**解决**：

- 重新授权该 Provider
- 检查 Provider 服务是否可用
- 检查 `ENCRYPTION_SECRET` 是否正确配置（解密失败会导致刷新逻辑异常）

### 5. 限流触发

**症状**：请求返回 429 Too Many Requests

**诊断**：

```bash
# 检查请求频率
docker logs tokenpulse | grep "429"
```

**解决**：

- 减少请求频率（默认限制：100 次/分钟/IP）
- 如在代理后，确认 `TRUST_PROXY=true`

### 6. TLS 证书错误

**症状**：请求 Provider API 时报 TLS 错误

**诊断**：

```bash
# 检查是否需要禁用 TLS 校验（仅开发环境）
docker exec tokenpulse printenv UNSAFE_DISABLE_TLS_CHECK
```

**解决**：

- 生产环境：修复证书链
- 开发环境：设置 `UNSAFE_DISABLE_TLS_CHECK=1`

## 日志分析

### 关键日志模式

| 模式                        | 含义         | 行动         |
| --------------------------- | ------------ | ------------ |
| `[ERROR]`                   | 错误事件     | 需立即排查   |
| `[WARN]`                    | 警告信息     | 需关注       |
| `[TokenManager] Refreshing` | Token 刷新中 | 正常         |
| `401`                       | 认证失败     | 检查 Token   |
| `429`                       | 限流触发     | 检查请求频率 |

### 日志过滤

```bash
# 仅查看错误
docker logs tokenpulse 2>&1 | grep "\[ERROR\]"

# 查看特定 Provider
docker logs tokenpulse 2>&1 | grep "claude"

# 查看最近 5 分钟
docker logs tokenpulse --since 5m
```

## 数据库诊断

```bash
# 检查数据库完整性
sqlite3 ./data/credentials.db "PRAGMA integrity_check"

# 查看所有凭证状态
sqlite3 ./data/credentials.db "SELECT provider, status, email FROM credentials"

# 查看 Token 过期时间
sqlite3 ./data/credentials.db "SELECT provider, datetime(expiresAt/1000, 'unixepoch') FROM credentials"
```

## 网络诊断

```bash
# 从容器内测试外部连接
docker exec tokenpulse curl -I https://api.anthropic.com

# 检查 DNS 解析
docker exec tokenpulse nslookup api.anthropic.com

# 检查代理配置
docker exec tokenpulse printenv | grep -i proxy
```

## 重置与清理

### 重置单个 Provider

```bash
sqlite3 ./data/credentials.db "DELETE FROM credentials WHERE provider='claude'"
```

### 完全重置

```bash
docker compose down
rm -rf ./data/credentials.db
docker compose up -d
```

## 获取支持

如问题无法解决，请提供以下信息：

1. `docker logs tokenpulse --tail 100`
2. `docker exec tokenpulse printenv | grep -v SECRET`
3. 问题复现步骤
