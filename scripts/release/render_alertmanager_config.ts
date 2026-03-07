#!/usr/bin/env bun

type JsonRecord = Record<string, unknown>;
type JsonArray = unknown[];

interface CliArgs {
  templatePath: string;
  outputFormat: "json" | "yaml";
  warningWebhookUrl: string;
  criticalWebhookUrl: string;
  p1WebhookUrl: string;
}

function usage() {
  process.stdout.write(`Alertmanager 基线渲染器

用法:
  bun scripts/release/render_alertmanager_config.ts [参数]

参数:
  --template-path <path>          Alertmanager 基线文件路径
  --output-format <json|yaml>     输出格式，默认: json
  --warning-webhook-url <url>     warning-webhook 的实际 URL
  --critical-webhook-url <url>    critical-webhook 的实际 URL
  --p1-webhook-url <url>          p1-webhook 的实际 URL
  --help                          显示帮助
`);
}

function fail(message: string): never {
  process.stderr.write(`[ERROR] ${message}\n`);
  process.exit(1);
}

function isRecord(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isYamlNode(value: unknown): value is JsonRecord | JsonArray {
  return isRecord(value) || Array.isArray(value);
}

function yamlKey(key: string): string {
  if (/^[a-zA-Z0-9_-]+$/.test(key)) return key;
  return JSON.stringify(key);
}

function yamlScalar(value: unknown): string {
  if (value === null || typeof value === "undefined") return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

function renderYamlNode(value: unknown, indent: number): string[] {
  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${padding}[]`];
    const lines: string[] = [];
    for (const item of value) {
      if (isYamlNode(item)) {
        lines.push(`${padding}-`);
        lines.push(...renderYamlNode(item, indent + 2));
      } else {
        lines.push(`${padding}- ${yamlScalar(item)}`);
      }
    }
    return lines;
  }

  if (!isRecord(value)) {
    return [`${padding}${yamlScalar(value)}`];
  }

  const entries = Object.entries(value).filter(([, item]) => typeof item !== "undefined");
  if (entries.length === 0) return [`${padding}{}`];

  const lines: string[] = [];
  for (const [key, item] of entries) {
    if (isYamlNode(item)) {
      lines.push(`${padding}${yamlKey(key)}:`);
      lines.push(...renderYamlNode(item, indent + 2));
    } else {
      lines.push(`${padding}${yamlKey(key)}: ${yamlScalar(item)}`);
    }
  }
  return lines;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    templatePath: "",
    outputFormat: "json",
    warningWebhookUrl: "",
    criticalWebhookUrl: "",
    p1WebhookUrl: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case "--template-path":
        args.templatePath = argv[index + 1] || "";
        index += 1;
        break;
      case "--output-format":
        args.outputFormat = (argv[index + 1] || "") as CliArgs["outputFormat"];
        index += 1;
        break;
      case "--warning-webhook-url":
        args.warningWebhookUrl = argv[index + 1] || "";
        index += 1;
        break;
      case "--critical-webhook-url":
        args.criticalWebhookUrl = argv[index + 1] || "";
        index += 1;
        break;
      case "--p1-webhook-url":
        args.p1WebhookUrl = argv[index + 1] || "";
        index += 1;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        fail(`未知参数: ${current}`);
    }
  }

  if (!args.templatePath) {
    fail("缺少 --template-path");
  }
  if (args.outputFormat !== "json" && args.outputFormat !== "yaml") {
    fail(`--output-format 仅支持 json/yaml，实际收到: ${args.outputFormat || "<empty>"}`);
  }
  if (!args.warningWebhookUrl) {
    fail("缺少 --warning-webhook-url");
  }
  if (!args.criticalWebhookUrl) {
    fail("缺少 --critical-webhook-url");
  }
  if (!args.p1WebhookUrl) {
    fail("缺少 --p1-webhook-url");
  }

  return args;
}

function injectWebhookUrls(config: JsonRecord, webhookTargets: Map<string, string>) {
  const receivers = config.receivers;
  if (!Array.isArray(receivers)) {
    fail("Alertmanager 基线缺少 receivers 数组");
  }

  const foundReceivers = new Set<string>();
  for (const receiver of receivers) {
    if (!isRecord(receiver)) continue;
    const receiverName = typeof receiver.name === "string" ? receiver.name.trim() : "";
    const targetUrl = webhookTargets.get(receiverName);
    if (!targetUrl) continue;

    const webhookConfigs = receiver.webhook_configs;
    if (!Array.isArray(webhookConfigs) || webhookConfigs.length === 0) {
      fail(`基线 receiver=${receiverName} 缺少 webhook_configs`);
    }

    for (const item of webhookConfigs) {
      if (!isRecord(item)) {
        fail(`基线 receiver=${receiverName} 的 webhook_configs 含非法节点`);
      }
      item.url = targetUrl;
    }

    foundReceivers.add(receiverName);
  }

  const missingReceivers = [...webhookTargets.keys()].filter(
    (receiverName) => !foundReceivers.has(receiverName),
  );
  if (missingReceivers.length > 0) {
    fail(`基线缺少目标 receiver: ${missingReceivers.join(", ")}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const templateText = await Bun.file(args.templatePath).text().catch((error: unknown) => {
  fail(`读取 Alertmanager 基线失败: ${String(error)}`);
});

let parsed: unknown;
try {
  parsed = Bun.YAML.parse(templateText);
} catch (error) {
  fail(`解析 Alertmanager 基线失败: ${String(error)}`);
}

if (!isRecord(parsed)) {
  fail("Alertmanager 基线内容必须是 YAML 对象");
}

const config = structuredClone(parsed);
injectWebhookUrls(
  config,
  new Map([
    ["warning-webhook", args.warningWebhookUrl],
    ["critical-webhook", args.criticalWebhookUrl],
    ["p1-webhook", args.p1WebhookUrl],
  ]),
);

if (args.outputFormat === "yaml") {
  process.stdout.write(`${renderYamlNode(config, 0).join("\n")}\n`);
} else {
  process.stdout.write(JSON.stringify(config));
}
