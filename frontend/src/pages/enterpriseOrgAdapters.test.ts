import { describe, expect, it } from "bun:test";
import {
  normalizeMemberBindingItem,
  normalizeMemberProjectBindingRow,
  normalizeOrganizationItem,
  normalizeOrgOverviewData,
  normalizeProjectItem,
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

    expect(shouldRefreshOrgDomainAfterMutationError({ status: 409 })).toBe(false);
    expect(shouldRefreshOrgDomainAfterMutationError({ status: 500 })).toBe(true);
    expect(shouldRefreshOrgDomainAfterMutationError(new Error("boom"))).toBe(true);
  });
});
