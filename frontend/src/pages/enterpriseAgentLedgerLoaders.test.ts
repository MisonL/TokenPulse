import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

interface MockStructuredResult {
  ok: boolean;
  status: number;
  error?: string;
  payload: unknown;
}

const listAgentLedgerOutboxResultMock = mock(async (): Promise<MockStructuredResult> => ({
  ok: true,
  status: 200,
  error: undefined,
  payload: {
    data: [],
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  },
}));
const getAgentLedgerOutboxSummaryResultMock = mock(async (): Promise<MockStructuredResult> => ({
  ok: true,
  status: 200,
  error: undefined,
  payload: {
    data: {
      total: 0,
      byDeliveryState: {
        pending: 0,
        delivered: 0,
        retryable_failure: 0,
        replay_required: 0,
      },
      byStatus: {
        success: 0,
        failure: 0,
        blocked: 0,
        timeout: 0,
      },
    },
  },
}));
const getAgentLedgerOutboxReadinessResultMock = mock(async (): Promise<MockStructuredResult> => ({
  ok: true,
  status: 200,
  error: undefined,
  payload: {
    data: {
      ready: false,
      status: "degraded",
      checkedAt: 1,
      blockingReasons: [],
      degradedReasons: ["retryable_backlog"],
      errorMessage: null,
      health: {
        enabled: true,
        deliveryConfigured: true,
        workerPollIntervalMs: 30000,
        requestTimeoutMs: 10000,
        maxAttempts: 5,
        retryScheduleSec: [0, 30],
        backlog: {
          pending: 0,
          delivered: 0,
          retryable_failure: 1,
          replay_required: 0,
          total: 1,
        },
        openBacklogTotal: 1,
        oldestOpenBacklogAgeSec: 60,
        latestReplayRequiredAt: null,
        lastCycleAt: 2,
        lastSuccessAt: 3,
      },
    },
  },
}));
const getAgentLedgerOutboxHealthResultMock = mock(async (): Promise<MockStructuredResult> => ({
  ok: false,
  status: 404,
  error: "not found",
  payload: {},
}));

type ClientModule = typeof import("../lib/client");
const clientOriginal = (await import(
  `../lib/client?agentledger-loaders-test=${Date.now()}-${Math.random().toString(16).slice(2)}`
)) as ClientModule;

mock.module("../lib/client", () => ({
  ...clientOriginal,
  enterpriseAdminClient: {
    ...clientOriginal.enterpriseAdminClient,
    listAgentLedgerOutboxResult: listAgentLedgerOutboxResultMock,
    getAgentLedgerOutboxSummaryResult: getAgentLedgerOutboxSummaryResultMock,
    getAgentLedgerOutboxReadinessResult: getAgentLedgerOutboxReadinessResultMock,
    getAgentLedgerOutboxHealthResult: getAgentLedgerOutboxHealthResultMock,
  },
}));

async function loadLoadersModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`./enterpriseAgentLedgerLoaders?loaders-test=${cacheBust}`);
}

function createOutboxOptions() {
  return {
    deliveryStateFilter: "",
    statusFilter: "",
    providerFilter: "",
    tenantFilter: "",
    traceFilter: "",
    fromFilter: "",
    toFilter: "",
    setOutbox: mock(() => {}),
    setSummary: mock(() => {}),
    setApiAvailable: mock(() => {}),
    setSelectedIds: mock(() => {}),
    setReadiness: mock(() => {}),
    setReadinessApiAvailable: mock(() => {}),
    setReadinessError: mock(() => {}),
    setHealth: mock(() => {}),
    setHealthApiAvailable: mock(() => {}),
    setHealthError: mock(() => {}),
  };
}

