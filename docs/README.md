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
| [监控与告警](./MONITORING_GUIDE.md)       | 健康检查、日志、Prometheus 配置 |
| [备份与恢复](./BACKUP_RECOVERY.md)        | 数据备份策略、灾难恢复          |
| [故障排查](./TROUBLESHOOTING.md)          | 常见问题、诊断命令              |

> OAuth 告警中心现支持“静默时段 + provider 抑制 + 最小投递级别”三类投递降噪策略，配置入口为 `/api/admin/observability/oauth-alerts/config`。
> 旧路径弃用窗口：`2026-03-01` 开始观测，`2026-06-30` 结束兼容，`2026-07-01` 起遗留调用按 `critical` 处置。

### 值班速查（OAuth）

| 文档 | 速查内容 |
| --- | --- |
| [API 文档](./API.md) | `GET /api/admin/oauth/session-events*`、`GET /api/admin/oauth/callback-events*` 参数定义 |
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
```

## 📞 支持

- **Issues**: [GitHub Issues](https://github.com/your-org/TokenPulse/issues)
- **文档反馈**: 欢迎 PR 改进文档

---

_最后更新: 2026-03-04_
