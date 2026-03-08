import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

interface FakeCurlResponse {
  status: number;
  body: string;
}

function writeFakePrometheusCurl(
  filePath: string,
  logFile: string,
  responses: {
    compat5m: FakeCurlResponse;
    compat24h: FakeCurlResponse;
  },
) {
  writeExecutable(
    filePath,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `log_file="${logFile}"`,
      'output_file=""',
      'url=""',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --output)',
      '      output_file="$2"',
      '      shift 2',
      '      ;;',
      '    --request|--header|--write-out|--data|--connect-timeout|--max-time)',
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
      'printf "%s\\n" "${url}" >> "${log_file}"',
      'if [[ "${url}" == *"%5B5m%5D"* ]]; then',
      `  printf '%s' '${responses.compat5m.body}' > "\${output_file}"`,
      `  printf '${responses.compat5m.status}'`,
      "  exit 0",
      "fi",
      'if [[ "${url}" == *"%5B24h%5D"* ]]; then',
      `  printf '%s' '${responses.compat24h.body}' > "\${output_file}"`,
      `  printf '${responses.compat24h.status}'`,
      "  exit 0",
      "fi",
      `printf '%s' '{"status":"error","error":"unexpected query"}' > "\${output_file}"`,
      "printf '500'",
      "",
    ].join("\n"),
  );
}

describe("compat enforce 前置检查脚本", () => {
  it("compat 指标归零且 triage log 存在时应通过并写 summary", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-compat-enforce-pass-"));
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const triageLogPath = join(tempDir, "compat-triage.md");
    const summaryPath = join(tempDir, "compat-enforce-summary.json");
    const emptyResponse = JSON.stringify({
      status: "success",
      data: { resultType: "vector", result: [] },
    });

    writeFileSync(
      triageLogPath,
      "# compat triage\n\n- 时间窗口: 24h\n- 结论: 当前已归零，可准备 enforce\n",
    );
    writeFakePrometheusCurl(fakeCurlPath, fakeCurlLog, {
      compat5m: { status: 200, body: emptyResponse },
      compat24h: { status: 200, body: emptyResponse },
    });

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "preflight_oauth_alert_compat_enforce.sh"),
          "--prometheus-url",
          "https://prometheus.tokenpulse.test",
          "--triage-log",
          triageLogPath,
          "--summary-file",
          summaryPath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "compat enforce 前置检查通过：可准备切换 OAUTH_ALERT_COMPAT_MODE=enforce",
      );
      expect(`${result.stdout}\n${result.stderr}`).toContain(`summary: ${summaryPath}`);

      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      expect(summary.overallStatus).toBe("passed");
      expect(summary.currentMode).toBe("observe");
      expect(summary.triageLog).toBe(triageLogPath);
      expect(summary.compat5mHits).toBe(0);
      expect(summary.compat24hHits).toBe(0);
      expect(summary.compatGateResult).toBe("pass");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("/api/v1/query?query=");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("当前已是 enforce 时应失败且保留失败 summary", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-compat-enforce-mode-"));
    const triageLogPath = join(tempDir, "compat-triage.md");
    const summaryPath = join(tempDir, "compat-enforce-summary.json");

    writeFileSync(triageLogPath, "# compat triage\n\n- 已确认切换前置条件\n");

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "preflight_oauth_alert_compat_enforce.sh"),
          "--prometheus-url",
          "https://prometheus.tokenpulse.test",
          "--triage-log",
          triageLogPath,
          "--current-mode",
          "enforce",
          "--summary-file",
          summaryPath,
        ],
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "当前 OAUTH_ALERT_COMPAT_MODE 已是 enforce，无需再执行 enforce 前置检查",
      );
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      expect(summary.overallStatus).toBe("failed");
      expect(summary.currentMode).toBe("enforce");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("compat 指标非零时应失败并保留失败 summary", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-compat-enforce-fail-"));
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const triageLogPath = join(tempDir, "compat-triage.md");
    const summaryPath = join(tempDir, "compat-enforce-summary.json");
    const compatResponse = JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          {
            metric: { method: "GET", route: "oauth_alerts.config" },
            value: [1_778_000_000, "1"],
          },
        ],
      },
    });

    writeFileSync(triageLogPath, "# compat triage\n\n- 仍有遗留调用待处理\n");
    writeFakePrometheusCurl(fakeCurlPath, fakeCurlLog, {
      compat5m: { status: 200, body: compatResponse },
      compat24h: { status: 200, body: compatResponse },
    });

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "preflight_oauth_alert_compat_enforce.sh"),
          "--prometheus-url",
          "https://prometheus.tokenpulse.test",
          "--triage-log",
          triageLogPath,
          "--summary-file",
          summaryPath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 指标未归零，当前不允许切到 enforce");
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      expect(summary.overallStatus).toBe("failed");
      expect(summary.compat5mHits).toBe(1);
      expect(summary.compat24hHits).toBe(1);
      expect(summary.compatGateResult).toBe("fail");
      expect(readFileSync(fakeCurlLog, "utf8")).toContain("/api/v1/query?query=");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
