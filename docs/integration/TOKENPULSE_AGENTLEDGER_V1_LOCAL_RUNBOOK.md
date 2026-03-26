# TokenPulse × AgentLedger v1 本地联调 Runbook

## 目的
- 在本地 Docker 环境完成 TokenPulse → AgentLedger v1 联调验证。
- 产出可留档的 evidence 文件，便于评审与问题追踪。

## 步骤

1. 启动 AgentLedger 本地 Docker

```bash
cd /Volumes/Work/code/AgentLedger
docker compose -f deploy/docker-compose.tokenpulse-v1.yml up -d --build
```

2. 准备 TokenPulse 联调环境文件（示例）

```bash
cat > /tmp/tokenpulse_agentledger_env <<'EOF'
TOKENPULSE_AGENTLEDGER_ENABLED=true
AGENTLEDGER_RUNTIME_INGEST_URL=http://127.0.0.1:18080/api/v1/integrations/tokenpulse/runtime-events
TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET=tp_agl_v1_shared_secret
TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID=tokenpulse-runtime-v1
TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID=default
EOF
```

3. 启动 TokenPulse（core + enterprise）

```bash
cd /Volumes/Work/code/TokenPulse
ENABLE_ADVANCED=true \
TRUST_PROXY=true \
ADMIN_TRUST_HEADER_AUTH=true \
ADMIN_AUTH_MODE=header \
API_SECRET=tokenpulse-secret-2026 \
DATABASE_URL=postgresql://tokenpulse:tokenpulse@127.0.0.1:55433/tokenpulse \
PORT=9009 \
PORT_ENTERPRISE=9010 \
bun run start:stack
```

4. 正向演练（202/200）

```bash
cd /Volumes/Work/code/TokenPulse
bash scripts/release/drill_agentledger_runtime_webhook.sh \
  --env-file /tmp/tokenpulse_agentledger_env \
  --evidence-file ./artifacts/agentledger-runtime-drill-evidence.json
```

5. 负向演练（401/401/400）

```bash
cd /Volumes/Work/code/TokenPulse
bash scripts/release/drill_agentledger_runtime_webhook.sh \
  --env-file /tmp/tokenpulse_agentledger_env \
  --with-negative \
  --evidence-file ./artifacts/agentledger-runtime-drill-evidence.json
```

6. 全量编排校验（含 post canary）

```bash
cd /Volumes/Work/code/TokenPulse
bash scripts/release/validate_enterprise_runtime_bundle.sh \
  --base-url http://127.0.0.1:9009 \
  --api-secret tokenpulse-secret-2026 \
  --env-file /tmp/tokenpulse_agentledger_env \
  --with-post-canary true \
  --with-agentledger-negative true
```

## 验证
- `drill_agentledger_runtime_webhook.sh` 输出 `AgentLedger runtime webhook 合同演练通过`。
- evidence 文件存在：
  - `./artifacts/agentledger-runtime-drill-evidence.json`
  - 负向演练时包含 `negativeCases` 数组且均为 `passed: true`。
- `validate_enterprise_runtime_bundle.sh` 输出 `企业域运行时编排校验通过`。
- `validate_enterprise_runtime_bundle.sh` 默认输出 `./artifacts/enterprise-runtime-bundle-evidence.json`。

## 回滚
- AgentLedger 侧：移除 `AGENTLEDGER_TOKENPULSE_WEBHOOK_SECRET` 或停止 compose 服务。
- TokenPulse 侧：停掉本地进程或临时关闭 `TOKENPULSE_AGENTLEDGER_ENABLED`。
