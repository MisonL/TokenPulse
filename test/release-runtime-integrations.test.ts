import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const scriptPath = join(
  repoRoot,
  "scripts",
  "release",
  "preflight_runtime_integrations.sh",
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

describe("统一运行时集成预检脚本", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-runtime-preflight-"));
  const logPath = join(tempDir, "script.log");
  const evidencePath = join(tempDir, "runtime-evidence.json");
  const envFile = join(tempDir, "runtime.env");
  const alertmanagerScript = join(tempDir, "fake-alertmanager.sh");
  const releaseWindowScript = join(tempDir, "fake-release-window.sh");
  const agentledgerScript = join(tempDir, "fake-agentledger.sh");
  const failingAgentledgerScript = join(tempDir, "fake-agentledger-fail.sh");

  mkdirSync(join(tempDir, "artifacts"), { recursive: true });
  writeFileSync(
    envFile,
    [
      "ALERTMANAGER_CONFIG_TEMPLATE_PATH=./monitoring/alertmanager.yml",
      "ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates",
      "TOKENPULSE_AGENTLEDGER_ENABLED=true",
      "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
      "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=runtime-secret",
      "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
      "",
    ].join("\n"),
  );
  writeExecutable(
    alertmanagerScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'alertmanager %s\\n' \"$*\" >> "${logPath}"`,
      "printf '[INFO] Alertmanager fake preflight passed\\n'",
      "",
    ].join("\n"),
  );
  writeExecutable(
    releaseWindowScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'release-window %s\\n' \"$*\" >> "${logPath}"`,
      "printf '[INFO] OAuth release window fake preflight passed\\n'",
      "",
    ].join("\n"),
  );
  writeExecutable(
    agentledgerScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'agentledger %s\\n' \"$*\" >> "${logPath}"`,
      "printf '[INFO] AgentLedger fake preflight passed\\n'",
      "",
    ].join("\n"),
  );
  writeExecutable(
    failingAgentledgerScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `printf 'agentledger-fail %s\\n' \"$*\" >> "${logPath}"`,
      "printf '[ERROR] AgentLedger fake preflight failed\\n' >&2",
      "exit 9",
      "",
    ].join("\n"),
  );

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("默认应执行三项预检并写 evidence", () => {
    rmSync(logPath, { force: true });
    rmSync(evidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--env-file",
      envFile,
      "--alertmanager-script",
      alertmanagerScript,
      "--oauth-release-window-script",
      releaseWindowScript,
      "--agentledger-script",
      agentledgerScript,
      "--evidence-file",
      evidencePath,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("统一运行时集成预检通过");
    expect(result.stdout).toContain(`evidence: ${evidencePath}`);

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      overallStatus: string;
      environment: { envFile: string | null };
      selectedChecks: {
        alertmanager: boolean;
        oauthReleaseWindow: boolean;
        agentledger: boolean;
      };
      summary: { passed: number; failed: number; skipped: number };
      configSnapshot: {
        alertmanagerConfigPath: string;
        alertmanagerTemplatesPath: string;
        agentledgerEnabled: string;
        agentledgerIngestUrl: string;
        agentledgerKeyId: string;
      };
      checks: Array<{ name: string; status: string; command: string }>;
      nextSteps: string[];
    };
    expect(evidence.overallStatus).toBe("passed");
    expect(evidence.environment.envFile).toBe(envFile);
    expect(evidence.selectedChecks).toEqual({
      alertmanager: true,
      oauthReleaseWindow: true,
      agentledger: true,
    });
    expect(evidence.summary).toEqual({ passed: 3, failed: 0, skipped: 0 });
    expect(evidence.configSnapshot).toMatchObject({
      alertmanagerConfigPath: "./monitoring/alertmanager.yml",
      alertmanagerTemplatesPath: "./monitoring/alertmanager-templates",
      agentledgerEnabled: "true",
      agentledgerIngestUrl: "https://agentledger.tokenpulse.test/runtime-events",
      agentledgerKeyId: "tokenpulse-runtime-v1",
    });
    expect(evidence.checks).toHaveLength(3);
    expect(evidence.checks.map((item) => item.status)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
    expect(evidence.nextSteps[0]).toContain("./scripts/release/canary_gate.sh --phase pre");
    expect(evidence.nextSteps[0]).toContain('--active-base-url "');
    expect(evidence.nextSteps[0]).toContain('--api-secret "');
    expect(evidence.nextSteps).toContain(
      `./scripts/release/release_window_oauth_alerts.sh --env-file "${envFile}"`,
    );
    expect(evidence.nextSteps).toContain(
      `./scripts/release/drill_agentledger_runtime_webhook.sh --env-file "${envFile}" --evidence-file "./artifacts/agentledger-runtime-drill-evidence.json"`,
    );

    const logText = readFileSync(logPath, "utf8");
    expect(logText).toContain(
      "alertmanager --config-path ./monitoring/alertmanager.yml --templates-path ./monitoring/alertmanager-templates",
    );
    expect(logText).toContain(`release-window --env-file ${envFile}`);
    expect(logText).toContain(`agentledger --env-file ${envFile}`);
  });

  it("可只执行 AgentLedger 预检，并将其他检查标记为 skipped", () => {
    rmSync(logPath, { force: true });
    rmSync(evidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--env-file",
      envFile,
      "--with-agentledger",
      "--alertmanager-script",
      alertmanagerScript,
      "--oauth-release-window-script",
      releaseWindowScript,
      "--agentledger-script",
      agentledgerScript,
      "--evidence-file",
      evidencePath,
    ]);

    expect(result.exitCode).toBe(0);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      overallStatus: string;
      selectedChecks: {
        alertmanager: boolean;
        oauthReleaseWindow: boolean;
        agentledger: boolean;
      };
      summary: { passed: number; failed: number; skipped: number };
      checks: Array<{ name: string; status: string; command?: string; summary?: string }>;
    };
    expect(evidence.overallStatus).toBe("passed");
    expect(evidence.selectedChecks).toEqual({
      alertmanager: false,
      oauthReleaseWindow: false,
      agentledger: true,
    });
    expect(evidence.summary).toEqual({ passed: 1, failed: 0, skipped: 2 });
    expect(evidence.checks.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: "alertmanager_config", status: "skipped" },
      { name: "oauth_release_window", status: "skipped" },
      { name: "agentledger_runtime_webhook", status: "passed" },
    ]);
    expect(evidence.checks[0]).toMatchObject({
      command: "(skipped)",
      summary: "Alertmanager 配置预检未选择执行",
    });
    expect(evidence.checks[1]).toMatchObject({
      command: "(skipped)",
      summary: "OAuth release window 预检未选择执行",
    });
    expect(evidence.checks[2]).toMatchObject({
      summary: "[INFO] AgentLedger fake preflight passed",
    });
    expect(evidence.nextSteps[0]).toContain("./scripts/release/canary_gate.sh --phase pre");
    expect(evidence.nextSteps[0]).toContain('--active-base-url "');
    expect(evidence.nextSteps[0]).toContain('--api-secret "');

    const logText = readFileSync(logPath, "utf8");
    expect(logText).not.toContain("alertmanager ");
    expect(logText).not.toContain("release-window ");
    expect(logText).toContain(`agentledger --env-file ${envFile}`);
  });

  it("子预检失败时应整体失败但仍输出完整 evidence", () => {
    rmSync(logPath, { force: true });
    rmSync(evidencePath, { force: true });

    const result = runShell([
      "bash",
      scriptPath,
      "--env-file",
      envFile,
      "--alertmanager-script",
      alertmanagerScript,
      "--oauth-release-window-script",
      releaseWindowScript,
      "--agentledger-script",
      failingAgentledgerScript,
      "--evidence-file",
      evidencePath,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("统一运行时集成预检失败");

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      overallStatus: string;
      checks: Array<{ name: string; status: string; stderrSnippet?: string }>;
      nextSteps: string[];
    };
    expect(evidence.overallStatus).toBe("failed");
    expect(evidence.checks.map((item) => item.status)).toEqual([
      "passed",
      "passed",
      "failed",
    ]);
    expect(
      evidence.checks.find((item) => item.name === "agentledger_runtime_webhook")?.stderrSnippet,
    ).toContain("AgentLedger fake preflight failed");
    expect(evidence.nextSteps).toContain(
      `./scripts/release/preflight_agentledger_runtime_webhook.sh --env-file "${envFile}"`,
    );
    expect(evidence.nextSteps).toContain(
      "修复失败项后重新执行 ./scripts/release/preflight_runtime_integrations.sh",
    );

    const logText = readFileSync(logPath, "utf8");
    expect(logText).toContain("alertmanager ");
    expect(logText).toContain("release-window ");
    expect(logText).toContain("agentledger-fail ");
  });

  it("仅执行 AgentLedger 预检且配置缺项时应失败，并在 evidence 中保留失败摘要", () => {
    rmSync(logPath, { force: true });
    rmSync(evidencePath, { force: true });

    const brokenEnvFile = join(tempDir, "runtime-missing-agentledger.env");
    writeFileSync(
      brokenEnvFile,
      [
        "ALERTMANAGER_CONFIG_TEMPLATE_PATH=./monitoring/alertmanager.yml",
        "ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates",
        "TOKENPULSE_AGENTLEDGER_ENABLED=",
        "AGENTLEDGER_RUNTIME_INGEST_URL=",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=",
        "",
      ].join("\n"),
    );

    const result = runShell([
      "bash",
      scriptPath,
      "--env-file",
      brokenEnvFile,
      "--with-agentledger",
      "--agentledger-script",
      join(repoRoot, "scripts", "release", "preflight_agentledger_runtime_webhook.sh"),
      "--evidence-file",
      evidencePath,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("统一运行时集成预检失败");

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      overallStatus: string;
      selectedChecks: {
        alertmanager: boolean;
        oauthReleaseWindow: boolean;
        agentledger: boolean;
      };
      summary: { passed: number; failed: number; skipped: number };
      checks: Array<{ name: string; status: string; summary?: string; stderrSnippet?: string }>;
    };
    expect(evidence.overallStatus).toBe("failed");
    expect(evidence.selectedChecks).toEqual({
      alertmanager: false,
      oauthReleaseWindow: false,
      agentledger: true,
    });
    expect(evidence.summary).toEqual({ passed: 0, failed: 1, skipped: 2 });
    expect(evidence.checks.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: "alertmanager_config", status: "skipped" },
      { name: "oauth_release_window", status: "skipped" },
      { name: "agentledger_runtime_webhook", status: "failed" },
    ]);
    expect(evidence.checks[2]?.summary || "").toContain("TOKENPULSE_AGENTLEDGER_ENABLED 必须显式开启");
    expect(evidence.checks[2]?.stderrSnippet || "").toContain("TOKENPULSE_AGENTLEDGER_ENABLED 必须显式开启");
    expect(evidence.nextSteps).toContain(
      `./scripts/release/preflight_agentledger_runtime_webhook.sh --env-file "${brokenEnvFile}"`,
    );
    expect(evidence.nextSteps).toContain(
      "修复失败项后重新执行 ./scripts/release/preflight_runtime_integrations.sh",
    );
  });

  it("存在 release window 环境变量时，成功 nextSteps 应带出 canary gate 与 compat 参数", () => {
    rmSync(logPath, { force: true });
    rmSync(evidencePath, { force: true });

    const releaseEnvFile = join(tempDir, "runtime-release-window.env");
    writeFileSync(
      releaseEnvFile,
      [
        "ALERTMANAGER_CONFIG_TEMPLATE_PATH=./monitoring/alertmanager.yml",
        "ALERTMANAGER_TEMPLATES_PATH=./monitoring/alertmanager-templates",
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=runtime-secret",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "RW_BASE_URL=https://core.tokenpulse.test",
        "RW_API_SECRET=release-secret",
        "RW_WITH_COMPAT=observe",
        "RW_PROMETHEUS_URL=https://prometheus.tokenpulse.test",
        "RW_COMPAT_CRITICAL_AFTER=2026-07-01",
        "RW_COMPAT_SHOW_LIMIT=15",
        "",
      ].join("\n"),
    );

    const result = runShell([
      "bash",
      scriptPath,
      "--env-file",
      releaseEnvFile,
      "--alertmanager-script",
      alertmanagerScript,
      "--oauth-release-window-script",
      releaseWindowScript,
      "--agentledger-script",
      agentledgerScript,
      "--evidence-file",
      evidencePath,
    ]);

    expect(result.exitCode).toBe(0);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      nextSteps: string[];
    };
    expect(evidence.nextSteps[0]).toBe(
      './scripts/release/canary_gate.sh --phase pre --active-base-url "https://core.tokenpulse.test" --api-secret "release-secret" --with-compat "observe" --prometheus-url "https://prometheus.tokenpulse.test" --compat-critical-after "2026-07-01" --compat-show-limit "15"',
    );
  });
});
