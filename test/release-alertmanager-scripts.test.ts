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

interface FakeCurlResponse {
  status: number;
  body: string;
}

interface FakeCurlLogEntry {
  method: string;
  url: string;
  data: string;
  headers: string[];
}

function writeFakePublishCurl(
  filePath: string,
  logFile: string,
  responses: {
    authMe: FakeCurlResponse;
    config: FakeCurlResponse;
    sync: FakeCurlResponse;
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
      'method="GET"',
      'data=""',
      'headers_joined=""',
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
      '    --header)',
      '      headers_joined="${headers_joined}${headers_joined:+||}$2"',
      '      shift 2',
      '      ;;',
      '    --connect-timeout|--max-time)',
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
      'printf "%s\\t%s\\t%s\\t%s\\n" "${method}" "${url}" "${data}" "${headers_joined}" >> "${log_file}"',
      'if [[ -z "${output_file}" ]]; then',
      '  echo "missing --output" >&2',
      '  exit 1',
      'fi',
      'if [[ "${url}" == *"/api/admin/auth/me" ]]; then',
      `  printf '%s' '${responses.authMe.body}' > "\${output_file}"`,
      `  printf '${responses.authMe.status}'`,
      "  exit 0",
      "fi",
      'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/config" ]]; then',
      `  printf '%s' '${responses.config.body}' > "\${output_file}"`,
      `  printf '${responses.config.status}'`,
      "  exit 0",
      "fi",
      'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/alertmanager/sync" ]]; then',
      `  printf '%s' '${responses.sync.body}' > "\${output_file}"`,
      `  printf '${responses.sync.status}'`,
      "  exit 0",
      "fi",
      `printf '%s' '{"error":"unexpected fake curl url"}' > "\${output_file}"`,
      "printf '500'",
      "",
    ].join("\n"),
  );
}

function readFakeCurlLog(logFile: string): FakeCurlLogEntry[] {
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [method = "", url = "", data = "", headersField = ""] = line.split("\t");
      return {
        method,
        url,
        data,
        headers: headersField ? headersField.split("||").filter(Boolean) : [],
      };
    });
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

