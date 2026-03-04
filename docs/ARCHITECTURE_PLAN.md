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

## 当前开发进度匹配（截至 2026-03-04）

| 规划项 | 当前状态 | 证据（代码位置） | 结论 |
| --- | --- | --- | --- |
| 双服务入口（Core + Enterprise） | 已完成 | `apps/core/src/index.ts`、`apps/enterprise/src/index.ts` | 与规划一致 |
| 单前端 + 权限显隐 | 已完成（持续迭代） | `frontend/src/App.tsx`、`frontend/src/pages/EnterprisePage.tsx` | 与规划一致 |
| 高级版单开关 | 已完成 | `src/config.ts`、`src/middleware/advanced.ts` | 与规划一致 |
| `/api/admin/features` 探针与企业代理 | 已完成 | `src/index.ts`、`src/middleware/enterprise-proxy.ts` | 与规划一致 |
| OAuth 统一入口与能力图谱 | 已完成（持续增强） | `src/routes/oauth.ts`、`src/lib/routing/capability-map.ts`、`src/lib/oauth/runtime-adapters.ts` | 已进入稳定性收口 |
| 旧 OAuth 路径下线 | 已完成 | `src/middleware/legacy-oauth.ts` | 与规划一致 |
| 企业域 RBAC / 审计 / 配额 | 进行中 | `src/routes/enterprise.ts`、`src/lib/admin/rbac.ts`、`src/lib/admin/audit.ts`、`src/lib/admin/quota.ts` | 主体可用，需持续补齐边界与文档 |
| 计费使用分页与前端联动 | 进行中（本轮收口） | `src/routes/enterprise.ts`、`src/lib/admin/quota.ts`、`frontend/src/pages/EnterprisePage.tsx` | 本轮已对齐分页契约 |
| OAuth 会话 TTL 可观测字段 | 进行中（本轮收口） | `src/routes/oauth.ts`、`test/oauth-route-cross-provider-boundary.test.ts` | 本轮已补齐 `expiresAtMs/remainingMs` |
| 发布灰度与回滚手册 | 待完善 | `docs/DEPLOYMENT.md`、`docs/PRODUCTION_CHECKLIST.md` | 需按 Phase-5 收口 |

## 下一步推进清单（紧邻开发）

1. 持续补强企业域边界测试（用户/角色/租户/配额联动与异常路径）。
2. 完成 OAuth 会话存储从进程内到持久化的升级评估与实施窗口。
3. 收口文档一致性：`docs/API.md`、`docs/README.md`、部署/运维文档统一。
