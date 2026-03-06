# 验收矩阵

## 目的

- 将“本地回归 / 灰度前 / 发布窗口 / 值班接手”的检查动作固化成统一清单。
- 覆盖企业域边界、OAuth 告警中心、Alertmanager 发布链路、前端契约与兼容路径。
- 降低分支并行开发后的遗漏风险，避免只看 `bun run test` 而漏掉发布面与值班面。

## 步骤

### 1. 本地回归（每次合并前必做）

| 分类 | 命令 / 动作 | 通过标准 |
| --- | --- | --- |
| 后端回归 | `bun run test` | Bun 测试全绿 |
| 双服务入口回归 | `bun test test/core-dual-service-routing.test.ts` | `core` 暴露 `/api/auth/verify-secret`、`/api/admin/features`，并能代理 `enterprise` 管理路径 |
| 登录探针 / 管理员认证回归 | `bun test test/enterprise-auth-rbac-regression.test.ts` | `/api/auth/verify-secret` 成功返回 `200`，失败返回 `401 JSON + traceId`，管理员登录/登出链路可用 |
| 前端 secret 生命周期回归 | `bun test test/frontend-client.test.ts` | `verify-secret -> 保存 secret` 与 `失败 -> 清理 secret` 语义稳定 |
| 发布脚本登录探针回归 | `bun test test/release-common.test.ts test/release-enterprise-scripts.test.ts` | 公共 helper 以及 `smoke_org/check_enterprise_boundary/canary_gate` 都会先校验 `/api/auth/verify-secret`，错误 secret 会被明确阻断 |
| OAuth 诊断导出回归 | `bun test test/oauth-callback-events-route.test.ts test/oauth-session-events-route.test.ts` | `callback-events` 点查/导出与 `session-events/export` 的 GET-only 边界保持稳定 |
| 前端静态检查 | `cd frontend && bun run lint` | 无 lint 错误 |
| 前端构建 | `cd frontend && bun run build` | 构建成功 |
| 前端高级开关 / 错误态验收 | 手工：分别在 `ENABLE_ADVANCED=false/true` 下登录并访问 `/enterprise` | `false` 时企业入口不误展示且页面明确提示高级能力未启用；`true` 时企业页关键区块加载失败会显示持久错误提示和重试按钮，lazy chunk 失败会落到刷新兜底页 |
| Alertmanager 脚本回归 | `bun test test/release-alertmanager-scripts.test.ts` | 预检/发布脚本测试全绿 |
| 兼容路径退场护栏 | `bun test test/oauth-alert-compat-guard.test.ts` | `frontend/src` 与 `scripts/` 不得再引用 `/api/admin/oauth/alerts*`、`/api/admin/oauth/alertmanager*` |
| 旧 OAuth 路由退场语义 | `bun test test/legacy-oauth-removed.test.ts` | `/api/credentials/auth/*` 的旧 `start/status` 路径统一返回 `410 Gone`，仅手动保存入口保留 |
| 示例配置一致性 | 同上 | `warning/critical/P1` 三段路由存在 |

### 2. 灰度前检查（切流前）

| 分类 | 命令 / 动作 | 通过标准 |
| --- | --- | --- |
| Core/Enterprise 健康 | `./scripts/release/canary_gate.sh --phase pre ...` | `/health`、`/api/admin/features`、组织域只读均通过 |
| 登录探针校验 | `curl -H "Authorization: Bearer $API_SECRET" http://127.0.0.1:9009/api/auth/verify-secret` | 返回 `{ "success": true }`，确认登录页使用的 `API_SECRET` 可用 |
| 企业域边界 | `./scripts/release/check_enterprise_boundary.sh ...` | 权限边界、绑定冲突、traceId 追溯通过 |
| Alertmanager 文件预检 | `./scripts/release/preflight_alertmanager_config.sh` | 生产配置文件/模板目录存在，且无占位 URL |
| Alertmanager 默认挂载覆写确认 | 检查 `ALERTMANAGER_CONFIG_PATH` / `docker compose config` | 灰度/发布环境不再回退到 `./monitoring/alertmanager.webhook.local.example.yml`，默认示例文件仅用于本地 webhook sink 演练 |
| Release Window 参数预检 | `./scripts/release/preflight_release_window_oauth_alerts.sh --env-file ...` | `RW_*` 必填项齐备，且不再使用默认占位值 |

### 3. 发布窗口检查（切流时）

