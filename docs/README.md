# TokenPulse 文档中心

TokenPulse 是一个统一的 AI 模型 OAuth 网关，支持多种 Provider 的凭证管理和 API 代理。

## 📚 文档目录

### 快速开始

| 文档                        | 说明                  |
| --------------------------- | --------------------- |
| [部署指南](./DEPLOYMENT.md) | Docker 部署、配置说明 |
| [API 文档](./API.md)        | RESTful API 接口说明  |

### 生产运维

| 文档                                      | 说明                            |
| ----------------------------------------- | ------------------------------- |
| [生产环境清单](./PRODUCTION_CHECKLIST.md) | 环境变量、密钥校验、启动检查    |
| [部署指南](./DEPLOYMENT.md)（发布灰度收口） | `scripts/release/*` 脚本用法与回滚流程 |
| [部署指南](./DEPLOYMENT.md)（OAuth 会话事件诊断） | OAuth 异常值班流程：筛选、按 state 聚合、CSV 导出、traceId 追溯 |
| [生产环境清单](./PRODUCTION_CHECKLIST.md)（OAuth 值班四段式） | 值班检查项模板：故障窗口筛选、聚合复盘、导出与追踪 |
| [部署指南](./DEPLOYMENT.md)（Alertmanager 升级演练） | Prometheus/Alertmanager 路由与 `scripts/release/drill_oauth_alert_escalation.sh` 演练 |
| [部署指南](./DEPLOYMENT.md)（Alertmanager Secret 发布） | `scripts/release/publish_alertmanager_secret_sync.sh` 参数与回滚要点 |
| [生产环境清单](./PRODUCTION_CHECKLIST.md)（Alertmanager 四段式） | 5/15 分钟升级检查、回滚动作与当班记录 |
| [验收矩阵](./VALIDATION_MATRIX.md) | 本地回归、灰度前、发布窗口、值班接手的统一检查清单 |
| [部署指南](./DEPLOYMENT.md)（Enterprise + AgentLedger 最小验收入口） | `scripts/release/validate_enterprise_runtime_bundle.sh` 的适用场景、最小命令与脚本关系 |
| [监控与告警](./MONITORING_GUIDE.md)       | 健康检查、日志、Prometheus 配置 |
| [备份与恢复](./BACKUP_RECOVERY.md)        | 数据备份策略、灾难恢复          |
| [故障排查](./TROUBLESHOOTING.md)          | 常见问题、诊断命令              |

> OAuth 告警中心现支持“静默时段 + provider 抑制 + 最小投递级别”三类投递降噪策略，配置入口为 `/api/admin/observability/oauth-alerts/config`。
> 登录页会先通过 `GET /api/auth/verify-secret` 校验 Bearer `API_SECRET`，通过后才写入本地凭证。
> Alertmanager 发布窗口优先使用 `--secret-helper`，并在证据中固定输出 `historyReason`。
> `tokenpulse_oauth_alert_compat_route_hits_total` 只覆盖 `/api/admin/oauth/alerts*` 与 `/api/admin/oauth/alertmanager*` 兼容入口；仓库会自动采集指标并阻止前端/脚本回归，但调用方归因与退场升级必须人工完成。
> 旧路径弃用窗口：`2026-03-01` 开始观测，`2026-06-30` 结束兼容，`2026-07-01` 起遗留调用按 `critical` 处置。

### 发布与联调速查

| 入口 | 用途 |
| --- | --- |
| `bun run test:release` | 基础发布回归入口，覆盖发布脚本、企业发布链路、Alertmanager、AgentLedger 与 compat 基础回归 |
| `bun run test:release:compat` | compat / 灰度 gate 专项回归入口，专门验证 compat 观测、`canary_gate` 与 release window 相关脚本 |
| `bun run test:release:full` | 完整门禁入口，在 `test:release` 基础上追加 compat guard 与 package scripts 声明校验 |
| `./scripts/release/validate_enterprise_runtime_bundle.sh --env-file ... --evidence-file ...` | Enterprise + AgentLedger 统一最小验收入口，适用于联调前收口、灰度前最小验收、值班交接前复核 |

