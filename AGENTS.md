# Repository Guidelines

## 项目结构与模块组织
TokenPulse 使用 Bun + TypeScript 单仓库结构，后端与前端分离：
- `src/`：后端服务（Hono 路由、认证、网关、调度、数据库访问）。
- `test/`：后端单元测试，文件命名为 `*.test.ts`。
- `frontend/src/`：React 19 + Vite 前端（`components/`、`pages/`、`layouts/`、`hooks/`）。
- `drizzle/`：数据库迁移资产；`data/`：本地 SQLite 数据文件；`docs/`：项目文档；`scripts/`：维护脚本。

## 构建、测试与开发命令
优先使用 Bun 工具链：
- `bun install`：安装根依赖。
- `bun run dev`：启动后端开发服务（监听 `src/index.ts`）。
- `bun run start`：执行迁移后启动后端。
- `bun run test`：运行 Bun 测试。
- `bun run test:coverage`：生成覆盖率报告。
- `bun run db:push` / `bun run db:studio`：Drizzle 推送模式变更 / 打开数据工作台。
- `cd frontend && bun install && bun run dev`：启动前端开发环境。
- `cd frontend && bun run build && bun run lint`：前端构建与静态检查。

## 代码风格与命名规范
- TypeScript 开启 `strict`，提交前保证无类型错误。
- 缩进使用 2 空格，字符串使用双引号（与现有代码保持一致）。
- 后端模块文件采用小写连字符或下划线风格（如 `rate-limiter.ts`、`token_manager.ts`）；React 组件与页面使用 PascalCase（如 `SettingsPage.tsx`）。
- 新增逻辑优先放入对应分层目录：路由放 `src/routes`，通用能力放 `src/lib`。

## 测试规范
- 测试框架为 `bun test`（`describe/it/expect`）。
- 测试文件与目标模块同语义命名，例如 `logger.test.ts`、`thinking-recovery.test.ts`。
- 变更认证、网关、调度、加密相关逻辑时必须补充回归测试，覆盖率目标不低于 README 标注基线（80%）。

## 提交与 Pull Request 规范
- 采用 Conventional Commits：`feat(scope): ...`、`fix: ...`、`chore: ...`、`docs: ...`（可参考近期历史）。
- PR 需包含：变更摘要、影响范围、测试结果（至少附 `bun run test`）、配置变更说明（如 `.env` 新增项）。
- 涉及前端页面改动时附截图；涉及接口行为变更时附示例请求或关键响应。

## 架构与协作约定
- 统一入口为 `src/index.ts`，新增中间件时优先挂在 `/api/*` 或 `/v1/*`，避免影响静态资源路由。
- Provider 适配优先复用 `src/lib/providers/base.ts` 抽象能力，避免在路由层直接耦合第三方协议细节。
- 数据库字段变更遵循“先迁移、后调用”原则：先更新 `drizzle/` 与 `src/db/schema.ts`，再修改业务代码。
- 需要跨后端与前端联动的功能，先定义 API 返回结构，再同步更新 `frontend/src/lib/client.ts` 与页面调用逻辑。

## 中文化与文档规范
- 用户可见提示、报错、通知文案默认使用中文；保留必要专有名词（如 OAuth、API Key）。
- 新增文档放在 `docs/`，以“目的、步骤、验证、回滚”四段式组织，避免仅贴命令不解释。
- 对高风险配置（鉴权、加密、代理）必须给出最小可运行示例，并标注适用环境（开发/生产）。

## 安全与配置提示
- 从 `.env.example` 复制生成本地 `.env`，生产环境必须设置强 `API_SECRET`。
- 严禁提交真实密钥、令牌或数据库文件内容；提交前检查 `data/` 与日志类产物是否被误纳入版本控制。
