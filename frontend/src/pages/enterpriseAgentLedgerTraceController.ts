import type { MutableRefObject } from "react";
import {
  enterpriseAdminClient,
  type AgentLedgerDeliveryAttemptQueryResult,
  type AgentLedgerDeliveryAttemptSummary,
  type AgentLedgerOutboxHealth,
  type AgentLedgerOutboxQueryResult,
  type AgentLedgerOutboxReadiness,
  type AgentLedgerOutboxSummary,
  type AgentLedgerReplayAuditQueryResult,
  type AgentLedgerReplayAuditSummary,
  type AgentLedgerTraceDrilldownSummary,
  type AuditEventItem,
} from "../lib/client";
import {
  buildAgentLedgerTracePageResult,
  normalizeAgentLedgerTraceDrilldownResult,
  summarizeAgentLedgerTraceAttempts,
  summarizeAgentLedgerTraceOutbox,
  summarizeAgentLedgerTraceReplayAudits,
} from "./enterpriseAgentLedgerAdapters";

interface ResetTraceStateOptions {
  clearInput?: boolean;
  preserveAvailability?: boolean;
}

interface EnterpriseAgentLedgerTraceControllerOptions {
  requestIdRef: MutableRefObject<number>;
  traceIdInput: string;
  hasSectionError: boolean;
  setTraceIdInput: (value: string) => void;
  setResolvedTraceId: (value: string) => void;
  setHasQueried: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setSummary: (value: AgentLedgerTraceDrilldownSummary | null) => void;
  setAuditEvents: (value: AuditEventItem[]) => void;
  setReadiness: (value: AgentLedgerOutboxReadiness | null) => void;
  setHealth: (value: AgentLedgerOutboxHealth | null) => void;
  setOutbox: (value: AgentLedgerOutboxQueryResult | null) => void;
  setOutboxSummary: (value: AgentLedgerOutboxSummary | null) => void;
  setOutboxApiAvailable: (value: boolean) => void;
  setAttempts: (value: AgentLedgerDeliveryAttemptQueryResult | null) => void;
  setAttemptSummary: (value: AgentLedgerDeliveryAttemptSummary | null) => void;
  setAttemptApiAvailable: (value: boolean) => void;
  setReplayAudits: (value: AgentLedgerReplayAuditQueryResult | null) => void;
  setReplayAuditSummary: (value: AgentLedgerReplayAuditSummary | null) => void;
  setReplayAuditApiAvailable: (value: boolean) => void;
  setSectionError: (section: "agentLedgerTrace", message: string) => void;
  clearSectionError: (section: "agentLedgerTrace") => void;
  getErrorMessage: (error: unknown, fallback: string) => string;
}