联调前最小执行链固定为：

若只需要执行 Enterprise + AgentLedger 的统一最小验收，优先使用：

1. `./scripts/release/validate_enterprise_runtime_bundle.sh --env-file ... --evidence-file ...`
作用：作为最小验收入口，统一编排 `preflight_runtime_integrations.sh`、`canary_gate.sh --phase pre` 与 `drill_agentledger_runtime_webhook.sh`；不替代 `release_window_oauth_alerts.sh` 的真实发布窗口证据。

2. `./scripts/release/preflight_runtime_integrations.sh --env-file ...`
作用：产出统一 preflight evidence，确认 Alertmanager / OAuth release window / AgentLedger 三线预检状态。
3. `./scripts/release/canary_gate.sh --phase pre ...`
作用：产出灰度 gate 日志，确认登录探针、组织域只读、企业域边界与 compat 观测门禁。
4. `./scripts/release/drill_agentledger_runtime_webhook.sh --env-file ... --evidence-file ...`
作用：产出 AgentLedger 合同演练 evidence，验证首发 `202`、重放 `200` 的最小联调前协议闭环。
5. `./scripts/release/release_window_oauth_alerts.sh --env-file ... --evidence-file ...`
作用：产出 OAuth release window evidence，保留 `historyId/historyReason/traceId/drillExitCode/rollbackResult` 等发布窗口证据。

> 该执行链只用于联调前收口与发布前演练，不代表 TokenPulse 与 AgentLedger 的跨仓常驻同步。
> TokenPulse × AgentLedger 的字段、签名、幂等、失败补偿以 [TokenPulse × AgentLedger 联合对接稿 v1](./integration/TOKENPULSE_AGENTLEDGER_V1.md) 为唯一基线。

## 本轮同步摘要（2026-03-06）

已完成：

1. 登录探针已落地：`/api/auth/verify-secret` 用于登录前轻量校验 `API_SECRET`，详情见 [API 文档](./API.md)。
2. Alertmanager 发布链路已以 `--secret-helper` 为推荐入口，并在发布窗口证据中保留 `historyReason`，详情见 [验收矩阵](./VALIDATION_MATRIX.md)。
3. `docker compose --profile monitoring` 未显式覆盖时，默认挂载 `monitoring/alertmanager.webhook.local.example.yml`，该值只允许本地 webhook sink 演练。
4. 前端与发布脚本已统一切到 `/api/admin/observability/oauth-alerts/*` 主路径，并新增兼容路径残留护栏测试；compat 指标的观测 / 定位 / 升级流程已写入 [监控与告警](./MONITORING_GUIDE.md)。
5. 仓库已补 `secret-helper` 模板、runtime Alertmanager 配置模板，并允许发布窗口改用双会话 Cookie 模式。
6. 文档已明确区分“仓库自动化”与“生产人工”：脚本负责预检、sync、证据输出；真实值班通道替换、接收确认、Pager/电话留证必须人工完成。

仍未完成：

1. 生产 Alertmanager webhook 仍需替换为真实值班通道，并按 [部署指南](./DEPLOYMENT.md) / [生产环境清单](./PRODUCTION_CHECKLIST.md) 完成一次真实链路演练与人工留证。
2. 企业域边界异常分支与 OAuth 告警规则少量异常/边界场景仍需继续补测，详见 [架构重构方案](./ARCHITECTURE_PLAN.md)。
3. 兼容路径仍处于观测窗口，需持续关注 `tokenpulse_oauth_alert_compat_route_hits_total`，并在非零时完成人工归因与迁移闭环，直至兼容窗口结束。
4. 值班与 compat 记录建议直接使用模板：[`docs/templates/OAUTH_ALERT_ONCALL_CHAIN_TEMPLATE.md`](./templates/OAUTH_ALERT_ONCALL_CHAIN_TEMPLATE.md)、[`docs/templates/OAUTH_ALERT_RELEASE_EVIDENCE_TEMPLATE.md`](./templates/OAUTH_ALERT_RELEASE_EVIDENCE_TEMPLATE.md)、[`docs/templates/OAUTH_COMPAT_TRIAGE_LOG_TEMPLATE.md`](./templates/OAUTH_COMPAT_TRIAGE_LOG_TEMPLATE.md)。

