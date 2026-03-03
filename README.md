<div align="center">
  <img src="docs/logo.png" alt="TokenPulse Logo" width="180" />
  <h1 style="margin-top: 20px">TokenPulse</h1>
  <h3 style="color: #666">统一 AI 网关与凭据管理器</h3>
  <p style="color: #888; font-size: 0.9em">Unified AI Gateway & Credential Manager</p>
  
  <br />
  
  [![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
  [![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev)
  [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org)
  [![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
  [![Version](https://img.shields.io/badge/version-1.4.2-blue.svg?style=for-the-badge)](https://github.com/MisonL/TokenPulse)
  [![Tests](https://img.shields.io/badge/tests->80%25-brightgreen.svg?style=for-the-badge)](https://github.com/MisonL/TokenPulse)
</div>

---

## ✨ 简介

**TokenPulse** 是一个高性能、安全的中间件，旨在统一管理各种 AI 提供商（Claude、Gemini、OpenAI 等）的认证和 API 交互。它提供了一个基于 Docker 部署的强大服务，并配备了现代化的 **Bauhaus** 风格管理后台。

### 🎯 核心特性

- 🔐 **凭据金库**: AES-256-GCM 硬件级数据加密，数据库从此无明文
- 🧠 **Antigravity 深度集成**: 完整 Thinking 模型支持（思考过程可视化、签名缓存）
- 🌉 **智能网关**: OpenAI 兼容接口，流式 SSE 协议转换
- 🛡️ **会话自愈**: 自动识别并修复对话状态损坏（Let-it-crash 策略）
- 💓 **自动保活**: 递归 `setTimeout` 调度（并发安全），智能刷新机制
- 📊 **可视化控制台**: 实时流量统计、Prometheus 指标、Token 消耗排行
- 🚀 **极速性能**: Bun 运行时 + Drizzle ORM + React 19 + Vite 7

---

## 🔌 支持的 AI 服务商

| 供应商          | 认证方式  | 模型支持                        | 特性                            |
| :-------------- | :-------: | :------------------------------ | :------------------------------ |
| **Claude**      | OAuth 2.0 | Claude 3.7 Sonnet/Haiku (Pens.) | 支持 Thinking & 签名恢复        |
| **Gemini**      | OAuth 2.0 | Gemini 2.0 Flash/Pro (Exp)      | 支持 Thinking & SSE 流式        |
| **Antigravity** | OAuth 2.0 | AG-Advanced, AG-Code            | **独家**: 签名缓存 & 双端点降级 |
| **Codex**       | OAuth 2.0 | GPT-4o, o1, o3                  | 支持原生 Tool-Use               |
| **iFlow**       | OAuth 2.0 | iFlow 心流模型                  | 适配手机号登录                  |
| **Qwen**        | OAuth 2.0 | 通义千问系列                    | 支持设备控制台流程              |
| **Kiro**        | OAuth 2.0 | CodeWhisperer                   | 自动绑定 AWS 租户               |
| **AI Studio**   | OAuth 2.0 | Google Cloud AI                 | 集成 Vertex AI 代理             |

---

## 🧩 核心功能模块

### 🛡️ AuthCore - 统一异构认证

抹平不同厂商 OAuth 2.0 流程的差异：

- ✅ **统一回调**: 所有厂商使用统一的回调处理逻辑
- ✅ **PKCE 支持**: Proof Key for Code Exchange 增强安全
- ✅ **状态保持**: 内置 `state` 校验，防止 CSRF 攻击
- ✅ **自动刷新**: Refresh Token Rotation 机制

### 🌉 SmartGateway - 多协议智能网关

让您的应用只需对接一套接口：

- ✅ **OpenAI 兼容层**: 自动转换为 Claude/Gemini 原生格式
- ✅ **流式转换**: 支持 SSE 实时流式响应
- ✅ **协议适配**: 无缝切换不同 AI 服务商

### 💓 PulseScheduler - 生命周期管理

TokenPulse 的心脏，确保服务永不掉线：

- ✅ **自动保活**: 每分钟检查 Token 有效期
- ✅ **智能刷新**: 过期前自动触发刷新流程
- ✅ **容错机制**: 刷新失败自动重试

### 📊 Bauhaus Dashboard - 可视化控制台

现代化的管理后台：

- ✅ **凭据金库**: 安全加密存储，自动脱敏，防止 Access Token 泄露
- ✅ **流量雷达**: 实时监控 RPS、带宽及 4xx/5xx 指标 (Prometheus)
- ✅ **审计日志**: 详细记录每次 API 调用
- ✅ **系统设置**: 灵活配置各项参数

---

## 🚀 快速开始

### 前置要求

- **Docker** & **Docker Compose** (推荐)
- **Bun** (仅本地开发需要)

### Docker 部署（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/yourusername/TokenPulse.git
cd TokenPulse

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置 API_SECRET 和 BASE_URL

# 3. 启动服务
docker-compose up --build -d

# 4. 访问管理后台
# 浏览器打开: http://localhost:8085 (前端) 或 http://localhost:9009 (后端)
```

### 本地开发

```bash
# 安装依赖
bun install

# 数据库迁移
bun run db:push

# 启动核心网关（默认 9009）
bun run dev:core

# 启动企业控制面（建议 9010）
bun run dev:enterprise

# 启动 Claude bridge（建议 9460）
bun run dev:bridge

# 新终端启动前端服务
cd frontend
bun install
bun run dev
```

---

## 📁 项目结构

```
TokenPulse/
├── apps/             # 双服务入口（core / enterprise）
├── packages/         # 共享类型与公共包
├── services/         # 辅助服务（如 claude bridge）
├── src/              # 后端源码
│   ├── api/          # API 路由
│   ├── lib/          # 核心库（认证、翻译、缓存等）
│   ├── middleware/   # 中间件
│   ├── routes/       # 业务路由
│   └── types/        # TypeScript 类型定义
├── frontend/         # 前端源码
│   ├── src/
│   │   ├── components/  # React 组件
│   │   ├── pages/       # 页面
│   │   ├── layouts/     # 布局
│   │   └── hooks/       # 自定义 Hooks
├── test/             # 单元测试
├── docs/             # 文档
├── drizzle/          # 数据库迁移
├── data/             # 数据库文件（本地）
└── scripts/          # 工具脚本
```

---

## 🏗️ 技术栈

### 后端

| 技术            | 用途              |
| :-------------- | :---------------- |
| **Bun**         | JavaScript 运行时 |
| **Hono**        | Web 框架          |
| **Drizzle ORM** | 数据库 ORM        |
| **SQLite**      | 数据库            |

### 前端

| 技术               | 用途     |
| :----------------- | :------- |
| **React 19**       | UI 框架  |
| **Vite 7**         | 构建工具 |
| **Tailwind CSS 4** | 样式框架 |
| **TypeScript**     | 类型安全 |

---

## 🔌 API 端点

### 认证相关

|  方法  | 路径                          | 说明                        |
| :----: | :---------------------------- | :-------------------------- |
| `GET`  | `/api/oauth/providers`        | 获取 OAuth 渠道与流程类型   |
| `GET`  | `/api/oauth/status`           | 获取 OAuth 连接状态         |
| `POST` | `/api/oauth/:provider/start`  | 发起 OAuth/Device 授权流程  |
| `POST` | `/api/oauth/:provider/poll`   | 轮询设备码流程状态          |
| `GET`  | `/api/oauth/session/:state`   | 查询 OAuth 授权会话状态     |
| `POST` | `/api/oauth/:provider/callback/manual` | 提交手动回调 URL |
| `POST` | `/api/oauth/callback`         | 聚合回调入口（code/state）  |
| `GET`  | `/api/oauth/:provider/callback` | 统一 OAuth 回调入口       |
| `POST` | `/api/oauth/kiro/register`    | Kiro 设备码注册与启动       |

### 凭据管理

|   方法   | 路径                   | 说明         |
| :------: | :--------------------- | :----------- |
|  `GET`   | `/api/credentials/status` | 获取凭据状态与账号计数 |
|  `GET`   | `/api/credentials`     | 获取所有凭据 |
| `DELETE` | `/api/credentials/:provider` | 删除凭据（支持 `?accountId=` 精确删除） |

### 企业能力（高级版）

|  方法  | 路径                         | 说明                    |
| :----: | :--------------------------- | :---------------------- |
| `GET`  | `/api/admin/features`        | 获取高级版能力开关      |
| `POST` | `/api/admin/auth/login`      | 管理员登录（local/hybrid） |
| `POST` | `/api/admin/auth/logout`     | 管理员退出会话          |
| `GET`  | `/api/admin/auth/me`         | 获取管理员会话状态      |
| `GET`  | `/api/admin/rbac/permissions`| 获取权限列表            |
| `GET`  | `/api/admin/rbac/roles`      | 获取角色定义            |
| `GET`  | `/api/admin/users`           | 获取管理员用户列表      |
| `PUT`  | `/api/admin/users/:id`       | 更新管理员用户与绑定    |
| `GET`  | `/api/admin/tenants`         | 获取租户列表            |
| `PUT`  | `/api/admin/tenants/:id`     | 更新租户信息            |
| `GET`  | `/api/admin/audit/events`    | 审计事件分页与筛选查询  |
| `POST` | `/api/admin/audit/events`    | 写入审计事件            |
| `GET`  | `/api/admin/billing/policies`| 获取配额策略            |
| `PUT`  | `/api/admin/billing/policies/:id`| 更新配额策略       |
| `GET`  | `/api/admin/billing/usage`   | 获取配额使用量窗口      |
| `GET`  | `/api/admin/oauth/selection-policy` | 获取 OAuth 路由策略 |
| `PUT`  | `/api/admin/oauth/selection-policy` | 更新 OAuth 路由策略 |
| `GET`  | `/api/admin/oauth/callback-events` | 查询 OAuth 回调事件 |
| `GET`  | `/api/admin/oauth/callback-events/:state` | 按 state 查询回调 |
| `GET`  | `/api/admin/oauth/model-alias` | 获取模型别名规则      |
| `GET`  | `/api/admin/oauth/excluded-models` | 获取模型禁用规则   |

### 统计与日志

| 方法  | 路径         | 说明         |
| :---: | :----------- | :----------- |
| `GET` | `/api/stats` | 系统统计数据 |
| `GET` | `/api/logs`  | 审计日志查询 |

### AI 接口（兼容 OpenAI）

|  方法  | 路径                   | 说明                       |
| :----: | :--------------------- | :------------------------- |
| `POST` | `/v1/chat/completions` | 聊天补全（OpenAI 兼容）    |
| `GET`  | `/v1/models`           | 模型列表（OpenAI 兼容）    |
| `POST` | `/v1/responses`        | Responses API 兼容接口     |
| `POST` | `/v1/messages`         | 消息接口（Anthropic 兼容） |

---

## 🧭 请求追踪与多账号路由

- 所有请求都会返回 `X-Request-Id` 响应头，可用于定位日志与审计事件。
- 可选传入 `X-TokenPulse-Account-Id` 指定账号（需 `TRUST_PROXY=true` 且 `ALLOW_HEADER_ACCOUNT_OVERRIDE=true`）。
- 可选传入 `X-TokenPulse-Selection-Policy` 临时覆盖策略（`round_robin` / `latest_valid` / `sticky_user`）。
- 企业管理可通过 `/api/admin/oauth/callback-events` 追踪 OAuth 回调成功/失败链路，并通过 traceId 反查审计事件。

## 🛡️ Claude 回退稳定参数

- `CLAUDE_BRIDGE_TIMEOUT_MS`：bridge 请求超时（毫秒）。
- `CLAUDE_BRIDGE_MAX_RETRIES`：bridge 降级重试次数。
- `CLAUDE_BRIDGE_CIRCUIT_THRESHOLD`：连续失败达到阈值后进入熔断。
- `CLAUDE_BRIDGE_CIRCUIT_COOLDOWN_SEC`：熔断冷却时间（秒）。

## 📊 测试覆盖

```bash
# 运行所有测试
bun run test

# 查看覆盖率
bun run test:coverage
```

当前测试覆盖率：**>80%** (60+ 测试用例)

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📮 联系方式

- **GitHub**: [https://github.com/yourusername/TokenPulse](https://github.com/yourusername/TokenPulse)
- **Issues**: [https://github.com/yourusername/TokenPulse/issues](https://github.com/yourusername/TokenPulse/issues)

---

<div align="center">
  <p style="color: #888; font-size: 0.9em">
    Made with ❤️ by TokenPulse Team
  </p>
</div>
