# TokenPulse 一体化重构方案（标准版 + 高级版，双服务，单前端）

- 文档版本：v1.0
- 记录时间：2026-03-04
- 适用范围：`TokenPulse` 主仓库（Core + Enterprise + Frontend + Bridge）
- 来源：2026-03-03 11 点后历史会话规划内容，结合当前代码现状完成落盘与进度匹配

## 摘要

本方案将 TokenPulse 收敛为“核心网关服务 + 企业控制面服务”的双服务架构，前端保持单应用，通过权限与环境开关控制标准版/高级版能力。

已锁定原则：

1. `ENABLE_ADVANCED` 是唯一高级功能开关。
2. 网关继续使用 `v1` 命名，不额外引入 `v2`。
3. OAuth 全 Provider 统一到 `/api/oauth/*`。
4. 允许复用 MIT 代码；SSPL 仓库仅做行为参考，不直接拷贝代码。

## 成功标准

1. 标准版在 `ENABLE_ADVANCED=false` 时可独立运行，完整提供现有网关能力与全 Provider OAuth。
2. 高级版在 `ENABLE_ADVANCED=true` 时开启企业能力，不影响标准版稳定性。
3. 既有 `v1` 网关接口保持兼容，前端路径可平滑迁移。
4. OAuth 成功率、刷新稳定性、回调可靠性达到可生产水位，并具备回归测试矩阵。

## 总体架构（决策完成）

1. 服务划分：`tokenpulse-core` + `tokenpulse-enterprise`。
2. `tokenpulse-core` 负责 OAuth、凭据金库、协议适配、模型路由、统一网关。
3. `tokenpulse-enterprise` 负责 RBAC、组织/项目隔离、审计、配额策略、计费运营。
4. 前端保持单应用，根据权限与 `ENABLE_ADVANCED` 控制菜单与页面能力。
5. 数据层统一 PostgreSQL，按 `core` 与 `enterprise` schema 分区。
6. Claude 高风险链路支持 strict 与 bridge 双通道策略。

## 关键创新点（稳定性优先）

1. Provider 能力图谱驱动路由，减少硬编码分支。
2. 策略编排层统一模型别名、降级、重试、配额切换。
3. OAuth 采用“统一状态机 + Provider 适配器”模式，降低端口冲突与重复实现。

## 对外 API 与类型基线

1. 保持网关主接口：`/v1/chat/completions`、`/v1/messages`、`/v1/models`、`/v1/responses`。
2. 保持系统接口前缀：`/api/*`。
3. OAuth 统一入口：`/api/oauth/:provider/start|poll|callback|status`，并补 `session/manual` 能力。
4. 旧 OAuth 路由 `/api/credentials/auth/*` 仅保留迁移与手动保存例外，不恢复业务能力。
5. 企业接口统一前缀：`/api/admin/*`、`/api/org/*`（高级版开关控制）。
6. 共享类型基线：`ProviderId`、`OAuthFlowType`、`CredentialEnvelope`、`RoutePolicy`、`EditionContext`、`PermissionKey`。

## 并行开发分工（Agent Teams）

1. Agent-A（架构骨架）：双服务目录、共享包、配置加载、依赖注入、Edition 开关。
2. Agent-B（OAuth Runtime）：全 Provider 统一状态机与适配器实现。
3. Agent-C（Gateway Runtime）：`v1` 协议兼容层、策略编排、模型图谱、错误语义统一。
4. Agent-D（Enterprise）：RBAC、组织/租户、审计、配额与计费域模型。
5. Agent-E（Frontend）：单前端改造、标准/高级能力显隐与路由守卫。
6. Agent-F（质量与运维）：测试矩阵、压测、可观测性、发布与回滚脚本。

## 分阶段实施

### Phase-0 基线清障

1. 移除硬编码密钥与不安全默认值。
2. 修复错误路由映射与旧 OAuth 混用路径。
3. 收紧 CORS / metrics / TLS 风险面。

### Phase-1 架构落地

1. 双服务与共享能力骨架就位。
2. PostgreSQL 迁移与 schema 分域。
3. 兼容层先空实现后逐步替换。

### Phase-2 OAuth 重构

1. 全 Provider 接入统一状态机。
2. 完成 `start/poll/callback/status/session/manual` 全链路。
3. 收口错误信封与 traceId 诊断字段。

### Phase-3 网关重构

1. `v1` 兼容适配。
2. 策略编排与模型能力图谱上线。
3. 统一选路、降级、失败恢复行为。

### Phase-4 企业能力

1. RBAC / 组织租户 / 审计 / 配额 / 计费并行开发。
2. 企业读写接口与审计事件形成闭环。
3. 管理台与后端契约同步演进。

### Phase-5 联调发布

1. 灰度、回归、压测、文档与运维手册收口。
2. 按 Provider 分批切流。
3. 保留可逆回滚路径。

