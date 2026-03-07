# TokenPulse × AgentLedger 联合对接稿 v1

## 文档元信息

| 项 | 值 |
| --- | --- |
| 唯一入口路径 | `docs/integration/TOKENPULSE_AGENTLEDGER_V1.md` |
| 文档状态 | `draft` |
| 版本号 | `v1-draft.1` |
| TokenPulse 侧负责人 | `TokenPulse Runtime Interface Owner` |
| AgentLedger 侧负责人 | `AgentLedger Governance Interface Owner` |
| 更新时间 | `2026-03-07 12:16:11 +0800` |
| 计划提交时间 | `2026-03-08 18:00:00 +0800` |
| 评审窗口 | `2026-03-08 18:00:00 +0800` 至 `2026-03-10 18:00:00 +0800` |
| 评审范围 | `是否职责越界`、`是否字段有歧义`、`是否存在运维不可执行点` |

> 本文档是 `TokenPulse × AgentLedger` 的唯一对接基线。邮件、聊天、会议记录若与本文档冲突，以本文档为准。

## 冻结条件与变更规则

### 冻结条件

1. 只有 `TokenPulse Runtime Interface Owner` 与 `AgentLedger Governance Interface Owner` 双方书面确认通过后，本文档状态才可从 `draft` 变为 `frozen`。
2. 在状态变为 `frozen` 前，不允许进入“最小联调”阶段。
3. 在状态变为 `frozen` 前，不允许新增任何真实跨仓强依赖实现。

### 变更规则

1. `v1` 冻结后，新增字段只能向后兼容。
2. `v1` 冻结后，禁止修改既有字段名、既有字段语义、既有字段必填性、既有字段缺失语义。
3. 如需破坏性变更，必须升级文档版本并重新走双方评审。

## 0. 职责边界与阶段边界

### 0.1 职责边界

#### TokenPulse 固定职责

1. Provider OAuth。
2. 凭据金库。
3. 模型路由与执行策略。
4. 统一网关。
5. 渠道侧企业控制面：RBAC、租户、审计、配额、OAuth 告警、Alertmanager。

#### AgentLedger 固定职责

1. CLI / IDE / Agent 会话采集。
2. `usage / cost / session / source` 统一账本。
3. 预算、审计、规则资产、MCP、Quality、Replay、合规治理。

### 0.2 协作禁区

#### 明确禁止

1. AgentLedger 接管 TokenPulse 的 OAuth 状态机、网关代理、Provider 协议适配、路由执行决策。
2. TokenPulse 扩展为终端账本治理、预算治理、数据主权、MCP、Replay、终端审计平台。
3. 在 `v1` 同时保留 webhook 与拉取式 API 双轨常驻。
4. 建立 AgentLedger -> TokenPulse 的反向策略控制接口。
5. 建立双向常驻同步。

### 0.3 v1 阶段边界

#### v1 允许

1. 深链 / SSO 预留。
2. `traceId` 联查。
3. TokenPulse 向 AgentLedger 单向输出“运行时摘要事件”。

#### v1 不做

1. 真实统一身份打通。
2. TokenPulse <- AgentLedger 反向控制。
3. 运行时摘要事件以外的双向同步。

### 0.4 v1 事件模型边界

1. `v1` 明确规定：**每个 TokenPulse 网关请求只产生一条终态运行时摘要事件**。
2. 终态事件的 `status` 只能表示该请求的最终状态，不表示中间过程。
3. 若未来需要“一次请求产生多条事件”，必须升级版本，不能在 `v1` 内直接扩展。

## 1. 字段契约与字段语义

### 1.1 事件字段表