describe("enterpriseAgentLedgerLoaders", () => {
  beforeEach(() => {
    listAgentLedgerOutboxResultMock.mockReset();
    getAgentLedgerOutboxSummaryResultMock.mockReset();
    getAgentLedgerOutboxReadinessResultMock.mockReset();
    getAgentLedgerOutboxHealthResultMock.mockReset();
  });

  afterAll(() => {
    mock.restore();
  });

  it("outbox loader 应优先使用 readiness 内嵌 health，并清空已选项", async () => {
    listAgentLedgerOutboxResultMock.mockResolvedValue({
      ok: true,
      status: 200,
      error: undefined,
      payload: {
        data: [],
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
      },
    });
    getAgentLedgerOutboxSummaryResultMock.mockResolvedValue({
      ok: true,
      status: 200,
      error: undefined,
      payload: {
        data: {
          total: 0,
          byDeliveryState: {
            pending: 0,
            delivered: 0,
            retryable_failure: 0,
            replay_required: 0,
          },
          byStatus: {
            success: 0,
            failure: 0,
            blocked: 0,
            timeout: 0,
          },
        },
      },
    });
    getAgentLedgerOutboxReadinessResultMock.mockResolvedValue({
      ok: true,
      status: 200,
      error: undefined,
      payload: {
        data: {
          ready: false,
          status: "degraded",
          checkedAt: 1,
          blockingReasons: [],
          degradedReasons: ["retryable_backlog"],
          errorMessage: null,
          health: {
            enabled: true,
            deliveryConfigured: true,
            workerPollIntervalMs: 30000,
            requestTimeoutMs: 10000,
            maxAttempts: 5,
            retryScheduleSec: [0, 30],
            backlog: {
              pending: 0,
              delivered: 0,
              retryable_failure: 1,
              replay_required: 0,
              total: 1,
            },
            openBacklogTotal: 1,
            oldestOpenBacklogAgeSec: 60,
            latestReplayRequiredAt: null,
            lastCycleAt: 2,
            lastSuccessAt: 3,
          },
        },
      },
    });
    getAgentLedgerOutboxHealthResultMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "not found",
      payload: {},
    });

    const outbox = createOutboxOptions();
    const deliveryAttempt = {
      requestIdRef: { current: 0 },
      openOutboxId: 42,
      setOpenOutboxId: mock(() => {}),
      setAttempts: mock(() => {}),
      setSummary: mock(() => {}),
      setApiAvailable: mock(() => {}),
      setLoading: mock(() => {}),
      setError: mock(() => {}),
    };

    const { createEnterpriseAgentLedgerLoaders } = await loadLoadersModule();
    const loaders = createEnterpriseAgentLedgerLoaders({
      runSectionLoad: async (
        _section: "agentLedgerOutbox" | "agentLedgerReplayAudits",
        action: () => Promise<unknown>,
      ) => await action(),
      getErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
      deliveryAttempt,
      outbox,
      replayAudits: {
        outboxIdFilter: "",
        traceFilter: "",
        operatorFilter: "",
        resultFilter: "",
        triggerSourceFilter: "",
        fromFilter: "",
        toFilter: "",
        setAudits: mock(() => {}),
        setSummary: mock(() => {}),
        setApiAvailable: mock(() => {}),
      },
    });

    await loaders.loadAgentLedgerOutbox();

    expect(outbox.setApiAvailable).toHaveBeenCalledWith(true);
    expect(outbox.setSelectedIds).toHaveBeenCalledWith([]);
    expect(outbox.setReadinessApiAvailable).toHaveBeenCalledWith(true);
    expect(outbox.setReadinessError).toHaveBeenCalledWith("");
    expect(outbox.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        deliveryConfigured: true,
        openBacklogTotal: 1,
      }),
    );
    expect(outbox.setHealthApiAvailable).toHaveBeenCalledWith(true);
    expect(outbox.setHealthError).toHaveBeenCalledWith("");
    expect(deliveryAttempt.setOpenOutboxId).toHaveBeenCalledWith(null);
  });

  it("outbox 主接口 404 时应整体降级并关闭 attempts 面板", async () => {
    listAgentLedgerOutboxResultMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "not found",
      payload: {},
    });
    getAgentLedgerOutboxSummaryResultMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "not found",
      payload: {},
    });

    const outbox = createOutboxOptions();
    const deliveryAttempt = {
      requestIdRef: { current: 0 },
      openOutboxId: 88,
      setOpenOutboxId: mock(() => {}),
      setAttempts: mock(() => {}),
      setSummary: mock(() => {}),
      setApiAvailable: mock(() => {}),
      setLoading: mock(() => {}),
      setError: mock(() => {}),
    };

    const { createEnterpriseAgentLedgerLoaders } = await loadLoadersModule();
    const loaders = createEnterpriseAgentLedgerLoaders({
      runSectionLoad: async (
        _section: "agentLedgerOutbox" | "agentLedgerReplayAudits",
        action: () => Promise<unknown>,
      ) => await action(),
      getErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
      deliveryAttempt,
      outbox,
      replayAudits: {
        outboxIdFilter: "",
        traceFilter: "",
        operatorFilter: "",
        resultFilter: "",
        triggerSourceFilter: "",
        fromFilter: "",
        toFilter: "",
        setAudits: mock(() => {}),
        setSummary: mock(() => {}),
        setApiAvailable: mock(() => {}),
      },
    });

    await loaders.loadAgentLedgerOutbox();

    expect(outbox.setApiAvailable).toHaveBeenCalledWith(false);
    expect(outbox.setOutbox).toHaveBeenCalledWith(null);
    expect(outbox.setSummary).toHaveBeenCalledWith(null);
    expect(outbox.setReadinessApiAvailable).toHaveBeenCalledWith(false);
    expect(outbox.setHealthApiAvailable).toHaveBeenCalledWith(false);
    expect(outbox.setSelectedIds).toHaveBeenCalledWith([]);
    expect(deliveryAttempt.setOpenOutboxId).toHaveBeenCalledWith(null);
    expect(deliveryAttempt.setApiAvailable).toHaveBeenCalledWith(true);
  });
});
