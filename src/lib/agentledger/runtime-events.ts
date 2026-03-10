import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import { config } from "../../config";
import { db } from "../../db";
import {
  type AgentLedgerDeliveryAttempt,
  type AgentLedgerReplayAudit,
  agentLedgerDeliveryAttempts,
  agentLedgerReplayAudits,
  agentLedgerRuntimeOutbox,
  type AgentLedgerRuntimeOutbox,
} from "../../db/schema";
import { logger } from "../logger";
import {
  agentLedgerRuntimeOutboxBacklogGauge,
  agentLedgerRuntimeOutboxWriteCounter,
  agentLedgerRuntimeDeliveryCounter,
  agentLedgerRuntimeDeliveryDuration,
  agentLedgerRuntimeLastCycleTimestampGauge,
  agentLedgerRuntimeLastSuccessTimestampGauge,
  agentLedgerRuntimeOldestOpenBacklogAgeGauge,
  agentLedgerRuntimeOpenBacklogTotalGauge,
  agentLedgerRuntimeReplayCounter,
  agentLedgerRuntimeWorkerConfigStateGauge,
} from "../metrics";
import { writeAuditEvent } from "../admin/audit";
import {
  AGENTLEDGER_RUNTIME_STATUSES,
  buildAgentLedgerRuntimeContract,
  buildAgentLedgerRuntimeSignedHeaders,
  normalizeAgentLedgerProvider,
  normalizeAgentLedgerResolvedModelValue,
  normalizeAgentLedgerRoutePolicyValue,
  normalizeAgentLedgerTenantId,
  type AgentLedgerRuntimeEventInput,
  type AgentLedgerRuntimeStatus,
} from "./runtime-contract";

export { AGENTLEDGER_RUNTIME_STATUSES } from "./runtime-contract";
export type {
  AgentLedgerRuntimeEventInput,
  AgentLedgerRuntimeStatus,
} from "./runtime-contract";

export const AGENTLEDGER_DELIVERY_STATES = [
  "pending",
  "delivered",
  "retryable_failure",
  "replay_required",
] as const;
export const AGENTLEDGER_REPLAY_RESULTS = [
  "delivered",
  "retryable_failure",
  "permanent_failure",
] as const;
export const AGENTLEDGER_REPLAY_TRIGGER_SOURCES = [
  "manual",
  "batch_manual",
] as const;
export const AGENTLEDGER_DELIVERY_ATTEMPT_SOURCES = [
  "worker",
  "manual_replay",
  "batch_replay",
] as const;

export type AgentLedgerDeliveryState =
  (typeof AGENTLEDGER_DELIVERY_STATES)[number];
export type AgentLedgerReplayAuditResult =
  (typeof AGENTLEDGER_REPLAY_RESULTS)[number];
export type AgentLedgerReplayTriggerSource =
  (typeof AGENTLEDGER_REPLAY_TRIGGER_SOURCES)[number];
export type AgentLedgerDeliveryAttemptSource =
  (typeof AGENTLEDGER_DELIVERY_ATTEMPT_SOURCES)[number];

export interface AgentLedgerOutboxQuery {
  page?: number;
  pageSize?: number;
  deliveryState?: AgentLedgerDeliveryState;
  status?: AgentLedgerRuntimeStatus;
  provider?: string;
  tenantId?: string;
  projectId?: string;
  traceId?: string;
  from?: number;
  to?: number;
}

export interface AgentLedgerOutboxSummary {
  total: number;
  byDeliveryState: Record<AgentLedgerDeliveryState, number>;
  byStatus: Record<AgentLedgerRuntimeStatus, number>;
}

export interface AgentLedgerOutboxHealth {
  enabled: boolean;
  deliveryConfigured: boolean;
  workerPollIntervalMs: number;
  requestTimeoutMs: number;
  maxAttempts: number;
  retryScheduleSec: number[];
  backlog: AgentLedgerOutboxSummary["byDeliveryState"] & {
    total: number;
  };
  openBacklogTotal: number;
  oldestOpenBacklogAgeSec: number;
  latestReplayRequiredAt: number | null;
  lastCycleAt: number | null;
  lastSuccessAt: number | null;
}

export type AgentLedgerOutboxReadinessStatus =
  | "disabled"
  | "ready"
  | "degraded"
  | "blocking";

export interface AgentLedgerOutboxReadiness {
  ready: boolean;
  status: AgentLedgerOutboxReadinessStatus;
  checkedAt: number;
  blockingReasons: string[];
  degradedReasons: string[];
  errorMessage?: string | null;
  health: AgentLedgerOutboxHealth | null;
}

