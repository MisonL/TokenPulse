# TokenPulse AI Gateway - API 文档

## 概述

TokenPulse AI Gateway 是一个统一的 AI 服务提供商网关，支持多个 AI 服务提供商的 OAuth 认证和 API 调用。

## 基础信息

- **基础 URL**: `http://localhost:9009`
- **认证方式**: OAuth 2.0
- **支持的数据格式**: JSON

## API 端点

### 1. 凭证管理

#### 获取凭证状态

```http
GET /api/credentials/status
```

**响应示例**:

```json
{
  "kiro": false,
  "codex": false,
  "qwen": false,
  "iflow": false,
  "aistudio": false,
  "vertex": false,
  "claude": false,
  "gemini": false,
  "antigravity": false,
  "copilot": false,
  "counts": {
    "kiro": 0,
    "codex": 0,
    "qwen": 0,
    "iflow": 0,
    "aistudio": 0,
    "vertex": 0,
    "claude": 0,
    "gemini": 0,
    "antigravity": 0,
    "copilot": 0
  }
}
```

#### 获取所有凭证

```http
GET /api/credentials
```

**响应示例**:

```json
[
  {
    "id": "uuid",
    "provider": "claude",
    "accountId": "user@example.com",
    "email": "user@example.com",
    "status": "active",
    "lastRefresh": "2026-01-13T00:00:00.000Z",
    "expiresAt": 1799736918987,
    "metadata": {}
  }
]
```

#### 删除凭证

```http
DELETE /api/credentials/:provider
```

**参数**:

- `provider`: 提供商名称 (claude, gemini, antigravity, kiro, codex, qwen, iflow, aistudio)
- `accountId`（可选，query 参数）: 指定删除某个账号，例如 `DELETE /api/credentials/claude?accountId=user@example.com`；不传时删除该 provider 全部账号

### 2. OAuth 认证（统一入口）

> 旧版 `/api/credentials/auth/*` OAuth 路径已移除，不再提供兼容入口。

#### 获取 OAuth Provider 列表

```http
GET /api/oauth/providers
```

#### 获取授权状态

```http
GET /api/oauth/status
```

响应结构与 `/api/credentials/status` 一致，包含 provider 布尔状态与 `counts` 账号计数。

#### 查询授权会话

```http
GET /api/oauth/session/:state
```

#### 启动 OAuth / Device Flow

```http
POST /api/oauth/:provider/start
```

**示例（Claude）**:

```json
{
  "url": "https://claude.ai/oauth/authorize?client_id=..."
}
```

**示例（Qwen/Kiro 设备流）**:

```json
{
  "deviceCode": "...",
  "userCode": "...",
  "verificationUri": "...",
  "verificationUriComplete": "...",
  "code_verifier": "..."
}
```

#### 轮询 Device Flow

```http
POST /api/oauth/:provider/poll
Content-Type: application/json
```

**Qwen 请求体**:

```json
{
  "deviceCode": "...",
  "codeVerifier": "..."
}
```

**Kiro 请求体**:

```json
{
  "deviceCode": "...",
  "clientId": "...",
  "clientSecret": "..."
}
```

#### 手动回调（适用于远程/无本地回调端口场景）

```http
POST /api/oauth/:provider/callback/manual
Content-Type: application/json
```

```json
{
  "url": "http://localhost/callback?code=...&state=..."
}
```

#### 统一回调聚合接口

```http
POST /api/oauth/callback
Content-Type: application/json
```

```json
{
  "provider": "claude",
  "redirect_url": "http://localhost/callback?code=...&state=...",
  "code": "...",
  "state": "...",
  "error": "..."
}
```

#### AI Studio

**保存 Service Account**:

```http
{
  "serviceAccountJson": "{...}"
}
```

#### Antigravity Token 计数 (Proxy)

**路径**:

```http
POST /api/antigravity/v1internal:countTokens
Content-Type: application/json
```

**请求示例**:

```json
{
  "model": "gemini-2.0-flash-exp",
  "messages": [{ "role": "user", "content": "hello" }]
}
```

**响应示例**:

```json
{
  "totalTokens": 12
}
```

### 3. 统计信息

```http
GET /api/stats
```

**响应示例**:

```json
{
  "active_providers": 2,
  "total_requests": 110,
  "avg_latency_ms": 27,
  "uptime_percentage": 97.27,
  "traffic_history": [0, 0, 0, 0, 1, 0, 5, 0, 0, 2, 0, 6],
  "tokens": {
    "prompt": 125030,
    "completion": 45020,
    "total": 170050
  }
}
```

### 4. 日志

```http
GET /api/logs?limit=10
```

**响应示例**:

