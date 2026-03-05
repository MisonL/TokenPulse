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

- `provider`: 提供商名称 (claude, gemini, antigravity, kiro, codex, qwen, iflow, copilot, aistudio, vertex)
- `accountId`（可选，query 参数）: 指定删除某个账号，例如 `DELETE /api/credentials/claude?accountId=user@example.com`；不传时删除该 provider 全部账号

### 2. OAuth 认证（统一入口）

> 旧版 `/api/credentials/auth/*` OAuth 路径已废弃，统一返回 `410 Gone`（仅保留 `/api/credentials/auth/aistudio/save` 与 `/api/credentials/auth/vertex/save` 手动保存入口）。
> 弃用窗口：`2026-03-01` 起进入迁移观测期（至 `2026-06-30`）；`2026-07-01` 起如仍命中旧路径，建议按 `critical` 级别处理并立即修复调用方。

旧路径 `410` 响应示例：

```json
{
  "error": "旧 OAuth 路径已废弃",
  "code": "legacy_oauth_route_deprecated",
  "replacement": "/api/oauth/:provider/start|poll|callback|status",
  "deprecatedSince": "2026-03-01",
  "compatibilityWindowEnd": "2026-06-30",
  "criticalAfter": "2026-07-01"
}
```

#### 获取 OAuth Provider 列表

```http
GET /api/oauth/providers
```

响应示例：

```json
{
  "data": [
    {
      "id": "claude",
      "flows": ["auth_code"],
      "supportsChat": true,
      "supportsModelList": true,
      "supportsStream": true,
      "supportsManualCallback": true
    }
  ]
}
```

说明：
- `flows` 为能力图谱驱动的完整流程列表。
- `supports*` 字段可用于前端按能力显隐操作入口。

#### 获取授权状态

```http
GET /api/oauth/status
```

响应结构与 `/api/credentials/status` 一致，包含 provider 布尔状态与 `counts` 账号计数。

#### 查询授权会话

```http
GET /api/oauth/session/:state
```

**响应示例**:

```json
{
  "exists": true,
  "state": "a1b2c3",
  "provider": "claude",
  "flow": "auth_code",
  "status": "pending",
  "phase": "waiting_callback",
  "pending": true,
  "success": false,
  "error": null,
  "expiresAtMs": 1741060800000,
  "remainingMs": 285000,
  "expiresAt": 1741060800000,
  "createdAt": "2026-03-04T03:00:00.000Z",
  "updatedAt": "2026-03-04T03:05:15.000Z",
  "completedAt": null
}
```

说明：
- `remainingMs` 为剩余有效期（毫秒），计算方式为 `max(0, expiresAtMs - 当前时间)`。
- `expiresAtMs` 与 `expiresAt` 当前都返回毫秒时间戳，便于兼容已有客户端。
- 当 `state` 不存在时返回 `404`：`{ "exists": false }`。

#### 启动 OAuth / Device Flow

```http
POST /api/oauth/:provider/start
```

**示例（Claude）**:

```json
{
  "url": "https://claude.ai/oauth/authorize?client_id=...",
  "state": "a1b2c3",
  "flow": "auth_code",
  "status": "pending",
  "phase": "waiting_callback"
}
```

**示例（Qwen/Kiro 设备流）**:

```json
{
  "deviceCode": "...",
  "userCode": "...",
  "verificationUri": "...",
  "verificationUriComplete": "...",
  "code_verifier": "...",
  "state": "d4e5f6",
  "flow": "device_code",
  "status": "pending",
  "phase": "waiting_device"
}
```

#### 轮询授权状态（统一）

```http
POST /api/oauth/:provider/poll
Content-Type: application/json
```

**Auth Code（claude/gemini/codex/iflow/antigravity）请求体**:

```json
{
  "state": "a1b2c3"
}
```

**Qwen 请求体**:

```json
{
  "state": "d4e5f6",
  "deviceCode": "...",
  "codeVerifier": "..."
}
```

**Kiro 请求体**:

```json
{
  "state": "d4e5f6",
  "deviceCode": "...",
  "clientId": "...",
  "clientSecret": "..."
}
```

**Copilot 请求体**:

```json
{
  "state": "d4e5f6",
  "deviceCode": "..."
}
```

轮询响应统一包含 `state/provider/flow/status/phase/pending/success/error`，其中：

