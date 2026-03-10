import type {
  AgentLedgerOutboxQuery,
  AgentLedgerReplayAuditQuery,
} from "../lib/client";
import { normalizeDateTimeParam } from "./enterprisePageUtils";

export interface AgentLedgerOutboxBaseQueryInput {
  deliveryState: AgentLedgerOutboxQuery["deliveryState"];
  status: AgentLedgerOutboxQuery["status"];
  provider: string;
  tenantId: string;
  projectId: string;
  traceId: string;
  from: string;
  to: string;
}

export interface AgentLedgerReplayAuditBaseQueryInput {
  outboxId: string;
  traceId: string;
  operatorId: string;
  result: AgentLedgerReplayAuditQuery["result"];
  triggerSource: AgentLedgerReplayAuditQuery["triggerSource"];
  from: string;
  to: string;
}

export const parseOptionalPositiveInteger = (value: string) => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const buildAgentLedgerOutboxBaseQuery = (
  input: AgentLedgerOutboxBaseQueryInput,
): Omit<AgentLedgerOutboxQuery, "page" | "pageSize"> => ({
  deliveryState: input.deliveryState || undefined,
  status: input.status || undefined,
  provider: input.provider.trim() || undefined,
  tenantId: input.tenantId.trim() || undefined,
  projectId: input.projectId?.trim() || undefined,
  traceId: input.traceId.trim() || undefined,
  from: normalizeDateTimeParam(input.from),
  to: normalizeDateTimeParam(input.to),
});

export const buildAgentLedgerReplayAuditBaseQuery = (
  input: AgentLedgerReplayAuditBaseQueryInput,
): Omit<AgentLedgerReplayAuditQuery, "page" | "pageSize"> => ({
  outboxId: parseOptionalPositiveInteger(input.outboxId),
  traceId: input.traceId.trim() || undefined,
  operatorId: input.operatorId.trim() || undefined,
  result: input.result || undefined,
  triggerSource: input.triggerSource || undefined,
  from: normalizeDateTimeParam(input.from),
  to: normalizeDateTimeParam(input.to),
});