| 字段 | 必填 | 生产者 | 消费者 | 取值约束 | 缺失/空值语义 | 示例 |
| --- | --- | --- | --- | --- | --- | --- |
| `tenantId` | 是 | TokenPulse | AgentLedger | 小写租户标识，`^[a-z0-9_-]{1,64}$` | 不允许缺失 | `default` |
| `projectId` | 否 | TokenPulse | AgentLedger | 项目标识，`^[A-Za-z0-9._:-]{1,128}$` | 缺失表示该请求未绑定项目上下文 | `project-mlops` |
| `traceId` | 是 | TokenPulse | AgentLedger | 与 TokenPulse 请求链路一致，`1..128` 字符 | 不允许缺失 | `trace-oauth-runtime-20260308-0001` |
| `provider` | 是 | TokenPulse | AgentLedger | TokenPulse 运行时 provider id，小写，`^[a-z0-9_-]{1,32}$` | 不允许缺失 | `claude` |
| `model` | 是 | TokenPulse | AgentLedger | 调用方原始请求模型名，`1..256` 字符 | 不允许缺失 | `claude-sonnet` |
| `resolvedModel` | 是 | TokenPulse | AgentLedger | TokenPulse 经过别名解析后的最终模型；若未命中别名，必须等于 `model` 或 provider 规范化值 | 不允许缺失 | `claude:claude-3-7-sonnet-20250219` |
| `routePolicy` | 是 | TokenPulse | AgentLedger | 实际生效的选路策略标识；`v1` 固定枚举为 `round_robin`、`latest_valid`、`sticky_user` | 不允许缺失 | `latest_valid` |
| `accountId` | 否 | TokenPulse | AgentLedger | 运行时选中的账号标识，`1..128` 字符 | 缺失表示未选中具体账号、账号匿名化或无账号概念 | `claude-account-01` |
| `status` | 是 | TokenPulse | AgentLedger | `v1` 固定终态枚举：`success`、`failure`、`blocked`、`timeout` | 不允许缺失 | `success` |
| `startedAt` | 是 | TokenPulse | AgentLedger | UTC RFC 3339，毫秒精度 | 不允许缺失 | `2026-03-08T09:59:58.123Z` |
| `finishedAt` | 否 | TokenPulse | AgentLedger | UTC RFC 3339，毫秒精度，必须大于等于 `startedAt` | 缺失表示请求尚未拿到可确认结束时间；`v1` 允许缺失但不建议长期保留 | `2026-03-08T09:59:59.204Z` |
| `errorCode` | 否 | TokenPulse | AgentLedger | `1..128` 字符，推荐小写下划线风格 | `status=success` 时应缺失；其余状态缺失表示“失败类别未知但已失败” | `oauth_upstream_429` |
| `cost` | 否 | TokenPulse | AgentLedger | 美元金额字符串，正则 `^\\d+(\\.\\d{1,6})?$` | 缺失表示该次请求未计算或无法可信估算成本 | `0.002310` |

### 1.2 字段语义补充

1. `status` 是单请求终态，不是事件流阶段；`blocked` 表示请求在 `TokenPulse` 本地控制面被拒绝执行，例如模型已被禁用、配额或策略阻断，尚未进入 provider 正常执行路径。
2. `timeout` 表示请求已进入执行或下游交互路径，但在约定时窗内未得到可接受完成结果；`cancelled` 不属于 `v1` 终态枚举，因为 `TokenPulse` 当前不对外暴露独立的用户取消/会话取消生命周期。
3. `resolvedModel` 必须是最终实际使用的模型值；如果没有命中别名规则，仍需给出最终值，不能留空。
4. `routePolicy` 在 `v1` 冻结后只允许这 3 个固定值；新增策略值视为破坏性协议变更，必须升级版本并重新走双方评审。
5. `cost` 使用字符串而不是浮点数，避免 JSON 数值精度与序列化差异导致的签名和对账歧义。
6. 本文档只定义运行时摘要，不承诺暴露完整原始消息、完整提示词或完整响应内容。

### 1.3 标准 JSON 事件示例

```json
{
  "tenantId": "default",
  "projectId": "project-mlops",
  "traceId": "trace-oauth-runtime-20260308-0001",
  "provider": "claude",
  "model": "claude-sonnet",
  "resolvedModel": "claude:claude-3-7-sonnet-20250219",
  "routePolicy": "latest_valid",
  "accountId": "claude-account-01",
  "status": "success",
  "startedAt": "2026-03-08T09:59:58.123Z",
  "finishedAt": "2026-03-08T09:59:59.204Z",
  "cost": "0.002310"
}
```

## 2. 鉴权方式

### 2.1 默认鉴权机制

