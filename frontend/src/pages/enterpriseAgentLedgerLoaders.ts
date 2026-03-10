import type { MutableRefObject } from "react";
import {
  enterpriseAdminClient,
  type AgentLedgerDeliveryAttemptQuery,
  type AgentLedgerDeliveryAttemptQueryResult,
  type AgentLedgerDeliveryAttemptSummary,
  type AgentLedgerOutboxHealth,
  type AgentLedgerOutboxQueryResult,
  type AgentLedgerOutboxReadiness,
  type AgentLedgerOutboxSummary,
  type AgentLedgerReplayAuditQueryResult,
  type AgentLedgerReplayAuditResult,
  type AgentLedgerReplayAuditSummary,
  type AgentLedgerReplayTriggerSource,
  type AgentLedgerRuntimeStatus,
} from "../lib/client";
import {
  normalizeAgentLedgerDeliveryAttemptQueryResult,
  normalizeAgentLedgerDeliveryAttemptSummary,
  normalizeAgentLedgerOutboxHealth,
  normalizeAgentLedgerOutboxQueryResult,
  normalizeAgentLedgerOutboxReadiness,
  normalizeAgentLedgerOutboxSummary,
  normalizeAgentLedgerReplayAuditQueryResult,
  normalizeAgentLedgerReplayAuditSummary,
} from "./enterpriseAgentLedgerAdapters";
import {
  buildAgentLedgerOutboxBaseQuery,
  buildAgentLedgerReplayAuditBaseQuery,
} from "./enterpriseQueryBuilders";

type RunSectionLoad = <T>(
  section: "agentLedgerOutbox" | "agentLedgerReplayAudits",
  action: () => Promise<T>,
  fallback: string,
) => Promise<T>;

type ErrorMessageResolver = (error: unknown, fallback: string) => string;

interface DeliveryAttemptControllerOptions {
  requestIdRef: MutableRefObject<number>;
  openOutboxId: number | null;
  setOpenOutboxId: (value: number | null) => void;
  setAttempts: (value: AgentLedgerDeliveryAttemptQueryResult | null) => void;
  setSummary: (value: AgentLedgerDeliveryAttemptSummary | null) => void;
  setApiAvailable: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setError: (value: string) => void;
}

interface OutboxControllerOptions {
  deliveryStateFilter: "" | "pending" | "delivered" | "retryable_failure" | "replay_required";
  statusFilter: "" | AgentLedgerRuntimeStatus;
  providerFilter: string;
  tenantFilter: string;
  projectIdFilter: string;
  traceFilter: string;
  fromFilter: string;
  toFilter: string;
  setOutbox: (value: AgentLedgerOutboxQueryResult | null) => void;
  setSummary: (value: AgentLedgerOutboxSummary | null) => void;
  setApiAvailable: (value: boolean) => void;
  setSelectedIds: (value: number[]) => void;
  setReadiness: (value: AgentLedgerOutboxReadiness | null) => void;
  setReadinessApiAvailable: (value: boolean) => void;
  setReadinessError: (value: string) => void;
  setHealth: (value: AgentLedgerOutboxHealth | null) => void;
  setHealthApiAvailable: (value: boolean) => void;
  setHealthError: (value: string) => void;
}

interface ReplayAuditControllerOptions {
  outboxIdFilter: string;
  traceFilter: string;
  operatorFilter: string;
  resultFilter: "" | AgentLedgerReplayAuditResult;
  triggerSourceFilter: "" | AgentLedgerReplayTriggerSource;
  fromFilter: string;
  toFilter: string;
  setAudits: (value: AgentLedgerReplayAuditQueryResult | null) => void;
  setSummary: (value: AgentLedgerReplayAuditSummary | null) => void;
  setApiAvailable: (value: boolean) => void;
}

export interface EnterpriseAgentLedgerLoadersOptions {
  runSectionLoad: RunSectionLoad;
  getErrorMessage: ErrorMessageResolver;
  deliveryAttempt: DeliveryAttemptControllerOptions;
  outbox: OutboxControllerOptions;
  replayAudits: ReplayAuditControllerOptions;
}

