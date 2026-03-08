import { describe, expect, it } from "bun:test";
import {
  buildTraceableErrorMessage,
  extractListData,
  formatFlows,
  formatOptionalDateTime,
  formatTraceableMessage,
  normalizeDateTimeParam,
  parseAuditDetails,
  resolveAuditPolicyId,
  toObject,
  toText,
} from "./enterprisePageUtils";

describe("enterprisePageUtils", () => {
  it("应规范化文本、对象和列表数据读取", () => {
    expect(toText(123)).toBe("123");
    expect(toText(false)).toBe("false");
    expect(toObject(null)).toEqual({});
    expect(extractListData({ data: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(extractListData({ items: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(extractListData({ data: { items: [{ id: 3 }] } })).toEqual([{ id: 3 }]);
  });

  it("应构造 traceable message 并归一化时间参数", () => {
    expect(formatTraceableMessage("操作成功", "trace-001")).toBe("操作成功（traceId: trace-001）");
    expect(
      buildTraceableErrorMessage({ error: "失败", traceId: "trace-002" }, "fallback"),
    ).toBe("失败（traceId: trace-002）");
    expect(normalizeDateTimeParam("2026-03-08T12:00:00+08:00")).toBe(
      "2026-03-08T04:00:00.000Z",
    );
  });

  it("应格式化可选日期并解析审计 details / policyId", () => {
    expect(formatOptionalDateTime(null)).toBe("-");
    expect(formatFlows()).toBe("-");
    expect(formatFlows(["auth_code", "manual_key"])).toBe("auth_code, manual_key");
    expect(parseAuditDetails('{"policyId":"quota-1"}')).toEqual({ policyId: "quota-1" });
    expect(
      resolveAuditPolicyId({
        id: 1,
        actor: "owner",
        action: "quota.policy.update",
        resource: "quota.policy",
        resourceId: "policy-1",
        result: "success",
        createdAt: "2026-03-08T10:00:00.000Z",
        details: '{"policyId":"quota-2"}',
      }),
    ).toBe("quota-2");
  });
});
