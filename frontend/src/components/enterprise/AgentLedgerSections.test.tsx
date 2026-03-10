import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentLedgerOutboxSection } from "./AgentLedgerOutboxSection";
import { AgentLedgerReplayAuditsSection } from "./AgentLedgerReplayAuditsSection";
import { AgentLedgerTraceSection } from "./AgentLedgerTraceSection";

const noop = () => {};
const formatOptionalDateTime = (value?: number | string | null) =>
  value === null || value === undefined || value === "" ? "-" : String(value);

describe("AgentLedger 前端展示文案", () => {
  it("Outbox 区应使用统一状态标签并展示关键健康指标", () => {
    const html = renderToStaticMarkup(
      createElement(AgentLedgerOutboxSection, {
        apiAvailable: true,
        sectionError: "",
        outbox: {
          data: [
            {
              id: 42,
              traceId: "trace-agentledger-ui-001",
              tenantId: "default",
              projectId: null,
              provider: "claude",
              model: "claude-sonnet",
              resolvedModel: "claude:claude-3-7-sonnet",
              routePolicy: "latest_valid",
              accountId: "acct-01",
              status: "timeout",
              startedAt: "2026-03-08T09:59:58.123Z",
              finishedAt: "2026-03-08T10:00:08.123Z",
              errorCode: "request_timeout",
              cost: null,
              idempotencyKey: "idem-001",
              specVersion: "v1",
              keyId: "tokenpulse-runtime-v1",
              targetUrl: "https://agentledger.example.test/runtime",
              payloadJson: "{}",
              payloadHash: "hash-001",
              headersJson: "{}",
              deliveryState: "replay_required",
              attemptCount: 5,
              lastHttpStatus: 503,
              lastErrorClass: "http_503",
              lastErrorMessage: "temporarily unavailable",
              firstFailedAt: 1,
              lastFailedAt: 2,
              nextRetryAt: 3,
              deliveredAt: null,
              createdAt: 4,
              updatedAt: 5,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        },
        outboxSummary: {
          total: 1,
          byDeliveryState: {
            pending: 0,
            delivered: 0,
            retryable_failure: 0,
            replay_required: 1,
          },
          byStatus: {
            success: 0,
            failure: 0,
            blocked: 0,
            timeout: 1,
          },
        },
        readiness: {
          ready: false,
          status: "blocking",
          checkedAt: 6,
          blockingReasons: ["replay_required_backlog"],
          degradedReasons: [],
          errorMessage: null,
          health: null,
        },
        readinessApiAvailable: true,
        readinessError: "",
        readinessMeta: {
          label: "阻断",
          className: "bg-red-100 text-red-800",
        },
        health: {
          enabled: true,
          deliveryConfigured: false,
          workerPollIntervalMs: 30000,
          requestTimeoutMs: 10000,
          maxAttempts: 5,
          retryScheduleSec: [0, 30, 120, 600, 1800],
          backlog: {
            pending: 0,
            delivered: 0,
            retryable_failure: 0,
            replay_required: 1,
            total: 1,
          },
          openBacklogTotal: 1,
          oldestOpenBacklogAgeSec: 420,
          latestReplayRequiredAt: 7,
          lastCycleAt: 8,
          lastSuccessAt: 9,
        },
        healthApiAvailable: true,
        healthError: "",
        shouldShowHealthSummary: true,
        getReasonLabel: (reason: string) => reason,
        formatOptionalDateTime,
        deliveryStateFilter: "",
        statusFilter: "",
        providerFilter: "",
        tenantFilter: "",
        projectIdFilter: "",
        traceFilter: "",
        fromFilter: "",
        toFilter: "",
        onDeliveryStateFilterChange: noop,
        onStatusFilterChange: noop,
        onProviderFilterChange: noop,
        onTenantFilterChange: noop,
        onProjectIdFilterChange: noop,
        onTraceFilterChange: noop,
        onFromFilterChange: noop,
        onToFilterChange: noop,
        onApplyFilters: noop,
        onExport: noop,
        onReplayBatch: noop,
        batchReplaying: false,
        replayingId: null,
        selectedIds: [],
        selectableIds: [42],
        allSelectableChecked: false,
        onToggleSelection: noop,
        onToggleAllSelection: noop,
        onJumpToAuditTrace: noop,
        onJumpToReplayAudits: noop,
        onReplayById: noop,
        attemptsOpenOutboxId: 42,
        attempts: {
          data: [
            {
              id: 88,
              outboxId: 42,
              traceId: "trace-agentledger-ui-001",
              idempotencyKey: "idem-001",
              source: "batch_replay",
              attemptNumber: 5,
              result: "permanent_failure",
              httpStatus: 503,
              errorClass: "http_503",
              errorMessage: "temporarily unavailable",
              durationMs: 1200,
              createdAt: 10,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        },
        attemptSummary: {
          total: 1,
          bySource: {
            worker: 0,
            manual_replay: 0,
            batch_replay: 1,
          },
          byResult: {
            delivered: 0,
            retryable_failure: 0,
            permanent_failure: 1,
          },
        },
        attemptApiAvailable: true,
        attemptLoading: false,
        attemptError: "",
        onToggleAttemptPanel: noop,
        onReloadAttemptPanel: noop,
        onCloseAttemptPanel: noop,
      }),
    );

    expect(html).toContain("未就绪");
    expect(html).toContain("投递未配置");
    expect(html).toContain("需人工回放（replay_required）");
    expect(html).toContain("超时（timeout）");
    expect(html).toContain("openBacklogTotal: 1");
    expect(html).toContain("lastSuccessAt: 9");
    expect(html).toContain("批量人工回放（batch_replay）");
    expect(html).toContain("永久失败（permanent_failure）");
  });

  it("Trace 与 ReplayAudits 区应避免展示写死后端路径，并统一状态表达", () => {
    const traceHtml = renderToStaticMarkup(
      createElement(AgentLedgerTraceSection, {
        traceId: "trace-agentledger-ui-002",
        resolvedTraceId: "trace-agentledger-ui-002",
        hasQueried: true,
        loading: false,
        sectionError: "",
        outboxApiAvailable: false,
        outbox: { data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 },
        outboxSummary: { total: 0, byDeliveryState: { pending: 0, delivered: 0, retryable_failure: 0, replay_required: 0 }, byStatus: { success: 0, failure: 0, blocked: 0, timeout: 0 } },
        attemptApiAvailable: false,
        attempts: { data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 },
        attemptSummary: { total: 0, bySource: { worker: 0, manual_replay: 0, batch_replay: 0 }, byResult: { delivered: 0, retryable_failure: 0, permanent_failure: 0 } },
        replayAuditApiAvailable: false,
        replayAudits: { data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 },
        replayAuditSummary: { total: 0, byResult: { delivered: 0, retryable_failure: 0, permanent_failure: 0 } },
        traceSummary: {
          traceId: "trace-agentledger-ui-002",
          currentState: "replay_required",
          latestAttemptResult: "retryable_failure",
          latestReplayResult: null,
          needsReplay: true,
          lastOperatorId: "owner-01",
          firstSeenAt: 1,
          lastUpdatedAt: 2,
          outboxCount: 0,
          deliveryAttemptCount: 0,
          replayAuditCount: 0,
          auditEventCount: 0,
        },
        auditEvents: [],
        readiness: {
          ready: false,
          status: "blocking",
          checkedAt: 3,
          blockingReasons: ["replay_required_backlog"],
          degradedReasons: [],
          errorMessage: null,
          health: null,
        },
        health: {
          enabled: true,
          deliveryConfigured: false,
          workerPollIntervalMs: 30000,
          requestTimeoutMs: 10000,
          maxAttempts: 5,
          retryScheduleSec: [0, 30, 120, 600, 1800],
          backlog: { pending: 0, delivered: 0, retryable_failure: 0, replay_required: 1, total: 1 },
          openBacklogTotal: 1,
          oldestOpenBacklogAgeSec: 90,
          latestReplayRequiredAt: 4,
          lastCycleAt: 5,
          lastSuccessAt: 6,
        },
        formatOptionalDateTime,
        onTraceIdChange: noop,
        onSearch: noop,
        onReset: noop,
        onJumpToOutbox: noop,
        onReplayOutboxBatchByTrace: noop,
        onJumpToReplayAudits: noop,
        onJumpToAuditTrace: noop,
      }),
    );

    const replayHtml = renderToStaticMarkup(
      createElement(AgentLedgerReplayAuditsSection, {
        apiAvailable: false,
        summary: {
          total: 1,
          byResult: {
            delivered: 0,
            retryable_failure: 1,
            permanent_failure: 0,
          },
        },
        audits: {
          data: [
            {
              id: 1,
              outboxId: 42,
              traceId: "trace-agentledger-ui-002",
              idempotencyKey: "idem-002",
              operatorId: "owner-01",
              triggerSource: "batch_manual",
              attemptNumber: 3,
              result: "retryable_failure",
              httpStatus: 503,
              errorClass: "http_503",
              createdAt: 7,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        },
        sectionError: "",
        outboxIdFilter: "",
        traceFilter: "",
        operatorFilter: "",
        resultFilter: "",
        triggerSourceFilter: "",
        fromFilter: "",
        toFilter: "",
        onOutboxIdFilterChange: noop,
        onTraceFilterChange: noop,
        onOperatorFilterChange: noop,
        onResultFilterChange: noop,
        onTriggerSourceFilterChange: noop,
        onFromFilterChange: noop,
        onToFilterChange: noop,
        onApplyFilters: noop,
        onJumpToAuditTrace: noop,
        formatOptionalDateTime,
      }),
    );

    expect(traceHtml).toContain("接口未开放");
    expect(traceHtml).toContain("需人工回放（replay_required）");
    expect(traceHtml).toContain("需要");
    expect(traceHtml).toContain("阻断（blocking）");
    expect(traceHtml).not.toContain("/api/admin/observability/agentledger");

    expect(replayHtml).toContain("人工回放（manual）");
    expect(replayHtml).toContain("批量人工回放");
    expect(replayHtml).toContain("可重试失败（retryable_failure）");
    expect(replayHtml).not.toContain("/api/admin/observability/agentledger-replay-audits");
  });

  it("Trace 区 Outbox lane 的批量回放按钮应基于 deliveryState 启用/禁用", () => {
    const baseOutboxItem = {
      id: 1,
      traceId: "trace-agentledger-ui-003",
      tenantId: "default",
      projectId: null,
      provider: "claude",
      model: "claude-sonnet",
      resolvedModel: "claude:claude-3-7-sonnet",
      routePolicy: "latest_valid",
      accountId: null,
      status: "success",
      startedAt: "2026-03-08T09:59:58.123Z",
      finishedAt: null,
      errorCode: null,
      cost: null,
      idempotencyKey: "idem-003",
      specVersion: "v1",
      keyId: "tokenpulse-runtime-v1",
      targetUrl: "https://agentledger.example.test/runtime",
      payloadJson: "{}",
      payloadHash: "hash-003",
      headersJson: "{}",
      deliveryState: "delivered",
      attemptCount: 1,
      lastHttpStatus: 200,
      lastErrorClass: null,
      lastErrorMessage: null,
      firstFailedAt: null,
      lastFailedAt: null,
      nextRetryAt: null,
      deliveredAt: 1,
      createdAt: 2,
      updatedAt: 3,
    } as const;

    const baseProps = {
      traceId: "trace-agentledger-ui-003",
      resolvedTraceId: "trace-agentledger-ui-003",
      hasQueried: true,
      loading: false,
      sectionError: "",
      outboxApiAvailable: true,
      outboxSummary: null,
      attemptApiAvailable: false,
      attempts: null,
      attemptSummary: null,
      replayAuditApiAvailable: false,
      replayAudits: null,
      replayAuditSummary: null,
      traceSummary: null,
      auditEvents: [],
      readiness: null,
      health: null,
      formatOptionalDateTime,
      onTraceIdChange: noop,
      onSearch: noop,
      onReset: noop,
      onJumpToOutbox: noop,
      onReplayOutboxBatchByTrace: noop,
      onJumpToReplayAudits: noop,
      onJumpToAuditTrace: noop,
    } as const;

    const disabledHtml = renderToStaticMarkup(
      createElement(AgentLedgerTraceSection, {
        ...baseProps,
        outbox: { data: [{ ...baseOutboxItem, id: 1, deliveryState: "delivered" }], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    );

    expect(disabledHtml).toContain("批量 replay 本 trace 未投递 outbox");
    expect(disabledHtml).toMatch(
      /<button[^>]*(?:data-testid=\"agentledger-trace-outbox-batch-replay\"[^>]*disabled|disabled[^>]*data-testid=\"agentledger-trace-outbox-batch-replay\")[^>]*>/,
    );

    const enabledHtml = renderToStaticMarkup(
      createElement(AgentLedgerTraceSection, {
        ...baseProps,
        outbox: { data: [{ ...baseOutboxItem, id: 2, deliveryState: "replay_required" }], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    );

    expect(enabledHtml).toContain("批量 replay 本 trace 未投递 outbox");
    expect(enabledHtml).not.toMatch(
      /<button[^>]*(?:data-testid=\"agentledger-trace-outbox-batch-replay\"[^>]*disabled|disabled[^>]*data-testid=\"agentledger-trace-outbox-batch-replay\")[^>]*>/,
    );
  });
});