export function createEnterpriseAgentLedgerLoaders({
  runSectionLoad,
  getErrorMessage,
  deliveryAttempt,
  outbox,
  replayAudits,
}: EnterpriseAgentLedgerLoadersOptions) {
  const closeAgentLedgerDeliveryAttemptPanel = (preserveAvailability = true) => {
    deliveryAttempt.requestIdRef.current += 1;
    deliveryAttempt.setOpenOutboxId(null);
    deliveryAttempt.setAttempts(null);
    deliveryAttempt.setSummary(null);
    deliveryAttempt.setLoading(false);
    deliveryAttempt.setError("");
    if (!preserveAvailability) {
      deliveryAttempt.setApiAvailable(true);
    }
  };

  const loadAgentLedgerDeliveryAttempts = async (outboxId: number, page = 1) => {
    const normalizedOutboxId = Math.max(0, Math.floor(Number(outboxId) || 0));
    if (normalizedOutboxId <= 0) {
      closeAgentLedgerDeliveryAttemptPanel();
      deliveryAttempt.setError("无效的 outbox id");
      return;
    }

    const requestId = deliveryAttempt.requestIdRef.current + 1;
    deliveryAttempt.requestIdRef.current = requestId;
    deliveryAttempt.setOpenOutboxId(normalizedOutboxId);
    deliveryAttempt.setLoading(true);
    deliveryAttempt.setError("");

    const baseQuery: Omit<AgentLedgerDeliveryAttemptQuery, "page" | "pageSize"> = {
      outboxId: normalizedOutboxId,
    };

    try {
      const [listRespResult, summaryRespResult] = await Promise.allSettled([
        enterpriseAdminClient.listAgentLedgerDeliveryAttemptsResult({
          ...baseQuery,
          page,
          pageSize: 10,
        }),
        enterpriseAdminClient.getAgentLedgerDeliveryAttemptSummaryResult(baseQuery),
      ]);

      if (listRespResult.status === "rejected") {
        throw listRespResult.reason;
      }
      if (summaryRespResult.status === "rejected") {
        throw summaryRespResult.reason;
      }

      const listResp = listRespResult.value;
      const summaryResp = summaryRespResult.value;

      if (
        listResp.status === 404 ||
        listResp.status === 405 ||
        summaryResp.status === 404 ||
        summaryResp.status === 405
      ) {
        if (deliveryAttempt.requestIdRef.current !== requestId) return;
        deliveryAttempt.setAttempts(null);
        deliveryAttempt.setSummary(null);
        deliveryAttempt.setApiAvailable(false);
        deliveryAttempt.setError("");
        return;
      }

      if (!listResp.ok) {
        throw new Error(listResp.error || "加载 AgentLedger delivery attempts 列表失败");
      }
      if (!summaryResp.ok) {
        throw new Error(summaryResp.error || "加载 AgentLedger delivery attempts 汇总失败");
      }

      if (deliveryAttempt.requestIdRef.current !== requestId) return;
      deliveryAttempt.setAttempts(normalizeAgentLedgerDeliveryAttemptQueryResult(listResp.payload));
      deliveryAttempt.setSummary(normalizeAgentLedgerDeliveryAttemptSummary(summaryResp.payload));
      deliveryAttempt.setApiAvailable(true);
      deliveryAttempt.setError("");
    } catch (error) {
      if (deliveryAttempt.requestIdRef.current !== requestId) return;
      deliveryAttempt.setAttempts(null);
      deliveryAttempt.setSummary(null);
      deliveryAttempt.setApiAvailable(true);
      deliveryAttempt.setError(
        getErrorMessage(error, "加载 AgentLedger delivery attempts 失败"),
      );
      throw error;
    } finally {
      if (deliveryAttempt.requestIdRef.current === requestId) {
        deliveryAttempt.setLoading(false);
      }
    }
  };

  const loadAgentLedgerOutbox = async (page = 1) =>
    runSectionLoad("agentLedgerOutbox", async () => {
      const baseQuery = buildAgentLedgerOutboxBaseQuery({
        deliveryState: outbox.deliveryStateFilter,
        status: outbox.statusFilter,
        provider: outbox.providerFilter,
        tenantId: outbox.tenantFilter,
        projectId: outbox.projectIdFilter,
        traceId: outbox.traceFilter,
        from: outbox.fromFilter,
        to: outbox.toFilter,
      });
      const [listRespResult, summaryRespResult, readinessRespResult, healthRespResult] =
        await Promise.allSettled([
          enterpriseAdminClient.listAgentLedgerOutboxResult({
            ...baseQuery,
            page,
            pageSize: 10,
          }),
          enterpriseAdminClient.getAgentLedgerOutboxSummaryResult(baseQuery),
          enterpriseAdminClient.getAgentLedgerOutboxReadinessResult(),
          enterpriseAdminClient.getAgentLedgerOutboxHealthResult(),
        ]);

      if (listRespResult.status === "rejected") {
        throw listRespResult.reason;
      }
      if (summaryRespResult.status === "rejected") {
        throw summaryRespResult.reason;
      }

      const listResp = listRespResult.value;
      const summaryResp = summaryRespResult.value;

      if (
        listResp.status === 404 ||
        listResp.status === 405 ||
        summaryResp.status === 404 ||
        summaryResp.status === 405
      ) {
        outbox.setApiAvailable(false);
        outbox.setOutbox(null);
        outbox.setSummary(null);
        outbox.setReadiness(null);
        outbox.setReadinessApiAvailable(false);
        outbox.setReadinessError("");
        outbox.setHealth(null);
        outbox.setHealthApiAvailable(false);
        outbox.setHealthError("");
        outbox.setSelectedIds([]);
        closeAgentLedgerDeliveryAttemptPanel(false);
        return;
      }
      if (!listResp.ok) {
        throw new Error(listResp.error || "加载 AgentLedger outbox 列表失败");
      }
      if (!summaryResp.ok) {
        throw new Error(summaryResp.error || "加载 AgentLedger outbox 汇总失败");
      }

      const normalizedOutbox = normalizeAgentLedgerOutboxQueryResult(listResp.payload);
      outbox.setOutbox(normalizedOutbox);
      outbox.setSummary(normalizeAgentLedgerOutboxSummary(summaryResp.payload));
      outbox.setApiAvailable(true);
      outbox.setSelectedIds([]);
      if (
        deliveryAttempt.openOutboxId !== null &&
        !normalizedOutbox.data.some((item) => item.id === deliveryAttempt.openOutboxId)
      ) {
        closeAgentLedgerDeliveryAttemptPanel();
      }

      let readinessData: AgentLedgerOutboxReadiness | null = null;
      let readinessRouteAvailable = false;

      if (readinessRespResult.status === "fulfilled") {
        const readinessResp = readinessRespResult.value;
        if (readinessResp.status === 404 || readinessResp.status === 405) {
          outbox.setReadiness(null);
          outbox.setReadinessApiAvailable(false);
          outbox.setReadinessError("");
        } else {
          readinessRouteAvailable = true;
          const normalizedReadiness = normalizeAgentLedgerOutboxReadiness(readinessResp.payload);
          if (normalizedReadiness) {
            readinessData = normalizedReadiness;
            outbox.setReadiness(normalizedReadiness);
            outbox.setReadinessApiAvailable(true);
            outbox.setReadinessError("");
          } else {
            outbox.setReadiness(null);
            outbox.setReadinessApiAvailable(true);
            outbox.setReadinessError(readinessResp.error || "加载 AgentLedger readiness 失败");
          }
        }
      } else {
        outbox.setReadiness(null);
        outbox.setReadinessApiAvailable(true);
        outbox.setReadinessError(
          getErrorMessage(readinessRespResult.reason, "加载 AgentLedger readiness 失败"),
        );
      }

      if (readinessData?.health) {
        outbox.setHealth(readinessData.health);
        outbox.setHealthApiAvailable(true);
        outbox.setHealthError("");
        return;
      }

      if (healthRespResult.status === "fulfilled") {
        const healthResp = healthRespResult.value;
        if (healthResp.status === 404 || healthResp.status === 405) {
          outbox.setHealth(null);
          outbox.setHealthApiAvailable(readinessRouteAvailable);
          outbox.setHealthError("");
        } else if (!healthResp.ok) {
          outbox.setHealth(null);
          outbox.setHealthApiAvailable(true);
          outbox.setHealthError(healthResp.error || "加载 AgentLedger 健康摘要失败");
        } else {
          outbox.setHealth(normalizeAgentLedgerOutboxHealth(healthResp.payload));
          outbox.setHealthApiAvailable(true);
          outbox.setHealthError("");
        }
      } else {
        outbox.setHealth(null);
        outbox.setHealthApiAvailable(true);
        outbox.setHealthError(
          getErrorMessage(healthRespResult.reason, "加载 AgentLedger 健康摘要失败"),
        );
      }
    }, "加载 AgentLedger outbox 失败");

  const loadAgentLedgerReplayAudits = async (page = 1) =>
    runSectionLoad("agentLedgerReplayAudits", async () => {
      const baseQuery = buildAgentLedgerReplayAuditBaseQuery({
        outboxId: replayAudits.outboxIdFilter,
        traceId: replayAudits.traceFilter,
        operatorId: replayAudits.operatorFilter,
        result: replayAudits.resultFilter,
        triggerSource: replayAudits.triggerSourceFilter,
        from: replayAudits.fromFilter,
        to: replayAudits.toFilter,
      });
      const [listRespResult, summaryRespResult] = await Promise.allSettled([
        enterpriseAdminClient.listAgentLedgerReplayAuditsResult({
          ...baseQuery,
          page,
          pageSize: 10,
        }),
        enterpriseAdminClient.getAgentLedgerReplayAuditSummaryResult(baseQuery),
      ]);

      if (listRespResult.status === "rejected") {
        throw listRespResult.reason;
      }
      if (summaryRespResult.status === "rejected") {
        throw summaryRespResult.reason;
      }

      const listResp = listRespResult.value;
      const summaryResp = summaryRespResult.value;
      if (
        listResp.status === 404 ||
        listResp.status === 405 ||
        summaryResp.status === 404 ||
        summaryResp.status === 405
      ) {
        replayAudits.setApiAvailable(false);
        replayAudits.setAudits(null);
        replayAudits.setSummary(null);
        return;
      }
      if (!listResp.ok) {
        throw new Error(listResp.error || "加载 AgentLedger replay 审计列表失败");
      }
      if (!summaryResp.ok) {
        throw new Error(summaryResp.error || "加载 AgentLedger replay 审计汇总失败");
      }

      replayAudits.setAudits(normalizeAgentLedgerReplayAuditQueryResult(listResp.payload));
      replayAudits.setSummary(normalizeAgentLedgerReplayAuditSummary(summaryResp.payload));
      replayAudits.setApiAvailable(true);
    }, "加载 AgentLedger replay 审计失败");

  return {
    closeAgentLedgerDeliveryAttemptPanel,
    loadAgentLedgerDeliveryAttempts,
    loadAgentLedgerOutbox,
    loadAgentLedgerReplayAudits,
  };
}
