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

function runShell(cmd: string[], cwd = repoRoot) {
  const proc = Bun.spawnSync({
    cmd,
    cwd,
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
  const bundleEvidencePath = join(tempDir, "bundle-evidence.json");
  const defaultBundleEvidencePath = join(
    tempDir,
    "artifacts",
    "enterprise-runtime-bundle-evidence.json",
  );
  const drillEvidencePath = join(tempDir, "drill-evidence.json");
  const failingDrillEvidencePath = join(tempDir, "drill-fail-evidence.json");
  const canaryEvidencePath = join(tempDir, "canary-evidence.json");
  const failingCanaryEvidencePath = join(tempDir, "canary-fail-evidence.json");
  const boundaryScript = join(tempDir, "fake-boundary.sh");
  const failingBoundaryScript = join(tempDir, "fake-boundary-fail.sh");
  const agentledgerScript = join(tempDir, "fake-agentledger.sh");
  const failingAgentledgerScript = join(tempDir, "fake-agentledger-fail.sh");
  const canaryScript = join(tempDir, "fake-canary.sh");
  const failingCanaryScript = join(tempDir, "fake-canary-fail.sh");

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
    failingAgentledgerScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'agentledger-fail %s\\n' \"$*\" >> "${logPath}"`,
      "printf '[ERROR] fake agentledger failed\\n' >&2",
      "exit 23",
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
  writeExecutable(
    failingCanaryScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'canary-fail %s\\n' \"$*\" >> "${logPath}"`,
      "printf '[ERROR] fake canary failed\\n' >&2",
      "exit 29",
      "",
    ].join("\n"),
  );

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("成功时应顺序执行 boundary -> agentledger -> optional post canary", () => {
    rmSync(logPath, { force: true });
    rmSync(bundleEvidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--evidence-file",
      bundleEvidencePath,
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
    expect(result.stdout).toContain(`evidence: ${bundleEvidencePath}`);

    const logText = readFileSync(logPath, "utf8").trim().split("\n");
    expect(logText).toHaveLength(3);
    expect(logText[0]).toContain("boundary ");
    expect(logText[1]).toContain("agentledger ");
    expect(logText[2]).toContain("canary ");

    const evidence = JSON.parse(readFileSync(bundleEvidencePath, "utf8")) as {
      overallStatus: string;
      baseUrl: string;
      envFile: string | null;
      withPostCanary: boolean;
      steps: Array<{
        name: string;
        status: string;
        command: string;
        startedAt: string | null;
        finishedAt: string | null;
        exitCode: number | null;
        evidenceFile: string | null;
      }>;
    };
    expect(evidence.overallStatus).toBe("passed");
    expect(evidence.baseUrl).toBe("https://core.tokenpulse.test");
    expect(evidence.envFile).toBe(envFile);
    expect(evidence.withPostCanary).toBe(true);
    expect(evidence.steps.map((item) => item.status)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
    expect(evidence.steps[0]?.exitCode).toBe(0);
    expect(evidence.steps[0]?.evidenceFile).toBe(null);
    expect(evidence.steps[1]?.exitCode).toBe(0);
    expect(evidence.steps[1]?.evidenceFile).toBe(null);
    expect(evidence.steps[2]?.exitCode).toBe(0);
    expect(evidence.steps[2]?.evidenceFile).toBe(null);
    for (const step of evidence.steps) {
      expect(typeof step.command).toBe("string");
      expect(step.command.length).toBeGreaterThan(0);
      expect(step.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(step.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("未显式传 --evidence-file 时应写入默认 evidence 路径", () => {
    rmSync(logPath, { force: true });
    rmSync(defaultBundleEvidencePath, { force: true });

    const result = runShell(
      [
        "bash",
        scriptPath,
        "--base-url",
        "https://core.tokenpulse.test",
        "--api-secret",
        "bundle-secret",
        "--env-file",
        envFile,
        "--boundary-script",
        boundaryScript,
        "--agentledger-script",
        agentledgerScript,
        "--boundary-case-prefix",
        "bundle-case",
      ],
      tempDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("企业域运行时编排校验通过");
    expect(result.stdout).toContain(`evidence: ./artifacts/enterprise-runtime-bundle-evidence.json`);

    const evidence = JSON.parse(readFileSync(defaultBundleEvidencePath, "utf8")) as {
      overallStatus: string;
      envFile: string | null;
      steps: Array<{
        status: string;
      }>;
    };
    expect(evidence.overallStatus).toBe("passed");
    expect(evidence.envFile).toBe(envFile);
    expect(evidence.steps.map((item) => item.status)).toEqual([
      "passed",
      "passed",
      "skipped",
    ]);
  });

  it("with-agentledger-negative=true 时应透传 --with-negative", () => {
    rmSync(logPath, { force: true });
    rmSync(bundleEvidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--evidence-file",
      bundleEvidencePath,
      "--env-file",
      envFile,
      "--with-agentledger-negative",
      "true",
      "--boundary-script",
      boundaryScript,
      "--agentledger-script",
      agentledgerScript,
      "--boundary-case-prefix",
      "bundle-case",
    ]);

    expect(result.exitCode).toBe(0);
    const logText = readFileSync(logPath, "utf8").trim().split("\n");
    expect(logText[1] || "").toContain("agentledger ");
    expect(logText[1] || "").toContain("--with-negative");
  });

  it("前一步失败时应阻断后续步骤", () => {
    rmSync(logPath, { force: true });
    rmSync(bundleEvidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--evidence-file",
      bundleEvidencePath,
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

    const evidence = JSON.parse(readFileSync(bundleEvidencePath, "utf8")) as {
      overallStatus: string;
      withPostCanary: boolean;
      steps: Array<{
        status: string;
        exitCode: number | null;
        startedAt: string | null;
        finishedAt: string | null;
        evidenceFile: string | null;
      }>;
    };
    expect(evidence.overallStatus).toBe("failed");
    expect(evidence.withPostCanary).toBe(true);
    expect(evidence.steps.map((item) => item.status)).toEqual([
      "failed",
      "skipped",
      "skipped",
    ]);
    expect(evidence.steps[0]?.exitCode).toBe(17);
    expect(evidence.steps[1]?.exitCode).toBe(null);
    expect(evidence.steps[2]?.exitCode).toBe(null);
    expect(evidence.steps[1]?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evidence.steps[2]?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("AgentLedger drill 失败时应保留失败步与被阻断 post canary 的 command/evidenceFile", () => {
    rmSync(logPath, { force: true });
    rmSync(bundleEvidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--evidence-file",
      bundleEvidencePath,
      "--env-file",
      envFile,
      "--with-post-canary",
      "true",
      "--boundary-script",
      boundaryScript,
      "--agentledger-script",
      failingAgentledgerScript,
      "--canary-script",
      canaryScript,
      "--drill-evidence-file",
      failingDrillEvidencePath,
      "--canary-evidence-file",
      failingCanaryEvidencePath,
      "--boundary-case-prefix",
      "bundle-case",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("fake agentledger failed");

    const logText = readFileSync(logPath, "utf8").trim().split("\n");
    expect(logText).toHaveLength(2);
    expect(logText[0]).toContain("boundary ");
    expect(logText[1]).toContain("agentledger-fail ");

    const evidence = JSON.parse(readFileSync(bundleEvidencePath, "utf8")) as {
      overallStatus: string;
      withPostCanary: boolean;
      steps: Array<{
        status: string;
        command: string;
        startedAt: string | null;
        finishedAt: string | null;
        exitCode: number | null;
        evidenceFile: string | null;
      }>;
    };
    expect(evidence.overallStatus).toBe("failed");
    expect(evidence.withPostCanary).toBe(true);
    expect(evidence.steps.map((item) => item.status)).toEqual([
      "passed",
      "failed",
      "skipped",
    ]);
    expect(evidence.steps[0]?.command).toContain(boundaryScript);
    expect(evidence.steps[0]?.evidenceFile).toBe(null);
    expect(evidence.steps[1]?.command).toContain(failingAgentledgerScript);
    expect(evidence.steps[1]?.command).toContain(`--env-file ${envFile}`);
    expect(evidence.steps[1]?.command).toContain(`--evidence-file ${failingDrillEvidencePath}`);
    expect(evidence.steps[1]?.evidenceFile).toBe(failingDrillEvidencePath);
    expect(evidence.steps[1]?.exitCode).toBe(23);
    expect(evidence.steps[1]?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evidence.steps[1]?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evidence.steps[2]?.command).toContain(canaryScript);
    expect(evidence.steps[2]?.command).toContain("--phase post");
    expect(evidence.steps[2]?.command).toContain(`--evidence-file ${failingCanaryEvidencePath}`);
    expect(evidence.steps[2]?.evidenceFile).toBe(failingCanaryEvidencePath);
    expect(evidence.steps[2]?.exitCode).toBe(null);
    expect(evidence.steps[2]?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evidence.steps[2]?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("post canary 失败时应写出 failed command 与 canary evidenceFile", () => {
    rmSync(logPath, { force: true });
    rmSync(bundleEvidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--evidence-file",
      bundleEvidencePath,
      "--env-file",
      envFile,
      "--with-post-canary",
      "true",
      "--boundary-script",
      boundaryScript,
      "--agentledger-script",
      agentledgerScript,
      "--canary-script",
      failingCanaryScript,
      "--drill-evidence-file",
      drillEvidencePath,
      "--canary-evidence-file",
      failingCanaryEvidencePath,
      "--boundary-case-prefix",
      "bundle-case",
      "--timeout",
      "19",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("fake canary failed");

    const logText = readFileSync(logPath, "utf8").trim().split("\n");
    expect(logText).toHaveLength(3);
    expect(logText[0]).toContain("boundary ");
    expect(logText[1]).toContain("agentledger ");
    expect(logText[2]).toContain("canary-fail ");

    const evidence = JSON.parse(readFileSync(bundleEvidencePath, "utf8")) as {
      overallStatus: string;
      steps: Array<{
        status: string;
        command: string;
        exitCode: number | null;
        evidenceFile: string | null;
      }>;
    };
    expect(evidence.overallStatus).toBe("failed");
    expect(evidence.steps.map((item) => item.status)).toEqual([
      "passed",
      "passed",
      "failed",
    ]);
    expect(evidence.steps[1]?.command).toContain(`--evidence-file ${drillEvidencePath}`);
    expect(evidence.steps[1]?.evidenceFile).toBe(drillEvidencePath);
    expect(evidence.steps[2]?.command).toContain(failingCanaryScript);
    expect(evidence.steps[2]?.command).toContain("--phase post");
    expect(evidence.steps[2]?.command).toContain("--with-boundary true");
    expect(evidence.steps[2]?.command).toContain("--with-smoke false");
    expect(evidence.steps[2]?.command).toContain("--timeout 19");
    expect(evidence.steps[2]?.command).toContain(`--evidence-file ${failingCanaryEvidencePath}`);
    expect(evidence.steps[2]?.evidenceFile).toBe(failingCanaryEvidencePath);
    expect(evidence.steps[2]?.exitCode).toBe(29);
  });

  it("post canary 未启用时应标记 skipped，并继续透传 boundary/agentledger 参数", () => {
    rmSync(logPath, { force: true });
    rmSync(bundleEvidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--base-url",
      "https://core.tokenpulse.test",
      "--api-secret",
      "bundle-secret",
      "--evidence-file",
      bundleEvidencePath,
      "--env-file",
      envFile,
      "--with-post-canary",
      "false",
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
    expect(logText).toHaveLength(2);

    const evidence = JSON.parse(readFileSync(bundleEvidencePath, "utf8")) as {
      overallStatus: string;
      withPostCanary: boolean;
      steps: Array<{
        status: string;
        command: string;
        exitCode: number | null;
        evidenceFile: string | null;
      }>;
    };
    expect(evidence.overallStatus).toBe("passed");
    expect(evidence.withPostCanary).toBe(false);
    expect(evidence.steps.map((item) => item.status)).toEqual([
      "passed",
      "passed",
      "skipped",
    ]);
    expect(evidence.steps[0]?.exitCode).toBe(0);
    expect(evidence.steps[1]?.exitCode).toBe(0);
    expect(evidence.steps[2]?.exitCode).toBe(null);
    expect(evidence.steps[2]?.command).toContain("--phase post");
    expect(evidence.steps[2]?.command).toContain("--active-base-url https://core.tokenpulse.test");
    expect(evidence.steps[2]?.command).toContain("--api-secret bundle-secret");
    expect(evidence.steps[2]?.command).toContain("--with-boundary true");
    expect(evidence.steps[2]?.command).toContain("--with-smoke false");
    expect(evidence.steps[2]?.command).toContain(`--boundary-script ${boundaryScript}`);
    expect(evidence.steps[2]?.command).toContain("--boundary-case-prefix bundle-case");
    expect(evidence.steps[2]?.command).toContain("--admin-user bundle-owner");
    expect(evidence.steps[2]?.command).toContain("--admin-role owner");
    expect(evidence.steps[2]?.command).toContain("--admin-tenant default");
    expect(evidence.steps[2]?.command).toContain("--auditor-user bundle-auditor");
    expect(evidence.steps[2]?.command).toContain("--auditor-role auditor");
    expect(evidence.steps[2]?.command).toContain(`--evidence-file ${canaryEvidencePath}`);
    expect(evidence.steps[2]?.command).toContain("--timeout 12");
    expect(evidence.steps[2]?.command).toContain("--insecure");
    expect(evidence.steps[2]?.evidenceFile).toBe(canaryEvidencePath);
  });
});
