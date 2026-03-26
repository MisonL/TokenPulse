import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  type AgentLedgerDeliveryAttempt,
  type AgentLedgerReplayAudit,
  agentLedgerDeliveryAttempts,
  agentLedgerReplayAudits,
  agentLedgerRuntimeOutbox,
  auditEvents,
  type AgentLedgerRuntimeOutbox,
} from "../../db/schema";
import {
  getAgentLedgerOutboxHealth,
  getAgentLedgerOutboxReadiness,
  type AgentLedgerOutboxHealth,
  type AgentLedgerOutboxReadiness,
  type AgentLedgerReplayAuditResult,
} from "./runtime-events";

export type AgentLedgerTraceCurrentState =
  | "delivered"
  | "retryable_failure"
  | "replay_required"
  | "blocked"
  | "timeout"
  | "pending"
  | "unknown";

export interface AgentLedgerTraceAuditEventItem {
  id: number;
  actor: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  result: string;
  details?: Record<string, unknown> | string | null;
  ip?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
  createdAt: string;
}

export interface AgentLedgerTraceDrilldownSummary {
  traceId: string;
  currentState: AgentLedgerTraceCurrentState;
  latestAttemptResult: AgentLedgerReplayAuditResult | null;
  latestReplayResult: AgentLedgerReplayAuditResult | null;
  needsReplay: boolean;
  lastOperatorId: string | null;
  firstSeenAt: number | string | null;
  lastUpdatedAt: number | string | null;
  outboxCount: number;
  deliveryAttemptCount: number;
  replayAuditCount: number;
  auditEventCount: number;
}

export interface AgentLedgerTraceDrilldownResult {
  traceId: string;
  summary: AgentLedgerTraceDrilldownSummary;
  outbox: AgentLedgerRuntimeOutbox[];
  deliveryAttempts: AgentLedgerDeliveryAttempt[];
  replayAudits: AgentLedgerReplayAudit[];
  auditEvents: AgentLedgerTraceAuditEventItem[];
  readiness: AgentLedgerOutboxReadiness;
  health: AgentLedgerOutboxHealth;
}

function normalizeTraceId(value: string): string {
  return String(value || "").trim();
}

function safeParseAuditDetails(raw?: string | null): Record<string, unknown> | string | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
}

function toComparableMs(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function deriveCurrentState(options: {
  latestOutbox?: AgentLedgerRuntimeOutbox | null;
  latestAttempt?: AgentLedgerDeliveryAttempt | null;
  latestReplay?: AgentLedgerReplayAudit | null;
}): AgentLedgerTraceCurrentState {
  const latestOutbox = options.latestOutbox || null;
  if (latestOutbox) {
    if (latestOutbox.deliveryState === "replay_required") return "replay_required";
    if (latestOutbox.deliveryState === "retryable_failure") return "retryable_failure";
    if (latestOutbox.deliveryState === "delivered") return "delivered";
    if (latestOutbox.status === "blocked") return "blocked";
    if (latestOutbox.status === "timeout") return "timeout";
    if (latestOutbox.deliveryState === "pending") return "pending";
  }

  const latestReplay = options.latestReplay || null;
  if (latestReplay?.result === "permanent_failure") return "replay_required";
  if (latestReplay?.result === "retryable_failure") return "retryable_failure";
  if (latestReplay?.result === "delivered") return "delivered";

  const latestAttempt = options.latestAttempt || null;
  if (latestAttempt?.result === "permanent_failure") return "replay_required";
  if (latestAttempt?.result === "retryable_failure") return "retryable_failure";
  if (latestAttempt?.result === "delivered") return "delivered";

  return "unknown";
}

function normalizeReplayResult(
  value?: string | null,
): AgentLedgerReplayAuditResult | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "delivered" ||
    normalized === "retryable_failure" ||
    normalized === "permanent_failure"
  ) {
    return normalized;
  }
  return null;
}