### 值班速查（OAuth）

| 文档 | 速查内容 |
| --- | --- |
| [API 文档](./API.md) | `GET /api/auth/verify-secret`、`GET /api/admin/oauth/session-events*`、`GET /api/admin/oauth/callback-events*` 参数定义 |
| [部署指南](./DEPLOYMENT.md) | 值班流程四段式：筛选 -> 按 state 聚合 -> CSV 导出 -> traceId 追溯 |
| [生产环境清单](./PRODUCTION_CHECKLIST.md) | 值班执行清单与回滚动作 |

### Provider 集成

| 文档                            | 说明                      |
| ------------------------------- | ------------------------- |
| [Provider 列表](./PROVIDERS.md) | 支持的 AI Provider 及配置 |
| [渠道管理](./CHANNELS.md)       | 多渠道路由与负载均衡      |

### 开发者

| 文档                               | 说明                             |
| ---------------------------------- | -------------------------------- |
| [架构重构方案](./ARCHITECTURE_PLAN.md) | 一体化重构方案与当前进度匹配     |
| [测试报告](./TEST_REPORT.md)       | 测试覆盖率、质量报告             |

### 集成协作

| 文档 | 说明 |
| --- | --- |
| [TokenPulse × AgentLedger 联合对接稿 v1](./integration/TOKENPULSE_AGENTLEDGER_V1.md) | 双方唯一对接基线，固定职责边界、字段契约、鉴权、幂等、失败补偿与冻结规则 |

> TokenPulse × AgentLedger 的唯一入口路径固定为 `docs/integration/TOKENPULSE_AGENTLEDGER_V1.md`。若邮件、聊天或临时记录与该文档冲突，以该文档为准。

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      TokenPulse Gateway                      │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + Vite)                                    │
│  ├── Dashboard          ├── Credentials       ├── Settings │
│  └── Models Center      └── Chat Playground   └── Logs     │
├─────────────────────────────────────────────────────────────┤
│  Backend (Bun + Hono)                                       │
│  ├── /api/credentials   ├── /api/oauth        ├── /api/admin│
│  └── /api/models        └── /v1/* (OpenAI/Anthropic)       │
├─────────────────────────────────────────────────────────────┤
│  Providers                                                   │
│  ├── Antigravity (Google)  ├── Claude (Anthropic)           │
│  ├── Gemini (Google)       ├── Copilot (GitHub)             │
│  ├── Kiro (AWS)            ├── Codex (OpenAI)               │
│  ├── Qwen (Alibaba)        ├── iFlow (iFlow.cn)             │
│  └── Vertex (Google Cloud) └── AIStudio (Google)            │
├─────────────────────────────────────────────────────────────┤
│  Storage: PostgreSQL (core / enterprise schema)             │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速启动

```bash
# 克隆项目
git clone https://github.com/your-org/TokenPulse.git
cd TokenPulse

# 配置环境
cp .env.example .env
# 编辑 .env 设置 API_SECRET

# 启动服务
docker compose up -d --build

# 验证
curl http://localhost:9009/health

# 登录前探针（可选）
curl -H "Authorization: Bearer <API_SECRET>" \
  http://localhost:9009/api/auth/verify-secret
```

## 📞 支持

- **Issues**: [GitHub Issues](https://github.com/your-org/TokenPulse/issues)
- **文档反馈**: 欢迎 PR 改进文档

---

_最后更新: 2026-03-06_