1. `v1` 默认使用**单向签名 webhook**。
2. 签名算法固定为 `HMAC-SHA256`。
3. 签名时间窗固定为 `±300s`。
4. 不使用 Basic Auth，不使用双向 TLS 作为 `v1` 默认机制。

### 2.2 默认请求头

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | 固定为 `application/json` |
| `X-TokenPulse-Spec-Version` | 是 | 固定为 `v1-draft.1`，冻结后更新为 `v1` |
| `X-TokenPulse-Key-Id` | 是 | 共享密钥标识，默认值 `tokenpulse-runtime-v1` |
| `X-TokenPulse-Timestamp` | 是 | Unix 秒级时间戳 |
| `X-TokenPulse-Signature` | 是 | `sha256=<hex-lowercase>` |
| `X-TokenPulse-Idempotency-Key` | 是 | 由第 4 节定义的幂等键 |

### 2.3 签名覆盖范围与字符串

`v1` 默认纳入签名覆盖范围的字段固定为：

1. `X-TokenPulse-Spec-Version`
2. `X-TokenPulse-Key-Id`
3. `X-TokenPulse-Timestamp`
4. `X-TokenPulse-Idempotency-Key`
5. `raw-request-body`

签名原文固定为：

```text
<X-TokenPulse-Spec-Version>\n<X-TokenPulse-Key-Id>\n<X-TokenPulse-Timestamp>\n<X-TokenPulse-Idempotency-Key>\n<raw-request-body>
```

说明：

1. `raw-request-body` 使用 UTF-8 原始字节，不做 JSON 重新格式化。
2. 验签时必须使用接收到的原始请求体，不能重新序列化后再验签。
3. `X-TokenPulse-Spec-Version` 与 `X-TokenPulse-Idempotency-Key` 不允许脱离签名单独解释。
4. 任一被覆盖字段发生变化，都必须重新计算签名。

### 2.4 签名示例

假设：

- `X-TokenPulse-Spec-Version=v1-draft.1`
- `X-TokenPulse-Key-Id=tokenpulse-runtime-v1`
- `X-TokenPulse-Timestamp=1772963998`
- `X-TokenPulse-Idempotency-Key=7dca0d3b55f34c4c67e3c0c7f2d9a2b3b1c43d4baf72e3109a0a4f88c5d12012`
- 共享密钥为 `tp_agl_v1_shared_secret`

签名示例：

```bash
BODY='{"tenantId":"default","traceId":"trace-oauth-runtime-20260308-0001","provider":"claude","model":"claude-sonnet","resolvedModel":"claude:claude-3-7-sonnet-20250219","routePolicy":"latest_valid","status":"success","startedAt":"2026-03-08T09:59:58.123Z","finishedAt":"2026-03-08T09:59:59.204Z","cost":"0.002310"}'
SPEC_VERSION='v1-draft.1'
KEY_ID='tokenpulse-runtime-v1'
TIMESTAMP='1772963998'
IDEMPOTENCY_KEY='7dca0d3b55f34c4c67e3c0c7f2d9a2b3b1c43d4baf72e3109a0a4f88c5d12012'
printf '%s\n%s\n%s\n%s\n%s' "$SPEC_VERSION" "$KEY_ID" "$TIMESTAMP" "$IDEMPOTENCY_KEY" "$BODY" \
  | openssl dgst -sha256 -hmac 'tp_agl_v1_shared_secret'
```

输出摘要应写入：

```text
X-TokenPulse-Signature: sha256=<hex-lowercase>
```

### 2.5 验签默认判定

1. `spec-version` 缺失或不受支持，返回 `400`。
2. 时间戳超出 `±300s`，返回 `401`，不进入业务处理。
3. `key-id` 未识别，返回 `401`。
4. `idempotency-key` 缺失，返回 `400`。
5. 签名不匹配，返回 `401`。
6. `idempotency-key` 与按第 4 节对请求体复算的结果不一致，返回 `400`。
7. 验签通过且幂等键一致后，才进入幂等判断。

## 3. 事件投递方式

### 3.1 默认投递方式

1. `v1` 只定义一种常驻投递方式：**HTTPS POST webhook**。
2. `v1` 不保留“拉取式 API”常驻通道。
3. 目标地址由 TokenPulse 配置项 `AGENTLEDGER_RUNTIME_INGEST_URL` 指定。

