import {
  buildAgentLedgerRuntimeContract,
  buildAgentLedgerRuntimeSignedHeaders,
} from "../../src/lib/agentledger/runtime-contract";

const REQUIRED_ARG_HINT: Record<string, string> = {
  "spec-version": "（签名覆盖字段，对应请求头 X-TokenPulse-Spec-Version）",
  "key-id": "（签名覆盖字段，对应请求头 X-TokenPulse-Key-Id）",
  timestamp: "（签名覆盖字段，对应请求头 X-TokenPulse-Timestamp）",
  secret: "（签名覆盖字段，用于生成请求头 X-TokenPulse-Signature）",
};

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
    throw new Error(`缺少必要参数: --${key}${REQUIRED_ARG_HINT[key] || ""}`);
  }
  return value;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function requireHeaderValue(headers: Record<string, string>, name: string): string {
  const value = (headers[name] || "").trim();
  if (!value) {
    throw new Error(`签名请求头缺少必要字段: ${name}`);
  }
  return value;
}

function main() {
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
  if (!signed.signature.trim()) {
    throw new Error("签名计算结果为空：signature");
  }
  requireHeaderValue(signed.headers, "X-TokenPulse-Spec-Version");
  requireHeaderValue(signed.headers, "X-TokenPulse-Key-Id");
  requireHeaderValue(signed.headers, "X-TokenPulse-Timestamp");
  requireHeaderValue(signed.headers, "X-TokenPulse-Idempotency-Key");
  requireHeaderValue(signed.headers, "X-TokenPulse-Signature");

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
    return;
  }

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

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
