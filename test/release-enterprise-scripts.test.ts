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
  const stateDir = join(tempDir, "state");

  writeExecutable(
    fakeCurlPath,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      `request_log="${requestLogPath}"`,
      `state_dir="${stateDir}"`,
      'mkdir -p "${state_dir}"',
      'mode="${TOKENPULSE_RELEASE_MODE:-probe-fail}"',
      'output_file=""',
      'request_method="GET"',
      'url=""',
      'request_body=""',
      'headers=()',
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
      '    --data)',
      '      request_body="$2"',
      '      shift 2',
      '      ;;',
      '    --header)',
      '      headers+=("$2")',
      '      shift 2',
      '      ;;',
      '    --write-out|--connect-timeout|--max-time)',
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
      'admin_role=""',
      'request_id=""',
      'for header in "${headers[@]}"; do',
      '  case "${header}" in',
      '    x-admin-role:*)',
      '      admin_role="${header#*: }"',
      '      ;;',
      '    x-request-id:*)',
      '      request_id="${header#*: }"',
      '      ;;',
      '  esac',
      'done',
      'if [[ "${mode}" == "probe-fail" ]]; then',
      '  if [[ "${url}" == *"/health" ]]; then',
      '    printf \'{"status":"ok"}\' > "${output_file}"',
      "    printf '200'",
      '    exit 0',
      '  fi',
      '  if [[ "${url}" == *"/api/auth/verify-secret" ]]; then',
      '    printf \'{"error":"未授权：缺少认证信息或认证无效","traceId":"trace-release-script-probe-401"}\' > "${output_file}"',
      "    printf '401'",
      '    exit 0',
      '  fi',
      '  if [[ "${url}" == *"/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      '    printf \'{"data":{"ready":true,"status":"ready"}}\' > "${output_file}"',
      "    printf '200'",
      '    exit 0',
      '  fi',
      '  printf \'{"success":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
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
      '  printf \'{"edition":"advanced","features":{"enterprise":true},"enterpriseBackend":{"reachable":true}}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
      '  if [[ "${admin_role}" == "auditor" ]]; then',
      '    printf \'{"authenticated":true,"roleKey":"auditor"}\' > "${output_file}"',
      '  else',
      '    printf \'{"authenticated":true,"roleKey":"owner"}\' > "${output_file}"',
      '  fi',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/users" && "${request_method}" == "POST" ]]; then',
      '  printf "%s" "${request_body}" > "${state_dir}/last-admin-user-create.json"',
      '  printf \'{"success":true,"id":"temp-admin-user-001","traceId":"trace-release-admin-user-create-001"}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/users/temp-admin-user-001" && "${request_method}" == "PUT" ]]; then',
      '  if ! printf "%s" "${request_body}" | grep -Fq \'"roleBindings"\'; then',
      '    printf \'{"error":"missing binding payload"}\' > "${output_file}"',
      "    printf '500'",
      '    exit 0',
      '  fi',
      '  if ! printf "%s" "${request_body}" | grep -Fq \'"tenantIds"\'; then',
      '    printf \'{"error":"missing binding payload"}\' > "${output_file}"',
      "    printf '500'",
      '    exit 0',
      '  fi',
      '  printf "%s" "${request_body}" > "${state_dir}/last-admin-user-update.json"',
      '  printf \'{"success":true,"traceId":"trace-release-admin-user-update-001"}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/users/temp-admin-user-001" && "${request_method}" == "DELETE" ]]; then',
      '  printf \'{"success":true,"traceId":"trace-release-admin-user-delete-001"}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/billing/policies" && "${request_method}" == "POST" ]]; then',
      '  if ! printf "%s" "${request_body}" | grep -Fq \'"scopeType":"global"\'; then',
      '    printf \'{"error":"unexpected scope validation payload"}\' > "${output_file}"',
      "    printf '500'",
      '    exit 0',
      '  fi',
      '  if ! printf "%s" "${request_body}" | grep -Fq \'"scopeValue":"default"\'; then',
      '    printf \'{"error":"unexpected scope validation payload"}\' > "${output_file}"',
      "    printf '500'",
      '    exit 0',
      '  fi',
      '  printf "%s" "${request_body}" > "${state_dir}/last-billing-policy-create.json"',
      '  printf \'{"error":"scopeType=global 时不允许提供 scopeValue","traceId":"trace-release-policy-scope-400"}\' > "${output_file}"',
      "  printf '400'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/org/organizations" && "${request_method}" == "GET" ]]; then',
      '  printf \'{"data":[],"success":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/org/organizations" && "${request_method}" == "POST" ]]; then',
      '  if [[ "${admin_role}" == "auditor" ]]; then',
      '    printf \'{"error":"权限不足","required":"admin.org.manage"}\' > "${output_file}"',
      "    printf '403'",
      '    exit 0',
      '  fi',
      '  org_id="$(printf "%s" "${request_body}" | sed -n \'s/.*"id":"\\([^\"]*\\)".*/\\1/p\' | head -n 1)"',
      '  if [[ -n "${request_id}" ]]; then',
      '    printf "%s" "${org_id}" > "${state_dir}/trace-org-id"',
      '    printf \'{"success":true,"traceId":"%s"}\' "${request_id}" > "${output_file}"',
      '  else',
      '    printf \'{"success":true}\' > "${output_file}"',
      '  fi',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/org/projects" && "${request_method}" == "POST" ]]; then',
      '  printf \'{"success":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/org/members" && "${request_method}" == "POST" ]]; then',
      '  printf \'{"success":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/org/member-project-bindings?"* && "${request_method}" == "GET" ]]; then',
      '  member_id="$(printf "%s" "${url}" | sed -n \'s/.*memberId=\\([^&]*\\).*/\\1/p\' | head -n 1)"',
      '  project_id="$(printf "%s" "${url}" | sed -n \'s/.*projectId=\\([^&]*\\).*/\\1/p\' | head -n 1)"',
      '  printf \'{"data":[{"id":101,"memberId":"%s","projectId":"%s"}]}\' "${member_id}" "${project_id}" > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/org/member-project-bindings" && "${request_method}" == "POST" ]]; then',
      '  if [[ -f "${state_dir}/binding-created" ]]; then',
      '    printf \'{"error":"成员与项目绑定已存在"}\' > "${output_file}"',
      "    printf '409'",
      '  else',
      '    : > "${state_dir}/binding-created"',
      '    printf \'{"success":true}\' > "${output_file}"',
      "    printf '200'",
      '  fi',
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/audit/events?traceId="* ]]; then',
      '  trace_id="$(printf "%s" "${url}" | sed -n \'s/.*traceId=\\([^&]*\\).*/\\1/p\' | head -n 1)"',
      '  trace_org_id="$(cat "${state_dir}/trace-org-id" 2>/dev/null || true)"',
      '  printf \'{"data":[{"traceId":"%s","action":"org.organization.create","resourceId":"%s"}]}\' "${trace_id}" "${trace_org_id}" > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      '  printf \'{"data":{"ready":true,"status":"ready"}}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'if [[ "${request_method}" == "DELETE" ]]; then',
      '  printf \'{"success":true}\' > "${output_file}"',
      "  printf '200'",
      '  exit 0',
      'fi',
      'printf \'{"error":"unexpected fake curl url"}\' > "${output_file}"',
      "printf '500'",
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
        TOKENPULSE_RELEASE_MODE: "probe-fail",
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
        TOKENPULSE_RELEASE_MODE: "probe-fail",
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
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/admin/users");
      expect(text).not.toContain("PUT https://core.tokenpulse.test/api/admin/users/");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/admin/billing/policies");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/organizations");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/projects");
      expect(text).not.toContain("POST https://core.tokenpulse.test/api/org/members");
    });
  });

  it("check_enterprise_boundary.sh 成功路径应覆盖 users 绑定写路径与 billing scope 校验", () => {
    rmSync(requestLogPath, { force: true });
    rmSync(join(stateDir, "last-admin-user-create.json"), { force: true });
    rmSync(join(stateDir, "last-admin-user-update.json"), { force: true });
    rmSync(join(stateDir, "last-billing-policy-create.json"), { force: true });
    rmSync(join(stateDir, "trace-org-id"), { force: true });
    rmSync(join(stateDir, "binding-created"), { force: true });

    const result = runShell(
      [
        "bash",
        join(scriptsDir, "check_enterprise_boundary.sh"),
        "--base-url",
        "https://core.tokenpulse.test",
        "--api-secret",
        "tokenpulse-secret",
        "--case-prefix",
        "boundary-success-test",
      ],
      {
        PATH: `${tempDir}:${process.env.PATH || ""}`,
        TOKENPULSE_RELEASE_MODE: "success",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("用户绑定写路径");
    expect(`${result.stdout}\n${result.stderr}`).toContain("计费范围校验");

    const requestLog = readFileSync(requestLogPath, "utf8");
    expect(requestLog).toContain("POST https://core.tokenpulse.test/api/admin/users");
    expect(requestLog).toContain("PUT https://core.tokenpulse.test/api/admin/users/temp-admin-user-001");
    expect(requestLog).toContain("POST https://core.tokenpulse.test/api/admin/billing/policies");
    expect(requestLog).toContain(
      "GET https://core.tokenpulse.test/api/admin/audit/events?traceId=boundary-success-test-",
    );

    const createPayload = JSON.parse(
      readFileSync(join(stateDir, "last-admin-user-create.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(createPayload.roleKey).toBe("operator");
    expect(createPayload.tenantId).toBe("default");

    const updatePayload = JSON.parse(
      readFileSync(join(stateDir, "last-admin-user-update.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Array.isArray(updatePayload.roleBindings)).toBe(true);
    expect(updatePayload.tenantIds).toEqual(["default"]);

    const policyPayload = JSON.parse(
      readFileSync(join(stateDir, "last-billing-policy-create.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(policyPayload.scopeType).toBe("global");
    expect(policyPayload.scopeValue).toBe("default");
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
        TOKENPULSE_RELEASE_MODE: "probe-fail",
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("[active] 登录探针");

    const requestLog = Bun.file(requestLogPath).text();
    return requestLog.then(async (text) => {
      expect(text).toContain("GET https://active.tokenpulse.test/health");
      expect(text).toContain("GET https://active.tokenpulse.test/api/auth/verify-secret");
      expect(text).not.toContain("GET https://active.tokenpulse.test/api/admin/features");
      expect(text).not.toContain("GET https://active.tokenpulse.test/api/admin/auth/me");
      expect(text).not.toContain("POST https://active.tokenpulse.test/api/admin/users");
      expect(text).not.toContain("POST https://active.tokenpulse.test/api/admin/billing/policies");
      expect(text).not.toContain(
        "GET https://active.tokenpulse.test/api/admin/observability/agentledger-outbox/readiness",
      );

      const runnerLog = await Bun.file(runnerLogPath).text().catch(() => "");
      expect(runnerLog).toBe("");
    });
  });
});

function createCanaryCompatFixture(
  compat5mHits: number,
  compat24hHits: number,
  readinessOptions?: {
    default?: { httpCode: number; body: string };
    active?: { httpCode: number; body: string };
    candidate?: { httpCode: number; body: string };
    rollbackTarget?: { httpCode: number; body: string };
  },
) {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-canary-compat-"));
  const fakeCurlPath = join(tempDir, "curl");
  const requestLogPath = join(tempDir, "request.log");
  const runnerLogPath = join(tempDir, "runner.log");
  const smokeScriptPath = join(tempDir, "fake-smoke.sh");
  const boundaryScriptPath = join(tempDir, "fake-boundary.sh");
  const defaultReadiness =
    readinessOptions?.default || {
      httpCode: 200,
      body: '{"data":{"ready":true,"status":"ready"}}',
    };
  const activeReadiness = readinessOptions?.active || defaultReadiness;
  const candidateReadiness = readinessOptions?.candidate || defaultReadiness;
  const rollbackTargetReadiness = readinessOptions?.rollbackTarget || candidateReadiness;
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
      'if [[ "${url}" == "https://active.tokenpulse.test/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      `  printf '%s' '${activeReadiness.body}' > "\${output_file}"`,
      `  printf '${activeReadiness.httpCode}'`,
      '  exit 0',
      'fi',
      'if [[ "${url}" == "https://candidate.tokenpulse.test/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      `  printf '%s' '${candidateReadiness.body}' > "\${output_file}"`,
      `  printf '${candidateReadiness.httpCode}'`,
      '  exit 0',
      'fi',
      'if [[ "${url}" == "https://rollback.tokenpulse.test/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      `  printf '%s' '${rollbackTargetReadiness.body}' > "\${output_file}"`,
      `  printf '${rollbackTargetReadiness.httpCode}'`,
      '  exit 0',
      'fi',
      'if [[ "${url}" == *"/api/admin/observability/agentledger-outbox/readiness" ]]; then',
      `  printf '%s' '${defaultReadiness.body}' > "\${output_file}"`,
      `  printf '${defaultReadiness.httpCode}'`,
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
    const evidencePath = join(fixture.tempDir, "canary-evidence.json");

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
          "--evidence-file",
          evidencePath,
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
      expect(`${result.stdout}\n${result.stderr}`).toContain(`evidence: ${evidencePath}`);
      expect(readFileSync(fixture.requestLogPath, "utf8")).not.toContain("prometheus.tokenpulse.test");
      expect(readFileSync(fixture.runnerLogPath, "utf8")).toBe("smoke\nboundary\n");
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        overallStatus: string;
        smokeRan: boolean;
        boundaryRan: boolean;
        compat: {
          mode: string;
          targetLabel: string | null;
          compat5mHits: number | null;
          compat24hHits: number | null;
          gateResult: string;
          checkedAt: string | null;
          prometheusUrl: string | null;
        };
      };
      expect(evidence.overallStatus).toBe("passed");
      expect(evidence.smokeRan).toBe(true);
      expect(evidence.boundaryRan).toBe(true);
      expect(evidence.compat).toEqual({
        mode: "false",
        targetLabel: "active",
        compat5mHits: null,
        compat24hHits: null,
        gateResult: "skipped",
        checkedAt: null,
        prometheusUrl: null,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("canary_gate.sh 在 AgentLedger readiness 阻断时不应继续执行 smoke/boundary", () => {
    const fixture = createCanaryCompatFixture(
      0,
      0,
      {
        default: {
          httpCode: 503,
          body: '{"data":{"ready":false,"status":"blocking","blockingReasons":["delivery_not_configured"]}}',
        },
      },
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

  it("canary_gate.sh 在 pre 阶段 active 缺少 readiness 路由时应按旧版本兼容继续检查 candidate", () => {
    const fixture = createCanaryCompatFixture(
      0,
      0,
      {
        active: {
          httpCode: 404,
          body: '{"error":"not found"}',
        },
        candidate: {
          httpCode: 200,
          body: '{"data":{"ready":true,"status":"ready"}}',
        },
      },
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
          "--candidate-base-url",
          "https://candidate.tokenpulse.test",
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

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("按旧版本兼容跳过");
      const requestLog = readFileSync(fixture.requestLogPath, "utf8");
      expect(requestLog).toContain(
        "GET https://active.tokenpulse.test/api/admin/observability/agentledger-outbox/readiness",
      );
      expect(requestLog).toContain(
        "GET https://candidate.tokenpulse.test/api/admin/observability/agentledger-outbox/readiness",
      );
      expect(readFileSync(fixture.runnerLogPath, "utf8")).toBe("smoke\nboundary\n");
    } finally {
      fixture.cleanup();
    }
  });

  it("canary_gate.sh 在 with-compat=observe 且 compat 命中时应继续执行 smoke/boundary", () => {
    const fixture = createCanaryCompatFixture(2, 6);
    const evidencePath = join(fixture.tempDir, "canary-compat-observe.json");

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
          "--evidence-file",
          evidencePath,
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
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 摘要: gate=warn, 5m=2, 24h_top10=6");
      expect(`${result.stdout}\n${result.stderr}`).toContain("灰度检查通过");
      expect(readFileSync(fixture.requestLogPath, "utf8")).toContain(
        "GET http://prometheus.tokenpulse.test/api/v1/query?query=",
      );
      expect(readFileSync(fixture.runnerLogPath, "utf8")).toBe("compat-5m\ncompat-24h\nsmoke\nboundary\n");
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        overallStatus: string;
        currentStage: string;
        smokeRan: boolean;
        boundaryRan: boolean;
        compat: {
          mode: string;
          targetLabel: string;
          compat5mHits: number;
          compat24hHits: number;
          gateResult: string;
          checkedAt: string;
          prometheusUrl: string;
        };
      };
      expect(evidence.overallStatus).toBe("passed");
      expect(evidence.currentStage).toBe("completed");
      expect(evidence.smokeRan).toBe(true);
      expect(evidence.boundaryRan).toBe(true);
      expect(evidence.compat).toMatchObject({
        mode: "observe",
        targetLabel: "active",
        compat5mHits: 2,
        compat24hHits: 6,
        gateResult: "warn",
      });
      expect(evidence.compat.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(evidence.compat.prometheusUrl).toBe("http://prometheus.tokenpulse.test");
    } finally {
      fixture.cleanup();
    }
  });

  it("canary_gate.sh 在 with-compat=strict 且 compat 命中时应阻断 smoke/boundary", () => {
    const fixture = createCanaryCompatFixture(1, 3);
    const evidencePath = join(fixture.tempDir, "canary-compat-strict.json");

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
          "--evidence-file",
          evidencePath,
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
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 摘要: gate=fail, 5m=1, 24h_top10=3");
      expect(readFileSync(fixture.runnerLogPath, "utf8")).toBe("compat-5m\ncompat-24h\n");
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
        overallStatus: string;
        currentStage: string;
        smokeRan: boolean;
        boundaryRan: boolean;
        compat: {
          mode: string;
          targetLabel: string;
          compat5mHits: number;
          compat24hHits: number;
          gateResult: string;
          checkedAt: string;
          prometheusUrl: string;
        };
      };
      expect(evidence.overallStatus).toBe("failed");
      expect(evidence.currentStage).toBe("compat:active");
      expect(evidence.smokeRan).toBe(false);
      expect(evidence.boundaryRan).toBe(false);
      expect(evidence.compat).toMatchObject({
        mode: "strict",
        compat5mHits: 1,
        compat24hHits: 3,
        gateResult: "fail",
      });
      expect(evidence.compat.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(evidence.compat.prometheusUrl).toBe("http://prometheus.tokenpulse.test");
    } finally {
      fixture.cleanup();
    }
  });
});