export interface AgentLedgerOutboxPageResult {
  data: AgentLedgerRuntimeOutbox[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AgentLedgerReplayAuditQuery {
  page?: number;
  pageSize?: number;
  outboxId?: number;
  traceId?: string;
  operatorId?: string;
  result?: AgentLedgerReplayAuditResult;
  triggerSource?: AgentLedgerReplayTriggerSource;
  from?: number;
  to?: number;
}

export interface AgentLedgerReplayAuditSummary {
  total: number;
  byResult: Record<AgentLedgerReplayAuditResult, number>;
}

export interface AgentLedgerReplayAuditPageResult {
  data: AgentLedgerReplayAudit[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AgentLedgerDeliveryAttemptQuery {
  page?: number;
  pageSize?: number;
  outboxId?: number;
  traceId?: string;
  source?: AgentLedgerDeliveryAttemptSource;
  result?: AgentLedgerReplayAuditResult;
  httpStatus?: number;
  errorClass?: string;
  from?: number;
  to?: number;
}

export interface AgentLedgerDeliveryAttemptSummary {
  total: number;
  bySource: Record<AgentLedgerDeliveryAttemptSource, number>;
  byResult: Record<AgentLedgerReplayAuditResult, number>;
}

export interface AgentLedgerDeliveryAttemptPageResult {
  data: AgentLedgerDeliveryAttempt[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AgentLedgerReplayResult {
  ok: boolean;
  code?: "not_found" | "not_configured";
  item?: AgentLedgerRuntimeOutbox | null;
  result?: AgentLedgerReplayAuditResult;
  httpStatus?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
}

export interface AgentLedgerBatchReplayItemResult {
  id: number;
  ok: boolean;
  code?: "not_found" | "not_configured";
  result?: AgentLedgerReplayAuditResult;
  httpStatus?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  traceId?: string | null;
  deliveryState?: AgentLedgerDeliveryState | null;
}

export interface AgentLedgerBatchReplayResult {
  requestedCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  notFoundCount: number;
  notConfiguredCount: number;
  items: AgentLedgerBatchReplayItemResult[];
}

interface DeliveryAttemptOutcome {
  result: AgentLedgerReplayAuditResult;
  deliveryState: AgentLedgerDeliveryState;
  attemptNumber: number;
  httpStatus?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  nextRetryAt?: number | null;
  durationMs: number;
}

const SUCCESS_HTTP_STATUSES = new Set([200, 202]);
function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}
const RETENTION_TERMINAL_STATES: AgentLedgerDeliveryState[] = [
  "delivered",
  "replay_required",
];

let agentLedgerWorkerLastCycleAt: number | null = null;
let agentLedgerWorkerLastSuccessAt: number | null = null;

async function recordAgentLedgerOutboxWriteFailureAudit(input: {
  traceId: string;
  idempotencyKey: string;
  targetUrl: string;
  payloadJson: string;
  headersJson: string;
  errorMessage: string;
}) {
  await writeAuditEvent({
    actor: "agentledger-runtime",
    action: "agentledger.outbox.write_failed",
    resource: "agentledger.runtime.outbox",
    result: "failure",
    traceId: input.traceId,
    details: {
      failureReason: "outbox_write_failed",
      idempotencyKey: input.idempotencyKey,
      targetUrl: input.targetUrl,
      payloadJson: input.payloadJson,
      headersJson: input.headersJson,
      errorMessage: input.errorMessage,
    },
  });
}

function resolvePendingBacklogBlockingAgeMs(): number {
  return Math.max(
    config.agentLedger.workerPollIntervalMs * 4,
    config.agentLedger.requestTimeoutMs * 2,
    120_000,
  );
}

function resolveWorkerHeartbeatBlockingAgeMs(): number {
  return Math.max(
    config.agentLedger.workerPollIntervalMs * 4,
    config.agentLedger.requestTimeoutMs * 2,
    120_000,
  );
}

function resolveRetryableBacklogBlockingAgeMs(): number {
  return Math.max(
    config.agentLedger.workerPollIntervalMs * 4,
    120_000,
  );
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

function safeParseHeadersJson(raw?: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const normalized = normalizeText(value, 512);
      if (normalized) {
        result[key] = normalized;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function isDeliveryConfigured(): boolean {
  return Boolean(
    config.agentLedger.enabled &&
      normalizeText(config.agentLedger.ingestUrl, 1024) &&
      normalizeText(config.agentLedger.secret, 1024),
  );
}

function normalizeMetricReason(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || "none";
}

function setAgentLedgerWorkerHeartbeat(options: {
  lastCycleAt: number | null;
  lastSuccessAt: number | null;
}) {
  agentLedgerWorkerLastCycleAt = options.lastCycleAt;
  agentLedgerWorkerLastSuccessAt = options.lastSuccessAt;
}

export function __setAgentLedgerWorkerHeartbeatForTests(options: {
  lastCycleAt: number | null;
  lastSuccessAt: number | null;
}) {
  setAgentLedgerWorkerHeartbeat(options);
}

export function __resetAgentLedgerWorkerHeartbeatForTests() {
  setAgentLedgerWorkerHeartbeat({
    lastCycleAt: null,
    lastSuccessAt: null,
  });
}

function setAgentLedgerConfigStateMetrics(options: {
  enabled: boolean;
  deliveryConfigured: boolean;
}) {
  agentLedgerRuntimeWorkerConfigStateGauge
    .labels("enabled")
    .set(options.enabled ? 1 : 0);
  agentLedgerRuntimeWorkerConfigStateGauge
    .labels("delivery_configured")
    .set(options.deliveryConfigured ? 1 : 0);
}

function setAgentLedgerBacklogMetrics(
  backlog: Record<AgentLedgerDeliveryState, number>,
) {
  for (const state of AGENTLEDGER_DELIVERY_STATES) {
    agentLedgerRuntimeOutboxBacklogGauge
      .labels(state)
      .set(Number(backlog[state] || 0));
  }
}

function setAgentLedgerOpenBacklogMetrics(openBacklogTotal: number, oldestOpenBacklogAgeSec: number) {
  agentLedgerRuntimeOpenBacklogTotalGauge.set(Math.max(0, openBacklogTotal));
  agentLedgerRuntimeOldestOpenBacklogAgeGauge.set(Math.max(0, oldestOpenBacklogAgeSec));
}

function setAgentLedgerHeartbeatMetrics() {
  agentLedgerRuntimeLastCycleTimestampGauge.set(
    agentLedgerWorkerLastCycleAt ? agentLedgerWorkerLastCycleAt / 1000 : 0,
  );
  agentLedgerRuntimeLastSuccessTimestampGauge.set(
    agentLedgerWorkerLastSuccessAt ? agentLedgerWorkerLastSuccessAt / 1000 : 0,
  );
}

function recordDeliveryMetrics(
  result: DeliveryAttemptOutcome["result"],
  durationMs: number,
  reason?: string | null,
) {
  const durationSec = Math.max(durationMs, 0) / 1000;
  agentLedgerRuntimeDeliveryCounter.inc({
    result,
    reason: normalizeMetricReason(reason),
  });
  agentLedgerRuntimeDeliveryDuration.observe(
    { result },
    durationSec,
  );
}

function mapTriggerSourceToAttemptSource(
  triggerSource?: string | null,
): AgentLedgerDeliveryAttemptSource {
  const normalized = (triggerSource || "").trim().toLowerCase();
  if (normalized === "batch_manual") {
    return "batch_replay";
  }
  if (normalized === "manual") {
    return "manual_replay";
  }
  return "worker";
}

function resolveRetryDelayMs(attemptNumber: number): number {
  const schedule = config.agentLedger.retryScheduleSec;
  if (attemptNumber < schedule.length) {
    return Math.max(0, schedule[attemptNumber] || 0) * 1000;
  }
  const fallback = schedule[schedule.length - 1] || 1800;
  return Math.max(0, fallback) * 1000;
}

function resolveDeliveryStateForFailure(
  attemptNumber: number,
): AgentLedgerDeliveryState {
  return attemptNumber >= config.agentLedger.maxAttempts
    ? "replay_required"
    : "retryable_failure";
}

function resolveClaimLeaseMs(): number {
  return Math.max(config.agentLedger.requestTimeoutMs * 2, 30_000);
}

function buildReadyOutboxWhere(now: number) {
  return and(
    inArray(agentLedgerRuntimeOutbox.deliveryState, [
      "pending",
      "retryable_failure",
    ]),
    lte(
      sql`COALESCE(${agentLedgerRuntimeOutbox.nextRetryAt}, 0)`,
      now,
    ),
  );
}

export async function claimAgentLedgerOutboxRow(
  row: AgentLedgerRuntimeOutbox,
  claimedAt = Date.now(),
  leaseUntil = claimedAt + resolveClaimLeaseMs(),
): Promise<AgentLedgerRuntimeOutbox | null> {
  const claimed = await db
    .update(agentLedgerRuntimeOutbox)
    .set({
      nextRetryAt: leaseUntil,
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(agentLedgerRuntimeOutbox.id, row.id),
        eq(agentLedgerRuntimeOutbox.deliveryState, row.deliveryState),
        eq(agentLedgerRuntimeOutbox.attemptCount, row.attemptCount),
        eq(agentLedgerRuntimeOutbox.updatedAt, row.updatedAt),
        lte(
          sql`COALESCE(${agentLedgerRuntimeOutbox.nextRetryAt}, 0)`,
          claimedAt,
        ),
      ),
    )
    .returning();

  return claimed[0] || null;
}

export async function claimAgentLedgerOutboxBatch(
  now = Date.now(),
): Promise<AgentLedgerRuntimeOutbox[]> {
  const candidateLimit = Math.max(
    config.agentLedger.workerBatchSize * 3,
    config.agentLedger.workerBatchSize,
  );
  const leaseUntil = now + resolveClaimLeaseMs();
  const candidates = await db
    .select()
    .from(agentLedgerRuntimeOutbox)
    .where(buildReadyOutboxWhere(now))
    .orderBy(
      desc(agentLedgerRuntimeOutbox.deliveryState),
      desc(agentLedgerRuntimeOutbox.createdAt),
    )
    .limit(candidateLimit);

  const claimed: AgentLedgerRuntimeOutbox[] = [];
  for (const row of candidates) {
    if (claimed.length >= config.agentLedger.workerBatchSize) {
      break;
    }
    const claimedRow = await claimAgentLedgerOutboxRow(row, now, leaseUntil);
    if (claimedRow) {
      claimed.push(claimedRow);
    }
  }

  return claimed;
}

async function persistDeliveryOutcome(
  row: AgentLedgerRuntimeOutbox,
  outcome: DeliveryAttemptOutcome,
): Promise<AgentLedgerRuntimeOutbox> {
  const now = Date.now();
  const values = {
    attemptCount: outcome.attemptNumber,
    lastHttpStatus: outcome.httpStatus ?? null,
    lastErrorClass: outcome.errorClass ?? null,
    lastErrorMessage: outcome.errorMessage ?? null,
    deliveryState: outcome.deliveryState,
    firstFailedAt:
      outcome.result === "delivered"
        ? row.firstFailedAt ?? null
        : row.firstFailedAt || now,
    lastFailedAt: outcome.result === "delivered" ? null : now,
    nextRetryAt:
      outcome.result === "retryable_failure"
        ? outcome.nextRetryAt || null
        : null,
    deliveredAt: outcome.result === "delivered" ? now : row.deliveredAt ?? null,
    updatedAt: now,
  };
  await db
    .update(agentLedgerRuntimeOutbox)
    .set(values)
    .where(eq(agentLedgerRuntimeOutbox.id, row.id));

  const rows = await db
    .select()
    .from(agentLedgerRuntimeOutbox)
    .where(eq(agentLedgerRuntimeOutbox.id, row.id))
    .limit(1);
  return rows[0] || { ...row, ...values };
}

async function executeDeliveryAttempt(
  row: AgentLedgerRuntimeOutbox,
): Promise<DeliveryAttemptOutcome> {
  const attemptNumber = row.attemptCount + 1;
  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.agentLedger.requestTimeoutMs);

  try {
    const timestampSec = `${Math.floor(Date.now() / 1000)}`;
    const { headers: signedHeaders } = buildAgentLedgerRuntimeSignedHeaders({
      specVersion: row.specVersion,
      keyId: row.keyId,
      timestampSec,
      idempotencyKey: row.idempotencyKey,
      rawBody: row.payloadJson,
      secret: config.agentLedger.secret,
      additionalHeaders: safeParseHeadersJson(row.headersJson),
    });

    const headers = new Headers(signedHeaders);

    const response = await fetch(row.targetUrl, {
      method: "POST",
      headers,
      body: row.payloadJson,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (SUCCESS_HTTP_STATUSES.has(response.status)) {
      const outcome: DeliveryAttemptOutcome = {
        result: "delivered",
        deliveryState: "delivered",
        attemptNumber,
        httpStatus: response.status,
        durationMs: Math.max(Date.now() - startedAtMs, 0),
      };
      recordDeliveryMetrics(outcome.result, outcome.durationMs, "http_success");
      return outcome;
    }

    if (isRetryableHttpStatus(response.status)) {
      const deliveryState = resolveDeliveryStateForFailure(attemptNumber);
      const outcome: DeliveryAttemptOutcome = {
        result:
          deliveryState === "retryable_failure"
            ? "retryable_failure"
            : "permanent_failure",
        deliveryState,
        attemptNumber,
        httpStatus: response.status,
        errorClass: `http_${response.status}`,
        errorMessage: normalizeText(await response.text().catch(() => ""), 4000) || null,
        nextRetryAt:
          deliveryState === "retryable_failure"
            ? Date.now() + resolveRetryDelayMs(attemptNumber)
            : null,
        durationMs: Math.max(Date.now() - startedAtMs, 0),
      };
      recordDeliveryMetrics(outcome.result, outcome.durationMs, outcome.errorClass);
      return outcome;
    }

    const outcome: DeliveryAttemptOutcome = {
      result: "permanent_failure",
      deliveryState: "replay_required",
      attemptNumber,
      httpStatus: response.status,
      errorClass: `http_${response.status}`,
      errorMessage: normalizeText(await response.text().catch(() => ""), 4000) || null,
      nextRetryAt: null,
      durationMs: Math.max(Date.now() - startedAtMs, 0),
    };
    recordDeliveryMetrics(outcome.result, outcome.durationMs, outcome.errorClass);
    return outcome;
  } catch (error: any) {
    clearTimeout(timer);
    const isTimeout =
      error?.name === "AbortError" ||
      String(error?.message || "").toLowerCase().includes("timeout");
    const deliveryState = resolveDeliveryStateForFailure(attemptNumber);
    const outcome: DeliveryAttemptOutcome = {
      result:
        deliveryState === "retryable_failure"
          ? "retryable_failure"
          : "permanent_failure",
      deliveryState,
      attemptNumber,
      errorClass: isTimeout ? "request_timeout" : "request_error",
      errorMessage: normalizeText(error?.message || String(error), 2048) || null,
      nextRetryAt:
        deliveryState === "retryable_failure"
          ? Date.now() + resolveRetryDelayMs(attemptNumber)
          : null,
      durationMs: Math.max(Date.now() - startedAtMs, 0),
    };
    recordDeliveryMetrics(outcome.result, outcome.durationMs, outcome.errorClass);
    return outcome;
  }
}

function buildOutboxFilters(query: AgentLedgerOutboxQuery) {
  const filters = [];
  if (query.deliveryState) {
    filters.push(eq(agentLedgerRuntimeOutbox.deliveryState, query.deliveryState));
  }
  if (query.status) {
    filters.push(eq(agentLedgerRuntimeOutbox.status, query.status));
  }
  if (query.provider) {
    filters.push(eq(agentLedgerRuntimeOutbox.provider, normalizeAgentLedgerProvider(query.provider)));
  }
  if (query.tenantId) {
    filters.push(eq(agentLedgerRuntimeOutbox.tenantId, normalizeAgentLedgerTenantId(query.tenantId)));
  }
  const projectId = (query.projectId || "").trim();
  if (projectId) {
    filters.push(eq(agentLedgerRuntimeOutbox.projectId, projectId));
  }
  if (query.traceId) {
    filters.push(eq(agentLedgerRuntimeOutbox.traceId, query.traceId.trim()));
  }
  if (typeof query.from === "number" && Number.isFinite(query.from)) {
    filters.push(gte(agentLedgerRuntimeOutbox.createdAt, Math.floor(query.from)));
  }
  if (typeof query.to === "number" && Number.isFinite(query.to)) {
    filters.push(lte(agentLedgerRuntimeOutbox.createdAt, Math.floor(query.to)));
  }
  return filters;
}

function buildReplayAuditFilters(query: AgentLedgerReplayAuditQuery) {
  const filters = [];
  if (typeof query.outboxId === "number" && Number.isFinite(query.outboxId)) {
    filters.push(eq(agentLedgerReplayAudits.outboxId, Math.floor(query.outboxId)));
  }
  if (query.traceId) {
    filters.push(eq(agentLedgerReplayAudits.traceId, query.traceId.trim()));
  }
  if (query.operatorId) {
    filters.push(eq(agentLedgerReplayAudits.operatorId, query.operatorId.trim()));
  }
  if (query.result) {
    filters.push(eq(agentLedgerReplayAudits.result, query.result));
  }
  if (query.triggerSource) {
    filters.push(eq(agentLedgerReplayAudits.triggerSource, query.triggerSource));
  }
  if (typeof query.from === "number" && Number.isFinite(query.from)) {
    filters.push(gte(agentLedgerReplayAudits.createdAt, Math.floor(query.from)));
  }
  if (typeof query.to === "number" && Number.isFinite(query.to)) {
    filters.push(lte(agentLedgerReplayAudits.createdAt, Math.floor(query.to)));
  }
  return filters;
}

function buildDeliveryAttemptFilters(query: AgentLedgerDeliveryAttemptQuery) {
  const filters = [];
  if (typeof query.outboxId === "number" && Number.isFinite(query.outboxId)) {
    filters.push(eq(agentLedgerDeliveryAttempts.outboxId, Math.floor(query.outboxId)));
  }
  if (query.traceId) {
    filters.push(eq(agentLedgerDeliveryAttempts.traceId, query.traceId.trim()));
  }
  if (query.source) {
    filters.push(eq(agentLedgerDeliveryAttempts.source, query.source));
  }
  if (query.result) {
    filters.push(eq(agentLedgerDeliveryAttempts.result, query.result));
  }
  if (typeof query.httpStatus === "number" && Number.isFinite(query.httpStatus)) {
    filters.push(eq(agentLedgerDeliveryAttempts.httpStatus, Math.floor(query.httpStatus)));
  }
  if (query.errorClass) {
    filters.push(eq(agentLedgerDeliveryAttempts.errorClass, query.errorClass.trim()));
  }
  if (typeof query.from === "number" && Number.isFinite(query.from)) {
    filters.push(gte(agentLedgerDeliveryAttempts.createdAt, Math.floor(query.from)));
  }
  if (typeof query.to === "number" && Number.isFinite(query.to)) {
    filters.push(lte(agentLedgerDeliveryAttempts.createdAt, Math.floor(query.to)));
  }
  return filters;
}

async function cleanupExpiredOutboxRecords() {
  const retentionMs = config.agentLedger.outboxRetentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  await db
    .delete(agentLedgerDeliveryAttempts)
    .where(lte(agentLedgerDeliveryAttempts.createdAt, cutoff));
  await db
    .delete(agentLedgerReplayAudits)
    .where(lte(agentLedgerReplayAudits.createdAt, cutoff));
  await db
    .delete(agentLedgerRuntimeOutbox)
    .where(
      and(
        lte(agentLedgerRuntimeOutbox.createdAt, cutoff),
        inArray(agentLedgerRuntimeOutbox.deliveryState, RETENTION_TERMINAL_STATES),
      ),
    );
}

async function appendAgentLedgerDeliveryAttempt(
  row: AgentLedgerRuntimeOutbox,
  outcome: DeliveryAttemptOutcome,
  source: AgentLedgerDeliveryAttemptSource,
) {
  try {
    await db.insert(agentLedgerDeliveryAttempts).values({
      outboxId: row.id,
      traceId: row.traceId,
      idempotencyKey: row.idempotencyKey,
      source,
      attemptNumber: outcome.attemptNumber,
      result: outcome.result,
      httpStatus: outcome.httpStatus ?? null,
      errorClass: outcome.errorClass ?? null,
      errorMessage: outcome.errorMessage ?? null,
      durationMs: Math.max(0, Math.floor(outcome.durationMs || 0)),
      createdAt: Date.now(),
    });
  } catch (error) {
    logger.warn("[AgentLedger] 写入 delivery attempt 审计失败", "AgentLedger");
    logger.error("[AgentLedger] 写入 delivery attempt 审计失败:", error, "AgentLedger");
  }
}

export async function recordAgentLedgerRuntimeEvent(
  input: AgentLedgerRuntimeEventInput,
): Promise<{ queued: boolean; duplicate?: boolean; id?: number }> {
  if (!config.agentLedger.enabled) {
    return { queued: false };
  }

  const contract = buildAgentLedgerRuntimeContract(input, {
    defaultRoutePolicy: config.oauthSelection.defaultPolicy,
    specVersion: config.agentLedger.specVersion,
    keyId: config.agentLedger.keyId,
  });
  const payload = contract.payload;
  if (!payload.traceId || !payload.startedAt) {
    logger.warn(
      `运行时事件缺少必填字段，已跳过入队 traceId=${payload.traceId || "(empty)"} startedAt=${payload.startedAt || "(empty)"}`,
      "AgentLedger",
    );
    return { queued: false };
  }
  const now = Date.now();

  try {
    const inserted = await db
      .insert(agentLedgerRuntimeOutbox)
      .values({
        traceId: payload.traceId,
        tenantId: payload.tenantId,
        projectId: payload.projectId || null,
        provider: payload.provider,
        model: payload.model,
        resolvedModel: payload.resolvedModel,
        routePolicy: payload.routePolicy,
        accountId: payload.accountId || null,
        status: payload.status,
        startedAt: payload.startedAt,
        finishedAt: payload.finishedAt || null,
        errorCode: payload.errorCode || null,
        cost: payload.cost || null,
        idempotencyKey: contract.idempotencyKey,
        specVersion: contract.specVersion,
        keyId: contract.keyId,
        targetUrl: normalizeText(config.agentLedger.ingestUrl, 1024) || "",
        payloadJson: contract.payloadJson,
        payloadHash: contract.payloadHash,
        headersJson: JSON.stringify(contract.baseHeaders),
        deliveryState: "pending",
        attemptCount: 0,
        nextRetryAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: agentLedgerRuntimeOutbox.idempotencyKey,
      })
      .returning({
        id: agentLedgerRuntimeOutbox.id,
      });

    if (inserted[0]?.id) {
      agentLedgerRuntimeOutboxWriteCounter.inc({
        result: "queued",
        reason: "accepted",
      });
      return { queued: true, id: inserted[0].id };
    }

    const existing = await db
      .select({
        id: agentLedgerRuntimeOutbox.id,
      })
      .from(agentLedgerRuntimeOutbox)
      .where(eq(agentLedgerRuntimeOutbox.idempotencyKey, contract.idempotencyKey))
      .limit(1);
    agentLedgerRuntimeOutboxWriteCounter.inc({
      result: "duplicate",
      reason: "idempotency_conflict",
    });
    return {
      queued: false,
      duplicate: true,
      id: existing[0]?.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    agentLedgerRuntimeOutboxWriteCounter.inc({
      result: "failed",
      reason: "outbox_write_failed",
    });
    await recordAgentLedgerOutboxWriteFailureAudit({
      traceId: payload.traceId,
      idempotencyKey: contract.idempotencyKey,
      targetUrl: normalizeText(config.agentLedger.ingestUrl, 1024) || "",
      payloadJson: contract.payloadJson,
      headersJson: JSON.stringify(contract.baseHeaders),
      errorMessage,
    });
    logger.error("[AgentLedger] 运行时事件写入 outbox 失败:", error, "AgentLedger");
    return { queued: false };
  }
}

export async function runAgentLedgerOutboxDeliveryCycle(): Promise<{
  attempted: number;
  delivered: number;
  replayRequired: number;
}> {
  if (!config.agentLedger.enabled) {
    await getAgentLedgerOutboxHealth();
    return { attempted: 0, delivered: 0, replayRequired: 0 };
  }

  await cleanupExpiredOutboxRecords();

  const cycleStartedAt = Date.now();

  if (!isDeliveryConfigured()) {
    setAgentLedgerWorkerHeartbeat({
      lastCycleAt: cycleStartedAt,
      lastSuccessAt: agentLedgerWorkerLastSuccessAt,
    });
    await getAgentLedgerOutboxHealth();
    logger.warn("[AgentLedger] outbox 投递已启用，但 webhook 目标或密钥未配置，暂不发送", "AgentLedger");
    return { attempted: 0, delivered: 0, replayRequired: 0 };
  }

  const rows = await claimAgentLedgerOutboxBatch(Date.now());

  let attempted = 0;
  let delivered = 0;
  let replayRequired = 0;

  for (const row of rows) {
    attempted += 1;
    const outcome = await executeDeliveryAttempt(row);
    const updated = await persistDeliveryOutcome(row, outcome);
    await appendAgentLedgerDeliveryAttempt(row, outcome, "worker");
    if (updated.deliveryState === "delivered") {
      delivered += 1;
    }
    if (updated.deliveryState === "replay_required") {
      replayRequired += 1;
    }
  }

  setAgentLedgerWorkerHeartbeat({
    lastCycleAt: cycleStartedAt,
    lastSuccessAt: delivered > 0 ? cycleStartedAt : agentLedgerWorkerLastSuccessAt,
  });
  await getAgentLedgerOutboxHealth();

  return { attempted, delivered, replayRequired };
}

export async function listAgentLedgerOutbox(
  query: AgentLedgerOutboxQuery = {},
): Promise<AgentLedgerOutboxPageResult> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.max(1, Math.min(200, Math.floor(query.pageSize || 20)));
  const filters = buildOutboxFilters(query);
  const whereClause = filters.length > 0 ? and(...filters) : undefined;
  const offset = (page - 1) * pageSize;

  const totalRows = await db
    .select({
      count: count(),
    })
    .from(agentLedgerRuntimeOutbox)
    .where(whereClause);
  const total = Number(totalRows[0]?.count || 0);

  const data = await db
    .select()
    .from(agentLedgerRuntimeOutbox)
    .where(whereClause)
    .orderBy(desc(agentLedgerRuntimeOutbox.createdAt), desc(agentLedgerRuntimeOutbox.id))
    .limit(pageSize)
    .offset(offset);

  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function summarizeAgentLedgerOutbox(
  query: Omit<AgentLedgerOutboxQuery, "page" | "pageSize"> = {},
): Promise<AgentLedgerOutboxSummary> {
  const filters = buildOutboxFilters(query);
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const deliveryStateRows = await db
    .select({
      deliveryState: agentLedgerRuntimeOutbox.deliveryState,
      total: sql<number>`count(*)::int`,
    })
    .from(agentLedgerRuntimeOutbox)
    .where(whereClause)
    .groupBy(agentLedgerRuntimeOutbox.deliveryState);

  const statusRows = await db
    .select({
      status: agentLedgerRuntimeOutbox.status,
      total: sql<number>`count(*)::int`,
    })
    .from(agentLedgerRuntimeOutbox)
    .where(whereClause)
    .groupBy(agentLedgerRuntimeOutbox.status);

  const byDeliveryState: Record<AgentLedgerDeliveryState, number> = {
    pending: 0,
    delivered: 0,
    retryable_failure: 0,
    replay_required: 0,
  };
  for (const row of deliveryStateRows) {
    const key = (row.deliveryState || "").trim() as AgentLedgerDeliveryState;
    if (key in byDeliveryState) {
      byDeliveryState[key] = Number(row.total || 0);
    }
  }

  const byStatus: Record<AgentLedgerRuntimeStatus, number> = {
    success: 0,
    failure: 0,
    blocked: 0,
    timeout: 0,
  };
  for (const row of statusRows) {
    const key = (row.status || "").trim() as AgentLedgerRuntimeStatus;
    if (key in byStatus) {
      byStatus[key] = Number(row.total || 0);
    }
  }

  return {
    total:
      byDeliveryState.pending +
      byDeliveryState.delivered +
      byDeliveryState.retryable_failure +
      byDeliveryState.replay_required,
    byDeliveryState,
    byStatus,
  };
}

async function getAgentLedgerOpenBacklogSnapshot(referenceNow = Date.now()) {
  const openBacklogRows = await db
    .select({
      oldestCreatedAt: sql<number | null>`min(${agentLedgerRuntimeOutbox.createdAt})`,
    })
    .from(agentLedgerRuntimeOutbox)
    .where(
      inArray(agentLedgerRuntimeOutbox.deliveryState, [
        "pending",
        "retryable_failure",
        "replay_required",
      ]),
    );

  const oldestCreatedAt = openBacklogRows[0]?.oldestCreatedAt ?? null;
  return {
    oldestCreatedAt,
    oldestOpenBacklogAgeSec:
      typeof oldestCreatedAt === "number"
        ? Math.max(0, Math.floor((referenceNow - oldestCreatedAt) / 1000))
        : 0,
  };
}

export async function getAgentLedgerOutboxHealth(): Promise<AgentLedgerOutboxHealth> {
  if (!config.agentLedger.enabled) {
    const disabledHealth: AgentLedgerOutboxHealth = {
      enabled: false,
      deliveryConfigured: isDeliveryConfigured(),
      workerPollIntervalMs: config.agentLedger.workerPollIntervalMs,
      requestTimeoutMs: config.agentLedger.requestTimeoutMs,
      maxAttempts: config.agentLedger.maxAttempts,
      retryScheduleSec: [...config.agentLedger.retryScheduleSec],
      backlog: {
        pending: 0,
        delivered: 0,
        retryable_failure: 0,
        replay_required: 0,
        total: 0,
      },
      openBacklogTotal: 0,
      oldestOpenBacklogAgeSec: 0,
      latestReplayRequiredAt: null,
      lastCycleAt: null,
      lastSuccessAt: null,
    };

    setAgentLedgerConfigStateMetrics({
      enabled: disabledHealth.enabled,
      deliveryConfigured: disabledHealth.deliveryConfigured,
    });
    setAgentLedgerBacklogMetrics({
      pending: 0,
      delivered: 0,
      retryable_failure: 0,
      replay_required: 0,
    });
    setAgentLedgerOpenBacklogMetrics(0, 0);
    setAgentLedgerHeartbeatMetrics();

    return disabledHealth;
  }

  const [summary, replayRequiredRows, openBacklogSnapshot] = await Promise.all([
    summarizeAgentLedgerOutbox(),
    db
      .select({
        latestReplayRequiredAt: sql<number | null>`max(${agentLedgerRuntimeOutbox.updatedAt})`,
      })
      .from(agentLedgerRuntimeOutbox)
      .where(eq(agentLedgerRuntimeOutbox.deliveryState, "replay_required")),
    getAgentLedgerOpenBacklogSnapshot(),
  ]);
  const openBacklogTotal =
    summary.byDeliveryState.pending +
    summary.byDeliveryState.retryable_failure +
    summary.byDeliveryState.replay_required;

  const health: AgentLedgerOutboxHealth = {
    enabled: config.agentLedger.enabled,
    deliveryConfigured: isDeliveryConfigured(),
    workerPollIntervalMs: config.agentLedger.workerPollIntervalMs,
    requestTimeoutMs: config.agentLedger.requestTimeoutMs,
    maxAttempts: config.agentLedger.maxAttempts,
    retryScheduleSec: [...config.agentLedger.retryScheduleSec],
    backlog: {
      pending: summary.byDeliveryState.pending,
      delivered: summary.byDeliveryState.delivered,
      retryable_failure: summary.byDeliveryState.retryable_failure,
      replay_required: summary.byDeliveryState.replay_required,
      total: summary.total,
    },
    openBacklogTotal,
    oldestOpenBacklogAgeSec: openBacklogSnapshot.oldestOpenBacklogAgeSec,
    latestReplayRequiredAt: replayRequiredRows[0]?.latestReplayRequiredAt ?? null,
    lastCycleAt: agentLedgerWorkerLastCycleAt,
    lastSuccessAt: agentLedgerWorkerLastSuccessAt,
  };

  setAgentLedgerConfigStateMetrics({
    enabled: health.enabled,
    deliveryConfigured: health.deliveryConfigured,
  });
  setAgentLedgerBacklogMetrics(summary.byDeliveryState);
  setAgentLedgerOpenBacklogMetrics(
    health.openBacklogTotal,
    health.oldestOpenBacklogAgeSec,
  );
  setAgentLedgerHeartbeatMetrics();

  return health;
}

export async function getAgentLedgerOutboxReadiness(): Promise<AgentLedgerOutboxReadiness> {
  const checkedAt = Date.now();

  try {
    const health = await getAgentLedgerOutboxHealth();
    const blockingReasons: string[] = [];
    const degradedReasons: string[] = [];

    if (!health.enabled) {
      return {
        ready: true,
        status: "disabled",
        checkedAt,
        blockingReasons,
        degradedReasons,
        health,
      };
    }

    if (!health.deliveryConfigured) {
      blockingReasons.push("delivery_not_configured");
    }
    if (health.backlog.replay_required > 0) {
      blockingReasons.push("replay_required_backlog");
    }
    if (health.deliveryConfigured) {
      const workerHeartbeatBlockingAgeMs = resolveWorkerHeartbeatBlockingAgeMs();
      if (typeof health.lastCycleAt !== "number") {
        if (health.openBacklogTotal > 0) {
          blockingReasons.push("worker_cycle_missing");
        } else {
          degradedReasons.push("worker_cycle_missing");
        }
      } else if (checkedAt - health.lastCycleAt > workerHeartbeatBlockingAgeMs) {
        blockingReasons.push("worker_cycle_stale");
      }
    }

    const [pendingRows, retryableRows] = await Promise.all([
      db
        .select({
          oldestReadyAt:
            sql<number | null>`min(coalesce(${agentLedgerRuntimeOutbox.nextRetryAt}, ${agentLedgerRuntimeOutbox.createdAt}))`,
        })
        .from(agentLedgerRuntimeOutbox)
        .where(eq(agentLedgerRuntimeOutbox.deliveryState, "pending")),
      db
        .select({
          oldestReadyAt:
            sql<number | null>`min(coalesce(${agentLedgerRuntimeOutbox.nextRetryAt}, ${agentLedgerRuntimeOutbox.updatedAt}, ${agentLedgerRuntimeOutbox.createdAt}))`,
        })
        .from(agentLedgerRuntimeOutbox)
        .where(eq(agentLedgerRuntimeOutbox.deliveryState, "retryable_failure")),
    ]);

    const oldestPendingReadyAt = pendingRows[0]?.oldestReadyAt ?? null;
    const oldestRetryableReadyAt = retryableRows[0]?.oldestReadyAt ?? null;

    if (
      health.backlog.pending > 0 &&
      typeof oldestPendingReadyAt === "number" &&
      checkedAt - oldestPendingReadyAt > resolvePendingBacklogBlockingAgeMs()
    ) {
      blockingReasons.push("pending_backlog_stale");
    }

    if (health.backlog.retryable_failure > 0) {
      if (
        typeof oldestRetryableReadyAt === "number" &&
        checkedAt - oldestRetryableReadyAt > resolveRetryableBacklogBlockingAgeMs()
      ) {
        blockingReasons.push("retryable_backlog_stale");
      } else {
        degradedReasons.push("retryable_backlog");
      }
    }

    let status: AgentLedgerOutboxReadinessStatus = "ready";
    if (blockingReasons.length > 0) {
      status = "blocking";
    } else if (degradedReasons.length > 0) {
      status = "degraded";
    }

    return {
      ready: blockingReasons.length === 0,
      status,
      checkedAt,
      blockingReasons,
      degradedReasons,
      health,
    };
  } catch (error: any) {
    return {
      ready: false,
      status: "blocking",
      checkedAt,
      blockingReasons: ["health_query_failed"],
      degradedReasons: [],
      errorMessage: normalizeText(error?.message || String(error), 2048) || null,
      health: null,
    };
  }
}

export async function listAgentLedgerDeliveryAttempts(
  query: AgentLedgerDeliveryAttemptQuery = {},
): Promise<AgentLedgerDeliveryAttemptPageResult> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.max(1, Math.min(200, Math.floor(query.pageSize || 20)));
  const filters = buildDeliveryAttemptFilters(query);
  const whereClause = filters.length > 0 ? and(...filters) : undefined;
  const offset = (page - 1) * pageSize;

  const totalRows = await db
    .select({
      count: count(),
    })
    .from(agentLedgerDeliveryAttempts)
    .where(whereClause);
  const total = Number(totalRows[0]?.count || 0);

  const data = await db
    .select()
    .from(agentLedgerDeliveryAttempts)
    .where(whereClause)
    .orderBy(desc(agentLedgerDeliveryAttempts.createdAt), desc(agentLedgerDeliveryAttempts.id))
    .limit(pageSize)
    .offset(offset);

  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function summarizeAgentLedgerDeliveryAttempts(
  query: Omit<AgentLedgerDeliveryAttemptQuery, "page" | "pageSize"> = {},
): Promise<AgentLedgerDeliveryAttemptSummary> {
  const filters = buildDeliveryAttemptFilters(query);
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [sourceRows, resultRows] = await Promise.all([
    db
      .select({
        source: agentLedgerDeliveryAttempts.source,
        total: sql<number>`count(*)::int`,
      })
      .from(agentLedgerDeliveryAttempts)
      .where(whereClause)
      .groupBy(agentLedgerDeliveryAttempts.source),
    db
      .select({
        result: agentLedgerDeliveryAttempts.result,
        total: sql<number>`count(*)::int`,
      })
      .from(agentLedgerDeliveryAttempts)
      .where(whereClause)
      .groupBy(agentLedgerDeliveryAttempts.result),
  ]);

  const bySource: Record<AgentLedgerDeliveryAttemptSource, number> = {
    worker: 0,
    manual_replay: 0,
    batch_replay: 0,
  };
  for (const row of sourceRows) {
    const key = (row.source || "").trim() as AgentLedgerDeliveryAttemptSource;
    if (key in bySource) {
      bySource[key] = Number(row.total || 0);
    }
  }

  const byResult: Record<AgentLedgerReplayAuditResult, number> = {
    delivered: 0,
    retryable_failure: 0,
    permanent_failure: 0,
  };
  for (const row of resultRows) {
    const key = (row.result || "").trim() as AgentLedgerReplayAuditResult;
    if (key in byResult) {
      byResult[key] = Number(row.total || 0);
    }
  }

  return {
    total: byResult.delivered + byResult.retryable_failure + byResult.permanent_failure,
    bySource,
    byResult,
  };
}

export async function listAgentLedgerReplayAudits(
  query: AgentLedgerReplayAuditQuery = {},
): Promise<AgentLedgerReplayAuditPageResult> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.max(1, Math.min(200, Math.floor(query.pageSize || 20)));
  const filters = buildReplayAuditFilters(query);
  const whereClause = filters.length > 0 ? and(...filters) : undefined;
  const offset = (page - 1) * pageSize;

  const totalRows = await db
    .select({
      count: count(),
    })
    .from(agentLedgerReplayAudits)
    .where(whereClause);
  const total = Number(totalRows[0]?.count || 0);

  const data = await db
    .select()
    .from(agentLedgerReplayAudits)
    .where(whereClause)
    .orderBy(desc(agentLedgerReplayAudits.createdAt), desc(agentLedgerReplayAudits.id))
    .limit(pageSize)
    .offset(offset);

  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function summarizeAgentLedgerReplayAudits(
  query: Omit<AgentLedgerReplayAuditQuery, "page" | "pageSize"> = {},
): Promise<AgentLedgerReplayAuditSummary> {
  const filters = buildReplayAuditFilters(query);
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const rows = await db
    .select({
      result: agentLedgerReplayAudits.result,
      total: sql<number>`count(*)::int`,
    })
    .from(agentLedgerReplayAudits)
    .where(whereClause)
    .groupBy(agentLedgerReplayAudits.result);

  const byResult: Record<AgentLedgerReplayAuditResult, number> = {
    delivered: 0,
    retryable_failure: 0,
    permanent_failure: 0,
  };
  for (const row of rows) {
    const key = (row.result || "").trim() as AgentLedgerReplayAuditResult;
    if (key in byResult) {
      byResult[key] = Number(row.total || 0);
    }
  }

  return {
    total:
      byResult.delivered +
      byResult.retryable_failure +
      byResult.permanent_failure,
    byResult,
  };
}

function escapeCsvCell(value: unknown): string {
  const normalized = String(value ?? "");
  if (!normalized.includes(",") && !normalized.includes("\"") && !normalized.includes("\n")) {
    return normalized;
  }
  return `"${normalized.replaceAll("\"", "\"\"")}"`;
}

export function buildAgentLedgerOutboxCsv(
  rows: AgentLedgerRuntimeOutbox[],
): string {
  const header = [
    "id",
    "traceId",
    "tenantId",
    "projectId",
    "provider",
    "model",
    "resolvedModel",
    "routePolicy",
    "accountId",
    "status",
    "deliveryState",
    "attemptCount",
    "lastHttpStatus",
    "lastErrorClass",
    "idempotencyKey",
    "startedAt",
    "finishedAt",
    "firstFailedAt",
    "lastFailedAt",
    "nextRetryAt",
    "deliveredAt",
    "createdAt",
    "targetUrl",
    "payloadJson",
    "headersJson",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.traceId,
      row.tenantId,
      row.projectId || "",
      row.provider,
      row.model,
      row.resolvedModel,
      row.routePolicy,
      row.accountId || "",
      row.status,
      row.deliveryState,
      row.attemptCount,
      row.lastHttpStatus ?? "",
      row.lastErrorClass || "",
      row.idempotencyKey,
      row.startedAt,
      row.finishedAt || "",
      row.firstFailedAt ?? "",
      row.lastFailedAt ?? "",
      row.nextRetryAt ?? "",
      row.deliveredAt ?? "",
      row.createdAt,
      row.targetUrl,
      row.payloadJson,
      row.headersJson,
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return `${header.join(",")}\n${lines.join("\n")}`;
}

async function readOutboxItemById(id: number): Promise<AgentLedgerRuntimeOutbox | null> {
  const rows = await db
    .select()
    .from(agentLedgerRuntimeOutbox)
    .where(eq(agentLedgerRuntimeOutbox.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function replayAgentLedgerOutboxItem(options: {
  id: number;
  operatorId: string;
  triggerSource?: string;
  refreshHealth?: boolean;
}): Promise<AgentLedgerReplayResult> {
  const row = await readOutboxItemById(options.id);
  if (!row) {
    return { ok: false, code: "not_found" };
  }

  const triggerSource = normalizeText(options.triggerSource, 64) || "manual";
  const attemptSource = mapTriggerSourceToAttemptSource(triggerSource);
  const operatorId = normalizeText(options.operatorId, 128) || "unknown";
  const refreshHealth = options.refreshHealth !== false;

  if (!isDeliveryConfigured()) {
    const attemptNumber = row.attemptCount + 1;
    await appendAgentLedgerDeliveryAttempt(
      row,
      {
        result: "permanent_failure",
        deliveryState: row.deliveryState as AgentLedgerDeliveryState,
        attemptNumber,
        errorClass: "delivery_not_configured",
        errorMessage: "AgentLedger webhook 目标或密钥未配置",
        durationMs: 0,
      },
      attemptSource,
    );
    await db.insert(agentLedgerReplayAudits).values({
      outboxId: row.id,
      traceId: row.traceId,
      idempotencyKey: row.idempotencyKey,
      operatorId,
      triggerSource,
      attemptNumber,
      result: "permanent_failure",
      httpStatus: null,
      errorClass: "delivery_not_configured",
      createdAt: Date.now(),
    });
    agentLedgerRuntimeReplayCounter.inc({
      result: "permanent_failure",
    });
    if (refreshHealth) {
      await getAgentLedgerOutboxHealth();
    }
    return {
      ok: false,
      code: "not_configured",
      item: row,
      result: "permanent_failure",
      errorClass: "delivery_not_configured",
      errorMessage: "AgentLedger webhook 目标或密钥未配置",
    };
  }

  const outcome = await executeDeliveryAttempt(row);
  const updated = await persistDeliveryOutcome(row, outcome);
  await appendAgentLedgerDeliveryAttempt(row, outcome, attemptSource);

  await db.insert(agentLedgerReplayAudits).values({
    outboxId: row.id,
    traceId: row.traceId,
    idempotencyKey: row.idempotencyKey,
    operatorId,
    triggerSource,
    attemptNumber: outcome.attemptNumber,
    result: outcome.result,
    httpStatus: outcome.httpStatus ?? null,
    errorClass: outcome.errorClass ?? null,
    createdAt: Date.now(),
  });
  agentLedgerRuntimeReplayCounter.inc({
    result: outcome.result,
  });
  if (refreshHealth) {
    await getAgentLedgerOutboxHealth();
  }

  return {
    ok: outcome.result === "delivered",
    item: updated,
    result: outcome.result,
    httpStatus: outcome.httpStatus ?? null,
    errorClass: outcome.errorClass ?? null,
    errorMessage: outcome.errorMessage ?? null,
  };
}

export async function replayAgentLedgerOutboxItemsBatch(options: {
  ids: number[];
  operatorId: string;
  triggerSource?: AgentLedgerReplayTriggerSource | string;
}): Promise<AgentLedgerBatchReplayResult> {
  const requestedCount = options.ids.length;
  const dedupedIds = Array.from(
    new Set(
      options.ids
        .map((id) => Math.floor(Number(id)))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  const operatorId = normalizeText(options.operatorId, 128) || "unknown";
  const triggerSource =
    (normalizeText(options.triggerSource, 64) as AgentLedgerReplayTriggerSource | undefined) ||
    "batch_manual";

  const items: AgentLedgerBatchReplayItemResult[] = [];
  let successCount = 0;
  let failureCount = 0;
  let notFoundCount = 0;
  let notConfiguredCount = 0;

  for (const id of dedupedIds) {
    const result = await replayAgentLedgerOutboxItem({
      id,
      operatorId,
      triggerSource,
      refreshHealth: false,
    });
    items.push({
      id,
      ok: result.ok,
      code: result.code,
      result: result.result,
      httpStatus: result.httpStatus ?? null,
      errorClass: result.errorClass ?? null,
      errorMessage: result.errorMessage ?? null,
      traceId: result.item?.traceId || null,
      deliveryState: AGENTLEDGER_DELIVERY_STATES.includes(
        (result.item?.deliveryState || "") as AgentLedgerDeliveryState,
      )
        ? ((result.item?.deliveryState || "") as AgentLedgerDeliveryState)
        : null,
    });

    if (result.ok) {
      successCount += 1;
      continue;
    }
    failureCount += 1;
    if (result.code === "not_found") {
      notFoundCount += 1;
      continue;
    }
    if (result.code === "not_configured") {
      notConfiguredCount += 1;
    }
  }

  await getAgentLedgerOutboxHealth();

  return {
    requestedCount,
    processedCount: dedupedIds.length,
    successCount,
    failureCount,
    notFoundCount,
    notConfiguredCount,
    items,
  };
}

type HeaderReader =
  | Headers
  | {
      get(name: string): string | null | undefined;
    };

function getHeaderValue(reader: HeaderReader, name: string): string | undefined {
  const value = reader.get(name);
  return normalizeText(value, 256);
}

export function resolveAgentLedgerTenantIdFromHeaders(
  headers: HeaderReader,
): string {
  return normalizeAgentLedgerTenantId(
    getHeaderValue(headers, "x-tokenpulse-tenant") ||
      getHeaderValue(headers, "x-admin-tenant") ||
      "default",
  );
}

export function resolveAgentLedgerProjectIdFromHeaders(
  headers: HeaderReader,
): string | undefined {
  return (
    getHeaderValue(headers, "x-tokenpulse-project") ||
    getHeaderValue(headers, "x-tokenpulse-project-id") ||
    getHeaderValue(headers, "x-project-id")
  );
}

export function normalizeAgentLedgerResolvedModel(
  provider: string,
  model: string,
  resolvedModel?: string,
): string {
  return normalizeAgentLedgerResolvedModelValue(
    normalizeAgentLedgerProvider(provider),
    model,
    resolvedModel,
  );
}

export function normalizeAgentLedgerRoutePolicy(
  value?: string,
): string {
  return normalizeAgentLedgerRoutePolicyValue(value, config.oauthSelection.defaultPolicy);
}
