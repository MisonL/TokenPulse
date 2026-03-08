# OAuth 告警值班链路模板

## 目的

用于在真实值班链路演练前固定责任人与接收链路，避免窗口中靠口头确认。

## 步骤

| 角色 | 姓名/固定标识 | 联系方式 | 备用人 | 职责 |
| --- | --- | --- | --- | --- |
| owner |  |  |  | 执行 Secret 映射、发布与回滚 |
| auditor |  |  |  | 复核 `history/evidence/traceId` |
| warning 通道负责人 |  |  |  | 确认 warning 消息接收 |
| critical 通道负责人 |  |  |  | 确认 critical 升级链路接收 |
| P1 通道负责人 |  |  |  | 确认 Pager/电话叫醒链路 |
| 值班经理 |  |  |  | 批准窗口与失败升级决策 |

## 验证

- `warning / critical / P1` 三类责任人都已明确，且不是同一测试群占位。
- 值班经理已批准窗口。
- owner 与 auditor 不为空。

## 回滚

- 发生失败时由 owner 执行回滚。
- auditor 负责复核回滚是否完成，并把 `rollbackTraceId` 写回证据。
