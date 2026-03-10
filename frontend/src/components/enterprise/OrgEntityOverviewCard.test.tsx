import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrgOrganizationOverviewData, OrgProjectOverviewData } from "../../pages/enterpriseOrgAdapters";
import { OrgEntityOverviewCard } from "./OrgEntityOverviewCard";

const noop = () => {};

const renderProjectCard = (quotaPolicies: OrgProjectOverviewData["quotaPolicies"]) => {
  const html = renderToStaticMarkup(
    createElement(OrgEntityOverviewCard, {
      kind: "project",
      entityId: "project-a",
      loading: false,
      error: "",
      overview: {
        kind: "project",
        project: {
          id: "project-a",
          name: "项目 A",
          organizationId: "org-a",
          status: "active",
        },
        organization: {
          id: "org-a",
          name: "组织 A",
          status: "active",
        },
        bindings: {
          total: 12,
          members: 3,
        },
        quotaPolicies,
        links: {},
      },
      onClose: noop,
      onRefresh: noop,
    }),
  );

  return html;
};

const renderOrganizationCard = (
  quotaPolicies: OrgOrganizationOverviewData["quotaPolicies"],
) => {
  const html = renderToStaticMarkup(
    createElement(OrgEntityOverviewCard, {
      kind: "organization",
      entityId: "org-a",
      loading: false,
      error: "",
      overview: {
        kind: "organization",
        organization: {
          id: "org-a",
          name: "组织 A",
          status: "active",
        },
        projects: {
          total: 12,
          active: 9,
          disabled: 3,
        },
        members: {
          total: 8,
          active: 7,
          disabled: 1,
        },
        bindings: {
          total: 10,
        },
        quotaPolicies,
        links: {},
      },
      onClose: noop,
      onRefresh: noop,
    }),
  );

  return html;
};

describe("OrgEntityOverviewCard", () => {
  it("应展示配额策略统计，并在 total=0 时提示暂无配额策略", () => {
    const html = renderProjectCard({ total: 0, enabled: 0 });
    expect(html).toContain("配额策略：0/0");
    expect(html).toContain("暂无配额策略");
  });

  it("应在 enabled=0 且 total>0 时提示已创建但未启用", () => {
    const html = renderProjectCard({ total: 3, enabled: 0 });
    expect(html).toContain("配额策略：0/3");
    expect(html).toContain("已创建 3 条，但当前均未启用");
  });

  it("enabled>0 时不应输出兜底提示", () => {
    const html = renderProjectCard({ total: 3, enabled: 2 });
    expect(html).toContain("配额策略：2/3");
    expect(html).not.toContain("暂无配额策略");
    expect(html).not.toContain("均未启用");
  });

  it("组织卡片应展示配额策略统计，并在 total=0 时提示暂无配额策略", () => {
    const html = renderOrganizationCard({ total: 0, enabled: 0 });
    expect(html).toContain("配额策略（项目）：0/0");
    expect(html).toContain("暂无配额策略");
  });

  it("组织卡片应在 enabled=0 且 total>0 时提示已创建但未启用", () => {
    const html = renderOrganizationCard({ total: 3, enabled: 0 });
    expect(html).toContain("配额策略（项目）：0/3");
    expect(html).toContain("已创建 3 条，但当前均未启用");
  });

  it("组织卡片 enabled>0 时不应输出兜底提示", () => {
    const html = renderOrganizationCard({ total: 3, enabled: 2 });
    expect(html).toContain("配额策略（项目）：2/3");
    expect(html).not.toContain("暂无配额策略");
    expect(html).not.toContain("均未启用");
  });
});
