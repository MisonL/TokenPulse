import { describe, expect, it } from "bun:test";
import {
  buildOrgOverviewFallback,
  createOrgMemberEditForm,
  normalizeMemberBindingItem,
  normalizeMemberProjectBindingRow,
  normalizeOrganizationItem,
  normalizeOrgOverviewData,
  normalizeProjectItem,
  planOrgMemberBindingMutation,
  resolveOrgDomainMutationErrorDecision,
  resolveOrgDomainWriteGuardState,
  resolveOrgDomainLoadResult,
  resolveOrgMemberEditingState,
  resolveAdminUserLabel,
  resolveOrganizationDisplayName,
  resolveProjectDisplay,
  shouldRefreshOrgDomainAfterMutationError,
} from "./enterpriseOrgAdapters";

describe("enterpriseOrgAdapters", () => {
  it("应归一化 organization / project / member / binding 数据", () => {
    expect(
      normalizeOrganizationItem({
        organizationId: "ORG-A",
        organizationName: "组织 A",
        status: "disabled",
      }),
    ).toEqual({
      id: "org-a",
      name: "组织 A",
      status: "disabled",
      updatedAt: undefined,
    });

    expect(
      normalizeProjectItem({
        projectId: "project-a",
        projectName: "项目 A",
        organizationId: "ORG-A",
      }),
    ).toEqual({
      id: "project-a",
      name: "项目 A",
      organizationId: "org-a",
      status: "active",
      updatedAt: undefined,
    });

    expect(
      normalizeMemberBindingItem({
        memberId: "USER-A",
        username: "Alice",
        organizationId: "ORG-A",
        projectIds: ["p1", "p1", "p2"],
        role: "admin",
      }),
    ).toEqual({
      memberId: "user-a",
      username: "Alice",
      userId: undefined,
      email: undefined,
      displayName: undefined,
      organizationId: "org-a",
      projectIds: ["p1", "p2"],
      role: "admin",
      status: "active",
      updatedAt: undefined,
    });

    expect(
      normalizeMemberProjectBindingRow({
        id: "12",
        memberId: "USER-A",
        organizationId: "ORG-A",
        projectId: "project-a",
      }),
    ).toEqual({
      id: 12,
      organizationId: "org-a",
      memberId: "user-a",
      projectId: "project-a",
    });
  });

  it("应归一化 overview 并判断 mutation 错误是否需要刷新", () => {
    expect(
      normalizeOrgOverviewData({
        data: {
          organizations: { total: "3", active: "2", disabled: "1" },
          projects: { total: 4, active: 3, disabled: 1 },
          members: { total: 5, active: 5, disabled: 0 },
          bindings: { total: "7" },
        },
      }),
    ).toEqual({
      organizations: { total: 3, active: 2, disabled: 1 },
      projects: { total: 4, active: 3, disabled: 1 },
      members: { total: 5, active: 5, disabled: 0 },
      bindings: { total: 7 },
    });

    expect(resolveOrgDomainMutationErrorDecision({ status: 400 })).toEqual({
      shouldRefresh: false,
      status: 400,
      reason: "client_validation",
    });
    expect(resolveOrgDomainMutationErrorDecision({ status: 409 })).toEqual({
      shouldRefresh: false,
      status: 409,
      reason: "conflict",
    });
    expect(resolveOrgDomainMutationErrorDecision({ status: 422 })).toEqual({
      shouldRefresh: false,
      status: 422,
      reason: "semantic_validation",
    });
    expect(resolveOrgDomainMutationErrorDecision({ status: 500 })).toEqual({
      shouldRefresh: true,
      status: 500,
      reason: "refresh_recommended",
    });
    expect(resolveOrgDomainMutationErrorDecision(new Error("network boom"))).toEqual({
      shouldRefresh: true,
      status: null,
      reason: "refresh_recommended",
    });

    expect(shouldRefreshOrgDomainAfterMutationError({ status: 400 })).toBe(false);
    expect(shouldRefreshOrgDomainAfterMutationError({ status: 409 })).toBe(false);
    expect(shouldRefreshOrgDomainAfterMutationError({ status: 422 })).toBe(false);
    expect(shouldRefreshOrgDomainAfterMutationError({ status: 500 })).toBe(true);
    expect(shouldRefreshOrgDomainAfterMutationError(new Error("boom"))).toBe(true);
  });

  it("应在只读降级或加载中阻断组织域写操作", () => {
    expect(
      resolveOrgDomainWriteGuardState({
        loading: false,
        readOnlyFallback: false,
      }),
    ).toEqual({
      blocked: false,
      reason: "ready",
      message: "",
    });

    expect(
      resolveOrgDomainWriteGuardState({
        loading: true,
        readOnlyFallback: false,
      }),
    ).toEqual({
      blocked: true,
      reason: "loading",
      message: "组织域正在加载，暂不允许写操作。",
    });

    expect(
      resolveOrgDomainWriteGuardState({
        loading: false,
        readOnlyFallback: true,
      }),
    ).toEqual({
      blocked: true,
      reason: "read_only_fallback",
      message: "组织域基础接口不可用，已切换为只读降级，写操作已禁用。",
    });

    expect(
      resolveOrgDomainWriteGuardState({
        loading: true,
        readOnlyFallback: true,
      }),
    ).toEqual({
      blocked: true,
      reason: "read_only_fallback",
      message: "组织域基础接口不可用，已切换为只读降级，写操作已禁用。",
    });
  });

  it("应基于组织/项目/成员/绑定数据构造本地 overview fallback", () => {
    expect(
      buildOrgOverviewFallback(
        [
          { id: "org-a", name: "组织 A", status: "active" },
          { id: "org-b", name: "组织 B", status: "disabled" },
        ],
        [
          { id: "project-a", name: "项目 A", organizationId: "org-a", status: "active" },
          { id: "project-b", name: "项目 B", organizationId: "org-b", status: "disabled" },
        ],
        [
          {
            memberId: "user-a",
            username: "Alice",
            organizationId: "org-a",
            projectIds: ["project-a"],
            status: "active",
          },
          {
            memberId: "user-b",
            username: "Bob",
            organizationId: "org-b",
            projectIds: ["project-b", "project-c"],
            status: "active",
          },
        ],
        [],
      ),
    ).toEqual({
      organizations: { total: 2, active: 1, disabled: 1 },
      projects: { total: 2, active: 1, disabled: 1 },
      members: { total: 2, active: 1, disabled: 1 },
      bindings: { total: 3 },
    });
  });

  it("应为组织域成员编辑构造回填表单，并格式化展示文本", () => {
    expect(
      createOrgMemberEditForm({
        member: {
          memberId: "user-a",
          username: "Alice",
          organizationId: "org-a",
          projectIds: ["project-a", "project-x"],
          status: "active",
        },
        organizations: [{ id: "org-a", name: "组织 A", status: "active" }],
        projects: [
          { id: "project-a", name: "项目 A", organizationId: "org-a", status: "active" },
          { id: "project-b", name: "项目 B", organizationId: "org-b", status: "active" },
        ],
        fallbackOrganizationId: "org-b",
      }),
    ).toEqual({
      organizationId: "org-a",
      projectIds: ["project-a"],
    });

    expect(
      resolveOrganizationDisplayName("ORG-A", [
        { id: "org-a", name: "组织 A", status: "active" },
      ]),
    ).toBe("组织 A (org-a)");
    expect(resolveOrganizationDisplayName("missing-org", [])).toBe("missing-org");

    expect(
      resolveProjectDisplay(
        ["project-a", "project-x"],
        [{ id: "project-a", name: "项目 A", organizationId: "org-a", status: "active" }],
      ),
    ).toBe("项目 A (project-a), project-x");
    expect(resolveProjectDisplay([], [])).toBe("-");

    expect(
      resolveAdminUserLabel("USER-A", [
        { id: "user-a", username: "alice", displayName: "Alice", status: "active", roles: [] },
      ]),
    ).toBe("Alice (user-a)");
    expect(resolveAdminUserLabel("missing-user", [])).toBe("missing-user");
  });

  it("应规划成员绑定的删除与新增差异", () => {
    expect(
      planOrgMemberBindingMutation({
        organizationId: "ORG-A",
        selectedProjectIds: ["project-a", "project-x", "project-a"],
        projects: [
          { id: "project-a", name: "项目 A", organizationId: "org-a", status: "active" },
          { id: "project-b", name: "项目 B", organizationId: "org-a", status: "active" },
          { id: "project-c", name: "项目 C", organizationId: "org-b", status: "active" },
        ],
        existingRows: [
          { id: 1, organizationId: "org-a", memberId: "member-a", projectId: "project-b" },
          { id: 2, organizationId: "org-b", memberId: "member-a", projectId: "project-c" },
        ],
      }),
    ).toEqual({
      projectIds: ["project-a"],
      rowsToDelete: [
        { id: 1, organizationId: "org-a", memberId: "member-a", projectId: "project-b" },
        { id: 2, organizationId: "org-b", memberId: "member-a", projectId: "project-c" },
      ],
      projectsToCreate: ["project-a"],
    });
  });

  it("应在组织域局部加载失败时保留最近成功结果并切换只读降级", () => {
    const previous = {
      organizations: [{ id: "org-prev", name: "历史组织", status: "active" as const }],
      projects: [{ id: "project-prev", name: "历史项目", organizationId: "org-prev", status: "active" as const }],
      members: [
        {
          memberId: "user-prev",
          username: "历史成员",
          organizationId: "org-prev",
          projectIds: ["project-prev"],
          status: "active" as const,
        },
      ],
      bindingRows: [
        { id: 1, organizationId: "org-prev", memberId: "user-prev", projectId: "project-prev" },
      ],
    };

    const result = resolveOrgDomainLoadResult({
      results: [
        {
          status: "fulfilled",
          value: [{ id: "org-a", name: "组织 A", status: "active" as const }],
        },
        {
          status: "rejected",
          reason: new Error("projects unavailable"),
        },
        {
          status: "fulfilled",
          value: {
            members: [
              {
                memberId: "user-a",
                username: "Alice",
                organizationId: "org-a",
                projectIds: [],
                status: "active" as const,
              },
            ],
            bindingRows: [],
          },
        },
      ],
      previous,
    });

    expect(result.organizations).toEqual([{ id: "org-a", name: "组织 A", status: "active" }]);
    expect(result.projects).toEqual(previous.projects);
    expect(result.members).toEqual([
      {
        memberId: "user-a",
        username: "Alice",
        organizationId: "org-a",
        projectIds: [],
        status: "active",
      },
    ]);
    expect(result.bindingRows).toEqual([]);
    expect(result.availability).toEqual({
      apiAvailable: false,
      readOnlyFallback: true,
      reason: "api_unavailable",
    });
    expect(result.failedSectionCount).toBe(1);
    expect(result.errorMessage).toContain("组织域接口加载失败");
    expect(result.overviewFallback).toEqual({
      organizations: { total: 1, active: 1, disabled: 0 },
      projects: { total: 1, active: 1, disabled: 0 },
      members: { total: 1, active: 1, disabled: 0 },
      bindings: { total: 0 },
    });
  });

  it("应根据写边界与成员存在性决定是否退出成员编辑态", () => {
    expect(
      resolveOrgMemberEditingState({
        editingMemberId: "USER-A",
        availableMemberIds: ["user-a", "user-b"],
      }),
    ).toEqual({
      nextEditingMemberId: "user-a",
      shouldResetForm: false,
      reason: "keep",
    });

    expect(
      resolveOrgMemberEditingState({
        editingMemberId: "user-a",
        loadFailed: true,
      }),
    ).toEqual({
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "load_failed",
    });

    expect(
      resolveOrgMemberEditingState({
        editingMemberId: "user-a",
        readOnlyFallback: true,
      }),
    ).toEqual({
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "read_only_fallback",
    });

    expect(
      resolveOrgMemberEditingState({
        editingMemberId: "user-a",
        mutationSucceeded: true,
      }),
    ).toEqual({
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "mutation_succeeded",
    });

    expect(
      resolveOrgMemberEditingState({
        editingMemberId: "user-a",
        removedMemberId: "USER-A",
      }),
    ).toEqual({
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "member_removed",
    });

    expect(
      resolveOrgMemberEditingState({
        editingMemberId: "user-a",
        availableMemberIds: ["user-b"],
      }),
    ).toEqual({
      nextEditingMemberId: null,
      shouldResetForm: true,
      reason: "member_missing",
    });

    expect(
      resolveOrgMemberEditingState({
        editingMemberId: null,
        readOnlyFallback: true,
      }),
    ).toEqual({
      nextEditingMemberId: null,
      shouldResetForm: false,
      reason: "idle",
    });
  });

  it("组织域全部加载成功时应返回 ready 状态与空错误", () => {
    const result = resolveOrgDomainLoadResult({
      results: [
        {
          status: "fulfilled",
          value: [{ id: "org-a", name: "组织 A", status: "active" as const }],
        },
        {
          status: "fulfilled",
          value: [{ id: "project-a", name: "项目 A", organizationId: "org-a", status: "active" as const }],
        },
        {
          status: "fulfilled",
          value: {
            members: [
              {
                memberId: "user-a",
                username: "Alice",
                organizationId: "org-a",
                projectIds: ["project-a"],
                status: "active" as const,
              },
            ],
            bindingRows: [
              { id: 1, organizationId: "org-a", memberId: "user-a", projectId: "project-a" },
            ],
          },
        },
      ],
      previous: {
        organizations: [],
        projects: [],
        members: [],
        bindingRows: [],
      },
    });

    expect(result.availability).toEqual({
      apiAvailable: true,
      readOnlyFallback: false,
      reason: "ready",
    });
    expect(result.failedSectionCount).toBe(0);
    expect(result.errorMessage).toBe("");
    expect(result.overviewFallback).toEqual({
      organizations: { total: 1, active: 1, disabled: 0 },
      projects: { total: 1, active: 1, disabled: 0 },
      members: { total: 1, active: 1, disabled: 0 },
      bindings: { total: 1 },
    });
  });
});
