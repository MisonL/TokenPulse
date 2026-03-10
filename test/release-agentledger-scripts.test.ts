import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAgentLedgerRuntimeContract,
  buildAgentLedgerRuntimeSignedHeaders,
} from "../src/lib/agentledger/runtime-contract";

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
const replayScriptPath = join(
  repoRoot,
  "scripts",
  "release",
  "replay_agentledger_outbox.sh",
);
const exportScriptPath = join(
  repoRoot,
  "scripts",
  "release",
  "export_agentledger_outbox.sh",
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

function createReplayServer(options?: {
  authMode?: "header" | "cookie";
  expectedOwnerUser?: string;
  expectedOwnerRole?: string;
  expectedCookie?: string;
  expectedAdminTenant?: string;
  verifySecretStatus?: number;
  verifySecretBody?: Record<string, unknown>;
  adminStatus?: number;
  adminBody?: Record<string, unknown>;
  replayStatus?: number;
  replayBody?: Record<string, unknown>;
}) {
  const requests: Array<{
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
  }> = [];
  const authMode = options?.authMode || "header";
  const expectedOwnerUser = options?.expectedOwnerUser || "replay-owner";
  const expectedOwnerRole = options?.expectedOwnerRole || "owner";
  const expectedCookie = options?.expectedCookie || "";
  const expectedAdminTenant = options?.expectedAdminTenant || "";
  const verifySecretStatus = options?.verifySecretStatus ?? 200;
  const verifySecretBody = options?.verifySecretBody || { success: true };
  const adminStatus = options?.adminStatus ?? 200;
  const adminBody = options?.adminBody || { authenticated: true, roleKey: "owner" };
  const replayStatus = options?.replayStatus ?? 200;
  const replayBody = options?.replayBody || {
    success: true,
    data: {
      requestedCount: 1,
      processedCount: 1,
      successCount: 1,
      failureCount: 0,
      notFoundCount: 0,
      notConfiguredCount: 0,
    },
    traceId: "trace-agentledger-replay-default-001",
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.text() : "";
      const headers = Object.fromEntries(request.headers.entries());
      requests.push({
        method: request.method,
        path: url.pathname,
        headers,
        body,
      });

      if (url.pathname === "/api/auth/verify-secret") {
        return Response.json(verifySecretBody, { status: verifySecretStatus });
      }

      if (url.pathname === "/api/admin/auth/me") {
        if (authMode === "cookie") {
          const cookie = request.headers.get("cookie") || "";
          if (cookie !== expectedCookie) {
            return Response.json(
              { authenticated: false, error: "missing_cookie", traceId: "trace-cookie-missing-001" },
              { status: 401 },
            );
          }
        } else {
          const ownerUser = request.headers.get("x-admin-user") || "";
          const ownerRole = request.headers.get("x-admin-role") || "";
          const adminTenant = request.headers.get("x-admin-tenant") || "";
          if (ownerUser !== expectedOwnerUser || ownerRole !== expectedOwnerRole) {
            return Response.json(
              {
                authenticated: false,
                roleKey: ownerRole || null,
                error: "missing_header_identity",
                traceId: "trace-header-missing-001",
              },
              { status: 401 },
            );
          }
          if (expectedAdminTenant && adminTenant !== expectedAdminTenant) {
            return Response.json(
              {
                authenticated: false,
                roleKey: ownerRole,
                error: "tenant_mismatch",
                traceId: "trace-header-tenant-mismatch-001",
              },
              { status: 401 },
            );
          }
        }

        return Response.json(adminBody, { status: adminStatus });
      }

      if (url.pathname === "/api/admin/observability/agentledger-outbox/replay-batch") {
        if (authMode === "cookie") {
          const cookie = request.headers.get("cookie") || "";
          if (cookie !== expectedCookie) {
            return Response.json(
              { success: false, error: "missing_cookie", traceId: "trace-cookie-missing-002" },
              { status: 401 },
            );
          }
        } else {
          const ownerUser = request.headers.get("x-admin-user") || "";
          const ownerRole = request.headers.get("x-admin-role") || "";
          if (ownerUser !== expectedOwnerUser || ownerRole !== expectedOwnerRole) {
            return Response.json(
              { success: false, error: "missing_header_identity", traceId: "trace-header-missing-002" },
              { status: 401 },
            );
          }
        }

        return Response.json(replayBody, { status: replayStatus });
      }

      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });

  return {
    baseUrl: server.url.toString().replace(/\/$/, ""),
    requests,
    stop() {
      server.stop(true);
    },
  };
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

  it("preflight_agentledger_runtime_webhook.sh 应拒绝 tenantId 占位值（允许 default）", () => {
    withEnvFile(
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        'TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID="<tenant-id>"',
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
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("tenantId 不能使用占位值");
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

  it("build_agentledger_runtime_contract.ts 在缺少签名覆盖字段时应输出可定位错误", () => {
    const result = runShell([
      "bun",
      "run",
      join(repoRoot, "scripts", "release", "build_agentledger_runtime_contract.ts"),
      "--format",
      "json",
      "--trace-id",
      "trace-agentledger-contract-missing-ts-001",
      "--tenant-id",
      "default",
      "--provider",
      "claude",
      "--model",
      "claude-sonnet",
      "--status",
      "success",
      "--started-at",
      "2026-03-10T00:00:00Z",
      "--spec-version",
      "v1",
      "--key-id",
      "tokenpulse-runtime-v1",
      "--secret",
      "tokenpulse-runtime-secret",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("缺少必要参数: --timestamp");
    expect(`${result.stdout}\n${result.stderr}`).toContain("签名覆盖字段");
    expect(`${result.stdout}\n${result.stderr}`).toContain("X-TokenPulse-Timestamp");
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
        idempotencyKey: string;
        payloadHash: string;
        payload: Record<string, string>;
        requestHeaders: Record<string, string>;
        firstDelivery: { httpCode: number; passed: boolean };
        secondDelivery: { httpCode: number; passed: boolean };
      };
      const expectedContract = buildAgentLedgerRuntimeContract(
        {
          traceId: "trace-agentledger-drill-pass-001",
          tenantId: "default",
          provider: "claude",
          model: "claude-sonnet",
          resolvedModel: "claude:claude-3-7-sonnet-20250219",
          routePolicy: "latest_valid",
          status: "success",
          startedAt: evidence.payload.startedAt,
          finishedAt: evidence.payload.finishedAt,
          cost: "0.002310",
        },
        {
          defaultRoutePolicy: "round_robin",
          specVersion: "v1",
          keyId: "tokenpulse-runtime-v1",
        },
      );
      const expectedSignedHeaders = buildAgentLedgerRuntimeSignedHeaders({
        specVersion: "v1",
        keyId: "tokenpulse-runtime-v1",
        timestampSec: evidence.requestHeaders["X-TokenPulse-Timestamp"] || "",
        idempotencyKey: expectedContract.idempotencyKey,
        rawBody: expectedContract.payloadJson,
        secret: "tokenpulse-runtime-secret",
      });

      expect(evidence.contractPassed).toBe(true);
      expect(evidence.traceId).toBe("trace-agentledger-drill-pass-001");
      expect(evidence.idempotencyKey).toBe(expectedContract.idempotencyKey);
      expect(evidence.payloadHash).toBe(expectedContract.payloadHash);
      expect(evidence.requestHeaders["X-TokenPulse-Spec-Version"]).toBe("v1");
      expect(evidence.requestHeaders["X-TokenPulse-Key-Id"]).toBe("tokenpulse-runtime-v1");
      expect(evidence.requestHeaders["X-TokenPulse-Idempotency-Key"]).toBe(
        expectedSignedHeaders.headers["X-TokenPulse-Idempotency-Key"],
      );
      expect(evidence.requestHeaders["X-TokenPulse-Signature"]).toBe(
        expectedSignedHeaders.headers["X-TokenPulse-Signature"],
      );
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
      expect(curlLog).toContain(
        `header=X-TokenPulse-Signature: ${expectedSignedHeaders.headers["X-TokenPulse-Signature"]}`,
      );
      expect(curlLog).toContain(`body=${expectedContract.payloadJson}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drill_agentledger_runtime_webhook.sh 应使用 TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID 作为默认 tenantId", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-drill-tenant-env-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const counterPath = join(tempDir, "curl.count");
    const evidencePath = join(tempDir, "agentledger-drill-evidence.json");

    writeFileSync(
      envFile,
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID=tenant-from-env",
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
          "trace-agentledger-drill-tenant-env-001",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        payload: { tenantId: string; startedAt: string; finishedAt: string };
        requestHeaders: Record<string, string>;
      };
      expect(evidence.payload.tenantId).toBe("tenant-from-env");

      const expectedContract = buildAgentLedgerRuntimeContract(
        {
          traceId: "trace-agentledger-drill-tenant-env-001",
          tenantId: "tenant-from-env",
          provider: "claude",
          model: "claude-sonnet",
          resolvedModel: "claude:claude-3-7-sonnet-20250219",
          routePolicy: "latest_valid",
          status: "success",
          startedAt: evidence.payload.startedAt,
          finishedAt: evidence.payload.finishedAt,
          cost: "0.002310",
        },
        {
          defaultRoutePolicy: "round_robin",
          specVersion: "v1",
          keyId: "tokenpulse-runtime-v1",
        },
      );
      const curlLog = readFileSync(logPath, "utf8");
      expect(curlLog).toContain(`body=${expectedContract.payloadJson}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drill_agentledger_runtime_webhook.sh 中 --tenant-id 应覆盖 TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-drill-tenant-cli-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const counterPath = join(tempDir, "curl.count");
    const evidencePath = join(tempDir, "agentledger-drill-evidence.json");

    writeFileSync(
      envFile,
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID=tenant-from-env",
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
          "trace-agentledger-drill-tenant-cli-001",
          "--tenant-id",
          "tenant-from-cli",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        payload: { tenantId: string };
      };
      expect(evidence.payload.tenantId).toBe("tenant-from-cli");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drill_agentledger_runtime_webhook.sh 调用 preflight 时应透传解析后的 tenantId", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-drill-tenant-pass-through-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const counterPath = join(tempDir, "curl.count");
    const evidencePath = join(tempDir, "agentledger-drill-evidence.json");

    writeFileSync(
      envFile,
      [
        "TOKENPULSE_AGENTLEDGER_ENABLED=true",
        "TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID=tenant-from-env",
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
        'printf "called\\n" >> "${log_path}"',
        'count=1',
        'if [[ -f "${counter_path}" ]]; then',
        '  count=$(( $(cat "${counter_path}") + 1 ))',
        'fi',
        'printf "%s" "${count}" > "${counter_path}"',
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
          "trace-agentledger-drill-tenant-pass-through-001",
          "--tenant-id",
          "<tenant-id>",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("tenantId 不能使用占位值");
      expect(existsSync(logPath)).toBe(false);
      expect(existsSync(evidencePath)).toBe(true);
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
      expect(existsSync(evidencePath)).toBe(true);

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        contractPassed: boolean;
        failureReason: string | null;
        traceId: string;
        ingestUrl: string;
        firstDelivery: null;
        secondDelivery: null;
      };
      expect(evidence.contractPassed).toBe(false);
      expect(evidence.traceId).toBe("trace-agentledger-drill-preflight-fail-001");
      expect(evidence.ingestUrl).toBe("https://agentledger.example.com/runtime-events");
      expect(evidence.failureReason).not.toBeNull();
      expect(evidence.failureReason || "").toContain("预检失败");
      expect(evidence.failureReason || "").toContain("AGENTLEDGER_RUNTIME_INGEST_URL 不能使用示例域名");
      expect(evidence.firstDelivery).toBeNull();
      expect(evidence.secondDelivery).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("export_agentledger_outbox.sh 支持 --env-file 读取 API_SECRET 与 base-url", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-export-env-file-"));
    const envFile = join(tempDir, "agentledger.env");
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const evidencePath = join(tempDir, "agentledger-export-evidence.json");
    const csvPath = join(tempDir, "agentledger-outbox.csv");

    writeFileSync(
      envFile,
      [
        "API_SECRET=tokenpulse-secret-from-env",
        "TOKENPULSE_BASE_URL=https://tokenpulse.release.test",
        "",
      ].join("\n"),
    );
    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_path="${logPath}"`,
        'output_file=""',
        'url=""',
        'method=""',
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
        '    http://*|https://*)',
        '      url="$1"',
        '      shift 1',
        '      ;;',
        '    *)',
        '      shift 1',
        '      ;;',
        '  esac',
        'done',
        '{',
        '  printf "method=%s\\n" "${method}"',
        '  printf "url=%s\\n" "${url}"',
        '  for header in "${headers[@]}"; do',
        '    printf "header=%s\\n" "${header}"',
        '  done',
        '  printf -- "--\\n"',
        '} >> "${log_path}"',
        'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
        '  printf \'%s\' \'{"success":true}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'%s\' \'{"authenticated":true,"roleKey":"auditor"}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/observability/agentledger-outbox/export" ]]; then',
        '  printf \'%s\' \'id,traceId\\n1,trace-export-env-001\\n\' > "${output_file}"',
        '  printf "200"',
        'else',
        '  printf \'%s\' \'{"error":"not_found"}\' > "${output_file}"',
        '  printf "404"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          exportScriptPath,
          "--env-file",
          envFile,
          "--owner-user",
          "release-export",
          "--owner-role",
          "auditor",
          "--output-file",
          csvPath,
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(readFileSync(csvPath, "utf8")).toContain("trace-export-env-001");

      const sections = readFileSync(logPath, "utf8")
        .split("\n--\n")
        .map((item) => item.trim())
        .filter(Boolean);
      expect(sections).toHaveLength(3);
      expect(sections[0]).toContain("url=https://tokenpulse.release.test/api/auth/verify-secret");
      expect(sections[0]).toContain("header=Authorization: Bearer tokenpulse-secret-from-env");
      expect(sections[2]).toContain(
        "url=https://tokenpulse.release.test/api/admin/observability/agentledger-outbox/export",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("export_agentledger_outbox.sh 应导出 CSV 并写 evidence（header 身份）", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-export-success-"));
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const evidencePath = join(tempDir, "agentledger-export-evidence.json");
    const csvPath = join(tempDir, "agentledger-outbox.csv");

    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_path="${logPath}"`,
        'output_file=""',
        'url=""',
        'method=""',
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
        '    http://*|https://*)',
        '      url="$1"',
        '      shift 1',
        '      ;;',
        '    *)',
        '      shift 1',
        '      ;;',
        '  esac',
        'done',
        '{',
        '  printf "method=%s\\n" "${method}"',
        '  printf "url=%s\\n" "${url}"',
        '  for header in "${headers[@]}"; do',
        '    printf "header=%s\\n" "${header}"',
        '  done',
        '  printf -- "--\\n"',
        '} >> "${log_path}"',
        'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
        '  printf \'%s\' \'{"success":true}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'%s\' \'{"authenticated":true,"roleKey":"auditor"}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/observability/agentledger-outbox/export" ]]; then',
        '  printf \'%s\' \'id,traceId\\n1,trace-export-001\\n\' > "${output_file}"',
        '  printf "200"',
        'else',
        '  printf \'%s\' \'{"error":"not_found"}\' > "${output_file}"',
        '  printf "404"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          exportScriptPath,
          "--base-url",
          "https://tokenpulse.release.test",
          "--api-secret",
          "tokenpulse-secret",
          "--owner-user",
          "release-export",
          "--owner-role",
          "auditor",
          "--request-id",
          "trace-agentledger-export-script-success",
          "--output-file",
          csvPath,
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AgentLedger outbox CSV 导出完成");
      expect(readFileSync(csvPath, "utf8")).toContain("id,traceId");

      const sections = readFileSync(logPath, "utf8")
        .split("\n--\n")
        .map((item) => item.trim())
        .filter(Boolean);
      expect(sections).toHaveLength(3);
      expect(sections[0]).toContain("url=https://tokenpulse.release.test/api/auth/verify-secret");
      expect(sections[0]).toContain("header=Authorization: Bearer tokenpulse-secret");
      expect(sections[1]).toContain("url=https://tokenpulse.release.test/api/admin/auth/me");
      expect(sections[1]).toContain("header=x-admin-user: release-export");
      expect(sections[1]).toContain("header=x-admin-role: auditor");
      expect(sections[1]).toContain("header=x-request-id: trace-agentledger-export-script-success");
      expect(sections[2]).toContain(
        "url=https://tokenpulse.release.test/api/admin/observability/agentledger-outbox/export",
      );

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        success: boolean;
        outputFile: string;
        export: { method: string; url: string; httpCode: number; saved: boolean };
      };
      expect(evidence.success).toBe(true);
      expect(evidence.outputFile).toBe(csvPath);
      expect(evidence.export).toMatchObject({
        method: "GET",
        url: "https://tokenpulse.release.test/api/admin/observability/agentledger-outbox/export",
        httpCode: 200,
        saved: true,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("export_agentledger_outbox.sh 应拼接导出查询串并写入 evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-export-query-"));
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const evidencePath = join(tempDir, "agentledger-export-evidence.json");
    const csvPath = join(tempDir, "agentledger-outbox.csv");

    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_path="${logPath}"`,
        'output_file=""',
        'url=""',
        'method=""',
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
        '    http://*|https://*)',
        '      url="$1"',
        '      shift 1',
        '      ;;',
        '    *)',
        '      shift 1',
        '      ;;',
        '  esac',
        'done',
        '{',
        '  printf "method=%s\\n" "${method}"',
        '  printf "url=%s\\n" "${url}"',
        '  for header in "${headers[@]}"; do',
        '    printf "header=%s\\n" "${header}"',
        '  done',
        '  printf -- "--\\n"',
        '} >> "${log_path}"',
        'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
        '  printf \'%s\' \'{"success":true}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'%s\' \'{"authenticated":true,"roleKey":"auditor"}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/observability/agentledger-outbox/export"* ]]; then',
        '  printf \'%s\' \'id,traceId\\n1,trace-export-002\\n\' > "${output_file}"',
        '  printf "200"',
        'else',
        '  printf \'%s\' \'{"error":"not_found"}\' > "${output_file}"',
        '  printf "404"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          exportScriptPath,
          "--base-url",
          "https://tokenpulse.release.test",
          "--api-secret",
          "tokenpulse-secret",
          "--owner-user",
          "release-export",
          "--owner-role",
          "auditor",
          "--delivery-state",
          "delivered",
          "--status",
          "success",
          "--provider",
          "openai",
          "--tenant-id",
          "tenant_01",
          "--project-id",
          "proj_02",
          "--trace-id",
          "trace:export+001",
          "--from",
          "2026-03-01T00:00:00+08:00",
          "--to",
          "2026-03-11T23:59:59Z",
          "--limit",
          "123",
          "--output-file",
          csvPath,
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(readFileSync(csvPath, "utf8")).toContain("trace-export-002");

      const sections = readFileSync(logPath, "utf8")
        .split("\n--\n")
        .map((item) => item.trim())
        .filter(Boolean);
      expect(sections).toHaveLength(3);
      expect(sections[2]).toContain(
        "url=https://tokenpulse.release.test/api/admin/observability/agentledger-outbox/export?deliveryState=delivered&status=success&provider=openai&tenantId=tenant_01&projectId=proj_02&traceId=trace%3Aexport%2B001&from=2026-03-01T00%3A00%3A00%2B08%3A00&to=2026-03-11T23%3A59%3A59Z&limit=123",
      );

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        success: boolean;
        export: { method: string; url: string; httpCode: number; saved: boolean };
      };
      expect(evidence.success).toBe(true);
      expect(evidence.export).toMatchObject({
        method: "GET",
        url: "https://tokenpulse.release.test/api/admin/observability/agentledger-outbox/export?deliveryState=delivered&status=success&provider=openai&tenantId=tenant_01&projectId=proj_02&traceId=trace%3Aexport%2B001&from=2026-03-01T00%3A00%3A00%2B08%3A00&to=2026-03-11T23%3A59%3A59Z&limit=123",
        httpCode: 200,
        saved: true,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("export_agentledger_outbox.sh 在导出失败时应非零退出并保留 evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-export-fail-"));
    const fakeCurl = join(tempDir, "curl");
    const evidencePath = join(tempDir, "agentledger-export-evidence.json");
    const csvPath = join(tempDir, "agentledger-outbox.csv");

    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'output_file=""',
        'url=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
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
        'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
        '  printf \'%s\' \'{"success":true}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'%s\' \'{"authenticated":true,"roleKey":"auditor"}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/observability/agentledger-outbox/export" ]]; then',
        '  printf \'%s\' \'{"error":"export_failed"}\' > "${output_file}"',
        '  printf "500"',
        'else',
        '  printf \'%s\' \'{"error":"not_found"}\' > "${output_file}"',
        '  printf "404"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          exportScriptPath,
          "--base-url",
          "https://tokenpulse.release.test",
          "--api-secret",
          "tokenpulse-secret",
          "--output-file",
          csvPath,
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("导出返回非 200");
      expect(existsSync(evidencePath)).toBe(true);
      expect(existsSync(csvPath)).toBe(false);

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        success: boolean;
        failureReason: string | null;
        export: { httpCode: number; saved: boolean };
      };
      expect(evidence.success).toBe(false);
      expect(evidence.failureReason || "").toContain("导出返回非 200");
      expect(evidence.export).toMatchObject({
        httpCode: 500,
        saved: false,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("replay_agentledger_outbox.sh 应按 owner 头部完成批量 replay 并写 evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-replay-success-"));
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const counterPath = join(tempDir, "curl.count");
    const evidencePath = join(tempDir, "agentledger-replay-evidence.json");

    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_path="${logPath}"`,
        `counter_path="${counterPath}"`,
        'output_file=""',
        'url=""',
        'body=""',
        'headers=()',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
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
        '  printf "url=%s\\n" "${url}"',
        '  printf "body=%s\\n" "${body}"',
        '  for header in "${headers[@]}"; do',
        '    printf "header=%s\\n" "${header}"',
        '  done',
        '  printf -- "--\\n"',
        '} >> "${log_path}"',
        'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
        '  printf \'%s\' \'{"success":true}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'%s\' \'{"authenticated":true,"roleKey":"owner"}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/observability/agentledger-outbox/replay-batch" ]]; then',
        '  printf \'%s\' \'{"success":true,"data":{"requestedCount":3,"processedCount":3,"successCount":3,"failureCount":0,"notFoundCount":0,"notConfiguredCount":0},"traceId":"trace-agentledger-replay-success-001"}\' > "${output_file}"',
        '  printf "200"',
        'else',
        '  printf \'%s\' \'{"error":"not_found"}\' > "${output_file}"',
        '  printf "404"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          replayScriptPath,
          "--base-url",
          "https://tokenpulse.release.test",
          "--api-secret",
          "tokenpulse-secret",
          "--ids",
          "101,102 103",
          "--owner-user",
          "release-replay-owner",
          "--owner-role",
          "owner",
          "--admin-tenant",
          "tenant-prod",
          "--request-id",
          "trace-agentledger-replay-script-success",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("AgentLedger outbox 批量 replay 完成");
      expect(result.stdout).toContain(`evidence=${evidencePath}`);

      const sections = readFileSync(logPath, "utf8")
        .split("\n--\n")
        .map((item) => item.trim())
        .filter(Boolean);
      expect(sections).toHaveLength(3);
      expect(sections[0]).toContain("url=https://tokenpulse.release.test/api/auth/verify-secret");
      expect(sections[0]).toContain("header=Authorization: Bearer tokenpulse-secret");
      expect(sections[0]).not.toContain("header=x-admin-user:");
      expect(sections[1]).toContain("url=https://tokenpulse.release.test/api/admin/auth/me");
      expect(sections[1]).toContain("header=x-admin-user: release-replay-owner");
      expect(sections[1]).toContain("header=x-admin-role: owner");
      expect(sections[1]).toContain("header=x-admin-tenant: tenant-prod");
      expect(sections[1]).toContain("header=x-request-id: trace-agentledger-replay-script-success");
      expect(sections[2]).toContain(
        "url=https://tokenpulse.release.test/api/admin/observability/agentledger-outbox/replay-batch",
      );
      expect(sections[2]).toContain('body={"ids":[101,102,103]}');
      expect(sections[2]).toContain("header=x-request-id: trace-agentledger-replay-script-success");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        success: boolean;
        authMode: string;
        responseTraceId: string | null;
        requestedIds: number[];
        prechecks: {
          verifySecret: { passed: boolean; httpCode: number };
          adminAuthMe: { passed: boolean; httpCode: number };
        };
        replayBatch: {
          passed: boolean;
          successFlag: boolean;
          requestedCount: number;
          successCount: number;
          failureCount: number;
        };
      };

      expect(evidence.success).toBe(true);
      expect(evidence.authMode).toBe("header");
      expect(evidence.responseTraceId).toBe("trace-agentledger-replay-success-001");
      expect(evidence.requestedIds).toEqual([101, 102, 103]);
      expect(evidence.prechecks.verifySecret).toMatchObject({
        passed: true,
        httpCode: 200,
      });
      expect(evidence.prechecks.adminAuthMe).toMatchObject({
        passed: true,
        httpCode: 200,
      });
      expect(evidence.replayBatch).toMatchObject({
        passed: true,
        successFlag: true,
        requestedCount: 3,
        successCount: 3,
        failureCount: 0,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("replay_agentledger_outbox.sh 在 cookie 身份下遇到部分失败时应非零退出并保留 evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-replay-cookie-"));
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const evidencePath = join(tempDir, "agentledger-replay-evidence.json");

    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_path="${logPath}"`,
        'output_file=""',
        'url=""',
        'headers=()',
        'body=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
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
        '{',
        '  printf "url=%s\\n" "${url}"',
        '  printf "body=%s\\n" "${body}"',
        '  for header in "${headers[@]}"; do',
        '    printf "header=%s\\n" "${header}"',
        '  done',
        '  printf -- "--\\n"',
        '} >> "${log_path}"',
        'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
        '  printf \'%s\' \'{"success":true}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'%s\' \'{"authenticated":true,"roleKey":"owner","traceId":"trace-agentledger-cookie-auth-001"}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/observability/agentledger-outbox/replay-batch" ]]; then',
        '  printf \'%s\' \'{"success":false,"data":{"requestedCount":3,"processedCount":3,"successCount":1,"failureCount":2,"notFoundCount":1,"notConfiguredCount":0},"traceId":"trace-agentledger-cookie-replay-001"}\' > "${output_file}"',
        '  printf "200"',
        'else',
        '  printf \'%s\' \'{"error":"not_found"}\' > "${output_file}"',
        '  printf "404"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          replayScriptPath,
          "--base-url",
          "https://tokenpulse.release.test",
          "--api-secret",
          "tokenpulse-secret",
          "--ids",
          "201,202,999999",
          "--cookie",
          "tp_admin_session=abc123",
          "--request-id",
          "trace-agentledger-replay-script-cookie",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("批量 replay 未全成功");

      const sections = readFileSync(logPath, "utf8")
        .split("\n--\n")
        .map((item) => item.trim())
        .filter(Boolean);
      expect(sections).toHaveLength(3);
      expect(sections[1]).toContain("header=Cookie: tp_admin_session=abc123");
      expect(sections[1]).not.toContain("header=x-admin-user:");
      expect(sections[2]).toContain("header=Cookie: tp_admin_session=abc123");
      expect(sections[2]).not.toContain("header=x-admin-user:");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        success: boolean;
        failureReason: string | null;
        authMode: string;
        failedStep: string | null;
        ownerIdentity: { cookieUsed: boolean };
        replayBatch: {
          passed: boolean;
          successFlag: boolean;
          requestedCount: number;
          successCount: number;
          failureCount: number;
          notFoundCount: number;
        };
      };

      expect(evidence.success).toBe(false);
      expect(evidence.failureReason).toContain("批量 replay 未全成功");
      expect(evidence.authMode).toBe("cookie");
      expect(evidence.failedStep).toBe("replay_batch");
      expect(evidence.ownerIdentity.cookieUsed).toBe(true);
      expect(evidence.replayBatch).toMatchObject({
        passed: false,
        successFlag: false,
        requestedCount: 3,
        successCount: 1,
        failureCount: 2,
        notFoundCount: 1,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("replay_agentledger_outbox.sh 在 owner 身份预检失败时应短路且不调用 replay-batch", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-agentledger-replay-precheck-fail-"));
    const fakeCurl = join(tempDir, "curl");
    const logPath = join(tempDir, "curl.log");
    const evidencePath = join(tempDir, "agentledger-replay-evidence.json");

    writeExecutable(
      fakeCurl,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_path="${logPath}"`,
        'output_file=""',
        'url=""',
        'headers=()',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
        '      shift 2',
        '      ;;',
        '    --header)',
        '      headers+=("$2")',
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
        '{',
        '  printf "url=%s\\n" "${url}"',
        '  for header in "${headers[@]}"; do',
        '    printf "header=%s\\n" "${header}"',
        '  done',
        '  printf -- "--\\n"',
        '} >> "${log_path}"',
        'if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
        '  printf \'%s\' \'{"success":true}\' > "${output_file}"',
        '  printf "200"',
        'elif [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'%s\' \'{"authenticated":true,"roleKey":"auditor","traceId":"trace-agentledger-precheck-fail-001"}\' > "${output_file}"',
        '  printf "403"',
        'else',
        '  printf \'%s\' \'{"error":"not_found"}\' > "${output_file}"',
        '  printf "404"',
        'fi',
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          replayScriptPath,
          "--base-url",
          "https://tokenpulse.release.test",
          "--api-secret",
          "tokenpulse-secret",
          "--ids",
          "301,302",
          "--owner-user",
          "release-precheck-owner",
          "--request-id",
          "trace-agentledger-replay-script-precheck-fail",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("owner 身份预检失败");

      const sections = readFileSync(logPath, "utf8")
        .split("\n--\n")
        .map((item) => item.trim())
        .filter(Boolean);
      expect(sections).toHaveLength(2);
      expect(sections[1]).toContain("url=https://tokenpulse.release.test/api/admin/auth/me");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        success: boolean;
        failedStep: string | null;
        responseTraceId: string | null;
        prechecks: {
          verifySecret: { passed: boolean; httpCode: number };
          adminAuthMe: { passed: boolean; httpCode: number };
        };
        replayBatch: { httpCode: number | null; passed: boolean; successFlag: boolean | null };
      };

      expect(evidence.success).toBe(false);
      expect(evidence.failedStep).toBe("admin_auth_me");
      expect(evidence.responseTraceId).toBe("trace-agentledger-precheck-fail-001");
      expect(evidence.prechecks.verifySecret).toMatchObject({
        passed: true,
        httpCode: 200,
      });
      expect(evidence.prechecks.adminAuthMe).toMatchObject({
        passed: false,
        httpCode: 403,
      });
      expect(evidence.replayBatch).toMatchObject({
        httpCode: null,
        passed: false,
        successFlag: null,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

});
