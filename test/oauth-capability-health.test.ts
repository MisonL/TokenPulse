import { describe, expect, it } from "bun:test";
import {
  getProviderRuntimeAdapter,
  overrideProviderRuntimeAdapterForTest,
  validateCapabilityRuntimeHealth,
} from "../src/lib/oauth/runtime-adapters";

type HealthInput = Parameters<typeof validateCapabilityRuntimeHealth>[0];

function buildAlignedCapabilityMap(): HealthInput {
  return {
    claude: {
      provider: "claude",
      flows: ["auth_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    },
    gemini: {
      provider: "gemini",
      flows: ["auth_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    },
    codex: {
      provider: "codex",
      flows: ["auth_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    },
    iflow: {
      provider: "iflow",
      flows: ["auth_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    },
    antigravity: {
      provider: "antigravity",
      flows: ["auth_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    },
    qwen: {
      provider: "qwen",
      flows: ["device_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: false,
    },
    kiro: {
      provider: "kiro",
      flows: ["device_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    },
    copilot: {
      provider: "copilot",
      flows: ["device_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    },
    aistudio: {
      provider: "aistudio",
      flows: ["manual_key"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: false,
    },
    vertex: {
      provider: "vertex",
      flows: ["service_account"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: false,
    },
  };
}

describe("OAuth 能力一致性校验", () => {
  it("默认能力图谱应与运行时适配器一致", () => {
    const report = validateCapabilityRuntimeHealth(buildAlignedCapabilityMap());

    expect(report.ok).toBe(true);
    expect(report.issueCount).toBe(0);
  });

  it("capability 存在但 adapter 缺失时应使用 capability_missing_adapter code", () => {
    const capabilityMap = buildAlignedCapabilityMap();
    capabilityMap.mock_provider = {
      provider: "mock_provider",
      flows: ["auth_code"],
      supportsChat: true,
      supportsModelList: true,
      supportsStream: true,
      supportsManualCallback: true,
    };

    const report = validateCapabilityRuntimeHealth(capabilityMap);
    const issue = report.issues.find((item) => item.provider === "mock_provider");

    expect(issue).toBeTruthy();
    expect(issue?.code).toBe("capability_missing_adapter");
    expect(issue?.message).toContain("已存在能力图谱，但缺少运行时适配器");
  });

  it("adapter 存在但 capability 缺失时应使用 adapter_missing_capability code", () => {
    const capabilityMap = buildAlignedCapabilityMap();
    delete capabilityMap.claude;

    const report = validateCapabilityRuntimeHealth(capabilityMap);
    const issue = report.issues.find((item) => item.provider === "claude");

    expect(issue).toBeTruthy();
    expect(issue?.code).toBe("adapter_missing_capability");
    expect(issue?.message).toContain("已存在运行时适配器，但缺少能力图谱");
  });

  it("manual callback 不一致时应给出告警", () => {
    const capabilityMap = buildAlignedCapabilityMap();
    const claude = capabilityMap.claude!;
    capabilityMap.claude = {
      ...claude,
      supportsManualCallback: false,
    };
    const report = validateCapabilityRuntimeHealth(capabilityMap);
    const issue = report.issues.find(
      (item) =>
        item.provider === "claude" && item.code === "manual_callback_mismatch",
    );

    expect(issue).toBeTruthy();
  });

  it("capability 启用 device_code 但 runtime 缺少 poll handler/flow 时应告警", () => {
    const current = getProviderRuntimeAdapter("qwen");
    expect(current).toBeTruthy();

    const restore = overrideProviderRuntimeAdapterForTest("qwen", {
      ...current!,
      poll: undefined,
      pollFlows: [],
    });

    try {
      const report = validateCapabilityRuntimeHealth(buildAlignedCapabilityMap());
      const issue = report.issues.find(
        (item) =>
          item.provider === "qwen" &&
          item.code === "poll_flows_mismatch" &&
          item.message.includes("capability 启用 device_code"),
      );

      expect(issue).toBeTruthy();
      expect(issue?.message).toContain("poll flow 缺少 device_code");
      expect(issue?.message).toContain("poll handler 缺失");
    } finally {
      restore();
    }
  });
});
