import { describe, expect, it } from "bun:test";
import {
  getAgentLedgerOutboxReasonLabel,
  normalizeAgentLedgerOutboxReadiness,
  normalizeAgentLedgerReplayBatchResult,
  normalizeAgentLedgerTraceDrilldownResult,
  summarizeAgentLedgerTraceOutbox,
} from "./enterpriseAgentLedgerAdapters";

describe("enterpriseAgentLedgerAdapters", () => {
  it("应保留 AgentLedger readiness 与原因标签适配语义", () => {
    const readiness = normalizeAgentLedgerOutboxReadiness({
      data: {
        blockingReasons: ["worker_cycle_missing"],
        health: {
          enabled: true,
          deliveryConfigured: true,
          backlog: {
            pending: 2,
            delivered: 1,
            retryable_failure: 0,
            replay_required: 0,
          },
        },
      },
    });

    expect(readiness).toMatchObject({
      ready: false,
      status: "blocking",
      blockingReasons: ["worker_cycle_missing"],
    });
    expect(readiness?.health?.backlog.total).toBe(3);
    expect(getAgentLedgerOutboxReasonLabel("worker_cycle_missing")).toBe(
      "worker 尚未产生日志心跳，需确认调度器是否已启动",
    );
    expect(getAgentLedgerOutboxReasonLabel("custom_reason")).toBe("custom_reason");
  });

  it("应归一化 AgentLedger trace 联查结果，并保留汇总字段", () => {
    const normalized = normalizeAgentLedgerTraceDrilldownResult({
      data: {
        summary: {
          traceId: "trace-1",
          currentState: "retryable_failure",
          latestAttemptResult: "retryable_failure",
          latestReplayResult: "delivered",
          needsReplay: "true",
          outboxCount: "1",
          deliveryAttemptCount: "1",
          replayAuditCount: "1",
          auditEventCount: "1",
        },
        outbox: [
          {
            id: 1,
            traceId: "trace-1",
            tenantId: "default",
            provider: "claude",
            model: "sonnet",
            resolvedModel: "claude:sonnet",
            routePolicy: "round_robin",
            status: "success",
            startedAt: "2026-03-08T00:00:00Z",
            idempotencyKey: "key-1",
            specVersion: "v1",
            keyId: "kid-1",
            targetUrl: "https://example.com/webhook",
            payloadJson: "{}",
            payloadHash: "hash-1",
            headersJson: "{}",
            deliveryState: "retryable_failure",
            attemptCount: 2,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        deliveryAttempts: [
          {
            id: 11,
            outboxId: 1,
            traceId: "trace-1",
            idempotencyKey: "key-1",
            source: "worker",
            attemptNumber: 2,
            result: "retryable_failure",
            createdAt: 3,
          },
        ],
        replayAudits: [
          {
            id: 21,
            outboxId: 1,
            traceId: "trace-1",
            idempotencyKey: "key-1",
            operatorId: "boss",
            triggerSource: "manual",
            attemptNumber: 1,
            result: "delivered",
            createdAt: 4,
          },
        ],
        auditEvents: [
          {
            id: 31,
            actor: "boss",
            action: "agentledger.replay",
            resource: "agentledger_outbox",
            traceId: "trace-1",
            result: "success",
            createdAt: "2026-03-08T00:00:00Z",
          },
        ],
        readiness: {
          ready: true,
          status: "ready",
        },
        health: {
          enabled: true,
          deliveryConfigured: true,
          backlog: {
            pending: 0,
            delivered: 1,
            retryable_failure: 0,
            replay_required: 0,
          },
        },
      },
    });

    expect(normalized?.summary).toMatchObject({
      traceId: "trace-1",
      currentState: "retryable_failure",
      latestAttemptResult: "retryable_failure",
      latestReplayResult: "delivered",
      needsReplay: true,
    });
    expect(normalized?.outbox).toHaveLength(1);
    expect(normalized?.deliveryAttempts).toHaveLength(1);
    expect(normalized?.replayAudits).toHaveLength(1);
    expect(normalized?.auditEvents[0]?.actor).toBe("boss");
    expect(normalized?.readiness?.status).toBe("ready");
    expect(normalized?.health?.backlog.total).toBe(1);
  });

  it("应保留批量 replay 结果与 trace outbox 汇总的适配结果", () => {
    const batchResult = normalizeAgentLedgerReplayBatchResult({
      data: {
        requestedCount: "3",
        processedCount: "2",
        successCount: "1",
        failureCount: "1",
        notFoundCount: "1",
        notConfiguredCount: "0",
        items: [
          {
            id: 1,
            ok: true,
            result: "delivered",
            traceId: "trace-1",
            deliveryState: "delivered",
          },
          {
            id: 2,
            ok: false,
            code: "not_found",
            errorMessage: "missing",
          },
          {
            id: 0,
            ok: false,
          },
        ],
      },
    });
    const outboxSummary = summarizeAgentLedgerTraceOutbox([
      {
        id: 1,
        traceId: "trace-1",
        tenantId: "default",
        projectId: null,
        provider: "claude",
        model: "sonnet",
        resolvedModel: "claude:sonnet",
        routePolicy: "round_robin",
        accountId: null,
        status: "success",
        startedAt: "2026-03-08T00:00:00Z",
        finishedAt: null,
        errorCode: null,
        cost: null,
        idempotencyKey: "key-1",
        specVersion: "v1",
        keyId: "kid-1",
        targetUrl: "https://example.com/webhook",
        payloadJson: "{}",
        payloadHash: "hash-1",
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
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 2,
        traceId: "trace-2",
        tenantId: "default",
        projectId: null,
        provider: "claude",
        model: "haiku",
        resolvedModel: "claude:haiku",
        routePolicy: "sticky_user",
        accountId: null,
        status: "failure",
        startedAt: "2026-03-08T00:05:00Z",
        finishedAt: null,
        errorCode: "timeout",
        cost: null,
        idempotencyKey: "key-2",
        specVersion: "v1",
        keyId: "kid-1",
        targetUrl: "https://example.com/webhook",
        payloadJson: "{}",
        payloadHash: "hash-2",
        headersJson: "{}",
        deliveryState: "retryable_failure",
        attemptCount: 2,
        lastHttpStatus: 500,
        lastErrorClass: "FetchError",
        lastErrorMessage: "boom",
        firstFailedAt: 2,
        lastFailedAt: 3,
        nextRetryAt: 4,
        deliveredAt: null,
        createdAt: 2,
        updatedAt: 4,
      },
    ]);

    expect(batchResult).toMatchObject({
      requestedCount: 3,
      processedCount: 2,
      successCount: 1,
      failureCount: 1,
      notFoundCount: 1,
      notConfiguredCount: 0,
    });
    expect(batchResult.items).toHaveLength(2);
    expect(batchResult.items[1]).toMatchObject({
      id: 2,
      code: "not_found",
      errorMessage: "missing",
    });
    expect(outboxSummary).toEqual({
      total: 2,
      byDeliveryState: {
        pending: 0,
        delivered: 1,
        retryable_failure: 1,
        replay_required: 0,
      },
      byStatus: {
        success: 1,
        failure: 1,
        blocked: 0,
        timeout: 0,
      },
    });
  });
});
