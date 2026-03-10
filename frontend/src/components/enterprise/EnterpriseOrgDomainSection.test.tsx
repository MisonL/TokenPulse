import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnterpriseOrgDomainSection } from "./EnterpriseOrgDomainSection";

const noop = () => {};

const renderSection = (quotaPolicies: { total: number; enabled: number }) => {
  return renderToStaticMarkup(
    createElement(EnterpriseOrgDomainSection, {
      loading: false,
      error: "",
      summaryText: "summary",
      overview: {
        organizations: { total: 1, active: 1, disabled: 0 },
        projects: { total: 2, active: 2, disabled: 0 },
        members: { total: 3, active: 3, disabled: 0 },
        bindings: { total: 4 },
        quotaPolicies,
      },
      overviewFromFallback: false,
      readOnlyFallback: false,
      onRefresh: noop,
    }),
  );
};

describe("EnterpriseOrgDomainSection", () => {
  it("应展示配额策略（项目）统计，并在 total=0 时提示暂无配额策略", () => {
    const html = renderSection({ total: 0, enabled: 0 });
    expect(html).toContain("配额策略（项目）：0/0");
    expect(html).toContain("暂无配额策略");
  });

  it("应在 enabled=0 且 total>0 时提示已创建但未启用", () => {
    const html = renderSection({ total: 3, enabled: 0 });
    expect(html).toContain("配额策略（项目）：0/3");
    expect(html).toContain("已创建 3 条，但当前均未启用");
  });
});

