import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const scriptsDir = join(repoRoot, "scripts", "release");
const monitoringDir = join(repoRoot, "monitoring");

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

function createRuntimeAlertmanagerFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-alertmanager-"));
  const templatesDir = join(tempDir, "templates");
  const configPath = join(tempDir, "alertmanager.prod.yml");
  mkdirSync(templatesDir, { recursive: true });
  writeFileSync(
    configPath,
    [
      "global:",
      "  resolve_timeout: 5m",
      "",
      "templates:",
      "  - /etc/alertmanager/templates/*.tmpl",
      "",
      "route:",
      '  receiver: "warning-webhook"',
      '  group_by: ["alertname", "service", "severity", "provider"]',
      "  group_wait: 30s",
      "  group_interval: 5m",
      "  repeat_interval: 2h",
      "  routes:",
      '    - receiver: "p1-webhook"',
      "      matchers:",
      '        - severity="critical"',
      '        - escalation="p1-15m"',
      "      group_wait: 10s",
      "      group_interval: 1m",
      "      repeat_interval: 15m",
      "      continue: false",
      '    - receiver: "warning-webhook"',
      "      matchers:",
      '        - severity="warning"',
      "      continue: false",
      '    - receiver: "critical-webhook"',
      "      matchers:",
      '        - severity="critical"',
      "      continue: false",
      "",
      "receivers:",
      '  - name: "warning-webhook"',
      "    webhook_configs:",
      '      - url: "https://hooks.tokenpulse.test/warning"',
      "        send_resolved: true",
      '  - name: "critical-webhook"',
      "    webhook_configs:",
      '      - url: "https://hooks.tokenpulse.test/critical"',
      "        send_resolved: true",
      '  - name: "p1-webhook"',
      "    webhook_configs:",
      '      - url: "https://hooks.tokenpulse.test/p1"',
      "        send_resolved: true",
      "",
    ].join("\n"),
  );
  writeFileSync(join(templatesDir, "oauth-alerts.tmpl"), "{{ define \"noop\" }}ok{{ end }}\n");

  return {
    tempDir,
    templatesDir,
    configPath,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("Alertmanager 发布脚本与示例配置", () => {
  it("示例配置应包含 warning/critical/P1 三段路由", () => {
    const files = [
      "alertmanager.yml",
      "alertmanager.slack.example.yml",
      "alertmanager.wecom.example.yml",
      "alertmanager.webhook.local.example.yml",
      "runtime/alertmanager.prod.example.yml",
    ];

    for (const file of files) {
      const content = readFileSync(join(monitoringDir, file), "utf8");
      expect(content).toContain('escalation="p1-15m"');
      expect(content).toContain("repeat_interval: 15m");
    }
  });

  it("read_alertmanager_secret_from_env.example.sh 应按 secret_ref 输出单行 webhook URL", () => {
    const helperPath = join(
      scriptsDir,
      "read_alertmanager_secret_from_env.example.sh",
    );

    const success = runShell(
      [
        "bash",
        helperPath,
        "tokenpulse/prod/alertmanager_warning_webhook_url",
      ],
      {
        TOKENPULSE_ALERTMANAGER_WARNING_WEBHOOK_URL:
          "https://hooks.tokenpulse.test/warning",
      },
    );
    expect(success.exitCode).toBe(0);
    expect(success.stdout).toBe("https://hooks.tokenpulse.test/warning");

    const invalid = runShell(["bash", helperPath, "tokenpulse/prod/unknown"]);
    expect(invalid.exitCode).not.toBe(0);
    expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("未知 secret_ref");
  });

  it("preflight_alertmanager_config.sh 应拒绝仓库示例配置并接受运行时配置", () => {
    const fixture = createRuntimeAlertmanagerFixture();

    try {
      const invalid = runShell([
        "bash",
        join(scriptsDir, "preflight_alertmanager_config.sh"),
        "--config-path",
        "./monitoring/alertmanager.yml",
        "--templates-path",
        "./monitoring/alertmanager-templates",
      ]);
      expect(invalid.exitCode).not.toBe(0);
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("example.invalid/example.com");

      const valid = runShell([
        "bash",
        join(scriptsDir, "preflight_alertmanager_config.sh"),
        "--config-path",
        fixture.configPath,
        "--templates-path",
        fixture.templatesDir,
      ]);
      expect(valid.exitCode).toBe(0);
      expect(valid.stdout).toContain("Alertmanager 发布前预检通过");
    } finally {
      fixture.cleanup();
    }
  });

  it("preflight_alertmanager_config.sh 应校验 templates 引用至少命中一个文件", () => {
    const fixture = createRuntimeAlertmanagerFixture();

    writeFileSync(
      fixture.configPath,
      [
        "global:",
        "  resolve_timeout: 5m",
        "",
        "templates:",
        "  - /etc/alertmanager/templates/missing/*.tmpl",
        "",
        "route:",
        '  receiver: "warning-webhook"',
        "",
        "receivers:",
        '  - name: "warning-webhook"',
        "    webhook_configs:",
        '      - url: "https://hooks.tokenpulse.test/warning"',
        "        send_resolved: true",
        "",
      ].join("\n"),
    );

    try {
      const invalid = runShell([
        "bash",
        join(scriptsDir, "preflight_alertmanager_config.sh"),
        "--config-path",
        fixture.configPath,
        "--templates-path",
        fixture.templatesDir,
      ]);
      expect(invalid.exitCode).not.toBe(0);
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain(
        "templates 引用未命中任何文件",
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("preflight_alertmanager_config.sh 不应把 alertmanager-templates 路径误判为缺失模板", () => {
    const invalid = runShell([
      "bash",
      join(scriptsDir, "preflight_alertmanager_config.sh"),
      "--config-path",
      "./monitoring/alertmanager.slack.example.yml",
      "--templates-path",
      "./monitoring/alertmanager-templates",
    ]);

    expect(invalid.exitCode).not.toBe(0);
    expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("example.invalid/example.com");
    expect(`${invalid.stdout}\n${invalid.stderr}`).not.toContain("templates 引用未命中任何文件");
  });

  it("preflight_release_window_oauth_alerts.sh 应校验 helper 参数并联动 Alertmanager 预检", () => {
    const fixture = createRuntimeAlertmanagerFixture();
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-"));
    const invalidEnv = join(tempDir, "invalid.env");
    const validEnv = join(tempDir, "valid.env");
    const helperPath = join(tempDir, "secret-helper.sh");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeFileSync(
      invalidEnv,
      [
        'RW_BASE_URL="https://core.example.com"',
        'RW_API_SECRET="__REPLACE_WITH_API_SECRET__"',
        'RW_OWNER_USER="__REPLACE_WITH_OWNER_USER__"',
        'RW_OWNER_ROLE="__REPLACE_WITH_OWNER_ROLE__"',
        'RW_AUDITOR_USER="__REPLACE_WITH_AUDITOR_USER__"',
        'RW_AUDITOR_ROLE="__REPLACE_WITH_AUDITOR_ROLE__"',
        'RW_WARNING_SECRET_REF="__REPLACE_WITH_WARNING_SECRET_REF__"',
        'RW_CRITICAL_SECRET_REF="__REPLACE_WITH_CRITICAL_SECRET_REF__"',
        'RW_P1_SECRET_REF="__REPLACE_WITH_P1_SECRET_REF__"',
        'RW_SECRET_HELPER="__REPLACE_WITH_SECRET_HELPER__"',
        "",
      ].join("\n"),
    );

    writeFileSync(
      validEnv,
      [
        'RW_BASE_URL="https://core.tokenpulse.test"',
        'RW_API_SECRET="tokenpulse-secret"',
        'RW_OWNER_USER="release-owner"',
        'RW_OWNER_ROLE="owner"',
        'RW_AUDITOR_USER="release-auditor"',
        'RW_AUDITOR_ROLE="auditor"',
        'RW_WARNING_SECRET_REF="tokenpulse/prod/warning"',
        'RW_CRITICAL_SECRET_REF="tokenpulse/prod/critical"',
        'RW_P1_SECRET_REF="tokenpulse/prod/p1"',
        `RW_SECRET_HELPER="${helperPath}"`,
        'RW_WITH_ROLLBACK="false"',
        `ALERTMANAGER_CONFIG_PATH="${fixture.configPath}"`,
        `ALERTMANAGER_TEMPLATES_PATH="${fixture.templatesDir}"`,
        "",
      ].join("\n"),
    );

    try {
      const invalid = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        invalidEnv,
      ]);
      expect(invalid.exitCode).not.toBe(0);
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("仍为默认占位值");

      const valid = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        validEnv,
      ]);
      expect(valid.exitCode).toBe(0);
      expect(valid.stdout).toContain("预检通过");
      expect(valid.stdout).toContain("release_window_oauth_alerts.sh");
      expect(valid.stdout).toContain('--secret-helper "${RW_SECRET_HELPER}"');
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preflight_release_window_oauth_alerts.sh 在双 Cookie 模式下应允许省略 owner/auditor 头部身份", () => {
    const fixture = createRuntimeAlertmanagerFixture();
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-cookie-"));
    const validEnv = join(tempDir, "cookie.env");
    const helperPath = join(tempDir, "secret-helper.sh");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeFileSync(
      validEnv,
      [
        'RW_BASE_URL="https://core.tokenpulse.test"',
        'RW_API_SECRET="tokenpulse-secret"',
        'RW_OWNER_COOKIE="tp_admin_session=owner-session"',
        'RW_AUDITOR_COOKIE="tp_admin_session=auditor-session"',
        'RW_WARNING_SECRET_REF="tokenpulse/prod/warning"',
        'RW_CRITICAL_SECRET_REF="tokenpulse/prod/critical"',
        'RW_P1_SECRET_REF="tokenpulse/prod/p1"',
        `RW_SECRET_HELPER="${helperPath}"`,
        `ALERTMANAGER_CONFIG_PATH="${fixture.configPath}"`,
        `ALERTMANAGER_TEMPLATES_PATH="${fixture.templatesDir}"`,
        "",
      ].join("\n"),
    );

    try {
      const valid = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        validEnv,
      ]);
      expect(valid.exitCode).toBe(0);
      expect(valid.stdout).toContain('--owner-cookie "${RW_OWNER_COOKIE}"');
      expect(valid.stdout).toContain('--auditor-cookie "${RW_AUDITOR_COOKIE}"');
      expect(valid.stdout).not.toContain('--owner-user "${RW_OWNER_USER}"');
      expect(valid.stdout).not.toContain('--auditor-user "${RW_AUDITOR_USER}"');
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应优先使用 secret-helper 并在联网前拒绝保留示例域名", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-"));
    const helperPath = join(tempDir, "secret-helper.sh");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://example.invalid/%s" "$1"',
        "",
      ].join("\n"),
    );

    try {
      const invalidUrl = runShell([
        "bash",
        join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
        "--base-url",
        "http://127.0.0.1:1",
        "--api-secret",
        "tokenpulse-secret",
        "--admin-user",
        "release-bot",
        "--admin-role",
        "owner",
        "--warning-secret-ref",
        "tokenpulse/prod/warning",
        "--critical-secret-ref",
        "tokenpulse/prod/critical",
        "--p1-secret-ref",
        "tokenpulse/prod/p1",
        "--secret-helper",
        helperPath,
      ]);
      expect(invalidUrl.exitCode).not.toBe(0);
      expect(`${invalidUrl.stdout}\n${invalidUrl.stderr}`).toContain("保留示例域名");
      expect(`${invalidUrl.stdout}\n${invalidUrl.stderr}`).not.toContain("管理员身份预检");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应拒绝 helper 输出多行内容", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-multiline-"));
    const helperPath = join(tempDir, "secret-helper.sh");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s\\nextra-log" "$1"',
        "",
      ].join("\n"),
    );

    try {
      const invalid = runShell([
        "bash",
        join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
        "--base-url",
        "http://127.0.0.1:1",
        "--api-secret",
        "tokenpulse-secret",
        "--admin-user",
        "release-bot",
        "--admin-role",
        "owner",
        "--warning-secret-ref",
        "tokenpulse/prod/warning",
        "--critical-secret-ref",
        "tokenpulse/prod/critical",
        "--p1-secret-ref",
        "tokenpulse/prod/p1",
        "--secret-helper",
        helperPath,
      ]);
      expect(invalid.exitCode).not.toBe(0);
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("必须是单行 webhook URL");
      expect(`${invalid.stdout}\n${invalid.stderr}`).not.toContain("管理员身份预检");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应按顺序写配置并触发 sync", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-happy-path-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const comment = "nightly publish";
    const syncReason = "nightly sync reason";

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    const authMeResponse = JSON.stringify({ authenticated: true, roleKey: "owner" });
    const successResponse = JSON.stringify({ success: true });

    writeExecutable(
      fakeCurlPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_file="${fakeCurlLog}"`,
        'output_file=""',
        'url=""',
        'method="GET"',
        'data=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    --output)',
        '      output_file="$2"',
        '      shift 2',
        '      ;;',
        '    --write-out)',
        '      shift 2',
        '      ;;',
        '    --request)',
        '      method="$2"',
        '      shift 2',
        '      ;;',
        '    --data)',
        '      data="$2"',
        '      shift 2',
        '      ;;',
        '    --header|--connect-timeout|--max-time)',
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
        'printf "%s\\t%s\\t%s\\n" "${method}" "${url}" "${data}" >> "${log_file}"',
        'if [[ -z "${output_file}" ]]; then',
        '  echo "missing --output" >&2',
        '  exit 1',
        'fi',
        'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        `  printf '%s' '${authMeResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/config" ]]; then',
        `  printf '%s' '${successResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync" ]]; then',
        `  printf '%s' '${successResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `printf '%s' '{"error":"unexpected fake curl url"}' > "\${output_file}"`,
        "printf '500'",
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "bash",
          join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
          "--base-url",
          "https://core.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--admin-user",
          "release-bot",
          "--admin-role",
          "owner",
          "--warning-secret-ref",
          "tokenpulse/prod/warning",
          "--critical-secret-ref",
          "tokenpulse/prod/critical",
          "--p1-secret-ref",
          "tokenpulse/prod/p1",
          "--secret-helper",
          helperPath,
          "--comment",
          comment,
          "--sync-reason",
          syncReason,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("已完成 Alertmanager 配置下发与同步");

      const curlLog = readFileSync(fakeCurlLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [method, url, data = ""] = line.split("\t");
          return { method, url, data };
        });

      expect(curlLog).toHaveLength(3);
      expect(curlLog.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET https://core.tokenpulse.test/api/admin/auth/me",
        "PUT https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/config",
        "POST https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync",
      ]);

      const configPayload = JSON.parse(curlLog[1]?.data || "{}");
      expect(configPayload.comment).toBe(comment);
      expect(configPayload.config?.route?.receiver).toBe("warning-webhook");
      expect(configPayload.config?.route?.routes?.map((item: { receiver?: string }) => item.receiver)).toEqual([
        "p1-webhook",
        "critical-webhook",
        "warning-webhook",
      ]);
      expect(configPayload.config?.route?.routes?.[0]?.matchers).toContain('escalation="p1-15m"');
      expect(configPayload.config?.route?.routes?.[0]?.repeat_interval).toBe("15m");
      expect(configPayload.config?.route?.routes?.[1]?.repeat_interval).toBe("30m");
      expect(configPayload.config?.route?.routes?.[2]?.repeat_interval).toBe("4h");

      const receivers = Object.fromEntries(
        (configPayload.config?.receivers || []).map(
          (item: { name?: string; webhook_configs?: Array<{ url?: string }> }) => [
            item.name,
            item.webhook_configs?.[0]?.url,
          ],
        ),
      );
      expect(receivers["warning-webhook"]).toBe(
        "https://hooks.tokenpulse.test/tokenpulse/prod/warning",
      );
      expect(receivers["critical-webhook"]).toBe(
        "https://hooks.tokenpulse.test/tokenpulse/prod/critical",
      );
      expect(receivers["p1-webhook"]).toBe("https://hooks.tokenpulse.test/tokenpulse/prod/p1");

      const syncPayload = JSON.parse(curlLog[2]?.data || "{}");
      expect(syncPayload).toEqual({
        reason: syncReason,
        comment,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应对 deprecated template 输出警告并在联网前拒绝非法 Secret 引用名", () => {
    const invalidRef = runShell([
      "bash",
      join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
      "--base-url",
      "http://127.0.0.1:1",
      "--api-secret",
      "tokenpulse-secret",
      "--admin-user",
      "release-bot",
      "--admin-role",
      "owner",
      "--warning-secret-ref",
      "warning;rm",
      "--critical-secret-ref",
      "tokenpulse/prod/critical",
      "--p1-secret-ref",
      "tokenpulse/prod/p1",
      "--secret-cmd-template",
      "printf https://hooks.tokenpulse.test/%s",
    ]);
    expect(invalidRef.exitCode).not.toBe(0);
    expect(`${invalidRef.stdout}\n${invalidRef.stderr}`).toContain("Secret 引用名包含非法字符");
    expect(`${invalidRef.stdout}\n${invalidRef.stderr}`).toContain("已弃用");
    expect(`${invalidRef.stdout}\n${invalidRef.stderr}`).not.toContain("管理员身份预检");
  });

  it("publish_alertmanager_secret_sync.sh 应拒绝通过 shell -c 执行命令模板", () => {
    const result = runShell([
      "bash",
      join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
      "--base-url",
      "http://127.0.0.1:1",
      "--api-secret",
      "tokenpulse-secret",
      "--admin-user",
      "release-bot",
      "--admin-role",
      "owner",
      "--warning-secret-ref",
      "tokenpulse/prod/warning",
      "--critical-secret-ref",
      "tokenpulse/prod/critical",
      "--p1-secret-ref",
      "tokenpulse/prod/p1",
      "--secret-cmd-template",
      "bash -lc printf https://hooks.tokenpulse.test/%s",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("不允许通过 shell -c");
  });

  it("release_window_oauth_alerts.sh 应透传 secret-helper 并把 historyReason 写入证据文件", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-runtime-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "test-run-001";

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeExecutable(
      fakeBashPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'script="${1:-}"',
        `log_file="${fakeBashLog}"`,
        'if [[ "${script}" == *"/publish_alertmanager_secret_sync.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 0",
        "fi",
        'if [[ "${script}" == *"/drill_oauth_alert_escalation.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 15",
        "fi",
        'exec /bin/bash "$@"',
        "",
      ].join("\n"),
    );

    const authMeResponse = JSON.stringify({ authenticated: true, roleKey: "auditor" });
    const syncHistoryResponse = JSON.stringify({
      data: [
        {
          historyId: "history-other",
          reason: "release window sync other-run",
          outcome: "success",
          startedAt: "2026-03-06T03:31:00Z",
        },
        {
          historyId: "history-target",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T03:35:00Z",
          traceId: "trace-history-target",
        },
      ],
    });
    const incidentsResponse = JSON.stringify({
      data: [
        {
          id: 202,
          incidentId: "incident:release-window:recent",
          createdAt: 1_778_136_120_000,
        },
        {
          id: 201,
          incidentId: "incident:release-window:anchor",
          createdAt: 1_778_135_820_000,
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [{ traceId: "trace-sync-001" }] });
    const unknownResponse = JSON.stringify({ error: "unexpected fake curl url" });

    writeExecutable(
      fakeCurlPath,
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
        '    --write-out|--request|--data|--header|--connect-timeout|--max-time)',
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
        'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        `  printf '%s' '${authMeResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200" ]]; then',
        `  printf '%s' '${syncHistoryResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/incidents?severity=critical&from="* ]]; then',
        `  printf '%s' '${incidentsResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `if [[ "\${url}" == *"/api/admin/audit/events?action=oauth.alert.alertmanager.sync&keyword=${runTag}"* ]]; then`,
        `  printf '%s' '${auditResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `printf '%s' '${unknownResponse}' > "\${output_file}"`,
        "printf '500'",
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "release_window_oauth_alerts.sh"),
          "--base-url",
          "https://core.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--owner-user",
          "release-owner",
          "--owner-role",
          "owner",
          "--auditor-user",
          "release-auditor",
          "--auditor-role",
          "auditor",
          "--warning-secret-ref",
          "tokenpulse/prod/warning",
          "--critical-secret-ref",
          "tokenpulse/prod/critical",
          "--p1-secret-ref",
          "tokenpulse/prod/p1",
          "--secret-helper",
          helperPath,
          "--run-tag",
          runTag,
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`"historyReason":"release window sync ${runTag}"`);

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(evidence.historyId).toBe("history-target");
      expect(evidence.historyReason).toBe(`release window sync ${runTag}`);
      expect(evidence.traceId).toBe("trace-sync-001");
      expect(evidence.drillExitCode).toBe(15);
      expect(evidence.incidentId).toBe("incident:release-window:anchor");
      expect(evidence.incidentCreatedAt).toBe(1_778_135_820_000);

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("--secret-helper");
      expect(bashLog).toContain(helperPath);
      expect(bashLog).not.toContain("--secret-cmd-template");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在关键字审计未命中时应回退到目标 history traceId", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-trace-fallback-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "trace-fallback-run-001";

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeExecutable(
      fakeBashPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'script="${1:-}"',
        'if [[ "${script}" == *"/publish_alertmanager_secret_sync.sh" ]]; then',
        "  exit 0",
        "fi",
        'if [[ "${script}" == *"/drill_oauth_alert_escalation.sh" ]]; then',
        "  exit 0",
        "fi",
        'exec /bin/bash "$@"',
        "",
      ].join("\n"),
    );

    const authMeResponse = JSON.stringify({ authenticated: true, roleKey: "auditor" });
    const syncHistoryResponse = JSON.stringify({
      data: [
        {
          historyId: "history-target-fallback",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T03:35:00Z",
          traceId: "trace-history-only-001",
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [] });
    const unknownResponse = JSON.stringify({ error: "unexpected fake curl url" });

    writeExecutable(
      fakeCurlPath,
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
        '    --write-out|--request|--data|--header|--connect-timeout|--max-time)',
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
        'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        `  printf '%s' '${authMeResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200" ]]; then',
        `  printf '%s' '${syncHistoryResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `if [[ "\${url}" == *"/api/admin/audit/events?action=oauth.alert.alertmanager.sync&keyword=${runTag}"* ]]; then`,
        `  printf '%s' '${auditResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `printf '%s' '${unknownResponse}' > "\${output_file}"`,
        "printf '500'",
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "release_window_oauth_alerts.sh"),
          "--base-url",
          "https://core.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--owner-user",
          "release-owner",
          "--owner-role",
          "owner",
          "--auditor-user",
          "release-auditor",
          "--auditor-role",
          "auditor",
          "--warning-secret-ref",
          "tokenpulse/prod/warning",
          "--critical-secret-ref",
          "tokenpulse/prod/critical",
          "--p1-secret-ref",
          "tokenpulse/prod/p1",
          "--secret-helper",
          helperPath,
          "--run-tag",
          runTag,
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(evidence.historyId).toBe("history-target-fallback");
      expect(evidence.traceId).toBe("trace-history-only-001");
      expect(evidence.incidentId).toBeNull();
      expect(evidence.incidentCreatedAt).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在双 Cookie 模式下应允许省略 owner/auditor 头部身份并写入 authMode", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-cookie-runtime-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "cookie-run-001";

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeExecutable(
      fakeBashPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'script="${1:-}"',
        `log_file="${fakeBashLog}"`,
        'if [[ "${script}" == *"/publish_alertmanager_secret_sync.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 0",
        "fi",
        'if [[ "${script}" == *"/drill_oauth_alert_escalation.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 11",
        "fi",
        'exec /bin/bash "$@"',
        "",
      ].join("\n"),
    );

    const authMeResponse = JSON.stringify({ authenticated: true, roleKey: "auditor" });
    const syncHistoryResponse = JSON.stringify({
      data: [
        {
          historyId: "history-cookie",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T04:35:00Z",
          traceId: "trace-history-cookie",
        },
      ],
    });
    const incidentsResponse = JSON.stringify({
      data: [
        {
          id: 301,
          incidentId: "incident:cookie-window:anchor",
          createdAt: 1_778_139_420_000,
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [{ traceId: "trace-cookie-sync-001" }] });
    const unknownResponse = JSON.stringify({ error: "unexpected fake curl url" });

    writeExecutable(
      fakeCurlPath,
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
        '    --write-out|--request|--data|--header|--connect-timeout|--max-time)',
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
        'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        `  printf '%s' '${authMeResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200" ]]; then',
        `  printf '%s' '${syncHistoryResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/incidents?severity=critical&from="* ]]; then',
        `  printf '%s' '${incidentsResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `if [[ "\${url}" == *"/api/admin/audit/events?action=oauth.alert.alertmanager.sync&keyword=${runTag}"* ]]; then`,
        `  printf '%s' '${auditResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `printf '%s' '${unknownResponse}' > "\${output_file}"`,
        "printf '500'",
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "release_window_oauth_alerts.sh"),
          "--base-url",
          "https://core.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--owner-cookie",
          "tp_admin_session=owner-session",
          "--auditor-cookie",
          "tp_admin_session=auditor-session",
          "--warning-secret-ref",
          "tokenpulse/prod/warning",
          "--critical-secret-ref",
          "tokenpulse/prod/critical",
          "--p1-secret-ref",
          "tokenpulse/prod/p1",
          "--secret-helper",
          helperPath,
          "--run-tag",
          runTag,
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(evidence.owner.authMode).toBe("cookie");
      expect(evidence.owner.user).toBeNull();
      expect(evidence.owner.role).toBeNull();
      expect(evidence.auditor.authMode).toBe("cookie");
      expect(evidence.traceId).toBe("trace-cookie-sync-001");
      expect(evidence.drillExitCode).toBe(11);
      expect(evidence.incidentId).toBe("incident:cookie-window:anchor");
      expect(evidence.incidentCreatedAt).toBe(1_778_139_420_000);

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("--cookie tp_admin_session=owner-session");
      expect(bashLog).not.toContain("--admin-user");
      expect(bashLog).not.toContain("--admin-role");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在 with-rollback=true 且 rollback 成功时应零退出并写入回滚证据", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-rollback-success-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "rollback-success-run-001";

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeExecutable(
      fakeBashPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'script="${1:-}"',
        `log_file="${fakeBashLog}"`,
        'if [[ "${script}" == *"/publish_alertmanager_secret_sync.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 0",
        "fi",
        'if [[ "${script}" == *"/drill_oauth_alert_escalation.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 0",
        "fi",
        'exec /bin/bash "$@"',
        "",
      ].join("\n"),
    );

    const syncHistoryResponse = JSON.stringify({
      data: [
        {
          historyId: "history-target-rollback-success",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T05:15:00Z",
          traceId: "trace-history-rollback-success",
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [{ traceId: "trace-sync-rollback-success-001" }] });
    const rollbackSuccessResponse = JSON.stringify({
      success: true,
      data: {
        sourceHistoryId: "history-target-rollback-success",
      },
      traceId: "trace-rollback-success-001",
    });
    const unknownResponse = JSON.stringify({ error: "unexpected fake curl url" });

    writeExecutable(
      fakeCurlPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_file="${fakeCurlLog}"`,
        'output_file=""',
        'url=""',
        'request_method="GET"',
        'role_key=""',
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
        '      if [[ "$2" == x-admin-role:* ]]; then',
        '        role_key="${2#x-admin-role: }"',
        '      fi',
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
        'printf "%s %s role=%s\\n" "${request_method}" "${url}" "${role_key}" >> "${log_file}"',
        'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'{"authenticated":true,"roleKey":"%s"}\' "${role_key}" > "${output_file}"',
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200" ]]; then',
        `  printf '%s' '${syncHistoryResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `if [[ "\${url}" == *"/api/admin/audit/events?action=oauth.alert.alertmanager.sync&keyword=${runTag}"* ]]; then`,
        `  printf '%s' '${auditResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync-history/history-target-rollback-success/rollback" ]]; then',
        `  printf '%s' '${rollbackSuccessResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `printf '%s' '${unknownResponse}' > "\${output_file}"`,
        "printf '500'",
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "release_window_oauth_alerts.sh"),
          "--base-url",
          "https://core.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--owner-user",
          "release-owner",
          "--owner-role",
          "owner",
          "--auditor-user",
          "release-auditor",
          "--auditor-role",
          "auditor",
          "--warning-secret-ref",
          "tokenpulse/prod/warning",
          "--critical-secret-ref",
          "tokenpulse/prod/critical",
          "--p1-secret-ref",
          "tokenpulse/prod/p1",
          "--secret-helper",
          helperPath,
          "--run-tag",
          runTag,
          "--with-rollback",
          "true",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("生产窗口编排完成");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(evidence.historyId).toBe("history-target-rollback-success");
      expect(evidence.historyReason).toBe(`release window sync ${runTag}`);
      expect(evidence.traceId).toBe("trace-rollback-success-001");
      expect(evidence.drillExitCode).toBe(0);
      expect(evidence.rollbackResult).toBe("success");
      expect(evidence.rollbackHttpCode).toBe(200);
      expect(evidence.rollbackTraceId).toBe("trace-rollback-success-001");
      expect(evidence.rollbackError).toBeNull();
      expect(evidence.incidentId).toBeNull();
      expect(evidence.incidentCreatedAt).toBeNull();

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain(
        "POST https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync-history/history-target-rollback-success/rollback role=owner",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在 with-rollback=true 且 rollback 失败时应非零退出并写入失败证据", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-rollback-failure-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "rollback-failure-run-001";

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeExecutable(
      fakeBashPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'script="${1:-}"',
        `log_file="${fakeBashLog}"`,
        'if [[ "${script}" == *"/publish_alertmanager_secret_sync.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 0",
        "fi",
        'if [[ "${script}" == *"/drill_oauth_alert_escalation.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 15",
        "fi",
        'exec /bin/bash "$@"',
        "",
      ].join("\n"),
    );

    const syncHistoryResponse = JSON.stringify({
      data: [
        {
          historyId: "history-target-rollback-failed",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T05:35:00Z",
          traceId: "trace-history-rollback-failed",
        },
      ],
    });
    const incidentsResponse = JSON.stringify({
      data: [
        {
          id: 401,
          incidentId: "incident:rollback-window:anchor",
          createdAt: 1_778_142_420_000,
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [{ traceId: "trace-sync-rollback-001" }] });
    const rollbackFailureResponse = JSON.stringify({
      error: "rollback downstream failed",
      traceId: "trace-rollback-failed-001",
    });
    const unknownResponse = JSON.stringify({ error: "unexpected fake curl url" });

    writeExecutable(
      fakeCurlPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_file="${fakeCurlLog}"`,
        'output_file=""',
        'url=""',
        'request_method="GET"',
        'role_key=""',
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
        '      if [[ "$2" == x-admin-role:* ]]; then',
        '        role_key="${2#x-admin-role: }"',
        '      fi',
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
        'printf "%s %s role=%s\\n" "${request_method}" "${url}" "${role_key}" >> "${log_file}"',
        'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
        '  printf \'{"authenticated":true,"roleKey":"%s"}\' "${role_key}" > "${output_file}"',
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200" ]]; then',
        `  printf '%s' '${syncHistoryResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/incidents?severity=critical&from="* ]]; then',
        `  printf '%s' '${incidentsResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        `if [[ "\${url}" == *"/api/admin/audit/events?action=oauth.alert.alertmanager.sync&keyword=${runTag}"* ]]; then`,
        `  printf '%s' '${auditResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync-history/history-target-rollback-failed/rollback" ]]; then',
        `  printf '%s' '${rollbackFailureResponse}' > "\${output_file}"`,
        "  printf '500'",
        "  exit 0",
        "fi",
        `printf '%s' '${unknownResponse}' > "\${output_file}"`,
        "printf '500'",
        "",
      ].join("\n"),
    );

    try {
      const result = runShell(
        [
          "/bin/bash",
          join(scriptsDir, "release_window_oauth_alerts.sh"),
          "--base-url",
          "https://core.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--owner-user",
          "release-owner",
          "--owner-role",
          "owner",
          "--auditor-user",
          "release-auditor",
          "--auditor-role",
          "auditor",
          "--warning-secret-ref",
          "tokenpulse/prod/warning",
          "--critical-secret-ref",
          "tokenpulse/prod/critical",
          "--p1-secret-ref",
          "tokenpulse/prod/p1",
          "--secret-helper",
          helperPath,
          "--run-tag",
          runTag,
          "--with-rollback",
          "true",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("rollback 执行失败（http_code=500）: rollback downstream failed");
      expect(`${result.stdout}\n${result.stderr}`).toContain("生产窗口编排完成，但 rollback 失败（rollbackResult=failure）");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(evidence.historyId).toBe("history-target-rollback-failed");
      expect(evidence.historyReason).toBe(`release window sync ${runTag}`);
      expect(evidence.traceId).toBe("trace-rollback-failed-001");
      expect(evidence.drillExitCode).toBe(15);
      expect(evidence.rollbackResult).toBe("failure");
      expect(evidence.rollbackHttpCode).toBe(500);
      expect(evidence.rollbackTraceId).toBe("trace-rollback-failed-001");
      expect(evidence.rollbackError).toBe("rollback downstream failed");
      expect(evidence.incidentId).toBe("incident:rollback-window:anchor");
      expect(evidence.incidentCreatedAt).toBe(1_778_142_420_000);

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain(
        "POST https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync-history/history-target-rollback-failed/rollback role=owner",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
