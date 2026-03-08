# OAuth 告警真实链路演练证据模板

## 目的

用于统一记录 `release_window_oauth_alerts.sh` 自动化证据与真实值班链路人工证据，避免发布窗口结束后出现字段缺失或口径不一致。

## 步骤

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| runTag | `release-window-20260308T120000Z` | 本次窗口唯一标识 |
| historyId | `history-123` | Alertmanager sync-history ID |
| historyReason | `release window sync <RUN_TAG>` | 应包含本次 `RUN_TAG` |
| traceId | `trace-sync-001` | sync / rollback 相关主追踪键 |
| drillExitCode | `0` | `drill_oauth_alert_escalation.sh` 退出码 |
| rollbackResult | `skip/success/failure` | 若启用 rollback，需明确结果 |
| compatCheckMode | `false/observe/strict` | compat 门禁模式 |
| compat5mHits | `0` | compat 5m 汇总 |
| compat24hHits | `0` | compat 24h topk 汇总 |
| compatGateResult | `pass/warn/fail` | compat 门禁结论 |
| incidentId | `incident:oauth:...` | 命中升级时必须留 |
| incidentCreatedAt | `1772963998` | 命中升级时必须留 |
| warningSecretRef | `tokenpulse/prod/warning` | warning 通道 Secret 引用 |
| criticalSecretRef | `tokenpulse/prod/critical` | critical 通道 Secret 引用 |
| p1SecretRef | `tokenpulse/prod/p1` | P1 通道 Secret 引用 |
| owner | `release-owner` | 执行变更负责人 |
| auditor | `release-auditor` | 审计复核人 |
| oncallReceiver | `值班群/通道负责人` | 真实接收确认人 |
| messageReceipt | `消息 ID / 截图链接` | IM 接收证据 |
| pagerEventId | `PD-12345` | Pager/电话事件号，无则写 `N/A` |
| confirmedAt | `2026-03-08T12:18:33+08:00` | 人工确认时间 |
| ticketId | `OPS-20260308-001` | 工单/变更单 |

## 验证

- 自动化证据与人工接收证据都已填写。
- `historyReason` 与本次 `RUN_TAG` 一致。
- 若 `compat5mHits` 或 `compat24hHits` 非 `0`，必须补充 compat 归因记录。
- 若没有 `messageReceipt` 或 `pagerEventId` / `confirmedAt`，不得标记为“真实链路闭环完成”。

## 回滚

- 若窗口失败，记录 `rollbackResult`、`rollbackTraceId`、`rollbackHttpCode`、`rollbackError`。
- 若已切换真实通道但未形成有效接收，先按回滚手册恢复旧通道，再补失败工单与证据。
