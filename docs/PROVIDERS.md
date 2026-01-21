# TokenPulse 渠道接入指南

本文档详细说明了 TokenPulse 支持的所有 AI 渠道的接入方式、配置方法及注意事项。

## 目录

1.  [Claude (Anthropic)](#1-claude-anthropic)
2.  [Gemini (Google DeepMind)](#2-gemini-google-deepmind)
3.  [Antigravity (Google Internal)](#3-antigravity-google-internal)
4.  [Kiro (Amazon AWS)](#4-kiro-amazon-aws)
5.  [Codex (OpenAI Responses)](#5-codex-openai-responses)
6.  [Qwen (Alibaba Cloud)](#6-qwen-alibaba-cloud)
7.  [iFlow (阿里巴巴心流)](#7-iflow-阿里巴巴心流)
8.  [AI Studio (Google DeepMind)](#8-ai-studio-google-deepmind)
9.  [Vertex AI (Google Cloud Platform)](#9-vertex-ai-google-cloud-platform)
10. [Copilot (GitHub)](#10-copilot-github)

---

## 1. Claude (Anthropic)

- **类型**: OAuth 2.0
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  TokenPulse 会弹出一个授权窗口，跳转至 Anthropic 登录页面。
  3.  完成登录并授权 TokenPulse 访问您的账号。
  4.  窗口会自动关闭，状态变为 "Connected"。
- **注意事项**:
  - 需要能够访问 Anthropic 官网的网络环境。
  - TokenPulse 会自动刷新 Access Token，无需手动维护。

## 2. Gemini (Google DeepMind)

- **类型**: OAuth 2.0 (Google Account)
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  弹出 Google 登录窗口。
  3.  选择您的 Google 账号并授权相关权限（通常是 `generative-language` 作用域）。
  4.  授权成功后自动连接。
- **注意事项**:
  - 请确保您的 Google 账号已开通 Gemini API 访问权限。
  - 对于国内用户，可能需要配置网络代理。

## 3. Antigravity (Google Internal)

- **类型**: OAuth 2.0 (Google Account + Internal Scopes)
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  进行 Google 内部账号认证。
  3.  连接成功后，系统会自动处理 `CloudCode` 相关的特殊权限。
- **注意事项**:
  - **仅限 Google 内部员工或受邀测试者使用**。
  - 需要特殊的 OAuth Client ID 配置（已预置在代码中，但需环境变量配合）。

## 4. Kiro (Amazon AWS)

- **类型**: Device Code Flow (设备码模式)
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  TokenPulse 会生成一个 **User Code**（例如 `ABCD-1234`）并显示验证链接。
  3.  点击 "Open Login Page" 跳转至 AWS 验证页面。
  4.  输入 User Code 并确认。
  5.  回到 TokenPulse，点击 "Check Status" 或等待自动轮询完成连接。
- **注意事项**:
  - Kiro 使用 AWS Builder ID 进行认证。
  - User Code 有效期较短，请尽快完成操作。

## 5. Codex (OpenAI Responses)

- **类型**: OAuth 2.0 (模拟) / Session Auth
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  弹出模拟的 OpenAI 登录/授权窗口。
  3.  完成流程后自动连接。
- **注意事项**:
  - 这是对 OpenAI 风格接口的封装，底层可能依赖通过 OAuth 获取的 Session Token。

## 6. Qwen (Alibaba Cloud)

- **类型**: Device Code Flow (设备码模式) / OAuth
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  系统会尝试发起 OAuth 流程或提供设备码。
  3.  如果是设备码模式，请复制 User Code 并访问阿里云授权页面进行填写。
- **注意事项**:
  - 需要阿里云账号并开通通义千问模型服务（DashScope）。

## 7. iFlow (阿里巴巴心流)

- **类型**: OAuth 2.0 (Alibaba Internal)
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  跳转至阿里内部认证页面（Alibaba login）。
  3.  授权后回调连接。
- **注意事项**:
  - **仅限阿里内部员工使用**。
  - 需要连接阿里内网环境。

## 8. AI Studio (Google DeepMind)

- **类型**: API Key
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  前往 [Google AI Studio](https://aistudio.google.com/app/apikey) 获取 API Key。
  3.  点击 "Create API key"。
  4.  复制生成的以 `AIza` 开头的密钥。
  5.  将其粘贴到 TokenPulse 的输入框中，点击 "Save"。
- **注意事项**:
  - 此接口使用 `generativelanguage.googleapis.com`，而非 Vertex AI。
  - 请确保您的网络环境可以访问该域名。

## 9. Vertex AI (Google Cloud Platform)

- **类型**: Service Account Credential (JSON Key)
- **接入方式**:
  1.  点击 "Connect" 按钮，会弹出一个 JSON 输入框。
  2.  前往 [Google Cloud Console](https://console.cloud.google.com/) -> **IAM 和管理** (IAM & Admin) -> **服务账号** (Service Accounts)。
  3.  点击顶部的 "**创建服务账号**" (Create Service Account)。
      - **账号名称**：随意填写（如 `tokenpulse-bot`），点击 "**创建并继续**"。
      - **授予权限**：在 "选择角色" 中搜索并选中 **Vertex AI User**（或 "Vertex AI 用户"）。如果找不到，测试环境下可选 "Owner"。点击 "**完成**"。
  4.  生成密钥：
      - 在列表页点击刚才创建的账号邮箱地址（蓝色链接）。
      - 进入顶部 **"密钥"** (Keys) 选项卡。
      - 点击 **"添加密钥"** (Add Key) -> **"创建新密钥"** (Create new key)。
      - 选择 **JSON** 格式，点击 "创建"。文件会自动下载。
  5.  使用文本编辑器打开该 JSON 文件，**全选复制**所有内容。
  6.  将内容粘贴到 TokenPulse 的输入框中，点击 "Save"。
- **注意事项**:
  - **这是目前唯一需要手动上传文件的渠道**。
  - 请妥善保管您的 Service Account Key，不要泄露给他人。
  - 确保对应的 Google Cloud Project 已启用 Vertex AI API。

---

## 10. Copilot (GitHub)

- **类型**: Device Code Flow (设备码模式)
- **接入方式**:
  1.  点击 "Connect" 按钮。
  2.  TokenPulse 会生成一个 **User Code** 并显示 GitHub 验证链接。
  3.  点击链接跳转至 GitHub 设备授权页面。
  4.  输入 User Code 并确认授权。
  5.  回到 TokenPulse，等待自动轮询完成连接。
- **注意事项**:
  - 需要有效的 GitHub Copilot 订阅。
  - User Code 有效期较短，请尽快完成操作。

---

## 通用注意事项

1.  **网络环境**: 大多数国外 AI 服务（Claude, Gemini, API Studio, Kiro）需要特殊的网络环境才能连接。如果不通，您会看到连接超时或网络错误。
2.  **凭据失效**: 虽然 TokenPulse 会自动刷新 Token，但在某些情况下（如修改密码、长期未已使用），Token 可能会彻底失效。此时状态会变为 "Disconnected" 或在日志中报错，您需要手动点击 "Revoke" 然后重新 "Connect"。
3.  **安全性**: 您的凭据（Access Token, Refresh Token, Service Account Key）均加密存储在本地 SQLite 数据库中。请勿直接分享您的 `credentials.db` 文件。
