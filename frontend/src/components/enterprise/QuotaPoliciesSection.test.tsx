import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ENTERPRISE_POLICY_CREATE_FORM, DEFAULT_ENTERPRISE_POLICY_EDIT_FORM } from "../../pages/enterprisePolicyEditors";
import { QuotaPoliciesSection } from "./QuotaPoliciesSection";

const noop = () => {};

describe("QuotaPoliciesSection", () => {
  it("project scope 的 projectId 候选应优先来自组织域 projects，并兼容补全 fallback", () => {
    const html = renderToStaticMarkup(
      createElement(QuotaPoliciesSection, {
        policies: [
          {
            id: "policy-global",
            name: "global",
            scopeType: "global",
            scopeValue: "",
            enabled: true,
          },
          {
            id: "policy-project",
            name: "project-limit",
            scopeType: "project",
            scopeValue: "policy-project",
            enabled: true,
          },
          {
            id: "policy-project-dup",
            name: "project-dup",
            scopeType: "project",
            scopeValue: "org-project-a",
            enabled: true,
          },
        ],
        orgProjects: [
          {
            id: "org-project-b",
            name: "Project B",
            organizationId: "org-a",
            status: "active",
          },
          {
            id: "org-project-a",
            name: "Project A",
            organizationId: "org-a",
            status: "active",
          },
        ],
        scopeTypeFilter: "",
        scopeValueFilter: "",
        setScopeTypeFilter: noop,
        setScopeValueFilter: noop,
        createForm: DEFAULT_ENTERPRISE_POLICY_CREATE_FORM,
        editForm: DEFAULT_ENTERPRISE_POLICY_EDIT_FORM,
        editingPolicyId: null,
        onCreateFormChange: noop,
        onEditFormChange: noop,
        onCreate: noop,
        onStartEdit: noop,
        onSaveEdit: noop,
        onCancelEdit: noop,
        onRemove: noop,
        onJumpToUsageByPolicy: noop,
        onJumpToAuditByPolicy: noop,
      }),
    );

    expect(html).toContain('value="org-project-a"');
    expect(html).toContain('value="org-project-b"');
    expect(html).toContain('value="policy-project"');
    expect(html).toContain("用量");
    expect(html).toContain("审计");

    expect(html.indexOf('value="org-project-a"')).toBeLessThan(html.indexOf('value="policy-project"'));
    expect(html.indexOf('value="org-project-b"')).toBeLessThan(html.indexOf('value="policy-project"'));
  });

  it("应按 scopeType + scopeValue 精确筛选（trim/lowercase）", () => {
    const html = renderToStaticMarkup(
      createElement(QuotaPoliciesSection, {
        policies: [
          {
            id: "policy-project-a",
            name: "Project A",
            scopeType: "project",
            scopeValue: "ORG-PROJECT-A",
            enabled: true,
          },
          {
            id: "policy-project-b",
            name: "Project B",
            scopeType: "project",
            scopeValue: "org-project-b",
            enabled: true,
          },
          {
            id: "policy-user-a",
            name: "User A",
            scopeType: "user",
            scopeValue: "alice",
            enabled: true,
          },
        ],
        orgProjects: [],
        scopeTypeFilter: "project",
        scopeValueFilter: " org-project-a ",
        setScopeTypeFilter: noop,
        setScopeValueFilter: noop,
        createForm: DEFAULT_ENTERPRISE_POLICY_CREATE_FORM,
        editForm: DEFAULT_ENTERPRISE_POLICY_EDIT_FORM,
        editingPolicyId: null,
        onCreateFormChange: noop,
        onEditFormChange: noop,
        onCreate: noop,
        onStartEdit: noop,
        onSaveEdit: noop,
        onCancelEdit: noop,
        onRemove: noop,
        onJumpToUsageByPolicy: noop,
        onJumpToAuditByPolicy: noop,
      }),
    );

    expect(html).toContain("policy-project-a");
    expect(html).not.toContain("policy-project-b");
    expect(html).not.toContain("policy-user-a");
  });

  it("筛选后无结果时应展示友好的空态提示", () => {
    const html = renderToStaticMarkup(
      createElement(QuotaPoliciesSection, {
        policies: [
          {
            id: "policy-project-a",
            name: "Project A",
            scopeType: "project",
            scopeValue: "org-project-a",
            enabled: true,
          },
          {
            id: "policy-tenant-a",
            name: "Tenant A",
            scopeType: "tenant",
            scopeValue: "tenant-a",
            enabled: true,
          },
        ],
        orgProjects: [],
        scopeTypeFilter: "user",
        scopeValueFilter: "missing",
        setScopeTypeFilter: noop,
        setScopeValueFilter: noop,
        createForm: DEFAULT_ENTERPRISE_POLICY_CREATE_FORM,
        editForm: DEFAULT_ENTERPRISE_POLICY_EDIT_FORM,
        editingPolicyId: null,
        onCreateFormChange: noop,
        onEditFormChange: noop,
        onCreate: noop,
        onStartEdit: noop,
        onSaveEdit: noop,
        onCancelEdit: noop,
        onRemove: noop,
        onJumpToUsageByPolicy: noop,
        onJumpToAuditByPolicy: noop,
      }),
    );

    expect(html).toContain("未找到匹配的配额策略");
    expect(html).toContain("清空筛选");
    expect(html).toContain("scopeType=user");
    expect(html).toContain("scopeValue=missing");
  });
});
