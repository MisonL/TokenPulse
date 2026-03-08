import { describe, expect, it } from "bun:test";
import {
  buildAdminUserUpdatePayload,
  parseRoleBindingsText,
  parseTenantIdsText,
} from "./enterpriseUserBindingEditors";

describe("enterpriseUserBindingEditors", () => {
  it("应解析多角色绑定文本", () => {
    expect(parseRoleBindingsText("admin@tenant-a, auditor@tenant-b")).toEqual([
      { roleKey: "admin", tenantId: "tenant-a" },
      { roleKey: "auditor", tenantId: "tenant-b" },
    ]);
  });

  it("应解析租户绑定文本", () => {
    expect(parseTenantIdsText("tenant-a, tenant-b")).toEqual(["tenant-a", "tenant-b"]);
    expect(parseTenantIdsText("   ")).toEqual([]);
  });

  it("应优先构造新绑定语义 payload", () => {
    expect(
      buildAdminUserUpdatePayload({
        roleKey: "operator",
        tenantId: "default",
        roleBindingsText: "admin@tenant-a,auditor@tenant-b",
        tenantIdsText: "tenant-a,tenant-b",
        status: "disabled",
        password: "NextPassword123!",
      }),
    ).toEqual({
      roleBindings: [
        { roleKey: "admin", tenantId: "tenant-a" },
        { roleKey: "auditor", tenantId: "tenant-b" },
      ],
      tenantIds: ["tenant-a", "tenant-b"],
      status: "disabled",
      password: "NextPassword123!",
    });
  });

  it("应在未填写多绑定文本时回退到 legacy payload", () => {
    expect(
      buildAdminUserUpdatePayload({
        roleKey: "admin",
        tenantId: "tenant-a",
        roleBindingsText: "",
        tenantIdsText: "",
        status: "active",
        password: "",
      }),
    ).toEqual({
      roleKey: "admin",
      tenantId: "tenant-a",
      status: "active",
      password: undefined,
    });
  });
});
