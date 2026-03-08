import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const scriptPath = join(
  repoRoot,
  "scripts",
  "release",
  "validate_enterprise_runtime_bundle.sh",
);

function decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function runShell(cmd: string[]) {
  const proc = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: decode(proc.stdout),
    stderr: decode(proc.stderr),
  };
}

describe("企业域运行时编排校验脚本", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-enterprise-runtime-bundle-"));
  const logPath = join(tempDir, "bundle.log");
  const envFile = join(tempDir, "runtime.env");
  const drillEvidencePath = join(tempDir, "drill-evidence.json");
  const canaryEvidencePath = join(tempDir, "canary-evidence.json");
  const boundaryScript = join(tempDir, "fake-boundary.sh");
  const failingBoundaryScript = join(tempDir, "fake-boundary-fail.sh");
  const agentledgerScript = join(tempDir, "fake-agentledger.sh");
  const canaryScript = join(tempDir, "fake-canary.sh");

  writeFileSync(
    envFile,
    [
      "TOKENPULSE_AGENTLEDGER_ENABLED=true",
      "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
      "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=runtime-secret",
      "",
    ].join("\n"),
  );

  writeExecutable(
    boundaryScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'boundary %s\\n' \"$*\" >> "${logPath}"`,
      "",
    ].join("\n"),
  );
  writeExecutable(
    failingBoundaryScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'boundary-fail %s\\n' \"$*\" >> "${logPath}"`,
      "printf '[ERROR] fake boundary failed\\n' >&2",
      "exit 17",
      "",
    ].join("\n"),
  );
  writeExecutable(
    agentledgerScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'agentledger %s\\n' \"$*\" >> "${logPath}"`,
      "",
    ].join("\n"),
  );
  writeExecutable(
    canaryScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'canary %s\\n' \"$*\" >> "${logPath}"`,
      "",
    ].join("\n"),
  );

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("成功时应顺序执行 boundary -> agentledger -> optional post canary", () => {
    rmSync(logPath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--env-file",
      envFile,
      "--with-post-canary",
      "true",
      "--boundary-script",
      boundaryScript,
      "--agentledger-script",
      agentledgerScript,
      "--canary-script",
      canaryScript,
      "--boundary-case-prefix",
      "bundle-case",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("企业域运行时编排校验通过");

    const logText = readFileSync(logPath, "utf8").trim().split("\n");
    expect(logText).toHaveLength(3);
    expect(logText[0]).toContain("boundary ");
    expect(logText[1]).toContain("agentledger ");
    expect(logText[2]).toContain("canary ");
  });

  it("前一步失败时应阻断后续步骤", () => {
    rmSync(logPath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--env-file",
      envFile,
      "--with-post-canary",
      "true",
      "--boundary-script",
      failingBoundaryScript,
      "--agentledger-script",
      agentledgerScript,
      "--canary-script",
      canaryScript,
      "--boundary-case-prefix",
      "bundle-case",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("fake boundary failed");

    const logText = readFileSync(logPath, "utf8").trim().split("\n");
    expect(logText).toHaveLength(1);
    expect(logText[0]).toContain("boundary-fail ");
  });

  it("应将关键参数透传给 boundary、agentledger 与 canary", () => {
    rmSync(logPath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--env-file",
      envFile,
      "--with-post-canary",
      "true",
      "--boundary-script",
      boundaryScript,
      "--agentledger-script",
      agentledgerScript,
      "--canary-script",
      canaryScript,
      "--boundary-case-prefix",
      "bundle-case",
      "--admin-user",
      "bundle-owner",
      "--admin-role",
      "owner",
      "--admin-tenant",
      "default",
      "--auditor-user",
      "bundle-auditor",
      "--auditor-role",
      "auditor",
      "--drill-evidence-file",
      drillEvidencePath,
      "--canary-evidence-file",
      canaryEvidencePath,
      "--timeout",
      "12",
      "--insecure",
    ]);

    expect(result.exitCode).toBe(0);

    const logText = readFileSync(logPath, "utf8").trim().split("\n");
    expect(logText[0]).toContain("--base-url https://core.tokenpulse.test");
    expect(logText[0]).toContain("--api-secret bundle-secret");
    expect(logText[0]).toContain("--case-prefix bundle-case");
    expect(logText[0]).toContain("--admin-user bundle-owner");
    expect(logText[0]).toContain("--admin-role owner");
    expect(logText[0]).toContain("--admin-tenant default");
    expect(logText[0]).toContain("--auditor-user bundle-auditor");
    expect(logText[0]).toContain("--auditor-role auditor");
    expect(logText[0]).toContain("--timeout 12");
    expect(logText[0]).toContain("--insecure");

    expect(logText[1]).toContain(`--env-file ${envFile}`);
    expect(logText[1]).toContain(`--evidence-file ${drillEvidencePath}`);
    expect(logText[1]).toContain("--insecure");

    expect(logText[2]).toContain("--phase post");
    expect(logText[2]).toContain("--active-base-url https://core.tokenpulse.test");
    expect(logText[2]).toContain("--api-secret bundle-secret");
    expect(logText[2]).toContain("--with-boundary true");
    expect(logText[2]).toContain("--with-smoke false");
    expect(logText[2]).toContain(`--boundary-script ${boundaryScript}`);
    expect(logText[2]).toContain("--boundary-case-prefix bundle-case");
    expect(logText[2]).toContain("--admin-user bundle-owner");
    expect(logText[2]).toContain("--admin-role owner");
    expect(logText[2]).toContain("--admin-tenant default");
    expect(logText[2]).toContain("--auditor-user bundle-auditor");
    expect(logText[2]).toContain("--auditor-role auditor");
    expect(logText[2]).toContain(`--evidence-file ${canaryEvidencePath}`);
    expect(logText[2]).toContain("--timeout 12");
    expect(logText[2]).toContain("--insecure");
  });
});
