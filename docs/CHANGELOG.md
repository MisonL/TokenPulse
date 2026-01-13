# 变更日志

本文件将记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
本项目遵循 [语义化版本控制](https://semver.org/spec/v2.0.0.html)。

## [未发布]

### 计划中

- 额外的提供商集成
- 增强的监控和日志记录
- 性能优化

## [0.1.0] - 2026-01-13

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
