import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { QuotaCheckResult, QuotaMeteringRecord } from "../src/lib/admin/quota";
import { config } from "../src/config";

const checkAndConsumeQuotaMock = mock(
  async (): Promise<QuotaCheckResult> => ({ allowed: true }),
);
const reconcileQuotaUsageMock = mock(
  async (): Promise<QuotaMeteringRecord[]> => [],
);
const writeAuditEventMock = mock(async () => {});

// 避免 mock.module 污染其他测试文件：缓存原始导出并在 afterAll 恢复。
type QuotaModule = typeof import("../src/lib/admin/quota");
const quotaOriginal = (await import(
  `../src/lib/admin/quota?quota-middleware-audit=${Date.now()}-${Math.random().toString(16).slice(2)}`
)) as QuotaModule;

type AuditModule = typeof import("../src/lib/admin/audit");
const auditOriginal = (await import(
  `../src/lib/admin/audit?quota-middleware-audit=${Date.now()}-${Math.random().toString(16).slice(2)}`
)) as AuditModule;
const auditOriginalExports = {
  buildAuditEventsCsv: auditOriginal.buildAuditEventsCsv,
  queryAuditEvents: auditOriginal.queryAuditEvents,
  writeAuditEvent: auditOriginal.writeAuditEvent,
};

mock.module("../src/lib/admin/quota", () => ({
  ...quotaOriginal,
  QUOTA_METERING_MODE: "estimate_then_reconcile",
  checkAndConsumeQuota: checkAndConsumeQuotaMock,
  reconcileQuotaUsage: reconcileQuotaUsageMock,
}));

mock.module("../src/lib/admin/audit", () => ({
  ...auditOriginalExports,
  writeAuditEvent: writeAuditEventMock,
}));

const { quotaMiddleware } = await import("../src/middleware/quota");
const { requestContextMiddleware } = await import("../src/middleware/request-context");

