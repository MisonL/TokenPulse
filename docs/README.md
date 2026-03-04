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
| [监控与告警](./MONITORING_GUIDE.md)       | 健康检查、日志、Prometheus 配置 |
| [备份与恢复](./BACKUP_RECOVERY.md)        | 数据备份策略、灾难恢复          |
| [故障排查](./TROUBLESHOOTING.md)          | 常见问题、诊断命令              |

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
