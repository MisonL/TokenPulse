import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const commonScriptPath = join(repoRoot, "scripts", "release", "common.sh");

async function runShell(cmd: string[], env?: Record<string, string>) {
  const proc = Bun.spawn({
    cmd,
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(env || {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
}

describe("release common helpers", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-common-"));
  const runnerPath = join(tempDir, "run_probe.sh");

  writeFileSync(
    runnerPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "COMMON_PATH=\"$1\"",
      "BASE_URL=\"$2\"",
      "API_SECRET_VALUE=\"$3\"",
      "source \"$COMMON_PATH\"",
      "declare -a TP_HEADERS=()",
      "tp_require_api_secret_probe \"$BASE_URL\" \"$API_SECRET_VALUE\" \"release-common-test\"",
      "",
    ].join("\n"),
  );
  chmodSync(runnerPath, 0o755);

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/verify-secret") {
        const authorization = request.headers.get("authorization") || "";
        if (authorization === "Bearer tokenpulse-secret") {
          return Response.json({ success: true });
        }
        return Response.json(
          {
            error: "未授权：缺少认证信息或认证无效",
            traceId: "trace-release-common-401",
          },
          { status: 401 },
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  afterAll(() => {
    server.stop(true);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("tp_require_api_secret_probe 在 secret 正确时应通过", async () => {
    const result = await runShell([
      "bash",
      runnerPath,
      commonScriptPath,
      server.url.toString(),
      "tokenpulse-secret",
    ]);

    expect(result.exitCode).toBe(0);
  });

  it("tp_require_api_secret_probe 在 secret 错误时应失败并带出上下文", async () => {
    const result = await runShell([
      "bash",
      runnerPath,
      commonScriptPath,
      server.url.toString(),
      "bad-secret",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("release-common-test 失败");
    expect(`${result.stdout}\n${result.stderr}`).toContain("/api/auth/verify-secret");
  });
});
