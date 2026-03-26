import crypto from "node:crypto";

export const AGENTLEDGER_RUNTIME_STATUSES = [
  "success",
  "failure",
  "blocked",
  "timeout",
] as const;

export type AgentLedgerRuntimeStatus =
  (typeof AGENTLEDGER_RUNTIME_STATUSES)[number];

export interface AgentLedgerRuntimeEventInput {
  traceId: string;
  tenantId?: string;
  projectId?: string;
  provider: string;
  model: string;
  resolvedModel?: string;
  routePolicy?: string;
  accountId?: string;
  status: AgentLedgerRuntimeStatus;
  startedAt: string;
  finishedAt?: string;
  errorCode?: string;
  cost?: string;
}

export interface AgentLedgerRuntimePayload {
  tenantId: string;
  projectId?: string;
  traceId: string;
  provider: string;
  model: string;
  resolvedModel: string;
  routePolicy: string;
  accountId?: string;
  status: AgentLedgerRuntimeStatus;
  startedAt: string;
  finishedAt?: string;
  errorCode?: string;
  cost?: string;
}

export interface BuildAgentLedgerRuntimeContractOptions {
  defaultRoutePolicy: string;
  specVersion: string;
  keyId: string;
}

export interface AgentLedgerRuntimeContract {
  payload: AgentLedgerRuntimePayload;
  payloadJson: string;
  payloadHash: string;
  idempotencyKey: string;
  specVersion: string;
  keyId: string;
  baseHeaders: Record<string, string>;
}

export interface BuildAgentLedgerRuntimeSignedHeadersOptions {
  specVersion: string;
  keyId: string;
  timestampSec: string;
  idempotencyKey: string;
  rawBody: string;
  secret: string;
  additionalHeaders?: Record<string, string>;
}

