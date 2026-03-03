# 前端开发指南

TokenPulse 前端基于 **React 19 + TypeScript + Vite 7**，用于管理凭据、模型、日志、设置与聊天调试页面。

## 目录结构

- `frontend/src/components/`：通用组件与 UI 组件。
- `frontend/src/pages/`：页面级组件（如 `Dashboard`、`CredentialsPage`）。
- `frontend/src/layouts/`：整体布局。
- `frontend/src/lib/`：客户端请求、工具函数与 i18n。
- `frontend/public/`：静态资源。

## 常用命令

```bash
cd frontend
bun install
bun run dev      # 本地开发
bun run build    # 生产构建
bun run lint     # ESLint 检查
bun run preview  # 本地预览构建产物
```

## 代码规范

- 使用 TypeScript 严格类型，避免 `any`。
- React 组件文件采用 PascalCase 命名（如 `SettingsPage.tsx`）。
- 通用工具文件采用小写命名（如 `utils.ts`、`client.ts`）。
- 提交前必须通过 `bun run lint`。

## 开发约定

- API 基地址与鉴权逻辑统一放在 `src/lib/client.ts`。
- 新页面应在 `src/App.tsx` 中注册路由，并复用现有 `BauhausLayout`。
- 新增文案优先写中文，并同步 i18n 词条（`src/lib/i18n.ts`）。
