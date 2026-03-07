import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const enterprisePageSource = readFileSync(
  join(process.cwd(), "frontend", "src", "pages", "EnterprisePage.tsx"),
  "utf8",
);
const enterpriseGovernanceSource = readFileSync(
  join(process.cwd(), "frontend", "src", "pages", "enterpriseGovernance.ts"),
  "utf8",
);
const clientSource = readFileSync(
  join(process.cwd(), "frontend", "src", "lib", "client.ts"),
  "utf8",
);
const combinedSource = `${enterprisePageSource}\n${enterpriseGovernanceSource}\n${clientSource}`;

describe("组织域前端只读降级契约", () => {
  it("应通过统一 client 使用稳定的 /api/org/* 路径，不再保留兼容写路径探测", () => {
    expect(enterprisePageSource).toContain("orgDomainClient.getOverview()");
    expect(enterprisePageSource).toContain("orgDomainClient.listOrganizations()");
    expect(enterprisePageSource).toContain("orgDomainClient.listProjects()");
    expect(enterprisePageSource).toContain("orgDomainClient.listMembers()");
    expect(enterprisePageSource).toContain("orgDomainClient.listMemberProjectBindings()");
    expect(clientSource).toContain('overview: "/api/org/overview"');
    expect(clientSource).toContain('organizations: "/api/org/organizations"');
    expect(clientSource).toContain('projects: "/api/org/projects"');
    expect(clientSource).toContain('members: "/api/org/members"');
    expect(clientSource).toContain('memberProjectBindings: "/api/org/member-project-bindings"');

    expect(combinedSource).not.toContain('"/api/org/orgs"');
    expect(combinedSource).not.toContain('"/api/org/member-bindings"');
    expect(combinedSource).not.toContain('"/api/org/members/${memberIdEncoded}/bindings"');
    expect(combinedSource).not.toContain("replacementCandidates");
    expect(combinedSource).not.toContain("requestOrgListWithFallback");
    expect(combinedSource).not.toContain("requestOrgApi");
  });

  it("接口不完整时应切换到只读降级文案", () => {
    expect(combinedSource).toContain("组织域接口不完整，管理面板已切换为只读降级。");
    expect(combinedSource).toContain("当前组织域处于只读降级，写操作已禁用。");
    expect(combinedSource).toContain("组织域基础接口不可用，面板已切换为只读降级。");
  });
});
