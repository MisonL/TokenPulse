import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const scriptPath = join(
  repoRoot,
  "scripts",
  "release",
  "preflight_agentledger_runtime_webhook.sh",
);
const drillScriptPath = join(
  repoRoot,
  "scripts",
  "release",
  "drill_agentledger_runtime_webhook.sh",
);

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

function withEnvFile(content: string, runner: (envFile: string) => void) {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-release-"));
  const envFile = join(tempDir, "agentledger.env");
  writeFileSync(envFile, content);

  try {
    runner(envFile);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

describe("AgentLedger 发布预检脚本", () => {
  it(".env.example 应暴露 AgentLedger runtime 投递配置", () => {
    const content = readFileSync(join(repoRoot, ".env.example"), "utf8");
    expect(content).toContain("TOKENPULSE_AGENTLEDGER_ENABLED=false");
    expect(content).toContain("AGENTLEDGER_RUNTIME_INGEST_URL=");
    expect(content).toContain("TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1");
    expect(content).toContain("TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=");
    expect(content).toContain("TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS=10000");
  });

  it("preflight_agentledger_runtime_webhook.sh 应接受有效配置", () => {
    withEnvFile(
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=tokenpulse-runtime-secret",
        "TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS=12000",
        "TOKENPULSE_AGENTLEDGER_MAX_ATTEMPTS=5",
        "TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC=0,30,120,600,1800",
        "TOKENPULSE_AGENTLEDGER_OUTBOX_RETENTION_DAYS=7",
        "TOKENPULSE_AGENTLEDGER_WORKER_BATCH_SIZE=20",
        "",
      ].join("\n"),
      (envFile) => {
        const result = runShell(["bash", scriptPath, "--env-file", envFile]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("AgentLedger runtime webhook 预检通过");
        expect(result.stdout).toContain("ingest_url=https://agentledger.tokenpulse.test/runtime-events");
      },
    );
  });

  it("preflight_agentledger_runtime_webhook.sh 应拒绝示例域名与占位密钥", () => {
    withEnvFile(
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.example.com/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=replace_me",
        "",
      ].join("\n"),
      (envFile) => {
        const result = runShell(["bash", scriptPath, "--env-file", envFile]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("AGENTLEDGER_RUNTIME_INGEST_URL 不能使用示例域名");
      },
    );
  });

  it("preflight_agentledger_runtime_webhook.sh 应拒绝未启用与非法数值配置", () => {
    withEnvFile(
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=false",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=tokenpulse-runtime-secret",
        "TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS=500",
        "TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC=0,30,abc",
        "",
      ].join("\n"),
      (envFile) => {
        const result = runShell(["bash", scriptPath, "--env-file", envFile]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("TOKENPULSE_AGENTLEDGER_ENABLED 必须显式开启");
      },
    );
  });

  it("drill_agentledger_runtime_webhook.sh 应验证 202 -> 200 合同并写 evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-drill-pass-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const counterPath = join(tempDir, "curl.count");
    const evidencePath = join(tempDir, "agentledger-drill-evidence.json");

    writeFileSync(
      envFile,
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=tokenpulse-runtime-secret",
        "TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS=10000",
        "TOKENPULSE_AGENTLEDGER_MAX_ATTEMPTS=5",
        "TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC=0,30,120,600,1800",
        "TOKENPULSE_AGENTLEDGER_OUTBOX_RETENTION_DAYS=7",
        "TOKENPULSE_AGENTLEDGER_WORKER_BATCH_SIZE=20",
        "",
      ].join("\n"),
    );
    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_path="${logPath}"`,
        `counter_path="${counterPath}"`,
        'output_file=""',
        'method=""',
        'url=""',
        'body=""',
        'headers=()',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
        '      shift 2',
        '      ;;',
        '    --request)',
        '      method="$2"',
        '      shift 2',
        '      ;;',
        '    --header)',
        '      headers+=("$2")',
        '      shift 2',
        '      ;;',
        '    --data)',
        '      body="$2"',
        '      shift 2',
        '      ;;',
        '    http://*|https://*)',
        '      url="$1"',
        '      shift 1',
        '      ;;',
        '    *)',
        '      shift 1',
        '      ;;',
        '  esac',
        'done',
        'count=1',
        'if [[ -f "${counter_path}" ]]; then',
        '  count=$(( $(cat "${counter_path}") + 1 ))',
        'fi',
        'printf "%s" "${count}" > "${counter_path}"',
        '{',
        '  printf "call=%s\\n" "${count}"',
        '  printf "method=%s\\n" "${method}"',
        '  printf "url=%s\\n" "${url}"',
        '  printf "body=%s\\n" "${body}"',
        '  for header in "${headers[@]}"; do',
        '    printf "header=%s\\n" "${header}"',
        '  done',
        '} >> "${log_path}"',
        'if [[ "${count}" == "1" ]]; then',
        '  printf \'%s\' \'{"success":true,"accepted":true}\' > "${output_file}"',
        '  printf "202"',
        'else',
        '  printf \'%s\' \'{"success":true,"duplicate":true}\' > "${output_file}"',
        '  printf "200"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          drillScriptPath,
          "--env-file",
          envFile,
          "--trace-id",
          "trace-agentledger-drill-pass-001",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AgentLedger runtime webhook 合同演练通过");
      expect(result.stdout).toContain(`evidence: ${evidencePath}`);

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        contractPassed: boolean;
        traceId: string;
        requestHeaders: Record<string, string>;
        firstDelivery: { httpCode: number; passed: boolean };
        secondDelivery: { httpCode: number; passed: boolean };
      };
      expect(evidence.contractPassed).toBe(true);
      expect(evidence.traceId).toBe("trace-agentledger-drill-pass-001");
      expect(evidence.requestHeaders["X-TokenPulse-Spec-Version"]).toBe("v1");
      expect(evidence.requestHeaders["X-TokenPulse-Key-Id"]).toBe("tokenpulse-runtime-v1");
      expect(evidence.requestHeaders["X-TokenPulse-Idempotency-Key"]).toHaveLength(64);
      expect(evidence.requestHeaders["X-TokenPulse-Signature"]).toContain("sha256=");
      expect(evidence.firstDelivery).toMatchObject({
        httpCode: 202,
        passed: true,
      });
      expect(evidence.secondDelivery).toMatchObject({
        httpCode: 200,
        passed: true,
      });

      const curlLog = readFileSync(logPath, "utf8");
      expect(curlLog).toContain("call=1");
      expect(curlLog).toContain("call=2");
      expect(curlLog).toContain("url=https://agentledger.tokenpulse.test/runtime-events");
      expect(curlLog).toContain("header=X-TokenPulse-Spec-Version: v1");
      expect(curlLog).toContain("header=X-TokenPulse-Signature: sha256=");
      expect(curlLog).toContain('body={"tenantId":"default","traceId":"trace-agentledger-drill-pass-001"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drill_agentledger_runtime_webhook.sh 在幂等命中语义异常时应失败并保留 evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-drill-fail-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const counterPath = join(tempDir, "curl.count");
    const evidencePath = join(tempDir, "agentledger-drill-evidence.json");

    writeFileSync(
      envFile,
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=tokenpulse-runtime-secret",
        "TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS=10000",
        "TOKENPULSE_AGENTLEDGER_MAX_ATTEMPTS=5",
        "TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC=0,30,120,600,1800",
        "TOKENPULSE_AGENTLEDGER_OUTBOX_RETENTION_DAYS=7",
        "TOKENPULSE_AGENTLEDGER_WORKER_BATCH_SIZE=20",
        "",
      ].join("\n"),
    );
    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `counter_path="${counterPath}"`,
        'output_file=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
        '      shift 2',
        '      ;;',
        '    *)',
        '      shift 1',
        '      ;;',
        '  esac',
        'done',
        'count=1',
        'if [[ -f "${counter_path}" ]]; then',
        '  count=$(( $(cat "${counter_path}") + 1 ))',
        'fi',
        'printf "%s" "${count}" > "${counter_path}"',
        'if [[ "${count}" == "1" ]]; then',
        '  printf \'%s\' \'{"success":true,"accepted":true}\' > "${output_file}"',
        '  printf "202"',
        'else',
        '  printf \'%s\' \'{"error":"business_conflict"}\' > "${output_file}"',
        '  printf "409"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          drillScriptPath,
          "--env-file",
          envFile,
          "--trace-id",
          "trace-agentledger-drill-fail-001",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "重复投递未返回 200 幂等命中（实际 409）",
      );

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        contractPassed: boolean;
        failureReason: string | null;
        firstDelivery: { httpCode: number; passed: boolean };
        secondDelivery: { httpCode: number; passed: boolean };
      };
      expect(evidence.contractPassed).toBe(false);
      expect(evidence.failureReason).toBe("重复投递未返回 200 幂等命中（实际 409）");
      expect(evidence.firstDelivery).toMatchObject({
        httpCode: 202,
        passed: true,
      });
      expect(evidence.secondDelivery).toMatchObject({
        httpCode: 409,
        passed: false,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drill_agentledger_runtime_webhook.sh 在首发失败时应跳过第二次投递并保留 evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-drill-first-fail-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const counterPath = join(tempDir, "curl.count");
    const evidencePath = join(tempDir, "agentledger-drill-evidence.json");

    writeFileSync(
      envFile,
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.tokenpulse.test/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=tokenpulse-runtime-secret",
        "TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS=10000",
        "TOKENPULSE_AGENTLEDGER_MAX_ATTEMPTS=5",
        "TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC=0,30,120,600,1800",
        "TOKENPULSE_AGENTLEDGER_OUTBOX_RETENTION_DAYS=7",
        "TOKENPULSE_AGENTLEDGER_WORKER_BATCH_SIZE=20",
        "",
      ].join("\n"),
    );
    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `counter_path="${counterPath}"`,
        'output_file=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
        '      shift 2',
        '      ;;',
        '    *)',
        '      shift 1',
        '      ;;',
        '  esac',
        'done',
        'count=1',
        'if [[ -f "${counter_path}" ]]; then',
        '  count=$(( $(cat "${counter_path}") + 1 ))',
        'fi',
        'printf "%s" "${count}" > "${counter_path}"',
        'printf \'%s\' \'{"error":"temporarily_unavailable"}\' > "${output_file}"',
        'printf "503"',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          drillScriptPath,
          "--env-file",
          envFile,
          "--trace-id",
          "trace-agentledger-drill-first-fail-001",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("首发请求未返回 202（实际 503）");
      expect(readFileSync(counterPath, "utf8")).toBe("1");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        contractPassed: boolean;
        failureReason: string | null;
        firstDelivery: { httpCode: number; passed: boolean };
        secondDelivery: null;
      };
      expect(evidence.contractPassed).toBe(false);
      expect(evidence.failureReason).toBe("首发请求未返回 202（实际 503）");
      expect(evidence.firstDelivery).toMatchObject({
        httpCode: 503,
        passed: false,
      });
      expect(evidence.secondDelivery).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drill_agentledger_runtime_webhook.sh 在 preflight 失败时应短路且不调用 curl", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-drill-preflight-fail-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const curlLogPath = join(tempDir, "curl.log");
    const evidencePath = join(tempDir, "agentledger-drill-evidence.json");

    writeFileSync(
      envFile,
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "AGENTLEDGER_RUNTIME_INGEST_URL=https://agentledger.example.com/runtime-events",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1",
        "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=tokenpulse-runtime-secret",
        "",
      ].join("\n"),
    );
    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `printf 'curl should not be called\\n' >> "${curlLogPath}"`,
        'printf "202"',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          drillScriptPath,
          "--env-file",
          envFile,
          "--trace-id",
          "trace-agentledger-drill-preflight-fail-001",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "AGENTLEDGER_RUNTIME_INGEST_URL 不能使用示例域名",
      );
      expect(existsSync(curlLogPath)).toBe(false);
      expect(existsSync(evidencePath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
