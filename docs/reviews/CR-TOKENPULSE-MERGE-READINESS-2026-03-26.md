# TokenPulse 分支收口审计（2026-03-26）

## 审计范围
- 基线：`main`
- 目标分支：`feat/parallel-iteration10-20260306`
- 目标提交：`50d01497c3b65c0afdd1ae5f568c4407a3d64f90`

## 事实输入
- `git diff --stat main..HEAD`：198 个文件变更，`58070` 行新增，`7520` 行删除。
- 路径分布：
  - `frontend/src/*`：83 个文件
  - `scripts/release/*`：21 个文件
  - `src/lib/*`：12 个文件
  - `src/routes/*`：3 个文件
- 最近提交主轴：
  - AgentLedger runtime 合同、outbox、replay、trace drilldown
  - Enterprise 前端拆分、深链和状态提示
  - release / observability / compat 脚本与文档强化
  - org / quota / project scope 契约补强

## CSE 分层判断

### 1. 数据面
- `src/lib/agentledger/runtime-contract.ts`
- `src/lib/agentledger/runtime-events.ts`
- `src/lib/agentledger/trace-drilldown.ts`
- `src/routes/enterprise.ts`
- `test/agentledger-runtime-*.test.ts`
- `test/agentledger-replay-routes.test.ts`

结论：
- 这是本分支最有价值、也是与 AgentLedger 主线对接最直接的一组改动。
- 该部分已经具备本地联调事实基础，最近又补上了本地迁移时序修复与 bundle evidence 默认留痕，属于应优先收口的主链。

### 2. 控制面
- `scripts/release/*`
- `monitoring/*`
- `docs/DEPLOYMENT.md`
- `docs/VALIDATION_MATRIX.md`
- `docs/MONITORING_GUIDE.md`
- `test/release-*.test.ts`
- `test/oauth-alert-*.test.ts`

结论：
- 这部分承担“预检、演练、灰度、兼容门禁、证据留档”的控制职责。
- 它与数据面耦合紧，但职责清晰，适合与 AgentLedger runtime 主链同批收口。
- 当前新增的 `validate_enterprise_runtime_bundle.sh` 默认 evidence 输出能力，应归入这一批次。

### 3. 状态面
- `drizzle-pg/0010_oauth_alert_incident_contract.sql`
- `src/db/schema.ts`
- `src/config.ts`
- `src/lib/migrate.ts`
- `.env.example`
- `docker-compose.yml`

结论：
- 该层决定真实数据库与运行配置是否能支撑主链闭环。
- 当前已暴露过“Postgres ready 但迁移瞬时失败”的真实问题，并已通过 `src/lib/migrate.ts` 重试修复。
- 任何收口都必须把 schema / migrate / env 视为冻结边界的一部分，不能只合 API 和前端。

### 4. 展示面
- `frontend/src/pages/EnterprisePage.tsx`
- `frontend/src/components/enterprise/*`
- `frontend/src/pages/enterprise*.ts`
- `frontend/src/lib/client.ts`
- `frontend/src/App.tsx`
- 对应 `frontend` 测试集

结论：
- 这是当前体量最大的改动面，也是直接整批合入 `main` 的最高风险来源。
- 改动价值存在，但复杂性主要集中在“结构重排 + 功能扩展 + 深链体验 + 状态提示”混批。
- 不建议作为 AgentLedger 主链收口的阻塞前置条件。

## 复杂性转移账本

| 复杂性原位置 | 新位置 | 收益 | 新成本 | 失效模式 |
| --- | --- | --- | --- | --- |
| 手工联调步骤 | `scripts/release/*` 编排脚本 + evidence | 联调和交接可复现 | 脚本/文档/测试需同步维护 | 文档和脚本口径漂移 |
| TokenPulse 内部运行时状态 | 本地 outbox / replay / trace drilldown | 失败可追溯、可补偿 | 数据表、worker、审计路径变复杂 | 幂等或 replay 语义漂移 |
| EnterprisePage 单体页面逻辑 | 多组件、多 adapter / loader / mutation helper | 页面职责更清晰，便于后续扩展 | 合并面增大，状态同步更分散 | 深链、筛选、反馈文案回归 |
| 兼容/演练口径散落在人工流程 | compat guard、preflight、validation matrix | 发布门禁更可执行 | 控制面脚本数量激增 | 预检全绿但真实发布窗口仍失败 |