```json
{
  "data": [
    {
      "id": 1,
      "timestamp": "2026-01-13T00:00:00.000Z",
      "level": "INFO",
      "source": "System",
      "message": "Server started on port 3000"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

### 5. 系统设置

```http
GET /api/settings
```

**响应示例**:

```json
{
  "systemName": "TokenPulse Gateway",
  "maintenanceMode": false,
  "logLevel": "INFO",
  "apiKey": "****************",
  "tokenExpiry": 3600,
  "allowRegistration": false,
  "defaultProvider": "Antigravity"
}
```

### 6. 企业管理（高级版）

> `GET /api/admin/features` 在标准版和高级版均可访问，用于探测能力开关。
> 其余 `/api/admin/*` 接口仅在高级版可用。

#### 获取能力开关

```http
GET /api/admin/features
```

#### RBAC 相关接口

```http
GET /api/admin/rbac/permissions
GET /api/admin/rbac/roles
POST /api/admin/rbac/roles
PUT /api/admin/rbac/roles/:key
DELETE /api/admin/rbac/roles/:key
```

#### 管理员会话接口（local/hybrid 模式）

```http
POST /api/admin/auth/login
POST /api/admin/auth/logout
GET /api/admin/auth/me
```

#### 用户与租户管理

```http
GET /api/admin/users
POST /api/admin/users
PUT /api/admin/users/:id
DELETE /api/admin/users/:id
GET /api/admin/tenants
POST /api/admin/tenants
PUT /api/admin/tenants/:id
DELETE /api/admin/tenants/:id
```

#### 审计与配额接口

```http
GET /api/admin/audit/events
POST /api/admin/audit/events
GET /api/admin/billing/quotas
GET /api/admin/billing/policies
POST /api/admin/billing/policies
PUT /api/admin/billing/policies/:id
DELETE /api/admin/billing/policies/:id
GET /api/admin/billing/usage
```

`GET /api/admin/audit/events` 支持 `traceId` 查询参数；审计事件响应新增 `traceId` 字段。

#### 模型治理接口（高级版）

```http
GET /api/admin/oauth/selection-policy
PUT /api/admin/oauth/selection-policy
GET /api/admin/oauth/callback-events
GET /api/admin/oauth/callback-events/:state
GET /api/admin/oauth/model-alias
PUT /api/admin/oauth/model-alias
GET /api/admin/oauth/excluded-models
PUT /api/admin/oauth/excluded-models
```

> 规则生效范围：`/v1/chat/completions`、`/v1/messages` 以及 `/api/models` 返回结果。
> `GET /api/admin/oauth/callback-events` 支持分页与筛选参数：`provider/status/source/state/traceId/from/to`。

### 7. v1 网关接口（兼容）

```http
POST /v1/chat/completions
POST /v1/messages
GET /v1/models
POST /v1/responses
```

说明：

- `/v1/models` 返回 OpenAI `list` 结构。
- `/v1/responses` 提供基础 Responses API 兼容能力，支持非流式与流式文本输出。

可选请求头：

- `x-admin-user`, `x-admin-role`, `x-admin-tenant`：仅在 `TRUST_PROXY=true` 且 `ADMIN_TRUST_HEADER_AUTH=true` 时生效，用于反向代理透传管理员身份。
- `X-Request-Id`：请求追踪 ID；不传时系统自动生成并在响应头回传。
- `X-TokenPulse-Account-Id`：指定使用的账号 ID（仅在 `TRUST_PROXY=true` 且 `ALLOW_HEADER_ACCOUNT_OVERRIDE=true` 时生效）。
- `X-TokenPulse-Selection-Policy`：请求级路由策略覆盖（`round_robin|latest_valid|sticky_user`，需启用策略头覆盖）。

## 支持的提供商

| 提供商      | OAuth 类型                | 回调端口 | 说明                   |
| ----------- | ------------------------- | -------- | ---------------------- |
| Claude      | Authorization Code + PKCE | 54545    | Anthropic Claude API   |
| Gemini      | Authorization Code        | 8085     | Google Gemini AI       |
| Antigravity | Authorization Code        | -        | Google DeepMind AI     |
| Codex       | Authorization Code + PKCE | 1455     | OpenAI Codex           |
| iFlow       | Authorization Code        | 11451    | iFlow 心流             |
| Qwen        | Device Flow               | -        | 阿里云通义千问         |
| Kiro        | Device Flow               | -        | AWS CodeWhisperer      |
| AI Studio   | API Key                   | -        | Google AI Studio       |
| Vertex      | Service Account           | -        | Google Cloud Vertex AI |
| Copilot     | Device Flow               | -        | GitHub Copilot         |

## 安全特性

- **PKCE (Proof Key for Code Exchange)**: Claude, Codex 使用 PKCE 增强安全性
- **State 参数**: 所有 OAuth 流程使用 state 参数防止 CSRF 攻击
- **HTTPS**: 生产环境建议使用 HTTPS
- **Token 刷新**: 自动刷新过期 token
- **Claude 传输降级**: strict 模式失败时可按策略降级到 bridge，并支持超时、重试与熔断参数（`CLAUDE_BRIDGE_TIMEOUT_MS`、`CLAUDE_BRIDGE_MAX_RETRIES`、`CLAUDE_BRIDGE_CIRCUIT_THRESHOLD`、`CLAUDE_BRIDGE_CIRCUIT_COOLDOWN_SEC`）

## 错误响应

所有错误响应遵循以下格式：

```json
{
  "error": "错误描述",
  "details": "详细信息（可选）"
}
```

常见 HTTP 状态码：

- `200 OK`: 请求成功
- `400 Bad Request`: 请求参数错误
- `401 Unauthorized`: 未授权
- `403 Forbidden`: 权限不足或模型被禁用
- `404 Not Found`: 资源不存在
- `429 Too Many Requests`: 触发限流或配额限制
- `500 Internal Server Error`: 服务器内部错误

配额拒绝（429）响应中会包含 `traceId`，用于与审计日志 `trace_id` 对齐排查。

## 速率限制

API 请求受速率限制保护，默认配置：

- 每个客户端每分钟最多 100 个请求
- 超过限制将返回 `429 Too Many Requests`
- 如需自定义限流，请设置 `TRUST_PROXY=true` 并配置反向代理

## 请求体限制

- 最大请求体大小：50MB
- 适用于所有 API 端点

## 版本

当前版本: `1.4.2` (2026-03-03)
