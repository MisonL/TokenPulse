import { describe, expect, it } from "bun:test";
import { validateCapabilityRuntimeHealth } from "../src/lib/oauth/runtime-adapters";

describe("OAuth 能力一致性校验", () => {
  it("默认能力图谱应与运行时适配器一致", () => {
    const report = validateCapabilityRuntimeHealth({
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
    });

    expect(report.ok).toBe(true);
    expect(report.issueCount).toBe(0);
  });

  it("manual callback 不一致时应给出告警", () => {
    const report = validateCapabilityRuntimeHealth({
      claude: {
        provider: "claude",
        flows: ["auth_code"],
        supportsChat: true,
        supportsModelList: true,
        supportsStream: true,
        supportsManualCallback: false,
      },
    });

    expect(report.ok).toBe(false);
    expect(report.issueCount).toBeGreaterThan(0);
    expect(report.issues.some((item) => item.code === "manual_callback_mismatch")).toBe(true);
  });
});
