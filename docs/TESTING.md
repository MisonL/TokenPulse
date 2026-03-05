# 测试与覆盖率

## 目的

本文档说明如何在 TokenPulse 仓库中运行后端单元测试、生成覆盖率报告，并解释覆盖率输出的口径（尤其是 `All files` 汇总与关键模块覆盖率的差异）。项目不承诺固定覆盖率百分比，所有覆盖率结论以本地执行 `bun run test:coverage` 的输出为准。

## 步骤

- 安装依赖（首次或依赖变更后）：

```bash
bun install
```

- 运行全部后端单元测试：

```bash
bun run test
```

- 生成并查看覆盖率（以命令输出为准）：

```bash
bun run test:coverage
```

- 可选：只跑某个测试文件/聚焦某个模块：

```bash
# 跑单个测试文件（路径需以 ./ 或 / 开头）
bun test ./test/some-feature.test.ts

# 仅对指定模块做覆盖率聚焦（用于快速定位未覆盖代码）
bun test --coverage src/lib/some-module.ts
```

## 验证

`bun run test`：
终端输出中 `fail` 为 `0`，且命令退出码为 `0`。
若你只改了文档但测试失败，优先排查是否有本地环境变量/依赖不一致导致的非确定性问题。

`bun run test:coverage`：
终端会输出覆盖率汇总表，包含每个文件（或分组）以及一行 `All files`。
`All files` 是“纳入统计的所有文件”的整体汇总口径：它可能包含非关键路径代码（也可能包含测试文件），并会被未覆盖的边缘模块拉低，因此不能直接等同于“关键模块覆盖率”或“项目健康度”。
评估关键路径时，请在覆盖率输出中查看与当前改动相关的目录/文件（例如 `src/lib/`、`src/routes/`、`src/middleware/` 等）的行/分支/函数覆盖率，并结合 PR 变更范围判断。
若配置了 Bun 的持久化覆盖率 reporter（如 `lcov`），会在 `coverage/` 目录生成报告文件（默认目录名为 `coverage`，可在 `bunfig.toml` 的 `[test]` 下通过 `coverageDir` 修改）。

## 回滚

- 本次变更仅涉及文档，推荐使用 Git 回滚提交来撤销：

```bash
git revert <commit-sha>
```

- 若只想撤销单个文件，也可以在本地用 Git 恢复到某个历史版本（以团队约定为准）。
