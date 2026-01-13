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
  "claude": false,
  "gemini": false,
  "antigravity": false
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

### 2. OAuth 认证

#### Claude OAuth

**生成授权 URL**:

```http
POST /api/credentials/auth/claude/url
```

**响应示例**:

```json
{
  "url": "https://claude.ai/oauth/authorize?client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&..."
}
```

**回调端口**: 54545

#### Gemini OAuth

**生成授权 URL**:

```http
POST /api/credentials/auth/gemini/url
```

**响应示例**:

```json
{
  "url": "https://accounts.google.com/o/oauth2/auth?client_id=681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com&..."
}
```

**回调端口**: 8085

#### Codex OAuth

**生成授权 URL**:

```http
POST /api/credentials/auth/codex/url
```

**响应示例**:

```json
{
  "url": "https://auth.openai.com/oauth/authorize?client_id=app_EMoamEEZ73f0CkXaXp7hrann&..."
}
```

**回调端口**: 1455

#### iFlow OAuth

**生成授权 URL**:

```http
POST /api/credentials/auth/iflow/url
```

**响应示例**:

```json
{
  "url": "https://iflow.cn/oauth?loginMethod=phone&type=phone&..."
}
```

**回调端口**: 11451

#### Qwen OAuth

**启动设备流程**:

```http
POST /api/credentials/auth/qwen/start
```

**响应示例**:

```json
{
  "deviceCode": "R_k4Ix7fRvGjsfu4xomMrZzPhClCNfj7a85gj-V7Vgpnz0r5Vn2rebds5_2IwIFG4-Nta5rqJN2ZaExRd9lOOA",
  "expiresIn": 600,
  "interval": 1,
  "userCode": "ZPGH-WFKK",
  "verificationUri": "https://chat.qwen.ai/authorize",
  "code_verifier": "..."
}
```

**轮询 token**:

```http
POST /api/credentials/auth/qwen/poll
Content-Type: application/json

{
  "device_code": "R_k4Ix7fRvGjsfu4xomMrZzPhClCNfj7a85gj-V7Vgpnz0r5Vn2rebds5_2IwIFG4-Nta5rqJN2ZaExRd9lOOA",
  "code_verifier": "..."
}
```

#### Kiro OAuth

**启动设备流程**:

```http
POST /api/credentials/auth/kiro/start
```

**响应示例**:

```json
{
  "deviceCode": "R_k4Ix7fRvGjsfu4xomMrZzPhClCNfj7a85gj-V7Vgpnz0r5Vn2rebds5_2IwIFG4-Nta5rqJN2ZaExRd9lOOA",
  "expiresIn": 600,
  "interval": 1,
  "userCode": "ZPGH-WFKK",
  "verificationUri": "https://view.awsapps.com/start/#/device",
  "verificationUriComplete": "https://view.awsapps.com/start/#/device?user_code=ZPGH-WFKK",
  "clientId": "a2lVQqA-UW9XOvMx8VSAsHVzLWVhc3QtMQ",
  "clientSecret": "..."
}
```

#### AI Studio

**保存 Service Account**:

```http
POST /api/credentials/auth/aistudio/save
Content-Type: application/json

{
  "serviceAccountJson": "{...}"
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
  "traffic_history": [0, 0, 0, 0, 1, 0, 5, 0, 0, 2, 0, 6]
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

## 支持的提供商

| 提供商      | OAuth 类型                | 回调端口 | 说明                 |
| ----------- | ------------------------- | -------- | -------------------- |
| Claude      | Authorization Code + PKCE | 54545    | Anthropic Claude API |
| Gemini      | Authorization Code        | 8085     | Google Gemini AI     |
| Antigravity | Authorization Code        | -        | Google DeepMind AI   |
| Codex       | Authorization Code + PKCE | 1455     | OpenAI Codex         |
| iFlow       | Authorization Code        | 11451    | iFlow 心流           |
| Qwen        | Device Flow               | -        | 阿里云通义千问       |
| Kiro        | Device Flow               | -        | AWS CodeWhisperer    |
| AI Studio   | Service Account           | -        | Google Cloud AI      |

## 安全特性

- **PKCE (Proof Key for Code Exchange)**: Claude, Codex 使用 PKCE 增强安全性
- **State 参数**: 所有 OAuth 流程使用 state 参数防止 CSRF 攻击
- **HTTPS**: 生产环境建议使用 HTTPS
- **Token 刷新**: 自动刷新过期 token

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
- `404 Not Found`: 资源不存在
- `500 Internal Server Error`: 服务器内部错误

## 速率限制

API 请求受速率限制保护，默认配置：

- 每个客户端每分钟最多 60 个请求
- 超过限制将返回 `429 Too Many Requests`

## 版本

当前版本: `1.0.0`
