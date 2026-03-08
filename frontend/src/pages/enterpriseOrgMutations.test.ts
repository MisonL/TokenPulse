import { describe, expect, it } from "bun:test";
import {
  buildMemberCreatePayload,
  buildOrganizationCreatePayload,
  buildProjectCreatePayload,
  buildRemoveMemberConfirmationMessage,
  buildRemoveOrganizationConfirmationMessage,
  buildRemoveProjectConfirmationMessage,
  buildToggleOrganizationStatusConfirmationMessage,
  buildToggleProjectStatusConfirmationMessage,
  DEFAULT_ENTERPRISE_ORG_CREATE_FORM,
  DEFAULT_ENTERPRISE_ORG_MEMBER_CREATE_FORM,
  DEFAULT_ENTERPRISE_ORG_PROJECT_CREATE_FORM,
  resetEnterpriseOrgCreateForm,
  resetEnterpriseOrgMemberCreateForm,
  resetEnterpriseOrgProjectCreateForm,
  resolveOrgMemberDisplayName,
} from "./enterpriseOrgMutations";

describe("enterpriseOrgMutations", () => {
  it("应提供稳定的组织域创建表单默认值", () => {
    expect(DEFAULT_ENTERPRISE_ORG_CREATE_FORM).toEqual({ name: "" });
    expect(DEFAULT_ENTERPRISE_ORG_PROJECT_CREATE_FORM).toEqual({
      name: "",
      organizationId: "",
    });
    expect(DEFAULT_ENTERPRISE_ORG_MEMBER_CREATE_FORM).toEqual({
      organizationId: "",
      userId: "",
    });
    expect(resetEnterpriseOrgCreateForm()).toEqual(DEFAULT_ENTERPRISE_ORG_CREATE_FORM);
    expect(resetEnterpriseOrgProjectCreateForm()).toEqual(
      DEFAULT_ENTERPRISE_ORG_PROJECT_CREATE_FORM,
    );
    expect(resetEnterpriseOrgMemberCreateForm()).toEqual(
      DEFAULT_ENTERPRISE_ORG_MEMBER_CREATE_FORM,
    );
  });

  it("应构造组织与项目创建 payload，并阻断空字段", () => {
    expect(buildOrganizationCreatePayload({ name: "  组织 A " })).toEqual({
      ok: true,
      value: { name: "组织 A" },
    });
    expect(buildOrganizationCreatePayload({ name: " " })).toEqual({
      ok: false,
      error: "请填写组织名称",
    });

    expect(
      buildProjectCreatePayload({
        name: " 项目 A ",
        organizationId: " ORG-A ",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "项目 A",
        organizationId: "org-a",
      },
    });
    expect(
      buildProjectCreatePayload({
        name: "项目 A",
        organizationId: " ",
      }),
    ).toEqual({
      ok: false,
      error: "请先选择组织",
    });
  });

  it("应根据管理员用户解析成员创建 payload", () => {
    expect(
      resolveOrgMemberDisplayName(" USER-A ", [
        {
          id: "user-a",
          username: "alice",
          displayName: "Alice",
          status: "active",
          roles: [],
        },
      ]),
    ).toEqual({
      ok: true,
      value: {
        userId: "user-a",
        displayName: "Alice",
      },
    });

    expect(
      buildMemberCreatePayload(
        {
          organizationId: " ORG-A ",
          userId: " USER-A ",
        },
        [
          {
            id: "user-a",
            username: "alice",
            displayName: "Alice",
            status: "active",
            roles: [],
          },
        ],
      ),
    ).toEqual({
      ok: true,
      value: {
        organizationId: "org-a",
        userId: "user-a",
        displayName: "Alice",
      },
    });
  });

  it("应阻断成员创建中的空组织和空用户", () => {
    expect(buildMemberCreatePayload({ organizationId: "", userId: "user-a" }, [])).toEqual({
      ok: false,
      error: "请先选择组织",
    });
    expect(buildMemberCreatePayload({ organizationId: "org-a", userId: " " }, [])).toEqual({
      ok: false,
      error: "请先选择管理员用户",
    });
  });

  it("应生成组织域删除与启停确认文案", () => {
    expect(
      buildRemoveOrganizationConfirmationMessage({
        id: "org-a",
        name: "组织 A",
        status: "active",
      }),
    ).toBe("确认删除组织 组织 A (org-a) 吗？");
    expect(
      buildToggleOrganizationStatusConfirmationMessage({
        id: "org-a",
        name: "组织 A",
        status: "active",
      }),
    ).toContain("确认禁用组织 组织 A (org-a)");
    expect(
      buildToggleOrganizationStatusConfirmationMessage({
        id: "org-a",
        name: "组织 A",
        status: "disabled",
      }),
    ).toContain("确认启用组织 组织 A (org-a)");

    expect(
      buildRemoveProjectConfirmationMessage({
        id: "project-a",
        name: "项目 A",
        organizationId: "org-a",
        status: "active",
      }),
    ).toBe("确认删除项目 项目 A (project-a) 吗？");
    expect(
      buildToggleProjectStatusConfirmationMessage({
        id: "project-a",
        name: "项目 A",
        organizationId: "org-a",
        status: "active",
      }),
    ).toContain("确认禁用项目 项目 A (project-a)");

    expect(
      buildRemoveMemberConfirmationMessage({
        memberId: "member-a",
        username: "Alice",
        organizationId: "org-a",
        projectIds: [],
        status: "active",
      }),
    ).toBe("确认删除成员 Alice (member-a) 吗？");
  });
});
