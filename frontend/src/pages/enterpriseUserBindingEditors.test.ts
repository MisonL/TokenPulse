import { describe, expect, it } from "bun:test";
import {
  buildAdminUserUpdatePayload,
  createEnterpriseUserEditForm,
  DEFAULT_ENTERPRISE_USER_EDIT_FORM,
  formatRoleBindingsText,
  formatTenantIdsText,
  parseRoleBindingsText,
  parseTenantIdsText,
  resetEnterpriseUserEditForm,
} from "./enterpriseUserBindingEditors";

describe("enterpriseUserBindingEditors", () => {
  it("应提供稳定的默认用户编辑表单", () => {
    expect(DEFAULT_ENTERPRISE_USER_EDIT_FORM).toEqual({
      displayName: "",
      roleKey: "operator",
      tenantId: "default",
      roleBindingsText: "operator@default",
      tenantIdsText: "default",
      initialRoleBindingsText: "operator@default",
      initialTenantIdsText: "default",
      status: "active",
      password: "",
    });
    expect(resetEnterpriseUserEditForm()).toEqual(DEFAULT_ENTERPRISE_USER_EDIT_FORM);
  });

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

  it("应从用户角色列表格式化编辑表单文本", () => {
    const roles = [
      { roleKey: "admin", tenantId: "tenant-a" },
      { roleKey: "auditor", tenantId: "tenant-b" },
      { roleKey: "admin", tenantId: "tenant-a" },
    ];
    expect(formatRoleBindingsText(roles)).toBe("admin@tenant-a,auditor@tenant-b,admin@tenant-a");
    expect(formatTenantIdsText(roles)).toBe("tenant-a,tenant-b");
  });

  it("应从用户对象构造编辑表单", () => {
    expect(
      createEnterpriseUserEditForm({
        id: "user-a",
        username: "alice",
        displayName: " Alice ",
        status: "disabled",
        roles: [
          { roleKey: "admin", tenantId: "tenant-a" },
          { roleKey: "auditor", tenantId: "tenant-b" },
        ],
      }),
    ).toEqual({
      displayName: "Alice",
      roleKey: "admin",
      tenantId: "tenant-a",
      roleBindingsText: "admin@tenant-a,auditor@tenant-b",
      tenantIdsText: "tenant-a,tenant-b",
      initialRoleBindingsText: "admin@tenant-a,auditor@tenant-b",
      initialTenantIdsText: "tenant-a,tenant-b",
      status: "disabled",
      password: "",
    });
  });

  it("应优先构造新绑定语义 payload", () => {
    expect(
      buildAdminUserUpdatePayload({
        displayName: "  Alice  ",
        roleKey: "operator",
        tenantId: "default",
        roleBindingsText: "admin@tenant-a,auditor@tenant-b",
        tenantIdsText: "tenant-a,tenant-b",
        initialRoleBindingsText: "operator@default",
        initialTenantIdsText: "default",
        status: "disabled",
        password: "NextPassword123!",
      }),
    ).toEqual({
      displayName: "Alice",
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
        displayName: "",
        roleKey: "admin",
        tenantId: "tenant-a",
        roleBindingsText: "",
        tenantIdsText: "",
        initialRoleBindingsText: "operator@default",
        initialTenantIdsText: "default",
        status: "active",
        password: "",
      }),
    ).toEqual({
      displayName: undefined,
      roleKey: "admin",
      tenantId: "tenant-a",
      status: "active",
      password: undefined,
    });
  });

  it("应支持仅更新非绑定字段", () => {
    expect(
      buildAdminUserUpdatePayload({
        displayName: "新昵称",
        roleKey: "admin",
        tenantId: "tenant-a",
        roleBindingsText: "admin@tenant-a",
        tenantIdsText: "tenant-a",
        initialRoleBindingsText: "admin@tenant-a",
        initialTenantIdsText: "tenant-a",
        status: "disabled",
        password: "NextPassword123!",
      }),
    ).toEqual({
      displayName: "新昵称",
      status: "disabled",
      password: "NextPassword123!",
    });
  });
});
