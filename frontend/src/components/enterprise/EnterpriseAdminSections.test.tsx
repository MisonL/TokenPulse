import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnterpriseAdminLoginSection } from "./EnterpriseAdminLoginSection";
import { EnterpriseAvailabilityState } from "./EnterpriseAvailabilityState";
import { EnterpriseConsoleHeader } from "./EnterpriseConsoleHeader";
import { EnterpriseFeatureFlagsSection } from "./EnterpriseFeatureFlagsSection";
import { EnterpriseOrgDomainSection } from "./EnterpriseOrgDomainSection";
import { EnterpriseRolesPermissionsSection } from "./EnterpriseRolesPermissionsSection";

const noop = () => {};

describe("Enterprise 管理台展示壳层", () => {
  it("应展示管理员登录壳层与企业控制面头部动作", () => {
    const loginHtml = renderToStaticMarkup(
      createElement(EnterpriseAdminLoginSection, {
        username: "admin",
        password: "secret",
        submitting: false,
        onUsernameChange: noop,
        onPasswordChange: noop,
        onSubmit: noop,
      }),
    );
    const headerHtml = renderToStaticMarkup(
      createElement(EnterpriseConsoleHeader, {
        onWriteTestAuditEvent: noop,
        onLogout: noop,
      }),
    );

    expect(loginHtml).toContain("管理员登录");
    expect(loginHtml).toContain("登录管理员会话");
    expect(loginHtml).toContain("企业管理中心");
    expect(headerHtml).toContain("写入测试审计事件");
    expect(headerHtml).toContain("退出管理员");
    expect(headerHtml).toContain("高级版能力编排与审计追踪");
  });

  it("应展示标准版与企业后端不可达提示", () => {
    const standardHtml = renderToStaticMarkup(
      createElement(EnterpriseAvailabilityState, {
        edition: "standard",
        enterpriseBackend: null,
      }),
    );
    const unreachableHtml = renderToStaticMarkup(
      createElement(EnterpriseAvailabilityState, {
        edition: "advanced",
        enterpriseBackend: {
          configured: true,
          reachable: false,
          baseUrl: "http://enterprise.local",
          error: "connect ECONNREFUSED",
        },
      }),
    );

    expect(standardHtml).toContain("当前为标准版");
    expect(standardHtml).toContain("ENABLE_ADVANCED=true");
    expect(unreachableHtml).toContain("企业后端不可用");
    expect(unreachableHtml).toContain("configured=<code>true</code>");
    expect(unreachableHtml).toContain("reachable=<code>false</code>");
    expect(unreachableHtml).toContain("connect ECONNREFUSED");
  });

  it("应展示能力开关、角色权限与组织域摘要", () => {
    const featureHtml = renderToStaticMarkup(
      createElement(EnterpriseFeatureFlagsSection, {
        entries: [
          ["rbac", true],
          ["audit", false],
        ],
      }),
    );
    const rolesHtml = renderToStaticMarkup(
      createElement(EnterpriseRolesPermissionsSection, {
        roles: [
          {
            key: "owner",
            name: "Owner",
            permissions: ["audit.read", "alert.write"],
          },
        ],
        permissions: [
          {
            key: "audit.read",
            name: "审计读取",
          },
        ],
      }),
    );
    const orgHtml = renderToStaticMarkup(
      createElement(
        EnterpriseOrgDomainSection,
        {
          loading: false,
          error: "",
          summaryText: "组织域固定使用 /api/org/* 真是契约",
          readOnlyBanner: "组织域基础接口不可用，面板已切换为只读降级。",
          overview: {
            organizations: { total: 2, active: 1, disabled: 1 },
            projects: { total: 3, active: 2, disabled: 1 },
            members: { total: 4, active: 3, disabled: 1 },
            bindings: { total: 5 },
          },
          overviewFromFallback: true,
          readOnlyFallback: true,
          overviewFallbackHint: "当前后端未提供 /api/org/overview，已降级为前端本地统计。",
          onRefresh: noop,
        },
        createElement("div", null, "org-children-slot"),
      ),
    );

    expect(featureHtml).toContain("能力开关");
    expect(featureHtml).toContain("已启用");
    expect(featureHtml).toContain("未启用");
    expect(rolesHtml).toContain("角色与权限");
    expect(rolesHtml).toContain("权限词典");
    expect(rolesHtml).toContain("audit.read");
    expect(orgHtml).toContain("组织 / 项目 / 成员绑定");
    expect(orgHtml).toContain("来源:fallback");
    expect(orgHtml).toContain("模式:readonly");
    expect(orgHtml).toContain("org-children-slot");
  });
});
