import { describe, expect, it } from "bun:test";
import {
  buildAgentLedgerOutboxBaseQuery,
  buildAgentLedgerReplayAuditBaseQuery,
  parseOptionalPositiveInteger,
} from "./enterpriseQueryBuilders";

describe("enterpriseQueryBuilders", () => {
  it("应构造 AgentLedger outbox 基础查询参数", () => {
    expect(
      buildAgentLedgerOutboxBaseQuery({
        deliveryState: "pending",
        status: "failure",
        provider: " claude ",
        tenantId: " default ",
        projectId: " project-a ",
        traceId: " trace-001 ",
        from: "2026-03-08T12:00:00+08:00",
        to: "2026-03-08T13:00:00+08:00",
      }),
    ).toEqual({
      deliveryState: "pending",
      status: "failure",
      provider: "claude",
      tenantId: "default",
      projectId: "project-a",
      traceId: "trace-001",
      from: "2026-03-08T04:00:00.000Z",
      to: "2026-03-08T05:00:00.000Z",
    });
  });

  it("应在空筛选下省略 outbox 可选参数", () => {
    expect(
      buildAgentLedgerOutboxBaseQuery({
        deliveryState: "",
        status: "",
        provider: " ",
        tenantId: "",
        projectId: " ",
        traceId: " ",
        from: "invalid",
        to: "",
      }),
    ).toEqual({
      deliveryState: undefined,
      status: undefined,
      provider: undefined,
      tenantId: undefined,
      projectId: undefined,
      traceId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("应解析可选正整数 outboxId", () => {
    expect(parseOptionalPositiveInteger(" 12 ")).toBe(12);
    expect(parseOptionalPositiveInteger("0")).toBeUndefined();
    expect(parseOptionalPositiveInteger("-1")).toBeUndefined();
    expect(parseOptionalPositiveInteger("abc")).toBeUndefined();
  });

  it("应构造 AgentLedger replay 审计基础查询参数", () => {
    expect(
      buildAgentLedgerReplayAuditBaseQuery({
        outboxId: " 42 ",
        traceId: " trace-002 ",
        operatorId: " owner-1 ",
        result: "delivered",
        triggerSource: "manual",
        from: "2026-03-08T12:00:00+08:00",
        to: "2026-03-08T13:00:00+08:00",
      }),
    ).toEqual({
      outboxId: 42,
      traceId: "trace-002",
      operatorId: "owner-1",
      result: "delivered",
      triggerSource: "manual",
      from: "2026-03-08T04:00:00.000Z",
      to: "2026-03-08T05:00:00.000Z",
    });
  });
});
