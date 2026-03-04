import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { config } from "../src/config";
import { db } from "../src/db";
import { queryAuditEvents, writeAuditEvent } from "../src/lib/admin/audit";
import { requestContextMiddleware } from "../src/middleware/request-context";
import org from "../src/routes/org";

async function ensureOrgAuditTables() {
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
    "x-admin-user": "audit-owner",
    "x-admin-role": "owner",
    "x-admin-tenant": "default",
    "x-request-id": traceId,
    ...(extra || {}),
  };
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;

describe("组织域审计", () => {
  beforeAll(async () => {
    await ensureOrgAuditTables();
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

  it("应写入并按 traceId/resource 查询组织域事件", async () => {
    await writeAuditEvent({
      actor: "owner",
      action: "org.project.create",
      resource: "project",
      resourceId: "project-a",
      result: "success",
      traceId: "trace-org-001",
      details: {
        organizationId: "org-a",
        projectId: "project-a",
      },
    });

    const result = await queryAuditEvents({
      traceId: "trace-org-001",
      resource: "project",
      resourceId: "project-a",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    const event = result.data[0]!;
    expect(event.action).toBe("org.project.create");
    expect(event.resource).toBe("project");
    expect(event.resourceId).toBe("project-a");
    expect(event.traceId).toBe("trace-org-001");
    expect((event.details as Record<string, unknown>)?.organizationId).toBe("org-a");
  });

  it("应支持按 keyword 检索组织域成员变更事件", async () => {
    await writeAuditEvent({
      actor: "owner",
      action: "org.member.project.bind",
      resource: "org.member.project",
      resourceId: "member-1:project-a",
      traceId: "trace-org-002",
      details: {
        memberId: "member-1",
        projectId: "project-a",
      },
    });
    await writeAuditEvent({
      actor: "owner",
      action: "org.member.project.bind",
      resource: "org.member.project",
      resourceId: "member-2:project-b",
      traceId: "trace-org-003",
      details: {
        memberId: "member-2",
        projectId: "project-b",
      },
    });

    const result = await queryAuditEvents({
      keyword: "member-2",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    const event = result.data[0]!;
    expect(event.resourceId).toBe("member-2:project-b");
    expect((event.details as Record<string, unknown>)?.projectId).toBe("project-b");
  });

  it("通过组织域创建组织时应写入带 trace/ip/userAgent 的审计事件", async () => {
    const app = createOrgApp();

    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-audit-route-001", {
            "x-forwarded-for": "10.0.0.1, 10.0.0.2",
            "user-agent": "bun-test-agent/1.0",
          }),
        },
        body: JSON.stringify({
          id: "org-a",
          name: "组织 A",
          status: "active",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.traceId).toBe("trace-org-audit-route-001");

    const auditResult = await queryAuditEvents({
      traceId: "trace-org-audit-route-001",
      action: "org.organization.create",
      resource: "organization",
      resourceId: "org-a",
      page: 1,
      pageSize: 20,
    });

    expect(auditResult.total).toBe(1);
    const event = auditResult.data[0]!;
    expect(event.actor).toBe("audit-owner");
    expect(event.ip).toBe("10.0.0.1");
    expect(event.userAgent).toBe("bun-test-agent/1.0");
    expect((event.details as Record<string, unknown>)?.name).toBe("组织 A");
    expect((event.details as Record<string, unknown>)?.status).toBe("active");
  });

  it("通过组织域更新组织时应写入 updatedFields 与 previousStatus", async () => {
    const app = createOrgApp();

    await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-audit-route-002"),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );

    const updateResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations/org-a", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...ownerHeaders("trace-org-audit-route-003"),
        },
        body: JSON.stringify({ status: "disabled", description: "" }),
      }),
    );

    expect(updateResponse.status).toBe(200);

    const auditResult = await queryAuditEvents({
      traceId: "trace-org-audit-route-003",
      action: "org.organization.update",
      resource: "organization",
      resourceId: "org-a",
      page: 1,
      pageSize: 20,
    });

    expect(auditResult.total).toBe(1);
    const event = auditResult.data[0]!;
    const details = event.details as Record<string, unknown>;
    const updatedFields = details.updatedFields as string[];

    expect(Array.isArray(updatedFields)).toBe(true);
    expect(updatedFields).toContain("status");
    expect(updatedFields).toContain("description");
    expect(details.previousStatus).toBe("active");
  });

  it("details 为字符串时应保持字符串返回", async () => {
    await writeAuditEvent({
      actor: "owner",
      action: "org.project.archive",
      resource: "project",
      resourceId: "project-c",
      result: "failure",
      traceId: "trace-org-004",
      details: "rollback required",
    });

    const result = await queryAuditEvents({
      action: "org.project.archive",
      result: "failure",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    const event = result.data[0]!;
    expect(event.details).toBe("rollback required");
    expect(event.result).toBe("failure");
  });
});
