import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

interface MockStructuredResult {
  ok: boolean;
  status: number;
  error?: string;
  payload: unknown;
}

const getAgentLedgerTraceResultMock = mock(async (): Promise<MockStructuredResult> => ({
  ok: true,
  status: 200,
  error: undefined,
  payload: {
    data: {
      summary: {
        traceId: "trace-1",
        currentState: "success",
        latestAttemptResult: "delivered",
        latestReplayResult: null,
        needsReplay: false,
        lastOperatorId: "",
        firstSeenAt: 1,
        lastUpdatedAt: 2,
        outboxCount: 1,
        deliveryAttemptCount: 0,
        replayAuditCount: 0,
        auditEventCount: 0,
      },
      outbox: [],
      deliveryAttempts: [],
      replayAudits: [],
      auditEvents: [],
      readiness: null,
      health: null,
    },
  },
}));

type ClientModule = typeof import("../lib/client");
const clientOriginal = (await import(
  `../lib/client?agentledger-trace-controller-test=${Date.now()}-${Math.random().toString(16).slice(2)}`
)) as ClientModule;

mock.module("../lib/client", () => ({
  ...clientOriginal,
  enterpriseAdminClient: {
    ...clientOriginal.enterpriseAdminClient,
    getAgentLedgerTraceResult: getAgentLedgerTraceResultMock,
  },
}));

async function loadTraceControllerModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`./enterpriseAgentLedgerTraceController?trace-controller-test=${cacheBust}`);
}

describe("enterpriseAgentLedgerTraceController", () => {
  beforeEach(() => {
    getAgentLedgerTraceResultMock.mockReset();
  });

  afterAll(() => {
    mock.restore();
  });

  it("trace 404 时应回填空结果页并保留接口可用状态", async () => {
    getAgentLedgerTraceResultMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "未找到对应 traceId 的 AgentLedger 联查记录",
      payload: {},
    });

    const setResolvedTraceId = mock(() => {});
    const setHasQueried = mock(() => {});
    const setLoading = mock(() => {});
    const setSummary = mock(() => {});
    const setAuditEvents = mock(() => {});
    const setReadiness = mock(() => {});
    const setHealth = mock(() => {});
    const setOutbox = mock(() => {});
    const setOutboxSummary = mock(() => {});
    const setOutboxApiAvailable = mock(() => {});
    const setAttempts = mock(() => {});
    const setAttemptSummary = mock(() => {});
    const setAttemptApiAvailable = mock(() => {});
    const setReplayAudits = mock(() => {});
    const setReplayAuditSummary = mock(() => {});
    const setReplayAuditApiAvailable = mock(() => {});
    const setSectionError = mock(() => {});
    const clearSectionError = mock(() => {});

    const requestIdRef = { current: 0 };
    const { createEnterpriseAgentLedgerTraceController } = await loadTraceControllerModule();
    const controller = createEnterpriseAgentLedgerTraceController({
      requestIdRef,
      traceIdInput: "trace-404",
      hasSectionError: false,
      setTraceIdInput: mock(() => {}),
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
      getErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
    });

    await controller.loadAgentLedgerTrace();

    expect(setHasQueried).toHaveBeenCalledWith(true);
    expect(setResolvedTraceId).toHaveBeenCalledWith("trace-404");
    expect(setOutboxApiAvailable).toHaveBeenCalledWith(true);
    expect(setAttemptApiAvailable).toHaveBeenCalledWith(true);
    expect(setReplayAuditApiAvailable).toHaveBeenCalledWith(true);
    expect(setOutbox).toHaveBeenCalledWith({
      data: [],
      page: 1,
      pageSize: 1,
      total: 0,
      totalPages: 1,
    });
    expect(setAttemptSummary).toHaveBeenCalledWith({
      total: 0,
      bySource: {
        worker: 0,
        manual_replay: 0,
        batch_replay: 0,
      },
      byResult: {
        delivered: 0,
        retryable_failure: 0,
        permanent_failure: 0,
      },
    });
    expect(setSectionError).toHaveBeenCalledWith(
      "agentLedgerTrace",
      "未找到对应 traceId 的 AgentLedger 联查记录",
    );
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("trace 返回非法 payload 时应清空结果并写入错误", async () => {
    getAgentLedgerTraceResultMock.mockResolvedValue({
      ok: true,
      status: 200,
      error: undefined,
      payload: {
        data: {
          summary: null,
        },
      },
    });

    const setSummary = mock(() => {});
    const setAuditEvents = mock(() => {});
    const setReadiness = mock(() => {});
    const setHealth = mock(() => {});
    const setOutbox = mock(() => {});
    const setOutboxSummary = mock(() => {});
    const setAttempts = mock(() => {});
    const setAttemptSummary = mock(() => {});
    const setReplayAudits = mock(() => {});
    const setReplayAuditSummary = mock(() => {});
    const setSectionError = mock(() => {});

    const { createEnterpriseAgentLedgerTraceController } = await loadTraceControllerModule();
    const controller = createEnterpriseAgentLedgerTraceController({
      requestIdRef: { current: 0 },
      traceIdInput: "trace-invalid",
      hasSectionError: false,
      setTraceIdInput: mock(() => {}),
      setResolvedTraceId: mock(() => {}),
      setHasQueried: mock(() => {}),
      setLoading: mock(() => {}),
      setSummary,
      setAuditEvents,
      setReadiness,
      setHealth,
      setOutbox,
      setOutboxSummary,
      setOutboxApiAvailable: mock(() => {}),
      setAttempts,
      setAttemptSummary,
      setAttemptApiAvailable: mock(() => {}),
      setReplayAudits,
      setReplayAuditSummary,
      setReplayAuditApiAvailable: mock(() => {}),
      setSectionError,
      clearSectionError: mock(() => {}),
      getErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
    });

    await controller.loadAgentLedgerTrace();

    expect(setSummary).toHaveBeenCalledWith(null);
    expect(setAuditEvents).toHaveBeenCalledWith([]);
    expect(setReadiness).toHaveBeenCalledWith(null);
    expect(setHealth).toHaveBeenCalledWith(null);
    expect(setOutbox).toHaveBeenCalledWith(null);
    expect(setOutboxSummary).toHaveBeenCalledWith(null);
    expect(setAttempts).toHaveBeenCalledWith(null);
    expect(setAttemptSummary).toHaveBeenCalledWith(null);
    expect(setReplayAudits).toHaveBeenCalledWith(null);
    expect(setReplayAuditSummary).toHaveBeenCalledWith(null);
    expect(setSectionError).toHaveBeenCalledWith(
      "agentLedgerTrace",
      "AgentLedger trace 联查返回数据格式无效",
    );
  });
});
