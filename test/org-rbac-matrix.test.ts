import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { config } from "../src/config";
import { db } from "../src/db";
import { requestContextMiddleware } from "../src/middleware/request-context";
import org from "../src/routes/org";

async function ensureOrganizationsTable() {
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
}

function createOrgApp() {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.route("/api/org", org);
  return app;
}

function adminHeaders(
  role: "owner" | "auditor" | "operator",
  traceId: string,
  extra?: Record<string, string>,
) {
  return {
    "x-admin-user": `org-${role}`,
    "x-admin-role": role,
    "x-admin-tenant": "default",
    "x-request-id": traceId,
    ...(extra || {}),
  };
}

async function expectForbiddenMatrix(
  response: Response,
  traceId: string,
  required: "admin.org.read" | "admin.org.manage",
) {
  expect(response.status).toBe(403);
  expect(response.headers.get("x-request-id")).toBe(traceId);
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload.traceId).toBe(traceId);
  expect(payload.required).toBe(required);
}

const originalEnableAdvanced = config.enableAdvanced;
const originalTrustProxy = config.trustProxy;
const originalTrustHeaderAuth = config.admin.trustHeaderAuth;

describe("组织域 RBAC 权限矩阵回归", () => {
  beforeAll(async () => {
    await ensureOrganizationsTable();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("DELETE FROM enterprise.organizations"));

    config.enableAdvanced = true;
    config.trustProxy = true;
    config.admin.trustHeaderAuth = true;
  });

  afterAll(() => {
    config.enableAdvanced = originalEnableAdvanced;
    config.trustProxy = originalTrustProxy;
    config.admin.trustHeaderAuth = originalTrustHeaderAuth;
  });

  it("owner GET/POST 通过", async () => {
    const app = createOrgApp();

    const listTraceId = "trace-org-rbac-owner-get-001";
    const listResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: adminHeaders("owner", listTraceId),
      }),
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("x-request-id")).toBe(listTraceId);
    const listPayload = (await listResponse.json()) as Record<string, unknown>;
    expect(Array.isArray(listPayload.data)).toBe(true);

    const createTraceId = "trace-org-rbac-owner-post-001";
    const createResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders("owner", createTraceId),
        },
        body: JSON.stringify({
          id: "org-matrix",
          name: "组织矩阵",
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    expect(createResponse.headers.get("x-request-id")).toBe(createTraceId);
    const createPayload = (await createResponse.json()) as Record<string, unknown>;
    expect(createPayload.success).toBe(true);
    expect(createPayload.id).toBe("org-matrix");
  });

  it("auditor GET 通过；POST/PUT/DELETE 返回 403 + traceId/required", async () => {
    const app = createOrgApp();

    const listTraceId = "trace-org-rbac-auditor-get-001";
    const listResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: adminHeaders("auditor", listTraceId),
      }),
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("x-request-id")).toBe(listTraceId);

    const postTraceId = "trace-org-rbac-auditor-post-001";
    const postResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders("auditor", postTraceId),
        },
        body: JSON.stringify({ id: "org-a", name: "组织 A" }),
      }),
    );
    await expectForbiddenMatrix(postResponse, postTraceId, "admin.org.manage");

    const putTraceId = "trace-org-rbac-auditor-put-001";
    const putResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations/org-any", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders("auditor", putTraceId),
        },
        body: JSON.stringify({ name: "组织 Any" }),
      }),
    );
    await expectForbiddenMatrix(putResponse, putTraceId, "admin.org.manage");

    const deleteTraceId = "trace-org-rbac-auditor-delete-001";
    const deleteResponse = await app.fetch(
      new Request("http://localhost/api/org/organizations/org-any", {
        method: "DELETE",
        headers: adminHeaders("auditor", deleteTraceId),
      }),
    );
    await expectForbiddenMatrix(
      deleteResponse,
      deleteTraceId,
      "admin.org.manage",
    );
  });

  it("operator GET 返回 403 + traceId/required=admin.org.read", async () => {
    const app = createOrgApp();

    const traceId = "trace-org-rbac-operator-get-001";
    const response = await app.fetch(
      new Request("http://localhost/api/org/organizations", {
        headers: adminHeaders("operator", traceId),
      }),
    );
    await expectForbiddenMatrix(response, traceId, "admin.org.read");
  });
});