## 收口建议

### 第一批：优先收口到 `main`
- AgentLedger runtime 主链
  - `src/lib/agentledger/*`
  - `src/routes/enterprise.ts`
  - `test/agentledger-*`
- release / observability 主链
  - `scripts/release/*agentledger*`
  - `scripts/release/validate_enterprise_runtime_bundle.sh`
  - `scripts/release/preflight_runtime_integrations.sh`
  - `docs/integration/*`
  - `docs/DEPLOYMENT.md`
  - `docs/VALIDATION_MATRIX.md`
  - `test/release-agentledger-scripts.test.ts`
  - `test/release-enterprise-runtime-bundle.test.ts`
  - `test/release-runtime-integrations.test.ts`
- 状态面配套
  - `src/lib/migrate.ts`
  - `src/db/schema.ts`
  - `drizzle-pg/0010_oauth_alert_incident_contract.sql`
  - `.env.example`
  - `docker-compose.yml`

判断：
- 这一批直接服务于“TokenPulse 主线具备与 AgentLedger `main` 对接能力”这个目标。
- 当前已经有真实双仓联调和脚本回归证据支撑，应优先完成。

### 第二批：条件收口
- org / quota / project scope
  - `src/lib/admin/quota.ts`
  - `src/middleware/quota.ts`
  - `src/routes/org.ts`
  - 相关前端概览、配额和组织域适配层
  - `test/org-*`
  - `test/quota-*`
  - `test/enterprise-billing-*`

判断：
- 这部分有业务价值，但与 AgentLedger 主链不是强依赖。
- 应在第一批收口后，按“后端契约先于前端展示”的顺序拆分处理。

### 第三批：独立治理流
- OAuth alert compat / Alertmanager hardening
  - `scripts/release/check_oauth_alert_compat.sh`
  - `scripts/release/preflight_oauth_alert_compat_enforce.sh`
  - `scripts/release/release_window_oauth_alerts.sh`
  - `monitoring/*`
  - `docs/MONITORING_GUIDE.md`
  - `docs/PRODUCTION_CHECKLIST.md`
  - `test/release-alertmanager-scripts.test.ts`
  - `test/oauth-alert-*`

判断：
- 这是生产治理流，不应和 AgentLedger 主线收口混成一个超大 PR。
- 需要单独看真实通道、compat 退场窗口和人工证据流程。

### 第四批：前端结构重排与体验优化
- `frontend/src/pages/EnterprisePage.tsx`
- `frontend/src/components/enterprise/*`
- `frontend/src/pages/enterprise*.ts`
- `frontend/src/lib/client.ts`
- 对应前端测试

判断：
- 建议继续拆成“适配器/加载器/深链体验/UI 结构重排”几个可验证小批次。
- 不要把这部分作为第一批收口的阻塞条件。

## 风险判定

### 高风险
- `frontend/src/pages/EnterprisePage.tsx` 及其拆分链路体量过大，属于合并冲突和行为回归高发区。
- release / observability 文档、脚本、测试需要严格同批，否则门禁口径会再次漂移。

### 中风险
- org / quota / project scope 同时改后端契约和前端跳转，若不分批，容易把收口目标从 AgentLedger 主线带偏。
- schema / migrate 若与主线环境差异未对齐，可能重现“测试全绿但干净库启动失败”。

### 低风险
- 默认 evidence 输出、compose warning 清理、迁移重试属于明确的运行面收口，适合作为当前第一批的补丁项。

## 当前建议执行顺序
1. 先完成第一批收口清单的提交整理，不再继续向分支叠加新的前端范围。
2. 以 `bun run test:release`、`bun run test:release:full`、双仓本地联调 evidence 作为第一批门禁。
3. 第一批进入 `main` 后，再独立处理 org/quota 与 OAuth alert compat 两条线。
4. Enterprise 前端大拆分继续拆小，不与主链收口混批。

## 当前结论
- `feat/parallel-iteration10-20260306` 不应整批直接合入 `main`。
- 可以优先抽取“AgentLedger runtime + release hardening + schema/migrate/env 配套”这一条主链先收口。
- 当前新增的迁移重试修复与 bundle evidence 默认留痕，属于第一批主链的必要收口项。
