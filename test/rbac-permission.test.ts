import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requirePermission } from "../src/middleware/rbac";

const app = new Hono();

app.get(
  "/audit-read",
  requirePermission("admin.audit.read"),
  (c) => c.json({ success: true }),
);
app.get(
  "/billing-manage",
  requirePermission("admin.billing.manage"),
  (c) => c.json({ success: true }),
);
app.get(
  "/rbac-manage",
  requirePermission("admin.rbac.manage"),
  (c) => c.json({ success: true }),
);

describe("RBAC 权限中间件", () => {
  it("未传角色时应按 owner 处理并允许访问", async () => {
    const res = await app.fetch(new Request("http://local/audit-read"));
    expect(res.status).toBe(200);
  });

  it("auditor 应可读取审计日志", async () => {
    const res = await app.fetch(
      new Request("http://local/audit-read", {
        headers: { "x-admin-role": "auditor" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("operator 不应具备审计读取权限", async () => {
    const res = await app.fetch(
      new Request("http://local/audit-read", {
        headers: { "x-admin-role": "operator" },
      }),
    );
    expect(res.status).toBe(403);
    const payload = await res.json();
    expect(payload.error).toBe("权限不足");
    expect(payload.required).toBe("admin.audit.read");
  });

  it("auditor 不应具备计费管理权限", async () => {
    const res = await app.fetch(
      new Request("http://local/billing-manage", {
        headers: { "x-admin-role": "auditor" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("operator 应通过 admin.users.manage 兼容 admin.rbac.manage", async () => {
    const res = await app.fetch(
      new Request("http://local/rbac-manage", {
        headers: { "x-admin-role": "operator" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