function buildPublishedConfigFromBaseline(urls: Record<string, string>) {
  const baseline = structuredClone(
    Bun.YAML.parse(readFileSync(join(monitoringDir, "alertmanager.yml"), "utf8")),
  ) as {
    receivers?: Array<{
      name?: string;
      webhook_configs?: Array<{ url?: string; send_resolved?: boolean }>;
    }>;
  };

  const expectedReceivers = new Set(["warning-webhook", "critical-webhook", "p1-webhook"]);
  for (const receiver of baseline.receivers || []) {
    if (!receiver?.name || !expectedReceivers.has(receiver.name)) {
      continue;
    }

    const targetUrl = urls[receiver.name];
    receiver.webhook_configs = (receiver.webhook_configs || []).map((item) => ({
      ...item,
      url: targetUrl,
    }));
    expectedReceivers.delete(receiver.name);
  }

  expect([...expectedReceivers]).toEqual([]);
  return baseline;
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

    const primaryBaseline = readFileSync(join(monitoringDir, "alertmanager.yml"), "utf8");
    expect(primaryBaseline).toContain("/etc/alertmanager/templates/*.tmpl");
  });

  it("TokenPulse Alertmanager 模板应展示 AgentLedger 告警分类与细节", () => {
    const templateContent = readFileSync(
      join(monitoringDir, "alertmanager-templates", "tokenpulse.tmpl"),
      "utf8",
    );
    expect(templateContent).toContain("category={{ .CommonLabels.category }}");
    expect(templateContent).toContain("escalation={{ .CommonLabels.escalation }}");
    expect(templateContent).toContain("details: {{ .Annotations.details }}");

    const ruleContent = readFileSync(join(monitoringDir, "alert_rules.yml"), "utf8");
    expect(ruleContent).toContain('alert: "TokenPulseAgentLedgerDeliveryNotConfigured"');
    expect(ruleContent).toContain('alert: "TokenPulseAgentLedgerWorkerStale"');
    expect(ruleContent).toContain('alert: "TokenPulseAgentLedgerOpenBacklogStale"');
    expect(ruleContent).toContain('alert: "TokenPulseAgentLedgerReplayRequiredBacklog"');
    expect(ruleContent).toContain("delivery_configured=0");
    expect(ruleContent).toContain("last_cycle_stale_seconds={{ $value }}");
    expect(ruleContent).toContain("oldest_open_backlog_age_seconds={{ $value }}");
    expect(ruleContent).toContain("replay_required_count={{ $value }}");
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

  it("preflight_alertmanager_config.sh 应拒绝缺少 templates 引用的配置", () => {
    const fixture = createRuntimeAlertmanagerFixture();

    writeFileSync(
      fixture.configPath,
      [
        "global:",
        "  resolve_timeout: 5m",
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
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("未声明任何 templates 引用");
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

  it("preflight_alertmanager_config.sh 应拒绝 example.local 与占位 webhook URL", () => {
    const fixture = createRuntimeAlertmanagerFixture();

    writeFileSync(
      fixture.configPath,
      [
        "global:",
        "  resolve_timeout: 5m",
        "",
        "templates:",
        "  - /etc/alertmanager/templates/*.tmpl",
        "",
        "route:",
        '  receiver: "warning-webhook"',
        "",
        "receivers:",
        '  - name: "warning-webhook"',
        "    webhook_configs:",
        '      - url: "https://hooks.example.local/REPLACE_ME"',
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
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("example.local");
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("占位 webhook URL");
    } finally {
      fixture.cleanup();
    }
  });

  it("preflight_alertmanager_config.sh 不应误拦合法域名与路径中的普通 todo 字样", () => {
    const fixture = createRuntimeAlertmanagerFixture();

    writeFileSync(
      fixture.configPath,
      [
        "global:",
        "  resolve_timeout: 5m",
        "",
        "templates:",
        "  - /etc/alertmanager/templates/*.tmpl",
        "",
        "route:",
        '  receiver: "warning-webhook"',
        "",
        "receivers:",
        '  - name: "warning-webhook"',
        "    webhook_configs:",
        '      - url: "https://hooks.auth-myexample.com/path/todo-123"',
        "        send_resolved: true",
        "",
      ].join("\n"),
    );

    try {
      const valid = runShell([
        "bash",
        join(scriptsDir, "preflight_alertmanager_config.sh"),
        "--config-path",
        fixture.configPath,
        "--templates-path",
        fixture.templatesDir,
      ]);
      expect(valid.exitCode).toBe(0);
      expect(`${valid.stdout}\n${valid.stderr}`).not.toContain("示例域名");
      expect(`${valid.stdout}\n${valid.stderr}`).not.toContain("占位 webhook URL");
    } finally {
      fixture.cleanup();
    }
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
        `ALERTMANAGER_CONFIG_TEMPLATE_PATH="${fixture.configPath}"`,
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
      expect(valid.stdout).toContain('--config-template "${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-./monitoring/alertmanager.yml}"');
      expect(valid.stdout).toContain('--secret-helper "${RW_SECRET_HELPER}"');
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preflight_release_window_oauth_alerts.sh 默认应使用 monitoring/alertmanager.yml 渲染后预检", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-default-template-"));
    const envFile = join(tempDir, "default-template.env");
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
      envFile,
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
        "",
      ].join("\n"),
    );

    try {
      const result = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        envFile,
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Alertmanager 发布基线已就绪");
      expect(result.stdout).toContain('--config-template "${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-./monitoring/alertmanager.yml}"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preflight_release_window_oauth_alerts.sh 应拒绝 warning/critical/p1 复用同一 Secret 引用名", () => {
    const fixture = createRuntimeAlertmanagerFixture();
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-dup-secret-ref-"));
    const envFile = join(tempDir, "dup-secret-ref.env");
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
      envFile,
      [
        'RW_BASE_URL="https://core.tokenpulse.test"',
        'RW_API_SECRET="tokenpulse-secret"',
        'RW_OWNER_USER="release-owner"',
        'RW_OWNER_ROLE="owner"',
        'RW_AUDITOR_USER="release-auditor"',
        'RW_AUDITOR_ROLE="auditor"',
        'RW_WARNING_SECRET_REF="tokenpulse/prod/shared"',
        'RW_CRITICAL_SECRET_REF="tokenpulse/prod/shared"',
        'RW_P1_SECRET_REF="tokenpulse/prod/p1"',
        `RW_SECRET_HELPER="${helperPath}"`,
        `ALERTMANAGER_CONFIG_TEMPLATE_PATH="${fixture.configPath}"`,
        `ALERTMANAGER_TEMPLATES_PATH="${fixture.templatesDir}"`,
        "",
      ].join("\n"),
    );

    try {
      const result = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        envFile,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("禁止复用同一 Secret 引用名");
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
        `ALERTMANAGER_CONFIG_TEMPLATE_PATH="${fixture.configPath}"`,
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

  it("preflight_release_window_oauth_alerts.sh 在启用 compat 但缺少 RW_PROMETHEUS_URL 时应失败", () => {
    const fixture = createRuntimeAlertmanagerFixture();
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-compat-preflight-"));
    const envFile = join(tempDir, "compat.env");
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
      envFile,
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
        'RW_WITH_COMPAT="observe"',
        'RW_COMPAT_CRITICAL_AFTER="2026-07-01"',
        'RW_COMPAT_SHOW_LIMIT="10"',
        `ALERTMANAGER_CONFIG_TEMPLATE_PATH="${fixture.configPath}"`,
        `ALERTMANAGER_TEMPLATES_PATH="${fixture.templatesDir}"`,
        "",
      ].join("\n"),
    );

    try {
      const result = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        envFile,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("RW_PROMETHEUS_URL");
      expect(`${result.stdout}\n${result.stderr}`).toContain("启用 compat 时必填");
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preflight_release_window_oauth_alerts.sh 应拒绝示例域名 RW_BASE_URL", () => {
    const fixture = createRuntimeAlertmanagerFixture();
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-base-url-"));
    const envFile = join(tempDir, "invalid-base-url.env");
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
      envFile,
      [
        'RW_BASE_URL="https://core.example.local"',
        'RW_API_SECRET="tokenpulse-secret"',
        'RW_OWNER_USER="release-owner"',
        'RW_OWNER_ROLE="owner"',
        'RW_AUDITOR_USER="release-auditor"',
        'RW_AUDITOR_ROLE="auditor"',
        'RW_WARNING_SECRET_REF="tokenpulse/prod/warning"',
        'RW_CRITICAL_SECRET_REF="tokenpulse/prod/critical"',
        'RW_P1_SECRET_REF="tokenpulse/prod/p1"',
        `RW_SECRET_HELPER="${helperPath}"`,
        `ALERTMANAGER_CONFIG_TEMPLATE_PATH="${fixture.configPath}"`,
        `ALERTMANAGER_TEMPLATES_PATH="${fixture.templatesDir}"`,
        "",
      ].join("\n"),
    );

    try {
      const result = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        envFile,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("RW_BASE_URL");
      expect(`${result.stdout}\n${result.stderr}`).toContain("示例域名");
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preflight_release_window_oauth_alerts.sh 不应误拦包含 example.com 子串的合法 RW_BASE_URL", () => {
    const fixture = createRuntimeAlertmanagerFixture();
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-valid-base-url-"));
    const envFile = join(tempDir, "valid-base-url.env");
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
      envFile,
      [
        'RW_BASE_URL="https://auth-myexample.com"',
        'RW_API_SECRET="tokenpulse-secret"',
        'RW_OWNER_USER="release-owner"',
        'RW_OWNER_ROLE="owner"',
        'RW_AUDITOR_USER="release-auditor"',
        'RW_AUDITOR_ROLE="auditor"',
        'RW_WARNING_SECRET_REF="tokenpulse/prod/warning"',
        'RW_CRITICAL_SECRET_REF="tokenpulse/prod/critical"',
        'RW_P1_SECRET_REF="tokenpulse/prod/p1"',
        `RW_SECRET_HELPER="${helperPath}"`,
        `ALERTMANAGER_CONFIG_TEMPLATE_PATH="${fixture.configPath}"`,
        `ALERTMANAGER_TEMPLATES_PATH="${fixture.templatesDir}"`,
        "",
      ].join("\n"),
    );

    try {
      const result = runShell([
        "bash",
        join(scriptsDir, "preflight_release_window_oauth_alerts.sh"),
        "--env-file",
        envFile,
      ]);
      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("示例域名");
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

  it("publish_alertmanager_secret_sync.sh 应在联网前拒绝占位 webhook URL", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-placeholder-"));
    const helperPath = join(tempDir, "secret-helper.sh");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/REPLACE_ME/%s" "$1"',
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
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("占位 webhook 标记");
      expect(`${invalid.stdout}\n${invalid.stderr}`).not.toContain("管理员身份预检");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应在联网前拒绝 REPLACE_WITH 类占位 webhook URL", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-replace-with-"));
    const helperPath = join(tempDir, "secret-helper.sh");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/REPLACE_WITH/%s" "$1"',
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
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("占位 webhook 标记");
      expect(`${invalid.stdout}\n${invalid.stderr}`).not.toContain("管理员身份预检");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 不应误拦合法 webhook URL 中的普通 todo 字样", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-valid-todo-"));
    const helperPath = join(tempDir, "secret-helper.sh");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/path/todo-123/%s" "$1"',
        "",
      ].join("\n"),
    );

    try {
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
        "--secret-helper",
        helperPath,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("占位 webhook 标记");
      expect(`${result.stdout}\n${result.stderr}`).toContain("管理员身份预检");
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

  it("publish_alertmanager_secret_sync.sh 在 render-only 模式下应先做本地预检，且可离线运行", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-render-only-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const renderOutput = join(tempDir, "rendered-alertmanager.yml");

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    try {
      const rendered = runShell([
        "bash",
        join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
        "--warning-secret-ref",
        "tokenpulse/prod/warning",
        "--critical-secret-ref",
        "tokenpulse/prod/critical",
        "--p1-secret-ref",
        "tokenpulse/prod/p1",
        "--secret-helper",
        helperPath,
        "--render-only",
        "--render-output",
        renderOutput,
      ]);
      expect(rendered.exitCode).toBe(0);
      expect(`${rendered.stdout}\n${rendered.stderr}`).not.toContain("缺少 --api-secret");
      expect(`${rendered.stdout}\n${rendered.stderr}`).toContain("render-only 完成");
      const renderedYaml = readFileSync(renderOutput, "utf8");
      expect(renderedYaml).toContain("https://hooks.tokenpulse.test/tokenpulse/prod/warning");
      expect(renderedYaml).toContain("/etc/alertmanager/templates/*.tmpl");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应在联网前拒绝渲染后缺少可用模板的配置", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-preflight-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const emptyTemplatesDir = join(tempDir, "templates-empty");
    mkdirSync(emptyTemplatesDir, { recursive: true });

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    try {
      const invalid = runShell([
        "bash",
        join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
        "--warning-secret-ref",
        "tokenpulse/prod/warning",
        "--critical-secret-ref",
        "tokenpulse/prod/critical",
        "--p1-secret-ref",
        "tokenpulse/prod/p1",
        "--secret-helper",
        helperPath,
        "--templates-path",
        emptyTemplatesDir,
        "--render-only",
      ]);
      expect(invalid.exitCode).not.toBe(0);
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("本地预检失败");
      expect(`${invalid.stdout}\n${invalid.stderr}`).toContain("templates 引用未命中任何文件");
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

    writeFakePublishCurl(
      fakeCurlPath,
      fakeCurlLog,
      {
        authMe: { status: 200, body: authMeResponse },
        config: { status: 200, body: successResponse },
        sync: { status: 200, body: successResponse },
      },
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

      const curlLog = readFakeCurlLog(fakeCurlLog);

      expect(curlLog).toHaveLength(3);
      expect(curlLog.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET https://core.tokenpulse.test/api/admin/auth/me",
        "PUT https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/config",
        "POST https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync",
      ]);

      const configPayload = JSON.parse(curlLog[1]?.data || "{}");
      const expectedConfig = buildPublishedConfigFromBaseline({
        "warning-webhook": "https://hooks.tokenpulse.test/tokenpulse/prod/warning",
        "critical-webhook": "https://hooks.tokenpulse.test/tokenpulse/prod/critical",
        "p1-webhook": "https://hooks.tokenpulse.test/tokenpulse/prod/p1",
      });

      expect(configPayload.comment).toBe(comment);
      expect(configPayload.config).toEqual(expectedConfig);

      const syncPayload = JSON.parse(curlLog[2]?.data || "{}");
      expect(syncPayload).toEqual({
        reason: syncReason,
        comment,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 在 cookie 模式下应只使用 Cookie 身份并完成发布", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-cookie-path-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const cookie = "tp_admin_session=owner-session";

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeFakePublishCurl(fakeCurlPath, fakeCurlLog, {
      authMe: {
        status: 200,
        body: JSON.stringify({ authenticated: true, roleKey: "owner" }),
      },
      config: {
        status: 200,
        body: JSON.stringify({ success: true }),
      },
      sync: {
        status: 200,
        body: JSON.stringify({ success: true }),
      },
    });

    try {
      const result = runShell(
        [
          "bash",
          join(scriptsDir, "publish_alertmanager_secret_sync.sh"),
          "--base-url",
          "https://core.tokenpulse.test",
          "--api-secret",
          "tokenpulse-secret",
          "--cookie",
          cookie,
          "--warning-secret-ref",
          "tokenpulse/prod/warning",
          "--critical-secret-ref",
          "tokenpulse/prod/critical",
          "--p1-secret-ref",
          "tokenpulse/prod/p1",
          "--secret-helper",
          helperPath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      const curlLog = readFakeCurlLog(fakeCurlLog);
      expect(curlLog).toHaveLength(3);
      expect(curlLog.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET https://core.tokenpulse.test/api/admin/auth/me",
        "PUT https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/config",
        "POST https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync",
      ]);

      for (const entry of curlLog) {
        expect(entry.headers).toContain("Authorization: Bearer tokenpulse-secret");
        expect(entry.headers).toContain(`Cookie: ${cookie}`);
        expect(entry.headers.some((item) => item.startsWith("x-admin-user:"))).toBe(false);
        expect(entry.headers.some((item) => item.startsWith("x-admin-role:"))).toBe(false);
        expect(entry.headers.some((item) => item.startsWith("x-admin-tenant:"))).toBe(false);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 在配置更新失败时应立即中断并透出响应体", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-config-fail-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const configError = JSON.stringify({ error: "config rejected", traceId: "trace-config-001" });

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeFakePublishCurl(fakeCurlPath, fakeCurlLog, {
      authMe: {
        status: 200,
        body: JSON.stringify({ authenticated: true, roleKey: "owner" }),
      },
      config: {
        status: 500,
        body: configError,
      },
      sync: {
        status: 200,
        body: JSON.stringify({ success: true }),
      },
    });

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
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Alertmanager 配置更新 失败");
      expect(`${result.stdout}\n${result.stderr}`).toContain("config rejected");

      const curlLog = readFakeCurlLog(fakeCurlLog);
      expect(curlLog.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET https://core.tokenpulse.test/api/admin/auth/me",
        "PUT https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/config",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 在同步失败时应透出响应体", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-sync-fail-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const syncError = JSON.stringify({ error: "sync rejected", traceId: "trace-sync-001" });

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeFakePublishCurl(fakeCurlPath, fakeCurlLog, {
      authMe: {
        status: 200,
        body: JSON.stringify({ authenticated: true, roleKey: "owner" }),
      },
      config: {
        status: 200,
        body: JSON.stringify({ success: true }),
      },
      sync: {
        status: 500,
        body: syncError,
      },
    });

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
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Alertmanager 同步 失败");
      expect(`${result.stdout}\n${result.stderr}`).toContain("sync rejected");

      const curlLog = readFakeCurlLog(fakeCurlLog);
      expect(curlLog.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET https://core.tokenpulse.test/api/admin/auth/me",
        "PUT https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/config",
        "POST https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应拒绝 success=false 的配置更新响应", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-config-response-invalid-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const configResponse = JSON.stringify({ success: false, error: "config body rejected" });

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeFakePublishCurl(fakeCurlPath, fakeCurlLog, {
      authMe: {
        status: 200,
        body: JSON.stringify({ authenticated: true, roleKey: "owner" }),
      },
      config: {
        status: 200,
        body: configResponse,
      },
      sync: {
        status: 200,
        body: JSON.stringify({ success: true }),
      },
    });

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
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Alertmanager 配置更新响应异常");
      expect(`${result.stdout}\n${result.stderr}`).toContain("config body rejected");

      const curlLog = readFakeCurlLog(fakeCurlLog);
      expect(curlLog.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET https://core.tokenpulse.test/api/admin/auth/me",
        "PUT https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/config",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("publish_alertmanager_secret_sync.sh 应拒绝缺少 success=true 的同步响应", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-secret-helper-sync-response-invalid-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const syncResponse = JSON.stringify({ data: { synced: true } });

    writeExecutable(
      helperPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'printf "https://hooks.tokenpulse.test/%s" "$1"',
        "",
      ].join("\n"),
    );

    writeFakePublishCurl(fakeCurlPath, fakeCurlLog, {
      authMe: {
        status: 200,
        body: JSON.stringify({ authenticated: true, roleKey: "owner" }),
      },
      config: {
        status: 200,
        body: JSON.stringify({ success: true }),
      },
      sync: {
        status: 200,
        body: syncResponse,
      },
    });

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
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("Alertmanager 同步响应异常");
      expect(`${result.stdout}\n${result.stderr}`).toContain('"synced":true');

      const curlLog = readFakeCurlLog(fakeCurlLog);
      expect(curlLog.map((item) => `${item.method} ${item.url}`)).toEqual([
        "GET https://core.tokenpulse.test/api/admin/auth/me",
        "PUT https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/config",
        "POST https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync",
      ]);
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

  it("publish_alertmanager_secret_sync.sh 应在联网前拒绝 warning/critical/p1 复用同一 Secret 引用名", () => {
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
      "tokenpulse/prod/shared",
      "--critical-secret-ref",
      "tokenpulse/prod/shared",
      "--p1-secret-ref",
      "tokenpulse/prod/p1",
      "--secret-cmd-template",
      "printf https://hooks.tokenpulse.test/%s",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("必须彼此不同");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("管理员身份预检");
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
      expect(bashLog).toContain("--config-template");
      expect(bashLog).toContain("./monitoring/alertmanager.yml");
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

  it("release_window_oauth_alerts.sh 在 publish 子脚本失败时应立即中断", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-publish-failed-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");

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
        '  echo "mock publish failed" >&2',
        "  exit 23",
        "fi",
        'if [[ "${script}" == *"/drill_oauth_alert_escalation.sh" ]]; then',
        '  printf "%s\\n" "$*" >> "${log_file}"',
        "  exit 0",
        "fi",
        'exec /bin/bash "$@"',
        "",
      ].join("\n"),
    );

    writeExecutable(
      fakeCurlPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_file="${fakeCurlLog}"`,
        'printf "%s\\n" "$*" >> "${log_file}"',
        'echo "curl should not be called" >&2',
        "exit 70",
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
          "publish-failed-run-001",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(23);
      expect(`${result.stdout}\n${result.stderr}`).toContain("mock publish failed");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("2/5 执行 OAuth 升级演练");

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).not.toContain("/drill_oauth_alert_escalation.sh");
      expect(() => readFileSync(fakeCurlLog, "utf8")).toThrow();
      expect(() => readFileSync(evidencePath, "utf8")).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在 sync-history 未命中 RUN_TAG 时应失败且不写证据", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-history-missing-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "history-missing-run-001";

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
          historyId: "history-other-1",
          reason: "release window sync other-run-1",
          outcome: "success",
          startedAt: "2026-03-06T06:15:00Z",
          traceId: "trace-history-other-1",
        },
        {
          historyId: "history-other-2",
          reason: "release window sync other-run-2",
          outcome: "success",
          startedAt: "2026-03-06T06:18:00Z",
          traceId: "trace-history-other-2",
        },
      ],
    });

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
        `printf '%s' '{"error":"unexpected fake curl url"}' > "\${output_file}"`,
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

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        `sync-history 未找到与本次 RUN_TAG 匹配的 historyId（run_tag=${runTag}`,
      );

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("GET https://core.tokenpulse.test/api/admin/auth/me role=auditor");
      expect(curlLog).toContain(
        "GET https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200 role=auditor",
      );
      expect(curlLog).not.toContain("/api/admin/audit/events");
      expect(() => readFileSync(evidencePath, "utf8")).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在 audit/events 查询失败时应失败且不写证据", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-audit-failure-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "audit-failed-run-001";

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

    const syncHistoryResponse = JSON.stringify({
      data: [
        {
          historyId: "history-target-audit-failed",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T06:25:00Z",
          traceId: "trace-history-audit-failed",
        },
      ],
    });
    const auditFailureResponse = JSON.stringify({ error: "audit search unavailable" });
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
        `  printf '%s' '${auditFailureResponse}' > "\${output_file}"`,
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
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("查询审计事件 失败，期望状态码 200，实际 500");

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("GET https://core.tokenpulse.test/api/admin/auth/me role=auditor");
      expect(curlLog).toContain(
        "GET https://core.tokenpulse.test/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200 role=auditor",
      );
      expect(curlLog).toContain("/api/admin/audit/events?action=oauth.alert.alertmanager.sync");
      expect(curlLog).not.toContain("/api/admin/observability/oauth-alerts/incidents?severity=critical");
      expect(curlLog).not.toContain("/rollback");
      expect(() => readFileSync(evidencePath, "utf8")).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在 incidents 查询失败时应失败且不写证据", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-incidents-failure-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "incidents-failed-run-001";

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
          historyId: "history-target-incidents-failed",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T06:35:00Z",
          traceId: "trace-history-incidents-failed",
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [{ traceId: "trace-sync-incidents-failed-001" }] });
    const incidentsFailureResponse = JSON.stringify({ error: "incident search unavailable" });
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
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/incidents?severity=critical&from="* ]]; then',
        `  printf '%s' '${incidentsFailureResponse}' > "\${output_file}"`,
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
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("查询 drill incidents 失败，期望状态码 200，实际 500");

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("/api/admin/audit/events?action=oauth.alert.alertmanager.sync");
      expect(curlLog).toContain("/api/admin/observability/oauth-alerts/incidents?severity=critical");
      expect(curlLog).not.toContain("/rollback");
      expect(() => readFileSync(evidencePath, "utf8")).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在 drill_exit_code=0 时不应查询 incidents", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-drill-clean-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "drill-clean-run-001";

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
          historyId: "history-target-drill-clean",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-06T06:45:00Z",
          traceId: "trace-history-drill-clean",
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [{ traceId: "trace-sync-drill-clean-001" }] });
    const unexpectedIncidentsResponse = JSON.stringify({ error: "incidents should not be queried" });
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
        'if [[ "${url}" == *"/api/admin/observability/oauth-alerts/incidents?severity=critical&from="* ]]; then',
        `  printf '%s' '${unexpectedIncidentsResponse}' > "\${output_file}"`,
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
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("drill 未命中升级，跳过 incident 证据补齐");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(evidence.historyId).toBe("history-target-drill-clean");
      expect(evidence.historyReason).toBe(`release window sync ${runTag}`);
      expect(evidence.traceId).toBe("trace-sync-drill-clean-001");
      expect(evidence.drillExitCode).toBe(0);
      expect(evidence.incidentId).toBeNull();
      expect(evidence.incidentCreatedAt).toBeNull();
      expect(evidence.rollbackResult).toBe("skip");

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("/api/admin/audit/events?action=oauth.alert.alertmanager.sync");
      expect(curlLog).not.toContain("/api/admin/observability/oauth-alerts/incidents?severity=critical");
      expect(curlLog).not.toContain("/rollback");
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

  it("release_window_oauth_alerts.sh 在 with-compat=observe 且 compat=0 时应成功并写入 compat 证据", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-compat-pass-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const runTag = "compat-pass-run-001";
    const compatZeroResponse = JSON.stringify({ status: "success", data: { result: [] } });
    const syncHistoryResponse = JSON.stringify({
      data: [
        {
          historyId: "history-target-compat-pass",
          reason: `release window sync ${runTag}`,
          outcome: "success",
          startedAt: "2026-03-07T01:15:00Z",
          traceId: "trace-history-compat-pass",
        },
      ],
    });
    const auditResponse = JSON.stringify({ data: [{ traceId: "trace-sync-compat-pass-001" }] });
    const unknownResponse = JSON.stringify({ error: "unexpected fake curl url" });

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
        'if [[ "${url}" == *"http://prometheus.tokenpulse.test/api/v1/query?query="*"%5B5m%5D"* ]]; then',
        `  printf '%s' '${compatZeroResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"http://prometheus.tokenpulse.test/api/v1/query?query="*"%5B24h%5D"* ]]; then',
        `  printf '%s' '${compatZeroResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
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
          "--with-compat",
          "observe",
          "--prometheus-url",
          "http://prometheus.tokenpulse.test",
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
      expect(`${result.stdout}\n${result.stderr}`).toContain("2.5/5 执行 compat 退场观测");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(evidence.historyId).toBe("history-target-compat-pass");
      expect(evidence.traceId).toBe("trace-sync-compat-pass-001");
      expect(evidence.compatCheckMode).toBe("observe");
      expect(evidence.compat5mHits).toBe(0);
      expect(evidence.compat24hHits).toBe(0);
      expect(evidence.compatGateResult).toBe("pass");
      expect(evidence.compatCheckedAt).toContain("T");

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("GET http://prometheus.tokenpulse.test/api/v1/query?query=");
      expect(curlLog.indexOf("http://prometheus.tokenpulse.test/api/v1/query?query=")).toBeLessThan(
        curlLog.indexOf("/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200"),
      );
      expect(curlLog).not.toContain("/api/admin/observability/oauth-alerts/incidents?severity=critical");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("release_window_oauth_alerts.sh 在 with-compat=strict 且 compat>0 时应失败且不写证据", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tokenpulse-release-window-compat-strict-"));
    const helperPath = join(tempDir, "secret-helper.sh");
    const fakeBashPath = join(tempDir, "bash");
    const fakeCurlPath = join(tempDir, "curl");
    const fakeBashLog = join(tempDir, "fake-bash.log");
    const fakeCurlLog = join(tempDir, "fake-curl.log");
    const evidencePath = join(tempDir, "evidence.json");
    const compat5mResponse = JSON.stringify({
      status: "success",
      data: {
        result: [
          {
            metric: { method: "GET", route: "/api/admin/oauth/alerts/legacy" },
            value: [1_778_200_000, "1"],
          },
        ],
      },
    });
    const compat24hResponse = JSON.stringify({
      status: "success",
      data: {
        result: [
          {
            metric: { method: "POST", route: "/api/admin/oauth/alertmanager/sync" },
            value: [1_778_200_000, "4"],
          },
        ],
      },
    });
    const unknownResponse = JSON.stringify({ error: "unexpected fake curl url" });

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

    writeExecutable(
      fakeCurlPath,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        `log_file="${fakeCurlLog}"`,
        'output_file=""',
        'url=""',
        'request_method="GET"',
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
        'printf "%s %s\\n" "${request_method}" "${url}" >> "${log_file}"',
        'if [[ "${url}" == *"http://prometheus.tokenpulse.test/api/v1/query?query="*"%5B5m%5D"* ]]; then',
        `  printf '%s' '${compat5mResponse}' > "\${output_file}"`,
        "  printf '200'",
        "  exit 0",
        "fi",
        'if [[ "${url}" == *"http://prometheus.tokenpulse.test/api/v1/query?query="*"%5B24h%5D"* ]]; then',
        `  printf '%s' '${compat24hResponse}' > "\${output_file}"`,
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
          "--with-compat",
          "strict",
          "--prometheus-url",
          "http://prometheus.tokenpulse.test",
          "--run-tag",
          "compat-strict-run-001",
          "--evidence-file",
          evidencePath,
        ],
        {
          PATH: `${tempDir}:${process.env.PATH || ""}`,
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("strict 模式阻断继续发布");
      expect(`${result.stdout}\n${result.stderr}`).toContain("compat 退场观测失败");

      const bashLog = readFileSync(fakeBashLog, "utf8");
      expect(bashLog).toContain("/publish_alertmanager_secret_sync.sh");
      expect(bashLog).toContain("/drill_oauth_alert_escalation.sh");

      const curlLog = readFileSync(fakeCurlLog, "utf8");
      expect(curlLog).toContain("http://prometheus.tokenpulse.test/api/v1/query?query=");
      expect(curlLog).not.toContain("/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200");
      expect(curlLog).not.toContain("/api/admin/audit/events");
      expect(curlLog).not.toContain("/api/admin/observability/oauth-alerts/incidents?severity=critical");
      expect(curlLog).not.toContain("/rollback");
      expect(() => readFileSync(evidencePath, "utf8")).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
