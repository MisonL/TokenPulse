import {
  buildAgentLedgerRuntimeContract,
  buildAgentLedgerRuntimeSignedHeaders,
} from "../../src/lib/agentledger/runtime-contract";

function parseArgs(argv: string[]) {
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current?.startsWith("--")) {
      throw new Error(`未知参数: ${current || "(empty)"}`);
    }
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`参数缺少值: --${key}`);
    }
    options.set(key, next);
    i += 1;
  }
  return options;
}

function getRequired(options: Map<string, string>, key: string): string {
  const value = (options.get(key) || "").trim();
  if (!value) {
    throw new Error(`缺少必要参数: --${key}`);
  }
  return value;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const options = parseArgs(process.argv.slice(2));
const format = (options.get("format") || "json").trim().toLowerCase();
if (format !== "json" && format !== "shell") {
  throw new Error(`不支持的输出格式: ${format}`);
}

const contract = buildAgentLedgerRuntimeContract(
  {
    traceId: getRequired(options, "trace-id"),
    tenantId: options.get("tenant-id"),
    projectId: options.get("project-id"),
    provider: getRequired(options, "provider"),
    model: getRequired(options, "model"),
    resolvedModel: options.get("resolved-model"),
    routePolicy: options.get("route-policy"),
    accountId: options.get("account-id"),
    status: getRequired(options, "status") as
      | "success"
      | "failure"
      | "blocked"
      | "timeout",
    startedAt: getRequired(options, "started-at"),
    finishedAt: options.get("finished-at"),
    errorCode: options.get("error-code"),
    cost: options.get("cost"),
  },
  {
    defaultRoutePolicy: (options.get("default-route-policy") || "round_robin").trim(),
    specVersion: getRequired(options, "spec-version"),
    keyId: getRequired(options, "key-id"),
  },
);

const signed = buildAgentLedgerRuntimeSignedHeaders({
  specVersion: contract.specVersion,
  keyId: contract.keyId,
  timestampSec: getRequired(options, "timestamp"),
  idempotencyKey: contract.idempotencyKey,
  rawBody: contract.payloadJson,
  secret: getRequired(options, "secret"),
});

const output = {
  payload: contract.payload,
  payloadJson: contract.payloadJson,
  payloadHash: contract.payloadHash,
  idempotencyKey: contract.idempotencyKey,
  signatureHex: signed.signature,
  requestHeaders: signed.headers,
};

if (format === "json") {
  process.stdout.write(`${JSON.stringify(output)}\n`);
} else {
  const lines = [
    `PAYLOAD_JSON=${shellEscape(contract.payloadJson)}`,
    `PAYLOAD_HASH=${shellEscape(contract.payloadHash)}`,
    `IDEMPOTENCY_KEY=${shellEscape(contract.idempotencyKey)}`,
    `SIGNATURE_HEX=${shellEscape(signed.signature)}`,
    `HEADER_SPEC_VERSION=${shellEscape(signed.headers["X-TokenPulse-Spec-Version"] || "")}`,
    `HEADER_KEY_ID=${shellEscape(signed.headers["X-TokenPulse-Key-Id"] || "")}`,
    `HEADER_TIMESTAMP=${shellEscape(signed.headers["X-TokenPulse-Timestamp"] || "")}`,
    `HEADER_IDEMPOTENCY_KEY=${shellEscape(
      signed.headers["X-TokenPulse-Idempotency-Key"] || "",
    )}`,
    `HEADER_SIGNATURE=${shellEscape(signed.headers["X-TokenPulse-Signature"] || "")}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
