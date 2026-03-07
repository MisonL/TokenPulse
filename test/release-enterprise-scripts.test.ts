import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      'if [[ "${url}" == *"/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      '  printf \'{"data":{"ready":true,"status":"ready"}}\' > "${output_file}"',
      "  printf '200'",
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

function createCanaryCompatFixture(
  compat5mHits: number,
  compat24hHits: number,
  readinessHttpCode = 200,
  readinessBody = '{"data":{"ready":true,"status":"ready"}}',
) {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-canary-compat-"));
  const fakeCurlPath = join(tempDir, "curl");
  const requestLogPath = join(tempDir, "request.log");
  const runnerLogPath = join(tempDir, "runner.log");
  const smokeScriptPath = join(tempDir, "fake-smoke.sh");
  const boundaryScriptPath = join(tempDir, "fake-boundary.sh");
  const compat5mResponse = JSON.stringify({
    status: "success",
    data: {
      result:
        compat5mHits > 0
          ? [
              {
                metric: { method: "GET", route: "/api/admin/oauth/alerts/legacy" },
                value: [1_778_200_000, String(compat5mHits)],
              },
            ]
          : [],
    },
  });
  const compat24hResponse = JSON.stringify({
    status: "success",
    data: {
      result:
        compat24hHits > 0
          ? [
              {
                metric: { method: "POST", route: "/api/admin/oauth/alertmanager/sync" },
                value: [1_778_200_000, String(compat24hHits)],
              },
            ]
          : [],
    },
  });

  writeExecutable(
    fakeCurlPath,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `request_log="${requestLogPath}"`,
      `runner_log="${runnerLogPath}"`,
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
      '  printf \'{"success":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/features" ]]; then',
      '  printf \'{"edition":"advanced","enterprise":true,"reachable":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
      '  printf \'{"authenticated":true,"roleKey":"owner"}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      `  printf '%s' '${readinessBody}' > "\${output_file}"`,
      `  printf '${readinessHttpCode}'`,
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/org/organizations" ]]; then',
      '  printf \'{"data":[],"success":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/v1/query?query="*"%5B5m%5D"* ]]; then',
      '  printf "compat-5m\\n" >> "${runner_log}"',
      `  printf '%s' '${compat5mResponse}' > "\${output_file}"`,
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/v1/query?query="*"%5B24h%5D"* ]]; then',
      '  printf "compat-24h\\n" >> "${runner_log}"',
      `  printf '%s' '${compat24hResponse}' > "\${output_file}"`,
      "  printf '200'",
      '  exit 0',
      'fi',
      `printf '%s' '{"error":"unexpected fake curl url"}' > "\${output_file}"`,
      "printf '500'",
      "",
    ].join("\n"),
  );

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

  return {
    tempDir,
    requestLogPath,
    runnerLogPath,
    smokeScriptPath,
    boundaryScriptPath,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("canary_gate compat 编排回归", () => {
  it("canary_gate.sh 在 with-compat=false 时不应调用 compat gate", () => {
    const fixture = createCanaryCompatFixture(0, 0);

    try {
      const result = runShell(
        [
          "bash",
          join(scriptsDir, "canary_gate.sh"),
          "--phase",
          "pre",
          "--active-base-url",
          "https://active.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--with-compat",
          "false",
          "--with-smoke",
          "true",
          "--with-boundary",
          "true",
          "--smoke-script",
          fixture.smokeScriptPath,
          "--boundary-script",
          fixture.boundaryScriptPath,
        ],
        {
          PATH: `${fixture.tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("已跳过 compat 退场观测");
      expect(readFileSync(fixture.requestLogPath, "utf8")).not.toContain("prometheus.tokenpulse.test");
      expect(readFileSync(fixture.runnerLogPath, "utf8")).toBe("smoke\nboundary\n");
    } finally {
      fixture.cleanup();
    }
  });

  it("canary_gate.sh 在 AgentLedger readiness 阻断时不应继续执行 smoke/boundary", () => {
    const fixture = createCanaryCompatFixture(
      0,
      0,
      503,
      '{"data":{"ready":false,"status":"blocking","blockingReasons":["delivery_not_configured"]}}',
    );

    try {
      const result = runShell(
        [
          "bash",
          join(scriptsDir, "canary_gate.sh"),
          "--phase",
          "pre",
          "--active-base-url",
          "https://active.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--with-smoke",
          "true",
          "--with-boundary",
          "true",
          "--smoke-script",
          fixture.smokeScriptPath,
          "--boundary-script",
          fixture.boundaryScriptPath,
        ],
        {
          PATH: `${fixture.tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("AgentLedger readiness");
      expect(readFileSync(fixture.requestLogPath, "utf8")).toContain(
        "GET https://active.tokenpulse.test/api/admin/observability/agentledger-outbox/readiness",
      );
      expect(existsSync(fixture.runnerLogPath)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it("canary_gate.sh 在 with-compat=observe 且 compat 命中时应继续执行 smoke/boundary", () => {
    const fixture = createCanaryCompatFixture(2, 6);

    try {
      const result = runShell(
        [
          "bash",
          join(scriptsDir, "canary_gate.sh"),
          "--phase",
          "pre",
          "--active-base-url",
          "https://active.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--with-compat",
          "observe",
          "--prometheus-url",
          "http://prometheus.tokenpulse.test",
          "--with-smoke",
          "true",
          "--with-boundary",
          "true",
          "--smoke-script",
          fixture.smokeScriptPath,
          "--boundary-script",
          fixture.boundaryScriptPath,
        ],
        {
          PATH: `${fixture.tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 指标命中 > 0");
      expect(`${result.stdout}\n${result.stderr}`).toContain("灰度检查通过");
      expect(readFileSync(fixture.requestLogPath, "utf8")).toContain(
        "GET http://prometheus.tokenpulse.test/api/v1/query?query=",
      );
      expect(readFileSync(fixture.runnerLogPath, "utf8")).toBe("compat-5m\ncompat-24h\nsmoke\nboundary\n");
    } finally {
      fixture.cleanup();
    }
  });

  it("canary_gate.sh 在 with-compat=strict 且 compat 命中时应阻断 smoke/boundary", () => {
    const fixture = createCanaryCompatFixture(1, 3);

    try {
      const result = runShell(
        [
          "bash",
          join(scriptsDir, "canary_gate.sh"),
          "--phase",
          "pre",
          "--active-base-url",
          "https://active.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--with-compat",
          "strict",
          "--prometheus-url",
          "http://prometheus.tokenpulse.test",
          "--with-smoke",
          "true",
          "--with-boundary",
          "true",
          "--smoke-script",
          fixture.smokeScriptPath,
          "--boundary-script",
          fixture.boundaryScriptPath,
        ],
        {
          PATH: `${fixture.tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("strict 模式阻断继续发布");
      expect(readFileSync(fixture.runnerLogPath, "utf8")).toBe("compat-5m\ncompat-24h\n");
    } finally {
      fixture.cleanup();
    }
  });
});