### 3.2 默认投递语义

1. 每个 TokenPulse 网关请求只投递一条终态摘要事件。
2. 事件投递是附加链路，不允许阻塞用户主请求。
3. TokenPulse 必须采取 fail-open 策略：
   - webhook 失败不影响网关响应
   - webhook 失败只影响对接链路自身

### 3.3 AgentLedger 默认响应语义

| 响应码 | 语义 | TokenPulse 行为 |
| --- | --- | --- |
| `202` | 首次成功接收，且已完成幂等登记与持久化保存 | 视为成功，不重试 |
| `200` | 幂等命中，且可确认该事件已在去重窗口内完成持久化保存 | 视为成功，不重试 |
| `400` | 请求体非法 | 视为永久失败，不重试 |
| `401` | 验签失败或时间窗失败 | 视为永久失败，不重试 |
| `403` | 调用未授权 | 视为永久失败，不重试 |
| `404` | 在唯一入口路径已冻结且目标 host/path 已完成发布的前提下，表示接口不存在或路径错误 | 视为永久失败，不重试 |
| `409` | 业务冲突但非幂等成功 | 视为永久失败，不重试 |
| `429` | 下游限流 | 进入重试 |
| `5xx` | 下游错误 | 进入重试 |

补充约束：

1. `200/202` 不得表示“仅收到请求但尚未持久化”或“仅内存接受、稍后异步落盘”。
2. 若 `AgentLedger` 尚未完成幂等登记与持久化保存，必须返回 `429` 或 `5xx`，不得提前返回成功。
3. `404` 视为永久失败只适用于 `v1` 已冻结、投递地址已完成切换且发布链路稳定的前提；灰度、迁移或联调阶段发现 `404`，应优先按配置漂移处理并阻断上线。

### 3.4 深链与联查预留

`v1` 只预留，不实现强依赖：

1. TokenPulse -> AgentLedger 深链保留查询参数：
   - `tenantId`
   - `projectId`
   - `traceId`
2. AgentLedger -> TokenPulse 深链保留查询参数：
   - `tenantId`
   - `projectId`
   - `traceId`
3. `SSO` 仅保留为阶段二入口，不属于 `v1-draft.1` 的实现范围。

## 4. 幂等键与重试策略

### 4.1 幂等键默认值

`v1` 幂等键默认值固定为：

```text
sha256(canonical_json({
  "tenantId": <tenantId>,
  "traceId": <traceId>,
  "provider": <provider>,
  "model": <model>,
  "startedAt": <startedAt>
}))
```

### 4.2 `canonical_json` 定义

1. 使用 UTF-8 编码。
2. 使用对象键固定顺序：
   - `tenantId`
   - `traceId`
   - `provider`
   - `model`
   - `startedAt`
3. 不插入额外空白。
4. 不允许使用“字符串直接相加”生成幂等键输入。

### 4.3 为什么 `status` 不进入幂等键

1. `v1` 规定“每个请求只产生一条终态摘要事件”。
2. 因此幂等键默认不包含 `status`。
3. 若未来需要“同一请求产生多条摘要事件”，必须升级版本，不能在 `v1` 内直接改变幂等语义。

### 4.4 去重保留时间

1. AgentLedger 去重保留时间默认值固定为 `7d`。
2. 在 `7d` 内命中相同 `X-TokenPulse-Idempotency-Key` 的事件，必须返回 `200` 并标记为重复，不得重复入账。

### 4.5 默认重试策略

| 尝试序号 | 延迟 |
| --- | --- |
| 第 1 次 | 立即发送 |
| 第 2 次 | `30s` |
| 第 3 次 | `2m` |
| 第 4 次 | `10m` |
| 第 5 次 | `30m` |

说明：

1. 最大尝试次数固定为 `5`。
2. 只有以下条件触发重试：
   - 网络错误
   - TLS / DNS 错误
   - 请求超时
   - HTTP `429`
   - HTTP `502`
   - HTTP `503`
   - HTTP `504`
3. 以下情况禁止重试：
   - HTTP `200`
   - HTTP `202`
   - HTTP `400`
   - HTTP `401`
   - HTTP `403`
   - HTTP `404`（仅限第 3.3 节前提成立）
   - HTTP `409`