- `status`: `pending | completed | error`
- `phase`: `waiting_callback | waiting_device | exchanging | completed | error`

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
> 当 `ENABLE_ADVANCED=false` 时：`GET/HEAD /api/admin/*`（除 `features` 外）返回 `503` 且 `code=ADVANCED_DISABLED_READONLY`；写接口（`POST/PUT/PATCH/DELETE`）返回 `404`。
> 当 `ENABLE_ADVANCED=true` 但 enterprise 后端不可用时，`/api/admin/*` 会返回 `503`，`code` 可能为 `ENTERPRISE_BACKEND_UNCONFIGURED`、`ENTERPRISE_BACKEND_URL_INVALID`、`ENTERPRISE_BACKEND_UNREACHABLE`。
> 组织域命名空间 `/api/org/*` 建议复用同一套开关语义与转发链路：标准版读接口 `503`、写接口 `404`；高级版依赖 enterprise 后端可达性。

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
GET /api/admin/audit/export
POST /api/admin/audit/events
GET /api/admin/billing/quotas
GET /api/admin/billing/policies
POST /api/admin/billing/policies
PUT /api/admin/billing/policies/:id
DELETE /api/admin/billing/policies/:id
GET /api/admin/billing/usage
```

`GET /api/admin/audit/events` 支持 `traceId`、`resourceId`、`policyId` 查询参数；审计事件响应包含 `traceId` 与 `resourceId` 字段。
`GET /api/admin/audit/export` 支持 `keyword/action/resource/resourceId/result/traceId/policyId/from/to/limit` 查询参数，返回 CSV 文件（默认 `limit=1000`，最大 `5000`）；`from`/`to` 用于按时间范围过滤（含边界，建议 ISO 8601）。
`GET /api/admin/billing/usage` 支持可选过滤：`policyId`、`bucketType`、`provider`、`model`、`tenantId`、`from`、`to`、`page`、`pageSize`、`limit`；`from/to` 需为 ISO 8601 且满足 `from <= to`。`pageSize` 优先，未传时回退 `limit`，默认 100，最大 500。响应中包含 `estimatedTokenCount`、`actualTokenCount`、`reconciledDelta`。
`POST/PUT/DELETE /api/admin/billing/policies*` 响应中会返回 `traceId`，便于与审计事件联动排查。

#### 组织域接口（`/api/org/*`）

> Core 节点会先走 enterprise proxy，实际业务契约由 enterprise 服务提供。以下为当前实现契约（`src/routes/org.ts`）。
> 能力探针统一使用 `GET /api/admin/features`，不要使用 `/api/org/features`。

开关与代理语义：

| 条件 | `GET/HEAD /api/org/*` | `POST/PUT/PATCH/DELETE /api/org/*` |
| ---- | --------------------- | ---------------------------------- |
| `ENABLE_ADVANCED=false` | `503` + `code=ADVANCED_DISABLED_READONLY` | `404` |
| `ENABLE_ADVANCED=true` 且 enterprise 未配置/不可达 | `503`（`ENTERPRISE_BACKEND_UNCONFIGURED` / `ENTERPRISE_BACKEND_URL_INVALID` / `ENTERPRISE_BACKEND_UNREACHABLE`） | 同左 |
| `ENABLE_ADVANCED=true` 且 enterprise 可达 | 由 enterprise 服务返回真实业务响应 | 由 enterprise 服务返回真实业务响应 |

统一鉴权与 RBAC：

- 组织域接口要求管理员身份（未认证返回 `403`：`管理员未登录或无权限`）。
- 组织域读接口（`GET/HEAD`）要求 `admin.org.read`（权限不足返回 `403`，并包含 `required=admin.org.read`）。
- 组织域写接口（`POST/PUT/PATCH/DELETE`）要求 `admin.org.manage`（权限不足返回 `403`，并包含 `required=admin.org.manage`）。
- `admin.org.manage` 被视为 `admin.org.read` 的超集。

路由契约：

```http
GET    /api/org/overview

GET    /api/org/organizations?status=active|disabled
POST   /api/org/organizations
PUT    /api/org/organizations/:id
DELETE /api/org/organizations/:id

GET    /api/org/projects?organizationId=:orgId&status=active|disabled
POST   /api/org/projects
PUT    /api/org/projects/:id
DELETE /api/org/projects/:id

GET    /api/org/members?organizationId=:orgId&userId=:userId&status=active|disabled
POST   /api/org/members
POST   /api/org/members/batch
PUT    /api/org/members/:id
DELETE /api/org/members/:id

GET    /api/org/member-project-bindings?organizationId=:orgId&memberId=:memberId&projectId=:projectId
POST   /api/org/member-project-bindings
POST   /api/org/member-project-bindings/batch
DELETE /api/org/member-project-bindings/:id
```

关键请求/响应语义：

- `GET /api/org/overview`
  成功：`{ data: { organizations, projects, members, bindings } }`
  其中 `organizations/projects/members` 均包含 `{ total, active, disabled }`，`bindings` 包含 `{ total }`

- `POST /api/org/organizations`
  请求体：`{ id?, name, description?, status? }`
  成功：`{ success: true, id, traceId }`
- `POST /api/org/projects`
  请求体：`{ id?, organizationId, name, description?, status? }`
  若组织不存在返回 `404`：`组织不存在`
- `POST /api/org/members`
  请求体：`{ id?, organizationId, userId?, email?, displayName?, role?, status? }`
  约束：`userId` 与 `email` 至少提供一个；`userId` 传入时必须对应已有管理员用户
- `POST /api/org/member-project-bindings`
  请求体：`{ organizationId, memberId, projectId }`
  约束：成员与项目必须存在且属于同一组织；重复绑定返回 `409`
- `POST /api/org/members/batch`
  请求体：`{ items: Array<{ id?, organizationId, userId?, email?, displayName?, role?, status? }> }`
  返回聚合：`{ success, data: { requested, successCount, errorCount, successes, errors }, traceId }`
- `POST /api/org/member-project-bindings/batch`
  请求体：`{ items: Array<{ organizationId, memberId, projectId }> }`
  返回聚合：`{ success, data: { requested, successCount, errorCount, successes, errors }, traceId }`
- `DELETE /api/org/member-project-bindings/:id`
  `id` 必须为正整数，否则返回 `400`：`绑定 ID 无效`

组织域审计语义：

- 组织域写操作会自动写入审计（如 `org.organization.create`、`org.project.update`、`org.member_project_binding.delete`）。
- 写接口响应包含 `traceId`，可通过 `GET /api/admin/audit/events?traceId=...` 关联排查。
- 审计查询与导出统一走 `/api/admin/audit/events` 与 `/api/admin/audit/export`，不是 `/api/org/audit/*`。

`GET /api/admin/billing/usage` 响应示例：

```json
{
  "data": [
    {
      "id": 101,
      "policyId": "quota-global-default",
      "policyName": "默认全局配额",
      "bucketType": "minute",
      "windowStart": 1741060800000,
      "requestCount": 12,
      "tokenCount": 3240,
      "estimatedTokenCount": 3300,
      "actualTokenCount": 3240,
      "reconciledDelta": -60,
      "scopeType": "global",
      "scopeValue": null,
      "provider": "claude",
      "modelPattern": "*",
      "createdAt": "2026-03-04T03:00:00.000Z",
      "updatedAt": "2026-03-04T03:00:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 156,
  "totalPages": 8
}
```

#### 模型治理接口（高级版）

```http
GET /api/admin/oauth/selection-policy
PUT /api/admin/oauth/selection-policy
GET /api/admin/oauth/route-policies
PUT /api/admin/oauth/route-policies
GET /api/admin/oauth/capability-map
PUT /api/admin/oauth/capability-map
GET /api/admin/oauth/capability-health
GET /api/admin/oauth/session-events
GET /api/admin/oauth/session-events/:state
GET /api/admin/oauth/session-events/export
GET /api/admin/oauth/callback-events
GET /api/admin/oauth/callback-events/:state
GET /api/admin/observability/oauth-alerts/config
PUT /api/admin/observability/oauth-alerts/config
POST /api/admin/observability/oauth-alerts/evaluate
POST /api/admin/observability/oauth-alerts/test-delivery
GET /api/admin/observability/oauth-alerts/incidents
GET /api/admin/observability/oauth-alerts/deliveries
GET /api/admin/observability/oauth-alerts/rules/active
GET /api/admin/observability/oauth-alerts/rules/versions
POST /api/admin/observability/oauth-alerts/rules/versions
POST /api/admin/observability/oauth-alerts/rules/versions/:versionId/rollback
GET /api/admin/observability/oauth-alerts/alertmanager/config
PUT /api/admin/observability/oauth-alerts/alertmanager/config
POST /api/admin/observability/oauth-alerts/alertmanager/sync
GET /api/admin/observability/oauth-alerts/alertmanager/sync-history
POST /api/admin/observability/oauth-alerts/alertmanager/sync-history/:historyId/rollback
GET /api/admin/oauth/alerts/config
PUT /api/admin/oauth/alerts/config
POST /api/admin/oauth/alerts/evaluate
GET /api/admin/oauth/alerts/incidents
GET /api/admin/oauth/alerts/deliveries
GET /api/admin/oauth/alerts/rules/active
GET /api/admin/oauth/alerts/rules/versions
POST /api/admin/oauth/alerts/rules/versions
POST /api/admin/oauth/alerts/rules/versions/:versionId/rollback
GET /api/admin/oauth/alertmanager/config
PUT /api/admin/oauth/alertmanager/config
POST /api/admin/oauth/alertmanager/sync
GET /api/admin/oauth/alertmanager/sync-history
POST /api/admin/oauth/alertmanager/sync-history/:historyId/rollback
GET /api/admin/observability/claude-fallbacks
GET /api/admin/observability/claude-fallbacks/summary
GET /api/admin/observability/claude-fallbacks/timeseries
GET /api/admin/oauth/model-alias
PUT /api/admin/oauth/model-alias
GET /api/admin/oauth/excluded-models
PUT /api/admin/oauth/excluded-models
```

> 规则生效范围：`/v1/chat/completions`、`/v1/messages` 以及 `/api/models` 返回结果。
> `GET /api/admin/oauth/session-events` 支持分页与筛选参数：`state/provider/flowType/phase/status/eventType/from/to`。
> `GET /api/admin/oauth/session-events/:state` 为按 `state` 聚合诊断入口，支持同样的分页与时间范围参数。
> `GET /api/admin/oauth/session-events/export` 支持筛选参数：`state/provider/flowType/phase/status/eventType/from/to/limit`，返回 UTF-8 BOM CSV（默认 `limit=1000`，最大 `5000`）。
> `GET /api/admin/oauth/callback-events` 支持分页与筛选参数：`provider/status/source/state/traceId/from/to`。
> OAuth 告警中心主路由为 `/api/admin/observability/oauth-alerts/*`，同时兼容 `/api/admin/oauth/alerts/*`。
> `GET /api/admin/observability/oauth-alerts/config` 返回告警引擎与投递抑制配置；`PUT` 支持参数：`enabled/warningRateThresholdBps/warningFailureCountThreshold/criticalRateThresholdBps/criticalFailureCountThreshold/recoveryRateThresholdBps/recoveryFailureCountThreshold/dedupeWindowSec/recoveryConsecutiveWindows/windowSizeSec/quietHoursEnabled/quietHoursStart/quietHoursEnd/quietHoursTimezone/muteProviders/minDeliverySeverity`。
> `POST /api/admin/observability/oauth-alerts/evaluate` 手动触发一次当前窗口评估。
> `POST /api/admin/observability/oauth-alerts/test-delivery` 支持 `eventId` 或自定义 `provider/phase/severity/totalCount/failureCount/failureRateBps/message` 发送测试通知。
> `GET /api/admin/observability/oauth-alerts/incidents` 支持筛选参数：`provider/phase/severity/from/to/page/pageSize`。
> `GET /api/admin/observability/oauth-alerts/deliveries` 支持筛选参数：`eventId/incidentId/provider/phase/severity/channel/status/from/to/page/pageSize`，`status` 查询兼容 `success|failure|sent|failed`，响应统一为 `success|failure`。
> OAuth 告警规则版本接口权限：`owner` 可读写，`auditor` 只读。`GET /rules/active` 返回当前激活版本（含 `rules/muteWindows/recoveryPolicy`）；`GET /rules/versions` 支持 `page/pageSize/status`；`POST /rules/versions` 支持 `version?/description?/activate?/rules[]/muteWindows?/recoveryPolicy?`；`POST /rules/versions/:versionId/rollback` 将目标版本激活并回退。创建冲突时返回 `409`：重复版本为 `oauth_alert_rule_version_already_exists`，静默窗口重叠冲突为 `oauth_alert_rule_mute_window_conflict`（响应可附带 `details`）。
> `muteWindows` 元素结构：`id?/name?/timezone/start/end/weekdays?/severities?`；`start/end` 使用 `HH:mm`；`weekdays` 使用 `0-6`（`0=Sunday`）；`severities` 支持 `warning|critical|recovery`。
> `recoveryPolicy` 当前支持 `consecutiveWindows`（覆盖引擎默认恢复窗口数）。
> Alertmanager 控制面接口权限：`owner` 可读写，`auditor` 只读。`GET/PUT /alertmanager/config` 读取/更新配置（Webhook URL 自动脱敏）；`POST /alertmanager/sync` 执行写文件->reload->ready，并在失败时自动回滚；`GET /alertmanager/sync-history` 支持分页参数 `page/pageSize`（兼容 `limit=1..200`）；`POST /alertmanager/sync-history/:historyId/rollback` 可按历史记录回滚并触发一次同步校验，请求体支持可选 `reason/comment`（示例：`{ "reason": "rollback-test", "comment": "恢复到稳定配置" }`）。并发执行 `sync/rollback` 时返回 `409`，错误码 `alertmanager_sync_in_progress`。
> `GET /api/admin/observability/claude-fallbacks` 支持分页与筛选参数：`mode/phase/reason/traceId/from/to`。
> `GET /api/admin/observability/claude-fallbacks/summary` 返回聚合统计：`total/byMode/byPhase/byReason`，筛选参数与列表接口一致。
> `GET /api/admin/observability/claude-fallbacks/timeseries` 返回时间序列统计：`step/data`；支持筛选参数 `mode/phase/reason/traceId/from/to`，`step` 支持 `5m/15m/1h/6h/1d`（默认 `15m`），`data` 项包含 `bucketStart/total/success/failure/bridgeShare`。
> `GET /api/admin/oauth/capability-health` 返回能力图谱与运行时适配器的一致性报告（`ok/issueCount/issues`）。
> `quietHoursStart/quietHoursEnd` 格式为 `HH:mm`；相等时表示全天静默。`muteProviders` 为小写 provider 列表，`minDeliverySeverity` 支持 `warning|critical`。
> `from/to` 建议使用 ISO 8601 且包含时区（例如 `2026-03-01T00:00:00.000Z`），并要求 `from <= to`。

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
- `X-TokenPulse-User`、`X-TokenPulse-Tenant`、`X-TokenPulse-Role`：仅在 `TRUST_PROXY=true` 时用于配额身份透传；未启用可信代理时会被忽略并回退为系统默认身份。

统一响应头（`/v1/*`）：

- `x-tokenpulse-provider`：最终命中的提供商。
- `x-tokenpulse-route-policy`：本次请求实际采用的路由策略。
- `x-tokenpulse-fallback`：本次请求触发的回退链路（`none` / `api_key` / `bridge` / 组合值）。
- `x-tokenpulse-account-id`：最终命中的账号 ID。

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
- **Claude 传输降级**: strict 模式失败时可按策略降级到 bridge，并支持内部鉴权、超时、重试与熔断参数（`CLAUDE_BRIDGE_SHARED_KEY`、`CLAUDE_BRIDGE_TIMEOUT_MS`、`CLAUDE_BRIDGE_MAX_RETRIES`、`CLAUDE_BRIDGE_CIRCUIT_THRESHOLD`、`CLAUDE_BRIDGE_CIRCUIT_COOLDOWN_SEC`）

## 错误响应

所有错误响应遵循以下格式：

```json
{
  "error": "错误描述",
  "code": "错误码（可选，OAuth 与运行时诊断场景建议必带）",
  "traceId": "请求追踪 ID（可选）",
  "details": "详细信息（可选）"
}
```

OAuth 统一入口（`/api/oauth/*`）在失败时返回结构化错误信封，至少包含 `error + code + traceId`。常见 `code` 包括：

- `oauth_provider_unsupported`
- `oauth_invalid_state`
- `oauth_session_not_found`
- `oauth_callback_missing_state`
- `oauth_callback_missing_code`
- `oauth_callback_provider_error`
- `oauth_callback_delegate_failed`
- `oauth_manual_callback_delegate_failed`

常见 HTTP 状态码：

- `200 OK`: 请求成功
- `400 Bad Request`: 请求参数错误
- `401 Unauthorized`: 未授权
- `403 Forbidden`: 权限不足或模型被禁用
- `404 Not Found`: 资源不存在
- `429 Too Many Requests`: 触发限流或配额限制
- `500 Internal Server Error`: 服务器内部错误

配额拒绝（429）响应中会包含 `traceId`、`policyId`、`provider`、`model`、`meteringMode`（固定为 `estimate_then_reconcile`），用于与审计日志 `trace_id/resource_id` 对齐排查。

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
