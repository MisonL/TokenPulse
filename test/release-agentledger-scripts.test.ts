import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const scriptPath = join(
  repoRoot,
  "scripts",
  "release",
  "preflight_agentledger_runtime_webhook.sh",
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
});
