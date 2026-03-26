import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const alertRulesPath = join(repoRoot, "monitoring", "alert_rules.yml");

describe("AgentLedger Prometheus 告警规则", () => {
  it("应包含 AgentLedger worker / backlog / replay_required 规则", () => {
    const content = readFileSync(alertRulesPath, "utf8");

    expect(content).toContain('name: "tokenpulse-agentledger-runtime"');
    expect(content).toContain('alert: "TokenPulseAgentLedgerDeliveryNotConfigured"');
    expect(content).toContain('alert: "TokenPulseAgentLedgerWorkerStale"');
    expect(content).toContain('alert: "TokenPulseAgentLedgerOpenBacklogStale"');
    expect(content).toContain('alert: "TokenPulseAgentLedgerReplayRequiredBacklog"');
  });

  it("应使用 AgentLedger runtime 配置、心跳与 backlog 指标", () => {
    const content = readFileSync(alertRulesPath, "utf8");

    expect(content).toContain('tokenpulse_agentledger_runtime_worker_config_state{state="enabled"}');
    expect(content).toContain(
      'tokenpulse_agentledger_runtime_worker_config_state{state="delivery_configured"}',
    );
    expect(content).toContain("tokenpulse_agentledger_runtime_last_cycle_timestamp_seconds");
    expect(content).toContain("tokenpulse_agentledger_runtime_open_backlog_total");
    expect(content).toContain("tokenpulse_agentledger_runtime_oldest_open_backlog_age_seconds");
    expect(content).toContain(
      'tokenpulse_agentledger_runtime_outbox_backlog{delivery_state="replay_required"}',
    );
  });
});
