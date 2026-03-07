import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};

describe("release package scripts", () => {
  it("应定义 test:release 基础发布回归入口", () => {
    const script = packageJson.scripts?.["test:release"] || "";
    expect(script).toContain("bash -n scripts/release/*.sh");
    expect(script).toContain("test/release-common.test.ts");
    expect(script).toContain("test/release-enterprise-scripts.test.ts");
    expect(script).toContain("test/release-alertmanager-scripts.test.ts");
    expect(script).toContain("test/release-agentledger-scripts.test.ts");
    expect(script).toContain("test/release-compat-scripts.test.ts");
  });

  it("应定义 test:release:compat compat 相关发布回归入口", () => {
    const script = packageJson.scripts?.["test:release:compat"] || "";
    expect(script).toContain("scripts/release/check_oauth_alert_compat.sh");
    expect(script).toContain("scripts/release/canary_gate.sh");
    expect(script).toContain("scripts/release/preflight_release_window_oauth_alerts.sh");
    expect(script).toContain("scripts/release/release_window_oauth_alerts.sh");
    expect(script).toContain("test/release-compat-scripts.test.ts");
    expect(script).toContain("test/release-enterprise-scripts.test.ts");
    expect(script).toContain("test/release-alertmanager-scripts.test.ts");
  });

  it("应定义 test:release:full 全量发布门禁入口", () => {
    const script = packageJson.scripts?.["test:release:full"] || "";
    expect(script).toContain("bun run test:release");
    expect(script).toContain("test/oauth-alert-compat-guard.test.ts");
    expect(script).toContain("test/release-package-scripts.test.ts");
  });
});
