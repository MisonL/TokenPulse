# TokenPulse AI Gateway - 版本管理机制

## 版本号规范

采用语义化版本控制 (Semantic Versioning 2.0.0)：

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: 主版本号 - 不兼容的 API 修改
- **MINOR**: 次版本号 - 向下兼容的功能性新增
- **PATCH**: 修订号 - 向下兼容的问题修正

## 版本历史

### v0.1.0 (2026-01-13)

**初始稳定版本**

#### 新功能

- 支持 8 个 AI 服务提供商的 OAuth 认证
- 完整的 API 端点和前端界面
- 100% 单元测试覆盖率（40 个测试用例）
- 完整的 API 和部署文档

#### 支持的提供商

- Claude (Anthropic)
- Gemini (Google)
- Antigravity (Google DeepMind)
- Codex (OpenAI)
- iFlow (心流)
- Qwen (阿里云通义千问)
- Kiro (AWS CodeWhisperer)
- AI Studio (Google Cloud)

#### 技术栈

- 后端: Bun, Hono, Drizzle ORM, SQLite
- 前端: React 19, Vite 7, Tailwind CSS 4
- 部署: Docker, Docker Compose

## 版本发布流程

### 1. 开发阶段 (Pre-release)

在开发新功能时，使用预发布版本号：

```
v0.2.0-alpha.1
v0.2.0-beta.1
v0.2.0-rc.1
```

- **alpha**: 内部测试版本
- **beta**: 公开测试版本
- **rc**: 候选发布版本

### 2. 发布准备

完成以下检查清单：

- [ ] 所有单元测试通过
- [ ] 代码审查完成
- [ ] 文档更新完成
- [ ] CHANGELOG 更新
- [ ] 版本号更新
- [ ] Git 标签创建

### 3. 创建发布版本

#### 步骤 1: 更新版本号

更新 `package.json` 中的版本号：

```json
{
  "name": "tokenpulse",
  "version": "0.2.0"
}
```

#### 步骤 2: 更新 CHANGELOG

在 `CHANGELOG.md` 中添加版本更新说明：

```markdown
## [0.2.0] - 2026-01-20

### Added

- 新功能 1
- 新功能 2

### Changed

- 改进 1

### Fixed

- 修复问题 1
```

#### 步骤 3: 提交代码

```bash
git add .
git commit -m "Release v0.2.0: Version description"
```

#### 步骤 4: 创建标签

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
```

#### 步骤 5: 推送到远程仓库

```bash
git push origin main
git push origin v0.2.0
```

## 分支策略

### 主分支 (main)

- **用途**: 生产环境代码
- **保护**: 只允许通过 Pull Request 合并
- **要求**: 所有测试必须通过

### 开发分支 (develop)

- **用途**: 开发环境代码
- **来源**: 从 main 分支创建
- **合并**: 合并回 main 分支创建发布版本

### 功能分支 (feature/\*)

- **用途**: 开发新功能
- **命名**: `feature/provider-name` 或 `feature/feature-name`
- **来源**: 从 develop 分支创建
- **合并**: 合并回 develop 分支

### 修复分支 (fix/\*)

- **用途**: 修复问题
- **命名**: `fix/issue-description`
- **来源**: 从 main 或 develop 分支创建
- **合并**: 合并回 develop 分支（如果是小修复）或 main 分支（如果是紧急修复）

### 发布分支 (release/\*)

- **用途**: 准备发布版本
- **命名**: `release/v0.2.0`
- **来源**: 从 develop 分支创建
- **合并**: 合并回 main 和 develop 分支

## 提交信息规范

使用约定式提交 (Conventional Commits)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型 (type)

- **feat**: 新功能
- **fix**: 问题修复
- **docs**: 文档更新
- **style**: 代码格式（不影响代码运行）
- **refactor**: 重构
- **test**: 测试相关
- **chore**: 构建过程或辅助工具的变动

### 示例

```bash
feat(auth): add Gemini OAuth support

- Implement Gemini OAuth flow
- Add PKCE for security
- Update documentation

Closes #123
```

```bash
fix(credentials): resolve token refresh issue

The refresh token was not being properly stored in the database.
This caused authentication failures after token expiration.

Fixes #456
```

## 变更日志 (CHANGELOG)

维护 `CHANGELOG.md` 文件，记录所有重要变更：

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 待添加的功能

### Changed

- 待变更的功能

## [0.1.0] - 2026-01-13

### Added

- Initial release
- OAuth authentication for 8 AI providers
- Complete API endpoints
- Frontend UI
- Unit tests
- Documentation
```

## 发布检查清单

### 代码质量

- [ ] 所有单元测试通过
- [ ] 代码审查完成
- [ ] 无 linting 错误
- [ ] 无安全漏洞

### 文档

- [ ] API 文档更新
- [ ] 部署文档更新
- [ ] CHANGELOG 更新
- [ ] README 更新（如需要）

### 功能

- [ ] 所有新功能已测试
- [ ] 所有 bug 已修复
- [ ] 向下兼容性检查

### 部署

- [ ] Docker 镜像构建成功
- [ ] 部署文档验证
- [ ] 回滚计划准备

## 版本回滚

如果发现问题需要回滚：

### 1. 回滚到上一个版本

```bash
git checkout v0.1.0
git checkout -b hotfix-v0.1.1
# 修复问题
git checkout main
git merge hotfix-v0.1.1
git tag -a v0.1.1 -m "Hotfix v0.1.1"
git push origin main --tags
```

### 2. 使用 Git revert

```bash
git revert <commit-hash>
git push origin main
```

## 版本命名建议

### 主版本 (MAJOR)

- 当进行不兼容的 API 修改时
- 当删除已废弃的功能时

### 次版本 (MINOR)

- 当添加向下兼容的功能时
- 当添加新的提供商支持时

### 修订版本 (PATCH)

- 当进行向下兼容的问题修复时
- 当修复安全漏洞时

## 预发布版本标识

- **alpha**: 内部测试，可能包含重大 bug
- **beta**: 公开测试，功能基本完整
- **rc**: 候选发布，只修复 bug

示例：

- `v0.2.0-alpha.1`
- `v0.2.0-beta.1`
- `v0.2.0-rc.1`

## 版本兼容性

### API 兼容性

- 保持 API 向下兼容
- 废弃的 API 至少保留一个主版本
- 在文档中明确标注废弃的 API

### 数据库兼容性

- 使用数据库迁移脚本
- 保持数据库结构向下兼容
- 提供数据迁移工具

## 版本发布通知

发布新版本时：

1. 更新 GitHub Releases
2. 更新文档网站
3. 发送通知给用户
4. 更新 CHANGELOG
5. 创建 Docker 镜像标签

## 版本策略总结

- **主版本**: 重大变更，可能不兼容
- **次版本**: 新功能，向下兼容
- **修订版本**: 问题修复，向下兼容
- **预发布**: 开发和测试阶段
- **标签**: 每个正式版本创建 Git 标签
- **分支**: 使用 Git Flow 工作流
- **提交**: 使用约定式提交规范