export function createEnterpriseAgentLedgerTraceController({
  requestIdRef,
  traceIdInput,
  hasSectionError,
  setTraceIdInput,
  setResolvedTraceId,
  setHasQueried,
  setLoading,
  setSummary,
  setAuditEvents,
  setReadiness,
  setHealth,
  setOutbox,
  setOutboxSummary,
  setOutboxApiAvailable,
  setAttempts,
  setAttemptSummary,
  setAttemptApiAvailable,
  setReplayAudits,
  setReplayAuditSummary,
  setReplayAuditApiAvailable,
  setSectionError,
  clearSectionError,
  getErrorMessage,
}: EnterpriseAgentLedgerTraceControllerOptions) {
  const resetAgentLedgerTraceState = (options?: ResetTraceStateOptions) => {
    requestIdRef.current += 1;
    setResolvedTraceId("");
    setHasQueried(false);
    setLoading(false);
    setSummary(null);
    setAuditEvents([]);
    setReadiness(null);
    setHealth(null);
    setOutbox(null);
    setOutboxSummary(null);
    setAttempts(null);
    setAttemptSummary(null);
    setReplayAudits(null);
    setReplayAuditSummary(null);
    clearSectionError("agentLedgerTrace");
    if (options?.clearInput) {
      setTraceIdInput("");
    }
    if (!options?.preserveAvailability) {
      setOutboxApiAvailable(true);
      setAttemptApiAvailable(true);
      setReplayAuditApiAvailable(true);
    }
  };

  const handleAgentLedgerTraceInputChange = (value: string) => {
    setTraceIdInput(value);
    if (hasSectionError) {
      clearSectionError("agentLedgerTrace");
    }
  };

  const loadAgentLedgerTrace = async (traceIdInputOverride?: string) => {
    const normalizedTraceId = (traceIdInputOverride ?? traceIdInput).trim();
    if (!normalizedTraceId) {
      setSectionError("agentLedgerTrace", "请输入 traceId 后再执行联查");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setHasQueried(true);
    setLoading(true);
    setResolvedTraceId(normalizedTraceId);
    clearSectionError("agentLedgerTrace");
    try {
      const result = await enterpriseAdminClient.getAgentLedgerTraceResult(normalizedTraceId);
      const payload = result.payload;
      if (requestIdRef.current !== requestId) {
        return;
      }

      if (result.status === 404) {
        setSummary(null);
        setAuditEvents([]);
        setReadiness(null);
        setHealth(null);
        setOutbox(buildAgentLedgerTracePageResult([]));
        setOutboxSummary(summarizeAgentLedgerTraceOutbox([]));
        setAttempts(buildAgentLedgerTracePageResult([]));
        setAttemptSummary(summarizeAgentLedgerTraceAttempts([]));
        setReplayAudits(buildAgentLedgerTracePageResult([]));
        setReplayAuditSummary(summarizeAgentLedgerTraceReplayAudits([]));
        setOutboxApiAvailable(true);
        setAttemptApiAvailable(true);
        setReplayAuditApiAvailable(true);
        setSectionError(
          "agentLedgerTrace",
          result.error || "未找到对应 traceId 的 AgentLedger 联查记录",
        );
        return;
      }

      if (!result.ok) {
        throw new Error(result.error || "加载 AgentLedger trace 联查失败");
      }

      const normalized = normalizeAgentLedgerTraceDrilldownResult(payload);
      if (!normalized) {
        throw new Error("AgentLedger trace 联查返回数据格式无效");
      }

      setSummary(normalized.summary);
      setAuditEvents(normalized.auditEvents);
      setReadiness(normalized.readiness);
      setHealth(normalized.health);
      setOutbox(buildAgentLedgerTracePageResult(normalized.outbox));
      setOutboxSummary(summarizeAgentLedgerTraceOutbox(normalized.outbox));
      setAttempts(buildAgentLedgerTracePageResult(normalized.deliveryAttempts));
      setAttemptSummary(summarizeAgentLedgerTraceAttempts(normalized.deliveryAttempts));
      setReplayAudits(buildAgentLedgerTracePageResult(normalized.replayAudits));
      setReplayAuditSummary(summarizeAgentLedgerTraceReplayAudits(normalized.replayAudits));
      setOutboxApiAvailable(true);
      setAttemptApiAvailable(true);
      setReplayAuditApiAvailable(true);
      clearSectionError("agentLedgerTrace");
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setSummary(null);
      setAuditEvents([]);
      setReadiness(null);
      setHealth(null);
      setOutbox(null);
      setOutboxSummary(null);
      setAttempts(null);
      setAttemptSummary(null);
      setReplayAudits(null);
      setReplayAuditSummary(null);
      setOutboxApiAvailable(true);
      setAttemptApiAvailable(true);
      setReplayAuditApiAvailable(true);
      setSectionError("agentLedgerTrace", getErrorMessage(error, "加载 AgentLedger trace 联查失败"));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  return {
    resetAgentLedgerTraceState,
    handleAgentLedgerTraceInputChange,
    loadAgentLedgerTrace,
  };
}
