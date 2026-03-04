import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireAdminIdentity } from "../src/middleware/admin-auth";
import { requirePermission } from "../src/middleware/rbac";

function createRbacApp() {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const username = (c.req.header("x-admin-user") || "").trim();
    const role = c.req.header("x-admin-role") || "";

    if (username) {
      (c as any).set("adminIdentity", {
        authenticated: true,
        source: "header",
        username,
        roleKey: role,
      });
    }

    await next();
  });

  app.use("*", requireAdminIdentity);
  app.use("*", requirePermission("admin.org.manage"));

  app.get("/api/org/organizations", (c) => c.json({ success: true }));
  app.post("/api/org/projects", (c) => c.json({ success: true }));

  return app;
}

const app = createRbacApp();

describe("组织域 RBAC", () => {
  it("未认证管理员访问组织域应返回 403", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations"),
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toBe("管理员未登录或无权限");
  });

  it("owner 应可访问组织域读写接口", async () => {
    const readResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: {
          "x-admin-user": "owner-user",
          "x-admin-role": "owner",
        },
      }),
    );
    expect(readResponse.status).toBe(200);

    const writeResponse = await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "x-admin-user": "owner-user",
          "x-admin-role": "owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "project-a" }),
      }),
    );
    expect(writeResponse.status).toBe(200);
  });

  it("auditor 访问组织域管理接口应返回 403", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: {
          "x-admin-user": "auditor-user",
          "x-admin-role": "auditor",
        },
      }),
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toBe("权限不足");
    expect(payload.role).toBe("auditor");
    expect(payload.required).toBe("admin.org.manage");
  });

  it("operator 访问组织域管理接口应返回 403", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "x-admin-user": "operator-user",
          "x-admin-role": "operator",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "project-b" }),
      }),
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.role).toBe("operator");
    expect(payload.required).toBe("admin.org.manage");
  });

  it("未知角色应回退 operator 并被组织域权限拒绝", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: {
          "x-admin-user": "custom-user",
          "x-admin-role": "super-admin",
        },
      }),
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.role).toBe("operator");
    expect(payload.required).toBe("admin.org.manage");
  });

  it("角色字段应支持大小写与空白归一化", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: {
          "x-admin-user": "owner-user",
          "x-admin-role": " OWNER ",
        },
      }),
    );

    expect(response.status).toBe(200);
  });
});
