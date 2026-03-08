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
      'request_method="GET"',
      'headers_joined=""',
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
      '    --header)',
      '      headers_joined="${headers_joined}${headers_joined:+||}$2"',
      '      shift 2',
      '      ;;',
      '    --write-out|--data|--connect-timeout|--max-time)',
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
      'printf "%s\\t%s\\t%s\\n" "${request_method}" "${url}" "${headers_joined}" >> "${log_file}"',
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

describe("compat 发布观测脚本", () => {
  it("check_oauth_alert_compat.sh 在 observe 模式且命中为 0 时应通过", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-compat-zero-"));
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const summaryPath = join(tempDir, "compat-summary.json");

    const emptyResponse = JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: [],
      },
    });

    writeFakePrometheusCurl(fakeCurlPath, fakeCurlLog, {
      compat5m: { status: 200, body: emptyResponse },
      compat24h: { status: 200, body: emptyResponse },
    });

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "check_oauth_alert_compat.sh"),
          "--prometheus-url",
          "https://prometheus.tokenpulse.test",
          "--mode",
          "observe",
          "--summary-file",
          summaryPath,
          "--now-date",
          "2026-03-06",
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 5m 总命中: 0");
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 24h top10 总命中: 0");
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 指标为 0，可继续发布窗口观测");
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      expect(summary.mode).toBe("observe");
      expect(summary.gateResult).toBe("pass");
      expect(summary.compat5mHits).toBe(0);
      expect(summary.compat24hHits).toBe(0);

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("/api/v1/query?query=");
      expect(curlLog).toContain("%5B5m%5D");
      expect(curlLog).toContain("%5B24h%5D");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("check_oauth_alert_compat.sh 在 observe 模式命中 compat 时应告警但不失败", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-compat-observe-"));
    const fakeCurlPath = join(tempDir, "curl");
    const summaryPath = join(tempDir, "compat-summary.json");

    const compat5mResponse = JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          {
            metric: {
              method: "GET",
              route: "oauth_alertmanager.sync_history",
            },
            value: [1_778_000_000, "2"],
          },
        ],
      },
    });
    const compat24hResponse = JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          {
            metric: {
              method: "GET",
              route: "oauth_alertmanager.sync_history",
            },
            value: [1_778_000_000, "5"],
          },
          {
            metric: {
              method: "POST",
              route: "oauth_alerts.evaluate",
            },
            value: [1_778_000_000, "1"],
          },
        ],
      },
    });

    writeFakePrometheusCurl(fakeCurlPath, join(tempDir, "fake-curl.log"), {
      compat5m: { status: 200, body: compat5mResponse },
      compat24h: { status: 200, body: compat24hResponse },
    });

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "check_oauth_alert_compat.sh"),
          "--prometheus-url",
          "https://prometheus.tokenpulse.test",
          "--mode",
          "observe",
          "--summary-file",
          summaryPath,
          "--now-date",
          "2026-03-06",
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 5m 总命中: 2");
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 24h top10 总命中: 6");
      expect(`${result.stdout}\n${result.stderr}`).toContain("method=GET route=oauth_alertmanager.sync_history hits=2");
      expect(`${result.stdout}\n${result.stderr}`).toContain("method=POST route=oauth_alerts.evaluate hits=1");
      expect(`${result.stdout}\n${result.stderr}`).toContain("请记录 method/route/时间窗口/疑似来源/责任人/处置结论");
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      expect(summary.gateResult).toBe("warn");
      expect(summary.compat5mHits).toBe(2);
      expect(summary.compat24hHits).toBe(6);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("check_oauth_alert_compat.sh 在 strict 模式或达到 critical-after 后命中 compat 时应失败", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-compat-strict-"));
    const fakeCurlPath = join(tempDir, "curl");
    const strictSummaryPath = join(tempDir, "compat-summary-strict.json");
    const criticalSummaryPath = join(tempDir, "compat-summary-critical.json");

    const compatResponse = JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          {
            metric: {
              method: "GET",
              route: "oauth_alerts.incidents",
            },
            value: [1_778_000_000, "1"],
          },
        ],
      },
    });

    writeFakePrometheusCurl(fakeCurlPath, join(tempDir, "fake-curl.log"), {
      compat5m: { status: 200, body: compatResponse },
      compat24h: { status: 200, body: compatResponse },
    });

    try {
      const strictResult = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "check_oauth_alert_compat.sh"),
          "--prometheus-url",
          "https://prometheus.tokenpulse.test",
          "--mode",
          "strict",
          "--summary-file",
          strictSummaryPath,
          "--now-date",
          "2026-03-06",
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(strictResult.exitCode).not.toBe(0);
      expect(`${strictResult.stdout}\n${strictResult.stderr}`).toContain("strict 模式阻断继续发布");
      const strictSummary = JSON.parse(readFileSync(strictSummaryPath, "utf8"));
      expect(strictSummary.gateResult).toBe("fail");
      expect(strictSummary.compat5mHits).toBe(1);
      expect(strictSummary.compat24hHits).toBe(1);

      const criticalResult = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "check_oauth_alert_compat.sh"),
          "--prometheus-url",
          "https://prometheus.tokenpulse.test",
          "--mode",
          "observe",
          "--summary-file",
          criticalSummaryPath,
          "--now-date",
          "2026-07-01",
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(criticalResult.exitCode).not.toBe(0);
      expect(`${criticalResult.stdout}\n${criticalResult.stderr}`).toContain(
        "当前日期 2026-07-01 已达到 critical-after=2026-07-01",
      );
      const criticalSummary = JSON.parse(readFileSync(criticalSummaryPath, "utf8"));
      expect(criticalSummary.gateResult).toBe("fail");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