export async function getAgentLedgerTraceDrilldown(
  traceIdInput: string,
): Promise<AgentLedgerTraceDrilldownResult | null> {
  const traceId = normalizeTraceId(traceIdInput);
  if (!traceId) return null;

  const [outbox, deliveryAttempts, replayAudits, rawAuditEvents, readiness, health] =
    await Promise.all([
      db
        .select()
        .from(agentLedgerRuntimeOutbox)
        .where(eq(agentLedgerRuntimeOutbox.traceId, traceId))
        .orderBy(desc(agentLedgerRuntimeOutbox.createdAt), desc(agentLedgerRuntimeOutbox.id)),
      db
        .select()
        .from(agentLedgerDeliveryAttempts)
        .where(eq(agentLedgerDeliveryAttempts.traceId, traceId))
        .orderBy(desc(agentLedgerDeliveryAttempts.createdAt), desc(agentLedgerDeliveryAttempts.id)),
      db
        .select()
        .from(agentLedgerReplayAudits)
        .where(eq(agentLedgerReplayAudits.traceId, traceId))
        .orderBy(desc(agentLedgerReplayAudits.createdAt), desc(agentLedgerReplayAudits.id)),
      db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.traceId, traceId))
        .orderBy(desc(auditEvents.id)),
      getAgentLedgerOutboxReadiness(),
      getAgentLedgerOutboxHealth(),
    ]);

  const auditEventRows: AgentLedgerTraceAuditEventItem[] = rawAuditEvents.map((row) => ({
    ...row,
    details: safeParseAuditDetails(row.details),
  }));

  if (
    outbox.length === 0 &&
    deliveryAttempts.length === 0 &&
    replayAudits.length === 0 &&
    auditEventRows.length === 0
  ) {
    return null;
  }

  const latestOutbox = outbox[0] || null;
  const latestAttempt = deliveryAttempts[0] || null;
  const latestReplay = replayAudits[0] || null;

  const firstSeenCandidates = [
    ...outbox.map((item) => toComparableMs(item.createdAt)),
    ...deliveryAttempts.map((item) => toComparableMs(item.createdAt)),
    ...replayAudits.map((item) => toComparableMs(item.createdAt)),
    ...auditEventRows.map((item) => toComparableMs(item.createdAt)),
  ].filter((item): item is number => item !== null);
  const lastUpdatedCandidates = [
    ...outbox.map((item) => toComparableMs(item.updatedAt ?? item.createdAt)),
    ...deliveryAttempts.map((item) => toComparableMs(item.createdAt)),
    ...replayAudits.map((item) => toComparableMs(item.createdAt)),
    ...auditEventRows.map((item) => toComparableMs(item.createdAt)),
  ].filter((item): item is number => item !== null);

  return {
    traceId,
    summary: {
      traceId,
      currentState: deriveCurrentState({
        latestOutbox,
        latestAttempt,
        latestReplay,
      }),
      latestAttemptResult: normalizeReplayResult(latestAttempt?.result),
      latestReplayResult: normalizeReplayResult(latestReplay?.result),
      needsReplay:
        latestOutbox?.deliveryState === "replay_required" ||
        latestAttempt?.result === "permanent_failure" ||
        latestReplay?.result === "permanent_failure",
      lastOperatorId: latestReplay?.operatorId || null,
      firstSeenAt:
        firstSeenCandidates.length > 0 ? Math.min(...firstSeenCandidates) : null,
      lastUpdatedAt:
        lastUpdatedCandidates.length > 0 ? Math.max(...lastUpdatedCandidates) : null,
      outboxCount: outbox.length,
      deliveryAttemptCount: deliveryAttempts.length,
      replayAuditCount: replayAudits.length,
      auditEventCount: auditEventRows.length,
    },
    outbox,
    deliveryAttempts,
    replayAudits,
    auditEvents: auditEventRows,
    readiness,
    health,
  };
}
