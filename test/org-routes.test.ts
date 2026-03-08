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

  it("禁用组织下创建项目应返回 409", async () => {
    const app = createOrgApp();
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-project-disabled-001"),
        },
        body: JSON.stringify({ id: "org-disabled", name: "组织 Disabled", status: "disabled" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-project-disabled-002"),
        },
        body: JSON.stringify({
          id: "project-disabled-attempt",
          organizationId: "org-disabled",
          name: "禁止创建项目",
        }),
      }),
    );

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toBe("组织已禁用，禁止新增项目");
  });

  it("应返回组织域概览统计", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-overview-001"),
        },
        body: JSON.stringify({ id: "org-active", name: "组织 Active", status: "active" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-overview-002"),
        },
        body: JSON.stringify({ id: "org-disabled", name: "组织 Disabled", status: "disabled" }),
      }),
    );

    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-overview-003"),
        },
        body: JSON.stringify({
          id: "project-active",
          organizationId: "org-active",
          name: "项目 Active",
          status: "active",
        }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-overview-004"),
        },
        body: JSON.stringify({
          id: "project-disabled",
          organizationId: "org-active",
          name: "项目 Disabled",
          status: "disabled",
        }),
      }),
    );

    await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-overview-005"),
        },
        body: JSON.stringify({
          id: "member-active",
          organizationId: "org-active",
          email: "member-active@example.com",
          status: "active",
        }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-overview-006"),
        },
        body: JSON.stringify({
          id: "member-disabled",
          organizationId: "org-active",
          email: "member-disabled@example.com",
          status: "disabled",
        }),
      }),
    );

    await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-overview-007"),
        },
        body: JSON.stringify({
          organizationId: "org-active",
          memberId: "member-active",
          projectId: "project-active",
        }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/org/overview", {
        headers: ownerHeaders("trace-org-overview-008"),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.organizations).toEqual({
      total: 2,
      active: 1,
      disabled: 1,
    });
    expect(payload.data.projects).toEqual({
      total: 2,
      active: 1,
      disabled: 1,
    });
    expect(payload.data.members).toEqual({
      total: 2,
      active: 1,
      disabled: 1,
    });
    expect(payload.data.bindings.total).toBe(1);
  });

  it("成员批量创建应返回错误聚合结果", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-batch-member-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/org/members/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-batch-member-002"),
        },
        body: JSON.stringify({
          items: [
            {
              id: "member-a",
              organizationId: "org-a",
              email: "member-a@example.com",
            },
            {
              id: "member-invalid",
              organizationId: "org-a",
            },
            {
              id: "member-missing-org",
              organizationId: "org-missing",
              email: "missing@example.com",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.data.requested).toBe(3);
    expect(payload.data.successCount).toBe(1);
    expect(payload.data.errorCount).toBe(2);
    const codes = (payload.data.errors || []).map(
      (item: { code?: string }) => item.code,
    );
    expect(codes).toContain("VALIDATION_FAILED");
    expect(codes).toContain("ORGANIZATION_NOT_FOUND");

    const listResponse = await app.fetch(
      new Request("http://localhost/api/org/members?organizationId=org-a", {
        headers: ownerHeaders("trace-org-batch-member-003"),
      }),
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.data.length).toBe(1);
    expect(listPayload.data[0].id).toBe("member-a");
  });

  it("成员更新应支持调整 organizationId 并保留 traceId", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-move-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-move-002"),
        },
        body: JSON.stringify({ id: "org-b", name: "组织 B" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-move-003"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-a",
          email: "member-a@example.com",
        }),
      }),
    );

    const traceId = "trace-org-member-move-004";
    const response = await app.fetch(
      new Request("http://localhost/api/org/members/member-a", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders(traceId),
        },
        body: JSON.stringify({
          organizationId: "org-b",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.traceId).toBe(traceId);

    const movedListResponse = await app.fetch(
      new Request("http://localhost/api/org/members?organizationId=org-b", {
        headers: ownerHeaders("trace-org-member-move-005"),
      }),
    );
    expect(movedListResponse.status).toBe(200);
    const movedListPayload = await movedListResponse.json();
    expect(movedListPayload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "member-a",
          organizationId: "org-b",
        }),
      ]),
    );
  });

  it("成员更新时若目标 organizationId 不存在应返回 404 并保留 traceId", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-move-missing-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-move-missing-002"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-a",
          email: "member-a@example.com",
        }),
      }),
    );

    const traceId = "trace-org-member-move-missing-003";
    const response = await app.fetch(
      new Request("http://localhost/api/org/members/member-a", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders(traceId),
        },
        body: JSON.stringify({
          organizationId: "org-missing",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("组织不存在");
    expect(payload.traceId).toBe(traceId);
  });

  it("禁用组织下创建成员、迁移成员都应被阻止", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-disabled-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-disabled-002"),
        },
        body: JSON.stringify({ id: "org-disabled", name: "组织 Disabled", status: "disabled" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-disabled-003"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-a",
          email: "member-a@example.com",
        }),
      }),
    );

    const createResponse = await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-disabled-004"),
        },
        body: JSON.stringify({
          id: "member-disabled-create",
          organizationId: "org-disabled",
          email: "member-disabled@example.com",
        }),
      }),
    );
    expect(createResponse.status).toBe(409);
    expect((await createResponse.json()).error).toBe("组织已禁用，禁止新增成员");

    const moveTraceId = "trace-org-member-disabled-005";
    const moveResponse = await app.fetch(
      new Request("http://localhost/api/org/members/member-a", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders(moveTraceId),
        },
        body: JSON.stringify({
          organizationId: "org-disabled",
        }),
      }),
    );
    expect(moveResponse.status).toBe(409);
    expect(moveResponse.headers.get("x-request-id")).toBe(moveTraceId);
    const movePayload = await moveResponse.json();
    expect(movePayload.error).toBe("目标组织已禁用");
  });

  it("删除成员时应级联清理项目绑定，再次删除返回 404 并保留 traceId", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-delete-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-delete-002"),
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
          ...ownerHeaders("trace-org-member-delete-003"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-a",
          email: "member-a@example.com",
        }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-delete-004"),
        },
        body: JSON.stringify({
          organizationId: "org-a",
          memberId: "member-a",
          projectId: "project-a",
        }),
      }),
    );

    const deleteTraceId = "trace-org-member-delete-005";
    const deleteResponse = await app.fetch(
      new Request("http://localhost/api/org/members/member-a", {
        method: "DELETE",
        headers: ownerHeaders(deleteTraceId),
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.headers.get("x-request-id")).toBe(deleteTraceId);
    const deletePayload = await deleteResponse.json();
    expect(deletePayload.success).toBe(true);
    expect(deletePayload.traceId).toBe(deleteTraceId);

    const listBindingsResponse = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings?memberId=member-a", {
        headers: ownerHeaders("trace-org-member-delete-006"),
      }),
    );
    expect(listBindingsResponse.status).toBe(200);
    const listBindingsPayload = await listBindingsResponse.json();
    expect(listBindingsPayload.data).toEqual([]);

    const missingTraceId = "trace-org-member-delete-007";
    const missingResponse = await app.fetch(
      new Request("http://localhost/api/org/members/member-a", {
        method: "DELETE",
        headers: ownerHeaders(missingTraceId),
      }),
    );
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get("x-request-id")).toBe(missingTraceId);
    const missingPayload = await missingResponse.json();
    expect(missingPayload.error).toBe("成员不存在");
  });

  it("成员项目绑定批量创建应返回错误聚合结果", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-batch-binding-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-batch-binding-002"),
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
          ...ownerHeaders("trace-org-batch-binding-003"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-a",
          email: "member-a@example.com",
          role: "member",
        }),
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-batch-binding-004"),
        },
        body: JSON.stringify({
          items: [
            {
              organizationId: "org-a",
              memberId: "member-a",
              projectId: "project-a",
            },
            {
              organizationId: "org-a",
              memberId: "member-a",
              projectId: "project-a",
            },
            {
              organizationId: "org-a",
              memberId: "member-a",
              projectId: "project-missing",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.data.requested).toBe(3);
    expect(payload.data.successCount).toBe(1);
    expect(payload.data.errorCount).toBe(2);
    const codes = (payload.data.errors || []).map(
      (item: { code?: string }) => item.code,
    );
    expect(codes.some((code: string) => code === "CONFLICT" || code === "INTERNAL_ERROR")).toBe(true);
    expect(codes).toContain("PROJECT_NOT_FOUND");

    const listResponse = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings?memberId=member-a", {
        headers: ownerHeaders("trace-org-batch-binding-005"),
      }),
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.data.length).toBe(1);
  });

  it("成员项目绑定创建时成员不属于目标组织应返回 404 且保留请求 traceId", async () => {
    const app = createOrgApp();
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-project-cross-org-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-project-cross-org-002"),
        },
        body: JSON.stringify({ id: "org-b", name: "组织 B" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-project-cross-org-003"),
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
          ...ownerHeaders("trace-org-member-project-cross-org-004"),
        },
        body: JSON.stringify({
          id: "member-b",
          organizationId: "org-b",
          email: "member-b@example.com",
        }),
      }),
    );

    const traceId = "trace-org-member-project-cross-org-005";
    const response = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders(traceId),
        },
        body: JSON.stringify({
          organizationId: "org-a",
          memberId: "member-b",
          projectId: "project-a",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.error).toBe("成员不存在或不属于该组织");
  });

  it("禁用组织或禁用项目时应阻止新增成员项目绑定", async () => {
    const app = createOrgApp();
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-bind-disabled-001"),
        },
        body: JSON.stringify({ id: "org-active", name: "组织 Active" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-bind-disabled-002"),
        },
        body: JSON.stringify({ id: "org-disabled", name: "组织 Disabled", status: "disabled" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-bind-disabled-003"),
        },
        body: JSON.stringify({
          id: "project-disabled",
          organizationId: "org-active",
          name: "项目 Disabled",
          status: "disabled",
        }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-bind-disabled-004"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-active",
          email: "member-a@example.com",
        }),
      }),
    );

    const disabledProjectResponse = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-bind-disabled-005"),
        },
        body: JSON.stringify({
          organizationId: "org-active",
          memberId: "member-a",
          projectId: "project-disabled",
        }),
      }),
    );
    expect(disabledProjectResponse.status).toBe(409);
    expect((await disabledProjectResponse.json()).error).toBe(
      "项目已禁用，禁止新增成员项目绑定",
    );

    const disabledOrganizationResponse = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-bind-disabled-006"),
        },
        body: JSON.stringify({
          organizationId: "org-disabled",
          memberId: "member-a",
          projectId: "project-disabled",
        }),
      }),
    );
    expect(disabledOrganizationResponse.status).toBe(409);
    expect((await disabledOrganizationResponse.json()).error).toBe(
      "组织已禁用，禁止新增成员项目绑定",
    );
  });

  it("成员项目绑定批量创建包含非法输入时应返回 VALIDATION_FAILED 并透传 traceId", async () => {
    const app = createOrgApp();
    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-project-validate-001"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await app.fetch(
      new Request("http://localhost/api/org/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-member-project-validate-002"),
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
          ...ownerHeaders("trace-org-member-project-validate-003"),
        },
        body: JSON.stringify({
          id: "member-a",
          organizationId: "org-a",
          email: "member-a@example.com",
        }),
      }),
    );

    const traceId = "trace-org-member-project-validate-004";
    const response = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders(traceId),
        },
        body: JSON.stringify({
          items: [
            {
              organizationId: "org-a",
              memberId: "member-a",
              projectId: "project-a",
            },
            {
              organizationId: "org-a",
              memberId: "member-a",
              projectId: "   ",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(traceId);
    const payload = await response.json();
    expect(payload.traceId).toBe(traceId);
    expect(payload.success).toBe(false);
    expect(payload.data.successCount).toBe(1);
    expect(payload.data.errorCount).toBe(1);
    const validationError = (payload.data.errors || []).find(
      (item: { index?: number; code?: string }) => item.index === 1,
    );
    expect(validationError?.code).toBe("VALIDATION_FAILED");
  });

  it("成员项目绑定单条创建请求体缺字段时应返回 400 并自动生成 traceId", async () => {
    const app = createOrgApp();
    const response = await app.fetch(
      new Request("http://localhost/api/org/member-project-bindings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-user": "org-owner",
          "x-admin-role": "owner",
          "x-admin-tenant": "default",
        },
        body: JSON.stringify({
          organizationId: "org-a",
          memberId: "member-a",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const headerTraceId = response.headers.get("x-request-id") || "";
    expect(headerTraceId.length).toBeGreaterThan(0);
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