4. 单次 webhook 总超时默认值固定为 `10s`。

### 4.6 重试时序说明

```text
TokenPulse -> AgentLedger: POST runtime summary
AgentLedger -> TokenPulse: 503
TokenPulse: 记录 attempt=1, result=retryable_failure, nextRetryAt=+30s
TokenPulse -> AgentLedger: retry attempt=2
AgentLedger -> TokenPulse: 202
TokenPulse: 记录 attempt=2, result=delivered, stop retry
```

## 5. 失败处理与失败审计

### 5.1 TokenPulse 侧失败处理

1. 任何对接失败都不得影响用户主请求返回。
2. 任何对接失败都必须记录到本地审计/运维日志；达到 `max_retry_exhausted` 或命中永久失败时，还必须进入持久化失败补偿出口，不能只留普通日志。
3. 推荐失败分类：
   - `config_missing`
   - `outbox_write_failed`
   - `network_error`
   - `timeout`
   - `http_4xx`
   - `http_5xx`
   - `duplicate_accepted`
   - `max_retry_exhausted`

### 5.2 TokenPulse 最小失败补偿出口

`v1` 默认最小补偿机制固定为“本地持久化 outbox + DLQ + 人工 replay”：

1. 运行时摘要事件生成后，应先写入 `TokenPulse` 本地持久化 outbox，再由异步投递器发送到 `AgentLedger`。
2. 收到 `202/200` 后，outbox 记录才能标记为 `delivered`。
3. 遇到网络错误、超时、`429`、`5xx` 时，事件保留在 outbox 中，并按第 4 节规则推进下一次重试。
4. 超过最大重试次数后，事件必须转入本地持久化 `DLQ` 或 `replay_required` 状态，不能仅保留一条普通日志后直接丢弃。
5. 永久失败（`400/401/403/404/409`）同样必须写入持久化补偿出口，便于后续人工排查、导出与审计。
6. 补偿出口最小字段必须包含：`traceId`、`idempotencyKey`、`rawBody` 或等价原始请求体、签名相关请求头、`attemptCount`、`lastHttpStatus`、`lastErrorClass`、`firstFailedAt`、`lastFailedAt`。
7. 补偿出口保留期不得短于 `7d`。
8. `TokenPulse` 必须支持按时间范围导出失败事件，并提供人工 replay 流程；人工 replay 必须复用同一业务语义与同一 `X-TokenPulse-Idempotency-Key`，以确保下游已入账时只得到 `200` 幂等命中。
9. 每次人工 replay 都必须记录操作人、操作时间、结果与下游响应码，形成可审计闭环。
10. 若本地 outbox 持久化本身失败，`TokenPulse` 仍保持对主请求 `fail-open`，但必须记录 `outbox_write_failed` 审计并触发运维告警。

### 5.3 TokenPulse 侧失败审计最小字段

| 字段 | 说明 |
| --- | --- |
| `traceId` | 对应业务请求 trace |
| `idempotencyKey` | 对应 webhook 幂等键 |
| `deliveryState` | `pending` / `delivered` / `retryable_failure` / `replay_required` |
| `targetUrl` | 目标地址，允许脱敏 |
| `attempt` | 当前第几次尝试 |
| `httpStatus` | 若有响应则记录 |
| `result` | `delivered` / `retryable_failure` / `permanent_failure` |
| `errorClass` | 失败分类 |
| `nextRetryAt` | 下次重试时间，若无则缺失 |

### 5.4 AgentLedger 侧失败处理

1. 验签失败必须在进入业务前返回 `401`。
2. 幂等命中必须返回 `200`，且命中的必须是已持久化成功的同一幂等键记录，不得重复入账。
3. 业务解析失败必须返回 `400`。
4. 只有完成幂等登记与持久化保存后，才能返回 `202`。
5. 暂时不可用时使用 `429` 或 `5xx`，不得用 `200/202` 伪装成功。

### 5.5 默认故障原则

1. TokenPulse 对 AgentLedger 故障采取 fail-open。
2. AgentLedger 对非法事件采取 fail-closed。
3. 两边都不允许通过“默默吞掉错误”来伪造对接成功。

## 6. 联调验收项

