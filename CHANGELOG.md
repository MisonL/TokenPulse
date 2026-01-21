# 变更日志

本文件将记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
本项目遵循 [语义化版本控制](https://semver.org/spec/v2.0.0.html)。

## [1.4.1] - 2026-01-21

**Observability Enhancement**

### 新增功能 (Features)

- **Prometheus Metrics**: 集成 `prom-client`，暴露标准 `/metrics` 端点
- **核心指标**:
  - `tokenpulse_http_requests_total`: 请求计数 (Counter)
  - `tokenpulse_http_request_duration_seconds`: 耗时分布 (Histogram)
  - `tokenpulse_active_providers`: 活跃 Provider 状态 (Gauge)
- **文档**: 更新 `docs/MONITORING_GUIDE.md` 添加 Grafana/Prometheus 配置示例

## [1.4.0] - 2026-01-21

**安全加固与运维生产就绪版本**

### 安全增强 (Security)

- **核心安全**: 全面实施 `crypto.timingSafeEqual` 防止时序攻击
- **Cookie 安全**: 生产环境强制 `Secure` / `HttpOnly` / `SameSite=Lax`
- **TLS 策略**: 禁用 TLS 校验需显式设置 `UNSAFE_DISABLE_TLS_CHECK`
- **数据脱敏**: Settings API 自动掩码 `*_token`, `*_secret` 等敏感字段
- **CSP 加固**: 移除 `unsafe-eval`，保留仅必要的 `unsafe-inline`
- **DoS 防护**: 请求体大小限制降至 50MB
- **反向代理**: Rate Limiter 严格遵循 `TRUST_PROXY` 配置

### 文档 (Docs)

- 新增 `docs/PRODUCTION_CHECKLIST.md`: 生产环境配置清单
- 新增 `docs/MONITORING_GUIDE.md`: 监控与告警指南
- 新增 `docs/BACKUP_RECOVERY.md`: 备份恢复手册
- 新增 `docs/TROUBLESHOOTING.md`: 故障排查手册
- 新增 `docs/README.md`: 文档中心索引

### 基础设施 (Infra)

- 优化 Docker 构建流程，确保环境变量正确传递
- 完善健康检查端点 (`/health`, `/api/credentials/status`)

## [1.3.6] - 2026-01-21

**功能完善与 UI 重构版本**

### 新增功能 (Features)

- **多模态支持**: Chat Playground 支持图片上传与多模态对话 (Gemini 1.5 Pro)
- **模型中心重构**: 全新设计的 Models Center，通过 Tab 分离目录与集成指南
- **Copilot 支持**: 新增 GitHub Copilot Provider (Device Flow)
- **OpenAI 兼容性**: 完善 `v1/chat/completions` 和 `v1/models` 的兼容层
- **模型 ID 命名空间**: 统一实施 `provider:id` 格式 (如 `antigravity:gemini-1.5-pro`)

### 优化 (Improvements)

- **UI/UX**: 统一 Bauhaus 设计语言，优化无障碍支持 (A11y)
- **国际化**: 补全前端界面的中文翻译
- **路由优化**: 修复 Anthropic Gateway 的 header 透传问题
- **类型安全**: 全面消除 TypeScript `any` 类型，通过 `tsc` 严格检查

## [1.0.0] - 2026-01-13

### 新增

- TokenPulse AI Gateway 初始版本发布
- 支持 8 个 AI 服务提供商的 OAuth 认证：
  - Claude (Anthropic)
  - Gemini (Google)
  - Antigravity (Google DeepMind)
  - Codex (OpenAI)
  - iFlow (心流)
  - Qwen (阿里云通义千问)
  - Kiro (AWS CodeWhisperer)
  - AI Studio (Google Cloud)
- 完整的凭证管理 API 端点
- 带有统计信息的实时仪表盘
- 审计日志系统
- 系统设置管理
- 100% 单元测试覆盖率（40 个测试用例）
- 完整的 API 文档
- 详细的部署指南
- 支持多阶段构建的 Docker 支持
- 用于性能优化的内存缓存层
- 速率限制和安全中间件
- Token 刷新机制
- 用于增强安全性的 PKCE（Proof Key for Code Exchange）

### 安全性

- 支持 PKCE 的 OAuth 2.0 实现
- 通过 state 参数进行 CSRF 保护
- 安全的 Token 存储
- 速率限制
- 输入验证
- CORS 配置

### 文档

- API 文档 (`docs/API.md`)
- 部署指南 (`docs/DEPLOYMENT.md`)
- 测试报告 (`docs/TEST_REPORT.md`)
- 版本管理指南 (`docs/VERSIONING.md`)

### 性能

- 内存缓存实现（减少 80% 的数据库查询）
- 优化的 OAuth 回调处理
- 高效的 Token 刷新机制

### 基础设施

- Docker 多阶段构建
- Docker Compose 配置
- SQLite 数据库与 Drizzle ORM
- TypeScript 类型安全

### 测试

- 所有 OAuth 提供商的单元测试
- 配置验证测试
- URL 生成测试
- 100% 测试覆盖率

### 技术细节

- 后端：Bun 运行时，Hono 框架
- 前端：React 19，Vite 7，Tailwind CSS 4
- 数据库：SQLite 与 Drizzle ORM
- 认证：支持 PKCE 的 OAuth 2.0
- 部署：Docker 容器