function normalizeText(
  value: unknown,
  maxLength = 1024,
): string | undefined {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

export function normalizeAgentLedgerTenantId(value?: string): string {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || "default";
}

export function normalizeAgentLedgerProvider(value?: string): string {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || "unknown";
}

export function normalizeAgentLedgerRoutePolicyValue(
  value: string | undefined,
  defaultRoutePolicy: string,
): string {
  const normalized = (value || "").trim().toLowerCase();
  if (
    normalized === "round_robin" ||
    normalized === "latest_valid" ||
    normalized === "sticky_user"
  ) {
    return normalized;
  }
  return defaultRoutePolicy;
}

function normalizeStatus(value?: string): AgentLedgerRuntimeStatus {
  const normalized = (value || "").trim().toLowerCase();
  if (
    normalized === "success" ||
    normalized === "failure" ||
    normalized === "blocked" ||
    normalized === "timeout"
  ) {
    return normalized;
  }
  return "failure";
}

export function normalizeAgentLedgerResolvedModelValue(
  provider: string,
  rawModel: string,
  resolvedModel?: string,
): string {
  const normalizedResolved = normalizeText(resolvedModel, 256);
  if (normalizedResolved) {
    return normalizedResolved.includes(":")
      ? normalizedResolved
      : `${provider}:${normalizedResolved}`;
  }
  const normalizedModel = normalizeText(rawModel, 256) || "unknown";
  return normalizedModel.includes(":")
    ? normalizedModel
    : `${provider}:${normalizedModel}`;
}

function normalizeCost(value?: string): string | undefined {
  const normalized = normalizeText(value, 64);
  if (!normalized) return undefined;
  return /^\d+(\.\d{1,6})?$/.test(normalized) ? normalized : undefined;
}

function canonicalJson(
  value: Record<string, string | undefined>,
  orderedKeys: string[],
): string {
  const ordered: Record<string, string> = {};
  for (const key of orderedKeys) {
    const item = value[key];
    if (typeof item === "string" && item.length > 0) {
      ordered[key] = item;
    }
  }
  return JSON.stringify(ordered);
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function toPayloadRecord(
  payload: AgentLedgerRuntimePayload,
): Record<string, string | undefined> {
  return {
    tenantId: payload.tenantId,
    projectId: payload.projectId,
    traceId: payload.traceId,
    provider: payload.provider,
    model: payload.model,
    resolvedModel: payload.resolvedModel,
    routePolicy: payload.routePolicy,
    accountId: payload.accountId,
    status: payload.status,
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt,
    errorCode: payload.errorCode,
    cost: payload.cost,
  };
}

export function normalizeAgentLedgerRuntimePayload(
  input: AgentLedgerRuntimeEventInput,
  options: Pick<BuildAgentLedgerRuntimeContractOptions, "defaultRoutePolicy">,
): AgentLedgerRuntimePayload {
  const provider = normalizeAgentLedgerProvider(input.provider);
  const model = normalizeText(input.model, 256) || "unknown";
  return {
    tenantId: normalizeAgentLedgerTenantId(input.tenantId),
    projectId: normalizeText(input.projectId, 128),
    traceId: normalizeText(input.traceId, 128) || "",
    provider,
    model,
    resolvedModel: normalizeAgentLedgerResolvedModelValue(provider, model, input.resolvedModel),
    routePolicy: normalizeAgentLedgerRoutePolicyValue(input.routePolicy, options.defaultRoutePolicy),
    accountId: normalizeText(input.accountId, 128),
    status: normalizeStatus(input.status),
    startedAt: normalizeText(input.startedAt, 64) || "",
    finishedAt: normalizeText(input.finishedAt, 64),
    errorCode: normalizeText(input.errorCode, 128),
    cost: normalizeCost(input.cost),
  };
}

export function buildAgentLedgerRuntimePayloadJson(
  payload: AgentLedgerRuntimePayload,
): string {
  const payloadRecord = toPayloadRecord(payload);
  return canonicalJson(payloadRecord, [
    "tenantId",
    "projectId",
    "traceId",
    "provider",
    "model",
    "resolvedModel",
    "routePolicy",
    "accountId",
    "status",
    "startedAt",
    "finishedAt",
    "errorCode",
    "cost",
  ]);
}

export function buildAgentLedgerRuntimeIdempotencyKey(
  payload: AgentLedgerRuntimePayload,
): string {
  const payloadRecord = toPayloadRecord(payload);
  return sha256Hex(
    canonicalJson(payloadRecord, [
      "tenantId",
      "traceId",
      "provider",
      "model",
      "startedAt",
    ]),
  );
}

export function buildAgentLedgerRuntimeContract(
  input: AgentLedgerRuntimeEventInput,
  options: BuildAgentLedgerRuntimeContractOptions,
): AgentLedgerRuntimeContract {
  const payload = normalizeAgentLedgerRuntimePayload(input, options);
  const payloadJson = buildAgentLedgerRuntimePayloadJson(payload);
  const idempotencyKey = buildAgentLedgerRuntimeIdempotencyKey(payload);
  return {
    payload,
    payloadJson,
    payloadHash: sha256Hex(payloadJson),
    idempotencyKey,
    specVersion: options.specVersion,
    keyId: options.keyId,
    baseHeaders: {
      "Content-Type": "application/json",
      "X-TokenPulse-Spec-Version": options.specVersion,
      "X-TokenPulse-Key-Id": options.keyId,
      "X-TokenPulse-Idempotency-Key": idempotencyKey,
    },
  };
}

export function buildAgentLedgerRuntimeSignature(options: {
  specVersion: string;
  keyId: string;
  timestampSec: string;
  idempotencyKey: string;
  rawBody: string;
  secret: string;
}): string {
  const signingText = [
    options.specVersion,
    options.keyId,
    options.timestampSec,
    options.idempotencyKey,
    options.rawBody,
  ].join("\n");
  return crypto
    .createHmac("sha256", options.secret)
    .update(signingText, "utf8")
    .digest("hex");
}

export function buildAgentLedgerRuntimeSignedHeaders(
  options: BuildAgentLedgerRuntimeSignedHeadersOptions,
): {
  headers: Record<string, string>;
  signature: string;
} {
  const signature = buildAgentLedgerRuntimeSignature({
    specVersion: options.specVersion,
    keyId: options.keyId,
    timestampSec: options.timestampSec,
    idempotencyKey: options.idempotencyKey,
    rawBody: options.rawBody,
    secret: options.secret,
  });

  return {
    signature,
    headers: {
      ...(options.additionalHeaders || {}),
      "Content-Type": "application/json",
      "X-TokenPulse-Spec-Version": options.specVersion,
      "X-TokenPulse-Key-Id": options.keyId,
      "X-TokenPulse-Timestamp": options.timestampSec,
      "X-TokenPulse-Idempotency-Key": options.idempotencyKey,
      "X-TokenPulse-Signature": `sha256=${signature}`,
    },
  };
}