## 测试与验收

1. Provider 维度 OAuth E2E：全 Provider 覆盖成功/失败/超时/重复回调。
2. 协议兼容测试：`v1` 请求与响应快照对比。
3. 开关测试：`ENABLE_ADVANCED=true/false` 下路由、前端菜单、权限行为一致。
4. 并发稳定性：刷新风暴、锁竞争、限流一致性、重试风暴。
5. 安全测试：CSRF state 校验、PKCE、敏感配置脱敏、审计完整性。

## 发布、灰度与回滚

1. 先双栈影子流量对比，不直接切生产入口。
2. 再按 Provider 分批切流，观测错误率与延迟。
3. 最后灰度开放高级版企业能力。
4. 回滚策略：入口回切 + 禁用新 OAuth Runtime + 保留旧凭据读取兼容。

## 明确假设与默认值

1. `ENABLE_ADVANCED` 默认 `false`，是唯一高级功能开关。
2. 网关对外保持 `v1` 命名，不新建 `v2` 前缀。
3. 数据库统一 PostgreSQL。
4. OAuth 第一阶段必须覆盖全部现有 Provider。
5. 单前端持续使用，按权限与开关显隐页面。
6. MIT 代码可复用；SSPL 代码仅做行为参考。

## 当前开发进度匹配（截至 2026-03-06，文档与发布链路同步后）

| 规划项 | 当前状态 | 证据（代码位置） | 结论 |
| --- | --- | --- | --- |
| 双服务入口（Core + Enterprise） | 已完成（入口存在，默认运行仍以单体为主） | `apps/core/src/index.ts`、`apps/enterprise/src/index.ts`、`src/index.ts`、`package.json` | 拆分入口已具备，但默认开发/发布链路仍以单体入口为主，尚未整体切换到双服务部署 |
| 单前端 + 权限显隐 | 已完成（持续迭代） | `frontend/src/App.tsx`、`frontend/src/pages/EnterprisePage.tsx` | 与规划一致 |
| 高级版单开关 | 已完成 | `src/config.ts`、`src/middleware/advanced.ts` | 与规划一致 |
| `/api/admin/features` 探针与企业代理 | 已完成 | `src/index.ts`、`src/middleware/enterprise-proxy.ts` | 与规划一致 |
| 登录前 API Secret 探针（`/api/auth/verify-secret`） | 已完成（本轮推进） | `src/routes/auth.ts`、`src/index.ts`、`frontend/src/lib/client.ts`、`test/enterprise-auth-rbac-regression.test.ts` | 登录页先校验 secret，再进入全局 client 链路，避免探针失败时误触发 `401 -> /login` 自动跳转 |
| OAuth 统一入口与能力图谱 | 已完成（持续增强） | `src/routes/oauth.ts`、`src/lib/routing/capability-map.ts`、`src/lib/oauth/runtime-adapters.ts` | 已进入稳定性收口 |
| 旧 OAuth 路径下线 | 已完成 | `src/middleware/legacy-oauth.ts` | 与规划一致 |
| 企业域 RBAC / 审计 / 配额 | 已完成（持续补边界回归） | `src/routes/enterprise.ts`、`src/lib/admin/rbac.ts`、`src/lib/admin/audit.ts`、`src/lib/admin/quota.ts` | 主链路、审计闭环与配额域模型已稳定，后续仅补边界测试 |
| 计费使用分页与前端联动 | 已完成（持续迭代） | `src/routes/enterprise.ts`、`src/lib/admin/quota.ts`、`frontend/src/pages/EnterprisePage.tsx` | 分页契约已对齐 |
| OAuth 会话可观测与持久化轨迹 | 已完成（持续迭代） | `src/routes/oauth.ts`、`src/lib/auth/oauth-session-store.ts`、`src/routes/enterprise.ts` | 已补齐 TTL 字段、会话事件查询与导出 |
| OAuth 会话事件值班诊断手册（筛选/聚合/导出/追溯） | 已完成（本轮推进） | `docs/DEPLOYMENT.md`、`docs/PRODUCTION_CHECKLIST.md`、`docs/README.md` | 已形成四段式操作闭环并纳入文档索引 |
| OAuth 告警中心前端收口（配置/评估/incidents/deliveries） | 已完成（本轮推进） | `frontend/src/pages/EnterprisePage.tsx`、`frontend/src/lib/client.ts`、`docs/API.md`、`docs/MONITORING_GUIDE.md` | 值班联动已覆盖 traceId 跳审计与 incident→会话事件过滤 |
| OAuth 告警事件/投递 Prometheus 指标接入 | 已完成（本轮推进） | `src/lib/metrics.ts`、`src/lib/observability/oauth-session-alerts.ts`、`src/lib/observability/alert-delivery.ts` | 已具备自动化告警升级的指标基础 |
| Alertmanager 路由与 OAuth 告警升级演练（5m/15m） | 已完成（本轮推进） | `monitoring/prometheus.yml`、`monitoring/alert_rules.yml`、`monitoring/alertmanager.yml`、`scripts/release/drill_oauth_alert_escalation.sh`、`docs/DEPLOYMENT.md`、`docs/PRODUCTION_CHECKLIST.md` | 监控配置、演练脚本、值班手册与校验流程已闭环 |
| Alertmanager Secret helper 发布链路与发布窗口证据 | 已完成（本轮推进） | `scripts/release/publish_alertmanager_secret_sync.sh`、`scripts/release/release_window_oauth_alerts.sh`、`scripts/release/preflight_release_window_oauth_alerts.sh`、`test/release-alertmanager-scripts.test.ts` | 发布链路优先 `--secret-helper`，窗口证据已固化 `historyReason` 字段 |
| 默认 Alertmanager 本地挂载与发布阻断 | 已完成（本轮推进） | `docker-compose.yml`、`scripts/release/preflight_alertmanager_config.sh`、`docs/VALIDATION_MATRIX.md` | monitoring profile 默认挂载本地 webhook sink 示例，仅允许本地演练，发布前必须显式覆盖为运行时生产文件 |
| 企业域边界最小回归（发布 gate 联动） | 已完成（本轮推进） | `scripts/release/check_enterprise_boundary.sh`、`scripts/release/canary_gate.sh`、`docs/DEPLOYMENT.md`、`docs/PRODUCTION_CHECKLIST.md` | 已纳入 `canary_gate` 主路径，支持 `pre/post` 复核 |
| OAuth 告警规则接口回归（创建/冲突/回滚主链路） | 已完成（持续补异常分支） | `test/oauth-alert-routes.test.ts`、`test/oauth-alert-rules.test.ts`、`src/routes/enterprise.ts` | 主链路已覆盖，后续仅补异常分支与兼容窗口观测 |
| OAuth 告警兼容路径观测 | 已完成（本轮推进） | `src/lib/metrics.ts`、`src/routes/enterprise.ts`、`test/oauth-alert-routes.test.ts`、`docs/MONITORING_GUIDE.md` | 已为 `/api/admin/oauth/alerts/*` 与 `/api/admin/oauth/alertmanager/*` 增加命中计数器，便于兼容窗口退场 |
| 发布灰度与回滚手册 | 已完成 | `docs/DEPLOYMENT.md`、`docs/PRODUCTION_CHECKLIST.md`、`scripts/release/*` | Phase-5 基础收口完成 |
| 验收矩阵（本地回归 / 灰度前 / 发布窗口 / 值班接手） | 已完成（本轮推进） | `docs/VALIDATION_MATRIX.md`、`test/release-alertmanager-scripts.test.ts` | 已将发布脚本、企业域边界、OAuth 告警与值班巡检统一收口 |

