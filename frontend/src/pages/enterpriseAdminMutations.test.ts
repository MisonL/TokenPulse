import { describe, expect, it } from "bun:test";
import {
  buildAdminUserCreatePayload,
  buildRemoveTenantConfirmationMessage,
  buildRemoveUserConfirmationMessage,
  buildTenantCreatePayload,
  DEFAULT_ENTERPRISE_TENANT_CREATE_FORM,
  DEFAULT_ENTERPRISE_USER_CREATE_FORM,
  resetEnterpriseTenantCreateForm,
  resetEnterpriseUserCreateForm,
} from "./enterpriseAdminMutations";

describe("enterpriseAdminMutations", () => {
  it("应提供稳定的创建表单默认值", () => {
    expect(DEFAULT_ENTERPRISE_USER_CREATE_FORM).toEqual({
      username: "",
      password: "",
      roleKey: "operator",
      tenantId: "default",
      status: "active",
    });
    expect(DEFAULT_ENTERPRISE_TENANT_CREATE_FORM).toEqual({
      name: "",
      status: "active",
    });
    expect(resetEnterpriseUserCreateForm()).toEqual(DEFAULT_ENTERPRISE_USER_CREATE_FORM);
    expect(resetEnterpriseTenantCreateForm()).toEqual(DEFAULT_ENTERPRISE_TENANT_CREATE_FORM);
  });

  it("应构造用户创建 payload 并保留密码原值", () => {
    expect(
      buildAdminUserCreatePayload({
        username: "  ops-user  ",
        password: " Password123! ",
        roleKey: "operator",
        tenantId: "default",
        status: "active",
      }),
    ).toEqual({
      ok: true,
      value: {
        username: "ops-user",
        password: " Password123! ",
        roleKey: "operator",
        tenantId: "default",
        status: "active",
      },
    });
  });

  it("应阻断空用户名或空密码的用户创建", () => {
    expect(
      buildAdminUserCreatePayload({
        username: "  ",
        password: "Password123!",
        roleKey: "operator",
        tenantId: "default",
        status: "active",
      }),
    ).toEqual({
      ok: false,
      error: "请填写用户名与密码",
    });
    expect(
      buildAdminUserCreatePayload({
        username: "ops-user",
        password: "  ",
        roleKey: "operator",
        tenantId: "default",
        status: "active",
      }),
    ).toEqual({
      ok: false,
      error: "请填写用户名与密码",
    });
  });

  it("应构造租户创建 payload", () => {
    expect(
      buildTenantCreatePayload({
        name: "  租户 A  ",
        status: "disabled",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "租户 A",
        status: "disabled",
      },
    });
  });

  it("应阻断空租户名，并提供删除确认文案", () => {
    expect(
      buildTenantCreatePayload({
        name: "   ",
        status: "active",
      }),
    ).toEqual({
      ok: false,
      error: "请填写租户名称",
    });
    expect(buildRemoveUserConfirmationMessage("alice")).toBe("确认删除用户 alice 吗？");
    expect(buildRemoveTenantConfirmationMessage("tenant-a")).toBe("确认删除租户 tenant-a 吗？");
  });
});