| 分类 | 命令 / 动作 | 通过标准 |
| --- | --- | --- |
| Secret 下发 + Alertmanager sync | `./scripts/release/publish_alertmanager_secret_sync.sh --secret-helper ...` | 成功写入配置并完成 sync |
| Secret 安全校验 | 同上 | Secret 引用名无非法字符；解析出的 webhook 不是 `example.invalid` / `example.com` / 本地 sink |
| Secret helper 链路 | 同上 | helper 成功解析 `warning/critical/P1` 三类 Secret，且未回退到已弃用的 `--secret-cmd-template` |
| 真实通道映射复核 | 人工：核对 `RW_WARNING_SECRET_REF/RW_CRITICAL_SECRET_REF/RW_P1_SECRET_REF` | 三类 Secret 已映射到真实值班群 / critical 通道 / P1 电话链路，且已双人复核 |
| OAuth 升级演练 | `./scripts/release/drill_oauth_alert_escalation.sh ...` | 退出码符合 `0/11/15/20` 约定 |
| 统一窗口编排 | `./scripts/release/release_window_oauth_alerts.sh ...` | 证据文件含 `historyId/historyReason/traceId/drillExitCode/rollbackResult`，命中升级时还应包含 `incidentId/incidentCreatedAt`；`historyReason` 应等于 `release window sync <RUN_TAG>`（或至少包含本次 `RUN_TAG`）；若 `with-rollback=true`，success/failure 都要核对 `rollbackTraceId`，其中 success 还应有 `rollbackHttpCode=200`，failure 还应保留 `rollbackHttpCode/rollbackError` |
| 真实链路接收确认 | 人工：值班群 / Pager / 电话接收回执 | 留存消息截图或消息 ID、Pager/电话事件号、接收人确认时间；没有人工回执时，不算真实链路闭环 |
| 兼容路径观察 | 检查 `tokenpulse_oauth_alert_compat_route_hits_total` 与 `/api/admin/oauth/alerts/*` 调用量 | 兼容路径仍可用，且前端/脚本调用量应保持为 `0`；若非 `0`，必须记录 `method/route/疑似来源/责任人/处置结论` |

### 4. 值班接手 / 发布后巡检

| 分类 | 动作 | 通过标准 |
| --- | --- | --- |
| 企业域最小回归 | 再执行一次 `check_enterprise_boundary.sh` 或 `canary_gate.sh --phase post ...` | 日志出现“企业域边界回归最小检查通过” |
| Alertmanager 历史核对 | `GET /api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=5` | 可读取最新同步记录 |
| OAuth 告警中心 | 检查 `rules/active`、`incidents`、`deliveries` | 规则版本、事件、投递记录查询正常 |
| traceId 追查 | 任选一次失败分支，按 traceId 追到 `audit/session-events` | 路由、审计、会话事件链路能串起来 |

## 验证

- 本地回归至少覆盖以下测试面：
  - 登录探针 / 管理员认证 / 企业域边界：`test/enterprise-auth-rbac-regression.test.ts`
  - 前端 client / 登录探针：`test/frontend-client.test.ts`
  - 发布脚本公共 helper：`test/release-common.test.ts`
  - 用户绑定/租户/配额：`test/enterprise-user-binding-validation.test.ts`、`test/enterprise-billing-policy-validation.test.ts`
  - 其中必须覆盖关键 400/404/409 护栏：legacy `roleKey/tenantId` 绑定校验、陈旧 tenant/user/role 资源校验、以及 `POST /api/admin/billing/policies` 的重复策略 ID 拒绝且不得覆盖既有策略
  - OAuth 告警路由：`test/oauth-alert-routes.test.ts`
  - OAuth 告警 incident/delivery 契约：`test/oauth-alert-delivery.test.ts`、`test/oauth-alert-evaluator.test.ts`、`test/oauth-alert-prometheus-metrics.test.ts`
  - 旧 OAuth 路由退场：`test/legacy-oauth-removed.test.ts`
  - 规则引擎/控制面：`test/oauth-alert-rules.test.ts`、`test/alertmanager-control.test.ts`
  - 兼容路径退场护栏：`test/oauth-alert-compat-guard.test.ts`
  - 发布脚本：`test/release-alertmanager-scripts.test.ts`
- 仓库内自动化覆盖范围：
  - 测试、预检、Secret helper 调用、安全阻断、`sync-history` 抓取、`traceId` 补齐、可选 rollback 证据输出
  - 不覆盖真实值班群是否收消息、Pager/电话是否叫醒、compat 调用方真实身份归因
- 生产人工必须完成：
  - 真实通道映射审批与双人复核
  - warning / critical / P1 实际接收确认与工单留档
  - compat 指标非零时的来源归因、迁移跟踪、以及 `2026-07-01` 之后的 `critical` 升级决策
- 发布窗口至少保留以下证据：
  - `sync-history` 最新记录
  - `historyReason`
  - 一次演练退出码
  - 一次 `traceId` 审计追溯
  - 一次真实通道接收确认（消息截图 / 消息 ID / Pager 或电话事件号）
  - 如有回滚成功，保留 `rollbackResult=success`、`rollbackTraceId`、`rollbackHttpCode=200`
  - 如有回滚失败，保留 `rollbackResult=failure`、`rollbackTraceId`、`rollbackHttpCode`、`rollbackError`

## 回滚

- 后端/前端回归失败：停止合并，回到功能分支修复后重新跑完整矩阵。
- Alertmanager 预检失败：修正运行时配置文件或 Secret 引用，不允许跳过预检直接发布。
- 若灰度/发布环境误用了默认挂载：先把 `ALERTMANAGER_CONFIG_PATH` 改为生产运行时文件，再重新执行预检与发布链路。
- 发布窗口失败：使用 `sync-history/:historyId/rollback` 或 `release_window_oauth_alerts.sh --with-rollback true` 回退到最近稳定配置。
- 值班巡检失败：先冻结继续切流/扩容动作，再按 `docs/DEPLOYMENT.md` 与 `docs/PRODUCTION_CHECKLIST.md` 的回滚步骤处理。
