import { describe, expect, it } from "bun:test";
import {
  buildQuotaPolicyCreatePayload,
  buildQuotaPolicyUpdatePayload,
} from "./enterprisePolicyEditors";

describe("enterprisePolicyEditors", () => {
  it("应构造 global 策略创建 payload，且不携带 scopeValue 与空串数值", () => {
    expect(
      buildQuotaPolicyCreatePayload({
        name: "  全局策略  ",
        scopeType: "global",
        scopeValue: "   ",
        provider: " claude ",
        modelPattern: " claude-3-* ",
        requestsPerMinute: "",
        tokensPerMinute: "120",
        tokensPerDay: " ",
        enabled: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "全局策略",
        scopeType: "global",
        scopeValue: undefined,
        provider: "claude",
        modelPattern: "claude-3-*",
        requestsPerMinute: undefined,
        tokensPerMinute: 120,
        tokensPerDay: undefined,
        enabled: true,
      },
    });
  });

  it("应要求 tenant/role/user scopeValue 必填，并保留既有归一化语义", () => {
    expect(
      buildQuotaPolicyCreatePayload({
        name: "租户策略",
        scopeType: "tenant",
        scopeValue: " ",
        provider: "",
        modelPattern: "",
        requestsPerMinute: "",
        tokensPerMinute: "",
        tokensPerDay: "",
        enabled: true,
      }),
    ).toEqual({
      ok: false,
      error: "scopeType=tenant 时必须填写 scopeValue",
    });

    expect(
      buildQuotaPolicyCreatePayload({
        name: "角色策略",
        scopeType: "role",
        scopeValue: " OWNER ",
        provider: "",
        modelPattern: "",
        requestsPerMinute: "0",
        tokensPerMinute: "",
        tokensPerDay: "",
        enabled: false,
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "角色策略",
        scopeType: "role",
        scopeValue: "owner",
        provider: undefined,
        modelPattern: undefined,
        requestsPerMinute: 0,
        tokensPerMinute: undefined,
        tokensPerDay: undefined,
        enabled: false,
      },
    });

    expect(
      buildQuotaPolicyCreatePayload({
        name: "用户策略",
        scopeType: "user",
        scopeValue: " User-001 ",
        provider: "",
        modelPattern: "",
        requestsPerMinute: "",
        tokensPerMinute: "",
        tokensPerDay: "",
        enabled: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "用户策略",
        scopeType: "user",
        scopeValue: "User-001",
        provider: undefined,
        modelPattern: undefined,
        requestsPerMinute: undefined,
        tokensPerMinute: undefined,
        tokensPerDay: undefined,
        enabled: true,
      },
    });
  });

  it("应在创建策略时透传数值校验错误", () => {
    expect(
      buildQuotaPolicyCreatePayload({
        name: "非法策略",
        scopeType: "global",
        scopeValue: "",
        provider: "",
        modelPattern: "",
        requestsPerMinute: "-1",
        tokensPerMinute: "",
        tokensPerDay: "",
        enabled: true,
      }),
    ).toEqual({
      ok: false,
      error: "RPM 必须是非负整数",
    });
  });

  it("应构造策略编辑 payload，并将空串数值转换为 undefined", () => {
    expect(
      buildQuotaPolicyUpdatePayload({
        requestsPerMinute: "",
        tokensPerMinute: "60000",
        tokensPerDay: " ",
        enabled: false,
      }),
    ).toEqual({
      ok: true,
      value: {
        requestsPerMinute: undefined,
        tokensPerMinute: 60000,
        tokensPerDay: undefined,
        enabled: false,
      },
    });
  });
});
