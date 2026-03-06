import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const scriptsDir = join(repoRoot, "scripts", "release");

function decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function runShell(cmd: string[], env?: Record<string, string>) {
  const proc = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(env || {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: decode(proc.stdout),
    stderr: decode(proc.stderr),
  };
}

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

describe("企业发布脚本登录探针回归", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-enterprise-"));
  const fakeCurlPath = join(tempDir, "curl");
  const requestLogPath = join(tempDir, "request.log");
  const runnerLogPath = join(tempDir, "runner.log");

  writeExecutable(
    fakeCurlPath,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `request_log="${requestLogPath}"`,
      'output_file=""',
      'request_method="GET"',
      'url=""',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --output)',
      '      output_file="$2"',
      '      shift 2',
      '      ;;',
      '    --request)',
      '      request_method="$2"',
      '      shift 2',
      '      ;;',
      '    --write-out|--data|--header|--connect-timeout|--max-time)',
      '      shift 2',
      '      ;;',
      '    --silent|--show-error|--location|--insecure)',
      '      shift 1',
      '      ;;',
      '    *)',
      '      url="$1"',
      '      shift 1',
      '      ;;',
      '  esac',
      'done',
      'if [[ -z "${output_file}" ]]; then',
      '  echo "missing --output" >&2',
      '  exit 1',
      'fi',
      'printf "%s %s\\n" "${request_method}" "${url}" >> "${request_log}"',
      'if [[ "${url}" == *"/health" ]]; then',
      '  printf \'{"status":"ok"}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
      '  printf \'{"error":"未授权：缺少认证信息或认证无效","traceId":"trace-release-script-probe-401"}\' > "${output_file}"',
      "  printf '401'",
      '  exit 0',
      'fi',
      'printf \'{"success":true}\' > "${output_file}"',
      "printf '200'",
      "",
    ].join("\n"),
  );

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("smoke_org.sh 在登录探针失败时应阻断后续组织域请求", () => {
    rmSync(requestLogPath, { force: true });

    const result = runShell(
      [
        "bash",
        join(scriptsDir, "smoke_org.sh"),
        "--base-url",
        "https://core.tokenpulse.test",
        "--api-secret",
        "bad-secret",
      ],
      {
        PATH: `${tempDir}:${process.env.PATH || ""}`,
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("登录探针检查 失败");

    const requestLog = Bun.file(requestLogPath).text();
    return requestLog.then((text) => {
      expect(text).toContain("GET https://core.tokenpulse.test/health");
      expect(text).toContain("GET https://core.tokenpulse.test/api/auth/verify-secret");
      expect(text).not.toContain("GET https://core.tokenpulse.test/api/admin/features");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/organizations");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/projects");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/members");
    });
  });

  it("check_enterprise_boundary.sh 在登录探针失败时应阻断后续管理接口", () => {
    rmSync(requestLogPath, { force: true });

    const result = runShell(
      [
        "bash",
        join(scriptsDir, "check_enterprise_boundary.sh"),
        "--base-url",
        "https://core.tokenpulse.test",
        "--api-secret",
        "bad-secret",
        "--case-prefix",
        "boundary-probe-test",
      ],
      {
        PATH: `${tempDir}:${process.env.PATH || ""}`,
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("登录探针检查 失败");

    const requestLog = Bun.file(requestLogPath).text();
    return requestLog.then((text) => {
      expect(text).toContain("GET https://core.tokenpulse.test/health");
      expect(text).toContain("GET https://core.tokenpulse.test/api/auth/verify-secret");
      expect(text).not.toContain("GET https://core.tokenpulse.test/api/admin/features");
      expect(text).not.toContain("GET https://core.tokenpulse.test/api/admin/auth/me");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/organizations");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/projects");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/members");
    });
  });

  it("canary_gate.sh 在登录探针失败时不应执行 smoke 或 boundary 子脚本", () => {
    rmSync(requestLogPath, { force: true });
    rmSync(runnerLogPath, { force: true });

    const smokeScriptPath = join(tempDir, "fake-smoke.sh");
    const boundaryScriptPath = join(tempDir, "fake-boundary.sh");
    writeExecutable(
      smokeScriptPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `printf "smoke\\n" >> "${runnerLogPath}"`,
        "",
      ].join("\n"),
    );
    writeExecutable(
      boundaryScriptPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `printf "boundary\\n" >> "${runnerLogPath}"`,
        "",
      ].join("\n"),
    );

    const result = runShell(
      [
        "bash",
        join(scriptsDir, "canary_gate.sh"),
        "--phase",
        "pre",
        "--active-base-url",
        "https://active.tokenpulse.test",
        "--api-secret",
        "bad-secret",
        "--with-smoke",
        "true",
        "--with-boundary",
        "true",
        "--smoke-script",
        smokeScriptPath,
        "--boundary-script",
        boundaryScriptPath,
      ],
      {
        PATH: `${tempDir}:${process.env.PATH || ""}`,
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("[active] 登录探针");

    const requestLog = Bun.file(requestLogPath).text();
    return requestLog.then(async (text) => {
      expect(text).toContain("GET https://active.tokenpulse.test/health");
      expect(text).toContain("GET https://active.tokenpulse.test/api/auth/verify-secret");
      expect(text).not.toContain("GET https://active.tokenpulse.test/api/admin/features");

      const runnerLog = await Bun.file(runnerLogPath).text().catch(() => "");
      expect(runnerLog).toBe("");
    });
  });
});
