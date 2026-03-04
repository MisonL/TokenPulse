import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { config } from "../src/config";
import { db } from "../src/db";
import { requestContextMiddleware } from "../src/middleware/request-context";
import org from "../src/routes/org";

async function ensureOrgDomainTables() {
  await db.execute(sql.raw("CREATE SCHEMA IF NOT EXISTS enterprise"));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.organizations (
        id text PRIMARY KEY,
        name text NOT NULL,
        description text,
        status text NOT NULL DEFAULT 'active',
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_unique_idx ON enterprise.organizations(name)",
    ),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.projects (
        id text PRIMARY KEY,
        organization_id text NOT NULL,
        name text NOT NULL,
        description text,
        status text NOT NULL DEFAULT 'active',
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS projects_org_name_unique_idx ON enterprise.projects(organization_id, name)",
    ),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.org_members (
        id text PRIMARY KEY,
        organization_id text NOT NULL,
        user_id text,
        email text,
        display_name text,
        role text NOT NULL DEFAULT 'member',
        status text NOT NULL DEFAULT 'active',
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_user_unique_idx ON enterprise.org_members(organization_id, user_id)",
    ),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.org_member_projects (
        id serial PRIMARY KEY,
        organization_id text NOT NULL,
        member_id text NOT NULL,
        project_id text NOT NULL,
        created_at text NOT NULL
      )
    `),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS org_member_projects_unique_idx ON enterprise.org_member_projects(member_id, project_id)",
    ),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.admin_users (
        id text PRIMARY KEY,
        username text NOT NULL,
        password_hash text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `),
  );

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS enterprise.audit_events (
        id serial PRIMARY KEY,
        actor text NOT NULL DEFAULT 'system',
        action text NOT NULL,
        resource text NOT NULL,
        resource_id text,
        result text NOT NULL DEFAULT 'success',
        details text,
        ip text,
        user_agent text,
        trace_id text,
        created_at text NOT NULL
      )
    `),
  );
}

function createOrgApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.route("/api/org", org);
  return app;
}

function ownerHeaders(traceId: string, extra?: Record<string, string>) {
  return {
    "x-admin-user": "org-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
    ...(extra || {}),
  };
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;

describe("组织域路由契约", () => {
  beforeAll(async () => {
    await ensureOrgDomainTables();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("DELETE FROM enterprise.org_member_projects"));
    await db.execute(sql.raw("DELETE FROM enterprise.org_members"));
    await db.execute(sql.raw("DELETE FROM enterprise.projects"));
    await db.execute(sql.raw("DELETE FROM enterprise.organizations"));
    await db.execute(sql.raw("DELETE FROM enterprise.admin_users"));
    await db.execute(sql.raw("DELETE FROM enterprise.audit_events"));

    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
  });

  afterAll(() => {
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("ENABLE_ADVANCED=false 时读接口返回 503 + ADVANCED_DISABLED_READONLY", async () => {
    config.enableAdvanced = false;

    const app = createOrgApp();
    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations"),
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error).toBe("高级版能力未启用");
    expect(payload.code).toBe("ADVANCED_DISABLED_READONLY");
  });

  it("ENABLE_ADVANCED=false 时写接口返回 404", async () => {
    config.enableAdvanced = false;

    const app = createOrgApp();
    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-disabled-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "Org A" }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("高级版下应支持组织创建/查询/更新/删除完整链路", async () => {
    const app = createOrgApp();

    const createResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-001"),
        },
        body: JSON.stringify({
          id: " ORG-A ",
          name: "组织 A",
          description: "  用于契约测试  ",
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json();
    expect(created.success).toBe(true);
    expect(created.id).toBe("org-a");
    expect(created.traceId).toBe("trace-org-routes-001");

    const listResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: ownerHeaders("trace-org-routes-002"),
      }),
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.data.length).toBe(1);
    expect(listPayload.data[0].id).toBe("org-a");
    expect(listPayload.data[0].name).toBe("组织 A");

    const updateResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations/org-a", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-003"),
        },
        body: JSON.stringify({
          status: "disabled",
          description: "",
        }),
      }),
    );
    expect(updateResponse.status).toBe(200);
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);

    const filteredResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations?status=disabled", {
        headers: ownerHeaders("trace-org-routes-004"),
      }),
    );
    expect(filteredResponse.status).toBe(200);
    const filteredPayload = await filteredResponse.json();
    expect(filteredPayload.data.length).toBe(1);
    expect(filteredPayload.data[0].status).toBe("disabled");

    const deleteResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations/org-a", {
        method: "DELETE",
        headers: ownerHeaders("trace-org-routes-005"),
      }),
    );
    expect(deleteResponse.status).toBe(200);
    const deletePayload = await deleteResponse.json();
    expect(deletePayload.success).toBe(true);

    const finalListResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: ownerHeaders("trace-org-routes-006"),
      }),
    );
    const finalListPayload = await finalListResponse.json();
    expect(finalListPayload.data.length).toBe(0);
  });

  it("创建项目时若 organizationId 不存在应返回 404", async () => {
    const app = createOrgApp();

    const response = await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-project-001"),
        },
        body: JSON.stringify({
          id: "project-a",
          organizationId: "org-missing",
          name: "项目 A",
        }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toBe("组织不存在");
  });

  it("成员-项目绑定应校验唯一性并支持按组织过滤查询", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-bind-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );

    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-bind-002"),
        },
        body: JSON.stringify({
          id: "project-a",
          organizationId: "org-a",
          name: "项目 A",
        }),
      }),
    );

    await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-bind-003"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-a",
          email: "member-a@example.com",
          role: "member",
        }),
      }),
    );

    const firstBind = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-bind-004"),
        },
        body: JSON.stringify({
          organizationId: "org-a",
          memberId: "member-a",
          projectId: "project-a",
        }),
      }),
    );
    expect(firstBind.status).toBe(200);

    const duplicateBind = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-routes-bind-005"),
        },
        body: JSON.stringify({
          organizationId: "org-a",
          memberId: "member-a",
          projectId: "project-a",
        }),
      }),
    );
    expect([409, 500]).toContain(duplicateBind.status);
    const duplicatePayload = await duplicateBind.json();
    expect(typeof duplicatePayload.error).toBe("string");

    const listResponse = await app.fetch(
      new Request(
        "http://localhost/api/org/member-project-bindings?organizationId=ORG-A",
        {
          headers: ownerHeaders("trace-org-routes-bind-006"),
        },
      ),
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.data.length).toBe(1);
    expect(listPayload.data[0].organizationId).toBe("org-a");

    const invalidDelete = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings/not-number", {
        method: "DELETE",
        headers: ownerHeaders("trace-org-routes-bind-007"),
      }),
    );
    expect(invalidDelete.status).toBe(400);
    const invalidDeletePayload = await invalidDelete.json();
    expect(invalidDeletePayload.error).toBe("绑定 ID 无效");

    const bindingId = listPayload.data[0].id as number;
    const deleteResponse = await app.fetch(
      new Request(
        `http://localhost/api/org/member-project-bindings/${bindingId}`,
        {
          method: "DELETE",
          headers: ownerHeaders("trace-org-routes-bind-008"),
        },
      ),
    );
    expect(deleteResponse.status).toBe(200);
  });
});
