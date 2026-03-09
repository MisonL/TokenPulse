import { describe, expect, it } from "bun:test";
import {
  buildAgentLedgerRuntimeContract,
  normalizeAgentLedgerResolvedModelValue,
  normalizeAgentLedgerRoutePolicyValue,
  normalizeAgentLedgerRuntimePayload,
  normalizeAgentLedgerTenantId,
} from "../src/lib/agentledger/runtime-contract";

describe("AgentLedger runtime contract", () => {
  it("应归一化 tenantId、routePolicy、status、resolvedModel 与 cost", () => {
    const payload = normalizeAgentLedgerRuntimePayload(
      {
        traceId: "trace-runtime-contract-001",
        tenantId: " DEFAULT ",
        provider: "Claude",
        model: "claude-sonnet",
        resolvedModel: "claude-3-7-sonnet-20250219",
        routePolicy: "UNKNOWN_POLICY",
        status: "unexpected" as never,
        startedAt: "2026-03-09T09:00:00.000Z",
        finishedAt: "2026-03-09T09:00:01.000Z",
        cost: "invalid-cost",
      },
      {
        defaultRoutePolicy: "latest_valid",
      },
    );

    expect(payload.tenantId).toBe("default");
    expect(payload.provider).toBe("claude");
    expect(payload.model).toBe("claude-sonnet");
    expect(payload.resolvedModel).toBe("claude:claude-3-7-sonnet-20250219");
    expect(payload.routePolicy).toBe("latest_valid");
    expect(payload.status).toBe("failure");
    expect(payload.cost).toBeUndefined();
  });

  it("应仅接受冻结的三种 routePolicy，并对 resolvedModel 自动补 provider 前缀", () => {
    expect(normalizeAgentLedgerRoutePolicyValue("round_robin", "latest_valid")).toBe(
      "round_robin",
    );
    expect(normalizeAgentLedgerRoutePolicyValue("sticky_user", "latest_valid")).toBe(
      "sticky_user",
    );
    expect(normalizeAgentLedgerRoutePolicyValue("legacy", "latest_valid")).toBe(
      "latest_valid",
    );

    expect(
      normalizeAgentLedgerResolvedModelValue("openai", "gpt-4.1-mini", "gpt-4.1"),
    ).toBe("openai:gpt-4.1");
    expect(
      normalizeAgentLedgerResolvedModelValue(
        "openai",
        "gpt-4.1-mini",
        "openai:gpt-4.1-mini-20250301",
      ),
    ).toBe("openai:gpt-4.1-mini-20250301");
  });

  it("应基于冻结字段生成稳定 payloadJson 与 idempotencyKey", () => {
    const contract = buildAgentLedgerRuntimeContract(
      {
        traceId: "trace-runtime-contract-002",
        tenantId: "tenant-a",
        projectId: "project-ai",
        provider: "OpenAI",
        model: "gpt-4.1-mini",
        resolvedModel: "gpt-4.1",
        routePolicy: "round_robin",
        accountId: "acct-01",
        status: "timeout",
        startedAt: "2026-03-09T09:05:00.000Z",
        finishedAt: "2026-03-09T09:05:08.000Z",
        errorCode: "request_timeout",
        cost: "0.002310",
      },
      {
        defaultRoutePolicy: "latest_valid",
        specVersion: "v1",
        keyId: "tokenpulse-runtime-v1",
      },
    );

    expect(contract.payload).toMatchObject({
      tenantId: "tenant-a",
      projectId: "project-ai",
      provider: "openai",
      model: "gpt-4.1-mini",
      resolvedModel: "openai:gpt-4.1",
      routePolicy: "round_robin",
      status: "timeout",
      errorCode: "request_timeout",
      cost: "0.002310",
    });
    expect(contract.payloadJson).toContain('"tenantId":"tenant-a"');
    expect(contract.payloadJson).toContain('"routePolicy":"round_robin"');
    expect(contract.payloadJson).toContain('"resolvedModel":"openai:gpt-4.1"');
    expect(contract.baseHeaders["X-TokenPulse-Spec-Version"]).toBe("v1");
    expect(contract.baseHeaders["X-TokenPulse-Key-Id"]).toBe("tokenpulse-runtime-v1");
    expect(contract.baseHeaders["X-TokenPulse-Idempotency-Key"]).toBe(contract.idempotencyKey);
    expect(contract.idempotencyKey).toHaveLength(64);
    expect(contract.payloadHash).toHaveLength(64);
  });

  it("应在 tenantId 缺失时回退到 default", () => {
    expect(normalizeAgentLedgerTenantId("")).toBe("default");
    expect(normalizeAgentLedgerTenantId("  ")).toBe("default");
    expect(normalizeAgentLedgerTenantId("TENANT_X")).toBe("tenant_x");
  });
});
