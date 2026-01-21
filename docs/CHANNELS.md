# TokenPulse 渠道实现逻辑汇总 (Channel Implementation Summary)

本文档汇总了 **TokenPulse** 项目中所有已实现 AI 渠道的技术细节、认证方式、API 终端以及模型获取逻辑。

---

## 核心设计哲学

### 1. BaseProvider 模式

所有渠道均继承自 `BaseProvider`，实现了统一的接口：

- `handleChatCompletion`: 统一的 OpenAI 兼容接口。
- `getModels`: 获取渠道支持的模型清单。
- `finalizeAuth`: 统一处理 OAuth 回调、身份解析与凭据持久化。

### 2. 高可用模型获取模式 (Robustness Pattern)

为了应对 API 波动、认证过期或 Scope 受限，每个渠道的 `getModels` 都遵循以下逻辑：

1. **动态尝试**：尝试调用上游 API 获取最新模型列表。
2. **错误捕获**：使用 `try-catch` 包裹所有网络与解析操作。
3. **静态兜底 (Fallback)**：若动态获取失败，立即返回一份预定义的**静态常用模型清单**。
   _这确保了前端 UI 永远不会因接口故障而导致模型下拉框为空。_

---

## 渠道详细清单

### 1. Kiro (AWS CodeWhisperer)

- **认证方式**: Device Flow (OIDC / Builder ID)
- **API 终端**: `https://codewhisperer.us-east-1.amazonaws.com`
- **处理逻辑**:
  - 使用 `x-amz-target: AmazonCodeWhispererService.ListAvailableCustomizations` 探测可用性。
  - **证书策略**: 采用 `curl -k` (Bun.spawn) 强行绕过 Node/Bun 的 TLS 证书校验，解决自签名/代理冲突。
- **默认模型**: Claude 3.5 Sonnet, Claude 3 Haiku (由 Kiro 侧作为前置服务提供)。

### 2. Copilot (GitHub Copilot)

- **认证方式**: OAuth (GitHub)
- **API 终端**: `https://api.githubcopilot.com`
- **处理逻辑**: 纯净的 GitHub OAuth 流程。
- **默认模型**: GPT-4o, GPT-4, o1, Claude 3.5 Sonnet, Gemini 2.0 Flash。

### 3. Qwen (阿里通义千问)

- **认证方式**: Device Flow (阿里云 DashScope)
- **API 终端**: `https://dashscope.aliyuncs.com`
- **处理逻辑**: 支持通过设备码实现快速登录。
- **模型来源**: 动态获取 `Qwen-*` 系列模型，失败时兜底提供 Qwen Max/Plus/Turbo/2.5 Coder。

### 4. iFlow (内部代理)

- **认证方式**: OAuth (iFlow 认证)
- **API 终端**: `https://apis.iflow.cn`
- **处理逻辑**: 专为内网/特定代理环境设计。
- **默认模型**: Claude 3.5 Sonnet, GPT-4o, DeepSeek Chat。

### 5. Codex (OpenAI)

- **认证方式**: OAuth (OpenAI Official)
- **核心逻辑**:
  - **请求转换**: 自动处理 `reasoning_effort` (o1 系列) 并开启 `parallel_tool_calls`。
  - **权限控制**: 显式声明 `api.model.read` 确保模型列表可读。
- **默认模型**: GPT-4o, GPT-4o Mini, GPT-4 Turbo, o1, o3-mini (OpenAI 全量常用模型)。

### 6. Claude (Anthropic)

- **认证方式**: OAuth (Anthropic Official)
- **核心逻辑**:
  - **思维模式 (Thinking)**: 支持 `interleaved-thinking` 预览特性，自动映射 OpenAI `reasoning_effort` 到 Anthropic `budget_tokens`。
  - **身份预设**: 自动注入 `Anthropic-Beta` 头。
- **默认模型**: Claude 3.5/3.7 Sonnet, Claude 3 Opus, Claude 3 Sonnet/Haiku。

### 7. AI Studio (Google AI)

- **认证方式**: API Key (AIza...) 或 Service Account JSON
- **API 终端**: `https://generativelanguage.googleapis.com`
- **处理逻辑**:
  - 兼容模式：检测输入前缀，智能切换 API Key 模式与 Service Account 模式。
  - 自动转换：将 OpenAI 消息结构转换为 Gemini 的 `contents` 结构。
- **默认模型**: Gemini 1.5 Pro, Gemini 1.5 Flash。

### 8. Vertex AI (Google Cloud)

- **认证方式**: Service Account JSON
- **API 终端**: `https://{location}-aiplatform.googleapis.com`
- **核心逻辑**:
  - **区域化**: 默认锁定 `us-central1`。
  - **项目隔离**: 从 JSON 中提取 `project_id` 构造动态端点。
- **默认模型**: Gemini 1.5 Pro, Gemini 1.5 Flash, Claude 3.5 Sonnet (Vertex 版)。

### 9. Antigravity (Google Internal)

- **认证方式**: OAuth (Google Internal)
- **核心逻辑**: 专用 Internal User-Agent，访问 Google 内部专有的 `v1internal` 生产端点。
- **默认模型**: Gemini 2.0 Flash, Gemini 1.5 Pro。

### 10. Gemini (Google Public)

- **认证方式**: OAuth (Google Cloud Console Project)
- **处理逻辑**: 标准 Google OAuth 流程，模型逻辑与 Antigravity 组件共享部分能力。

---

## 前端交互说明

- **模型查看**: 每个渠道 row 下的“查看模型”按钮通过 `/api/models?provider={id}` 实时获取。
- **统一 UI**: 无论上游是哪种协议（Rest/WS/gRPC），前端均渲染为一致的表格展示（包含模型名称与全局唯一 Model ID）。

---

_文档版本: 1.0.0 | 最后更新: 2026-01-20_
