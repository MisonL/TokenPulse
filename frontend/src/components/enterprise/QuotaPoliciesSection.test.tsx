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
      }),
    );

    expect(html).toContain('value="org-project-a"');
    expect(html).toContain('value="org-project-b"');
    expect(html).toContain('value="policy-project"');

    expect(html.indexOf('value="org-project-a"')).toBeLessThan(html.indexOf('value="policy-project"'));
    expect(html.indexOf('value="org-project-b"')).toBeLessThan(html.indexOf('value="policy-project"'));
  });
});