describe("quotaMiddleware 审计链路", () => {
  const app = new Hono();
  app.use("*", requestContextMiddleware);
  app.use("/v1/*", quotaMiddleware);
  app.post("/v1/chat/completions", (c) =>
    c.json({ ok: true, usage: { total_tokens: 10 } }),
  );

  beforeEach(() => {
    checkAndConsumeQuotaMock.mockReset();
    reconcileQuotaUsageMock.mockReset();
    writeAuditEventMock.mockReset();
  });

  afterAll(() => {
    mock.module("../src/lib/admin/quota", () => ({
      ...quotaOriginal,
    }));
    mock.module("../src/lib/admin/audit", () => ({
      ...auditOriginalExports,
    }));
  });

  it("配额拒绝时应返回 traceId/policyId 并写入可追踪审计事件", async () => {
    checkAndConsumeQuotaMock.mockImplementationOnce(
      async (): Promise<QuotaCheckResult> => ({
        allowed: false,
        status: 429,
        reason: "请求超出每分钟限制（策略：tenant-limit）",
        policyId: "policy-tenant-1",
        meteringMode: "estimate_then_reconcile",
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "trace-quota-001",
          "X-TokenPulse-User": "alice",
          "X-TokenPulse-Tenant": "tenant-a",
          "X-TokenPulse-Role": "ops",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "hello" }],
          max_tokens: 256,
        }),
      }),
    );

    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.traceId).toBe("trace-quota-001");
    expect(payload.policyId).toBe("policy-tenant-1");
    expect(payload.provider).toBe("gemini");
    expect(payload.model).toBe("gemini-2.0-flash");
    expect(payload.meteringMode).toBe("estimate_then_reconcile");

    expect(writeAuditEventMock).toHaveBeenCalledTimes(1);
    const firstCall = writeAuditEventMock.mock.calls[0] as unknown[] | undefined;
    const event = (firstCall?.[0] || {}) as Record<string, unknown>;
    expect(event.traceId).toBe("trace-quota-001");
    expect(event.resourceId).toBe("policy-tenant-1");
    expect(event.action).toBe("quota.reject");
    expect(event.actor).toBe("api-secret");
    expect((event.details as Record<string, unknown>)?.tenantId).toBe(null);
    expect((event.details as Record<string, unknown>)?.roleKey).toBe(null);
    expect((event.details as Record<string, unknown>)?.identitySource).toBe("default");

    expect(checkAndConsumeQuotaMock).toHaveBeenCalledTimes(1);
    const quotaCall = checkAndConsumeQuotaMock.mock.calls[0] as unknown[] | undefined;
    const quotaInput = (quotaCall?.[0] || {}) as Record<string, unknown>;
    expect(quotaInput.userKey).toBe("api-secret");
    expect(quotaInput.tenantId).toBeUndefined();
    expect(quotaInput.roleKey).toBeUndefined();
  });

  it("TRUST_PROXY=true 时应采信 x-tokenpulse 身份头", async () => {
    const originalTrustProxy = config.trustProxy;
    config.trustProxy = true;

    checkAndConsumeQuotaMock.mockImplementationOnce(
      async (): Promise<QuotaCheckResult> => ({
        allowed: false,
        status: 429,
        reason: "请求超出每分钟限制（策略：tenant-limit）",
        policyId: "policy-tenant-2",
        meteringMode: "estimate_then_reconcile",
      }),
    );

    try {
      const response = await app.fetch(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": "trace-quota-002",
            "X-TokenPulse-User": "alice",
            "X-TokenPulse-Tenant": "tenant-a",
            "X-TokenPulse-Role": "ops",
          },
          body: JSON.stringify({
            model: "gemini-2.0-flash",
            messages: [{ role: "user", content: "hello" }],
            max_tokens: 256,
          }),
        }),
      );

      expect(response.status).toBe(429);
      expect(writeAuditEventMock).toHaveBeenCalledTimes(1);
      const firstCall = writeAuditEventMock.mock.calls[0] as unknown[] | undefined;
      const event = (firstCall?.[0] || {}) as Record<string, unknown>;
      expect(event.actor).toBe("alice");
      expect((event.details as Record<string, unknown>)?.tenantId).toBe("tenant-a");
      expect((event.details as Record<string, unknown>)?.roleKey).toBe("ops");
      expect((event.details as Record<string, unknown>)?.identitySource).toBe("trusted_headers");

      expect(checkAndConsumeQuotaMock).toHaveBeenCalledTimes(1);
      const quotaCall = checkAndConsumeQuotaMock.mock.calls[0] as unknown[] | undefined;
      const quotaInput = (quotaCall?.[0] || {}) as Record<string, unknown>;
      expect(quotaInput.userKey).toBe("alice");
      expect(quotaInput.tenantId).toBe("tenant-a");
      expect(quotaInput.roleKey).toBe("ops");
    } finally {
      config.trustProxy = originalTrustProxy;
    }
  });

  it("配额允许时应放行请求且不写入 reject 审计", async () => {
    checkAndConsumeQuotaMock.mockImplementationOnce(
      async (): Promise<QuotaCheckResult> => ({
        allowed: true,
        meteringMode: "estimate_then_reconcile",
        matchedWindows: [
          {
            policyId: "policy-tenant-1",
            minuteStart: 1000,
            dayStart: 0,
          },
        ],
      }),
    );
    reconcileQuotaUsageMock.mockImplementationOnce(async () => [
      {
        policyId: "policy-tenant-1",
        estimatedTokens: 4,
        actualTokens: 10,
        reconciledDelta: 6,
      },
    ]);

    const response = await app.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "trace-quota-allow-001",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 1,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tokenpulse-quota-metering")).toBe("estimate_then_reconcile");
    expect(reconcileQuotaUsageMock).toHaveBeenCalledTimes(1);
    expect(writeAuditEventMock).toHaveBeenCalledTimes(1);
    const firstCall = writeAuditEventMock.mock.calls[0] as unknown[] | undefined;
    const event = (firstCall?.[0] || {}) as Record<string, unknown>;
    expect(event.action).toBe("quota.reconcile");
  });

  it("上游失败且无 usage 时应按 0 token 进行校正", async () => {
    const errorApp = new Hono();
    errorApp.use("*", requestContextMiddleware);
    errorApp.use("/v1/*", quotaMiddleware);
    errorApp.post("/v1/chat/completions", () =>
      new Response(JSON.stringify({ error: "upstream failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
    );

    checkAndConsumeQuotaMock.mockImplementationOnce(
      async (): Promise<QuotaCheckResult> => ({
        allowed: true,
        meteringMode: "estimate_then_reconcile",
        matchedWindows: [
          {
            policyId: "policy-fail-1",
            minuteStart: 1000,
            dayStart: 0,
          },
        ],
      }),
    );

    await errorApp.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "trace-quota-err-001",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "error" }],
          max_tokens: 32,
        }),
      }),
    );

    expect(reconcileQuotaUsageMock).toHaveBeenCalledTimes(1);
    const firstCall = reconcileQuotaUsageMock.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] || {}) as Record<string, unknown>;
    expect(payload.actualTokens).toBe(0);
  });
});
