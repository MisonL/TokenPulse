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
| [监控与告警](./MONITORING_GUIDE.md)       | 健康检查、日志、Prometheus 配置 |
| [备份与恢复](./BACKUP_RECOVERY.md)        | 数据备份策略、灾难恢复          |
| [故障排查](./TROUBLESHOOTING.md)          | 常见问题、诊断命令              |

> OAuth 告警中心现支持“静默时段 + provider 抑制 + 最小投递级别”三类投递降噪策略，配置入口为 `/api/admin/observability/oauth-alerts/config`。
> 登录页会先通过 `GET /api/auth/verify-secret` 校验 Bearer `API_SECRET`，通过后才写入本地凭证。
> Alertmanager 发布窗口优先使用 `--secret-helper`，并在证据中固定输出 `historyReason`。
> 旧路径弃用窗口：`2026-03-01` 开始观测，`2026-06-30` 结束兼容，`2026-07-01` 起遗留调用按 `critical` 处置。

## 本轮同步摘要（2026-03-06）

已完成：

1. 登录探针已落地：`/api/auth/verify-secret` 用于登录前轻量校验 `API_SECRET`，详情见 [API 文档](./API.md)。
2. Alertmanager 发布链路已以 `--secret-helper` 为推荐入口，并在发布窗口证据中保留 `historyReason`，详情见 [验收矩阵](./VALIDATION_MATRIX.md)。
3. `docker compose --profile monitoring` 未显式覆盖时，默认挂载 `monitoring/alertmanager.webhook.local.example.yml`，该值只允许本地 webhook sink 演练。
4. 前端与发布脚本已统一切到 `/api/admin/observability/oauth-alerts/*` 主路径，并新增兼容路径残留护栏测试。
5. 仓库已补 `secret-helper` 模板、runtime Alertmanager 配置模板，并允许发布窗口改用双会话 Cookie 模式。

仍未完成：

1. 生产 Alertmanager webhook 仍需替换为真实值班通道，并执行一次真实链路演练。
2. 企业域边界异常分支与 OAuth 告警规则少量异常/边界场景仍需继续补测，详见 [架构重构方案](./ARCHITECTURE_PLAN.md)。
3. 兼容路径仍处于观测窗口，需持续关注 `tokenpulse_oauth_alert_compat_route_hits_total`，直至兼容窗口结束。

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