## 本轮已完成项（2026-03-06）

1. 登录页已接入 `/api/auth/verify-secret` 轻量探针，先校验 `API_SECRET`，再进入全局业务 client。
2. Alertmanager 发布链路已以 `--secret-helper` 为推荐入口，并对已弃用的 `--secret-cmd-template` 保持阻断/降级提示。
3. `release_window_oauth_alerts.sh` 已把匹配到的同步原因写入证据字段 `historyReason`，用于把 `sync-history.reason` 与本次 `RUN_TAG` 绑定。
4. `docker compose --profile monitoring` 未显式覆盖时默认挂载 `monitoring/alertmanager.webhook.local.example.yml`，并由发布前预检阻断其进入灰度/生产窗口。
5. `/api/admin/oauth/alerts/*` 与 `/api/admin/oauth/alertmanager/*` 已补兼容路径命中指标 `tokenpulse_oauth_alert_compat_route_hits_total`，便于灰度期统计遗留调用。
6. 前端与发布脚本已清零旧的 OAuth 告警兼容路径调用，并新增 `test/oauth-alert-compat-guard.test.ts` 作为退场护栏。
7. 发布窗口现已支持双会话 Cookie 模式，并补充 `secret-helper` 模板与 runtime Alertmanager 配置模板，降低真实值接入成本。

## 仍未完成项（紧邻开发）

1. （持续推进）企业域边界测试：继续补强用户/角色/租户/配额联动、冲突与非法输入路径，但不再改主契约。
2. （持续推进）OAuth 告警异常分支回归：继续补齐少量异常分支与兼容窗口观察场景，不再新增兼容路径能力。
3. 将 Alertmanager webhook 占位地址替换为生产告警通道（值班群/P1 电话）并执行一次真实链路演练。
4. 兼容路径退场准备：持续观察 `tokenpulse_oauth_alert_compat_route_hits_total`；当前前端与脚本残留调用已清零，剩余工作仅为兼容窗口观测与后续正式下线。
