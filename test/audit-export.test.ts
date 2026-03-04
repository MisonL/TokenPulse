import { describe, expect, it } from "bun:test";
import { buildAuditEventsCsv } from "../src/lib/admin/audit";

describe("审计导出 CSV", () => {
  it("应输出带表头的 UTF-8 BOM CSV，并正确转义特殊字符", () => {
    const csv = buildAuditEventsCsv([
      {
        id: 1,
        createdAt: "2026-03-04T10:00:00.000Z",
        actor: "admin,boss",
        action: "admin.audit.export",
        resource: "audit.events",
        resourceId: "policy-1",
        result: "success",
        traceId: "trace-001",
        ip: "127.0.0.1",
        userAgent: "Mozilla/5.0",
        details: {
          reason: "导出审计",
          scope: "tenant-default",
        },
      },
      {
        id: 2,
        createdAt: "2026-03-04T10:05:00.000Z",
        actor: "auditor",
        action: "admin.audit.read",
        resource: "audit.events",
        resourceId: null,
        result: "failure",
        traceId: "trace-002",
        ip: null,
        userAgent: "curl/8.0",
        details: "line1\nline2",
      },
    ]);

    expect(csv.startsWith("\uFEFFid,createdAt,actor,action,resource,resourceId,result,traceId,ip,userAgent,details\n")).toBe(
      true,
    );
    expect(csv).toContain("\"admin,boss\"");
    expect(csv).toContain("\"line1\nline2\"");
    expect(csv).toContain("\"{\"\"reason\"\":\"\"导出审计\"\",\"\"scope\"\":\"\"tenant-default\"\"}\"");
  });
});
