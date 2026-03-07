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
const combinedSource = `${enterprisePageSource}\n${enterpriseGovernanceSource}`;

describe("组织域前端只读降级契约", () => {
  it("应只依赖稳定的 /api/org/* 路径，不再保留兼容写路径探测", () => {
    expect(enterprisePageSource).toContain('requestOrgApi("/api/org/overview")');
    expect(enterprisePageSource).toContain("ORG_DOMAIN_API_CONTRACT.organizations");
    expect(enterprisePageSource).toContain("ORG_DOMAIN_API_CONTRACT.projects");
    expect(enterprisePageSource).toContain("ORG_DOMAIN_API_CONTRACT.members");
    expect(enterprisePageSource).toContain("ORG_DOMAIN_API_CONTRACT.memberProjectBindings");

    expect(combinedSource).not.toContain('"/api/org/orgs"');
    expect(combinedSource).not.toContain('"/api/org/member-bindings"');
    expect(combinedSource).not.toContain('"/api/org/members/${memberIdEncoded}/bindings"');
    expect(combinedSource).not.toContain("replacementCandidates");
    expect(combinedSource).not.toContain("requestOrgListWithFallback");
  });

  it("接口不完整时应切换到只读降级文案", () => {
    expect(combinedSource).toContain("组织域接口不完整，管理面板已切换为只读降级。");
    expect(combinedSource).toContain("当前组织域处于只读降级，写操作已禁用。");
    expect(combinedSource).toContain("组织域基础接口不可用，面板已切换为只读降级。");
  });
});