### 6.1 阶段一：文档冻结验收

1. 职责边界无越界项。
2. 13 个字段都具备：
   - 是否必填
   - 生产者
   - 消费者
   - 取值约束
   - 缺失/空值语义
   - 示例
3. webhook 鉴权机制、签名算法、时间窗、幂等键默认值已写死。
4. 已明确 `v1` 只保留 webhook 单轨，不保留拉取式 API 常驻方案。
5. 已明确 `v1` 每请求只产出一条终态摘要事件。
6. 已明确 `200/202` 只能表示幂等登记与持久化保存完成，不能表示“仅接收待处理”。
7. 已明确存在“本地持久化 outbox + DLQ + 人工 replay”的最小失败补偿出口。

### 6.2 阶段二：最小联调验收

1. TokenPulse 能按配置向 `AGENTLEDGER_RUNTIME_INGEST_URL` 发送签名 webhook。
2. AgentLedger 能校验 `HMAC-SHA256`、`±300s` 时间窗并接收事件。
3. 同一事件重复投递时，AgentLedger 仅第一次入账，后续返回 `200`。
4. TokenPulse 遇到 `429/5xx` 时按第 4 节重试。
5. TokenPulse 遇到 `400/401/403/404/409` 时不重试，并记录失败审计；其中 `404` 仅在第 3.3 节前提成立时视为永久失败。
6. 下游 webhook 故障不影响 TokenPulse 用户主请求。
7. 可通过 `traceId` 在两边完成联查。
8. 最大重试次数耗尽后，失败事件可在 outbox/DLQ 中查询、导出并人工 replay。
9. 能从失败补偿出口选取一条事件执行人工 replay，并验证首次成功后再次 replay 只返回 `200` 幂等命中。

## 7. 回滚方案

### 7.1 回滚触发条件

满足任一条件即可回滚：

1. 发现职责越界实现。
2. 发现字段语义不兼容。
3. 发现签名或幂等机制无法稳定执行。
4. 发现下游故障已经对 TokenPulse 主请求产生影响。
5. 发现 AgentLedger 无法可靠区分首次接收与重复接收。

### 7.2 回滚动作

1. TokenPulse 立即关闭运行时摘要输出开关：
   - `TOKENPULSE_AGENTLEDGER_WEBHOOK_ENABLED=false`
2. 保留本地 outbox / DLQ、日志与失败审计，不继续发送新 webhook。
3. 不对 TokenPulse 主链路做其他行为回退。
4. AgentLedger 保留已接收记录，但暂停新事件接收。

### 7.3 回滚后的状态要求

1. TokenPulse 网关、OAuth、模型路由、企业控制面继续独立运行。
2. AgentLedger 账本、治理、审计能力继续独立运行。
3. 双方回退后仍保持“松耦合、无强依赖”状态。

## 附录 A：默认配置键

### TokenPulse

| 配置键 | 说明 |
| --- | --- |
| `TOKENPULSE_AGENTLEDGER_WEBHOOK_ENABLED` | 是否启用单向摘要输出 |
| `AGENTLEDGER_RUNTIME_INGEST_URL` | AgentLedger 事件接收地址 |
| `TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID` | 默认 `tokenpulse-runtime-v1` |
| `TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET` | webhook 共享密钥 |
| `TOKENPULSE_AGENTLEDGER_OUTBOX_DIR` | 本地持久化 outbox / DLQ 目录 |
| `TOKENPULSE_AGENTLEDGER_OUTBOX_RETENTION_DAYS` | outbox / DLQ 默认保留天数 |

### AgentLedger

| 配置键 | 说明 |
| --- | --- |
| `AGENTLEDGER_TOKENPULSE_WEBHOOK_KEY_ID` | 与 TokenPulse `key-id` 对应 |
| `AGENTLEDGER_TOKENPULSE_WEBHOOK_SECRET` | 与 TokenPulse 共享的签名密钥 |

## 附录 B：评审结论记录

| 日期 | 评审方 | 结论 | 备注 |
| --- | --- | --- | --- |
| `2026-03-08` | `TokenPulse Runtime Interface Owner` | `pending` |  |
| `2026-03-08` | `AgentLedger Governance Interface Owner` | `pending` |  |
