# TokenPulse 接手现状与开发计划

## 目标
将 TokenPulse 当前“功能分支上已经完成但尚未主线收口”的工作和“仍未完成的企业域/发布域问题”分开处理，先完成主线收敛，再继续做可验证的后续迭代。

## 现状梳理
- 当前工作分支是 `feat/parallel-iteration10-20260306`，提交为 `50d01497c3b65c0afdd1ae5f568c4407a3d64f90`。
- 当前工作区存在未提交收口改动：
  - `src/lib/migrate.ts` + `test/migrate.test.ts`：修复首次迁移时序问题
  - `scripts/release/validate_enterprise_runtime_bundle.sh` + `test/release-enterprise-runtime-bundle.test.ts`：补默认 evidence 留痕
  - `docker-compose.yml`：清理 compose warning
  - 文档同步：`docs/README.md`、`docs/DEPLOYMENT.md`、`docs/VALIDATION_MATRIX.md`、`docs/integration/TOKENPULSE_AGENTLEDGER_V1_LOCAL_RUNBOOK.md`
- 该分支尚未合入 `main`；`git branch --no-merged main` 仍显示该分支及若干相关分支。
- 当前分支已经实现并文档化的 AgentLedger 联动能力包括：
  - 运行时摘要合同、签名、幂等：`src/lib/agentledger/runtime-contract.ts`
  - 本地 outbox / worker / retry / replay / audit：`src/lib/agentledger/runtime-events.ts`
  - trace drilldown：`src/lib/agentledger/trace-drilldown.ts`
  - 企业控制面 observability 路由：`src/routes/enterprise.ts`
  - 联调 Runbook：`docs/integration/TOKENPULSE_AGENTLEDGER_V1_LOCAL_RUNBOOK.md`
  - 发布前预检 / 合同演练 / 统一 bundle 验收脚本：`scripts/release/*agentledger*`
  - 监控与告警规则：`docs/MONITORING_GUIDE.md`、`monitoring/alert_rules.yml`
- 当前分支最近提交重点是：
  - AgentLedger 深链与 traceId 透传
  - 本地联调 runbook
  - AgentLedger 负向演练
  - outbox export / batch replay
  - 企业控制台状态提示与深链体验
- 当前未完成项仍集中在：
  - 企业域边界异常分支继续补强
  - 组织域 `/api/org/*` 契约继续收口
  - OAuth 告警 compat 路径退场观察与正式下线
  - 真实生产告警通道演练

## 当前判断
- TokenPulse 当前最大问题不是“缺协议”或“缺 AgentLedger 集成设计”，而是“相关工作尚停在功能分支，没有收口进 main”。
- 只要这一分支不收口，AgentLedger 主线与 TokenPulse 主线之间就会长期存在事实错位：AgentLedger 认为联调已就绪，TokenPulse 主线却还看不到完整实现。
- 因此 TokenPulse 的第一优先级必须是主线收敛和验证，而不是继续外扩新的企业域功能。

## 开发计划
- [x] 任务 1：整理 `feat/parallel-iteration10-20260306` 相对 `main` 的实际改动面，按“AgentLedger 联动 / 企业前端 / release hardening”三类重新审一遍 -> 验证：已输出 `docs/reviews/CR-TOKENPULSE-MERGE-READINESS-2026-03-26.md`
- [x] 任务 2：对当前分支执行最小完整回归，重点覆盖 AgentLedger runtime、release scripts、enterprise 边界、前端深链 -> 验证：`2026-03-26` 已执行 `bun run test:release`、`bun run test:release:full`，均通过
- [ ] 任务 3：完成一次 TokenPulse -> AgentLedger 本地联调复验，确认 outbox / replay / readiness / trace drilldown 与 AgentLedger `main` 一致 -> 验证：`drill_agentledger_runtime_webhook.sh`、`validate_enterprise_runtime_bundle.sh` 产出 evidence
- [ ] 任务 4：在回归通过后优先把 `feat/parallel-iteration10-20260306` 收口到 `main`，避免双主线长期分叉 -> 验证：`main` 可见 AgentLedger 联动实现，且验证矩阵可在主线上复现
- [ ] 任务 5：合入后继续补企业域边界测试，重点收口用户/角色/租户/配额联动、非法输入、traceId 追溯 -> 验证：边界测试与 `check_enterprise_boundary.sh` 通过
- [ ] 任务 6：收口组织域 `/api/org/*` 契约，明确只读降级、写路径、组织/项目/配额/审计下钻边界 -> 验证：组织域读写 smoke 与前端页面契约稳定
- [ ] 任务 7：推进 OAuth 告警 compat 路径正式退场，保留观测期但不再保留新功能投入 -> 验证：compat 指标连续观察，前端与脚本零命中，相关 guard 测试通过
- [ ] 任务 8：在 release / observability 主链稳定后，再考虑下一阶段 TokenPulse 自身能力深化，不与 AgentLedger 联动收口混批 -> 验证：新计划另立批次，不污染当前发布基线

## 关键路径
- 关键路径 1：当前功能分支完整回归
- 关键路径 2：与 AgentLedger 主线做一次真实本地联调复验
- 关键路径 3：将该分支收口进 `main`
- 关键路径 4：补企业域边界与组织域契约

## 暂不处理
- 不新增 AgentLedger 反向控制 TokenPulse 的接口
- 不在主线收口前继续扩新的组织域大功能
- 不在 compat 路径未退场时再引入新的兼容分支

## 完成标准
- [ ] TokenPulse 主线可直接看到 AgentLedger runtime outbox / replay / trace drilldown / release bundle 能力
- [ ] 与 AgentLedger `main` 的双仓联调可复现
- [ ] 企业域边界与组织域契约进入“稳定补边界”阶段，而非继续大改主契约
- [ ] OAuth 告警 compat 路径进入退场执行阶段，而不是继续长期共存
