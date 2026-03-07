#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
AgentLedger runtime webhook 合同演练脚本

用法:
  ./scripts/release/drill_agentledger_runtime_webhook.sh [参数]

参数:
  --env-file <path>        加载环境变量文件后执行演练
  --evidence-file <path>   输出 evidence JSON，默认: ./artifacts/agentledger-runtime-drill-evidence.json
  --trace-id <id>          指定 traceId；默认自动生成
  --tenant-id <id>         指定 tenantId，默认: default
  --project-id <id>        指定 projectId（可选）
  --provider <name>        指定 provider，默认: claude
  --model <name>           指定 model，默认: claude-sonnet
  --resolved-model <name>  指定 resolvedModel，默认: claude:claude-3-7-sonnet-20250219
  --route-policy <name>    指定 routePolicy，默认: latest_valid
  --account-id <id>        指定 accountId（可选）
  --status <value>         指定 status，默认: success
  --started-at <iso8601>   指定 startedAt；默认: 当前时间前 1 秒
  --finished-at <iso8601>  指定 finishedAt；默认: 当前时间
  --error-code <code>      指定 errorCode（可选）
  --cost <decimal>         指定 cost（可选），默认: 0.002310
  --insecure               curl 使用 -k（仅测试环境）
  --help                   显示帮助

说明:
  1) 首次发送期望返回 202，表示已完成幂等登记与持久化保存。
  2) 第二次使用同一 idempotency-key 重放，期望返回 200，表示幂等命中。
  3) 无论成功或失败，都会输出 evidence JSON，便于联调留档。
EOF
}

ENV_FILE=""
EVIDENCE_FILE="./artifacts/agentledger-runtime-drill-evidence.json"
TRACE_ID=""
TENANT_ID="default"
PROJECT_ID=""
PROVIDER="claude"
MODEL="claude-sonnet"
RESOLVED_MODEL="claude:claude-3-7-sonnet-20250219"
ROUTE_POLICY="latest_valid"
ACCOUNT_ID=""
STATUS="success"
STARTED_AT=""
FINISHED_AT=""
ERROR_CODE=""
COST="0.002310"
INSECURE="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --evidence-file)
      EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --trace-id)
      TRACE_ID="${2:-}"
      shift 2
      ;;
    --tenant-id)
      TENANT_ID="${2:-}"
      shift 2
      ;;
    --project-id)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --provider)
      PROVIDER="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --resolved-model)
      RESOLVED_MODEL="${2:-}"
      shift 2
      ;;
    --route-policy)
      ROUTE_POLICY="${2:-}"
      shift 2
      ;;
    --account-id)
      ACCOUNT_ID="${2:-}"
      shift 2
      ;;
    --status)
      STATUS="${2:-}"
      shift 2
      ;;
    --started-at)
      STARTED_AT="${2:-}"
      shift 2
      ;;
    --finished-at)
      FINISHED_AT="${2:-}"
      shift 2
      ;;
    --error-code)
      ERROR_CODE="${2:-}"
      shift 2
      ;;
    --cost)
      COST="${2:-}"
      shift 2
      ;;
    --insecure)
      INSECURE="1"
      shift 1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      tp_fail "未知参数: $1"
      ;;
  esac
done

if [[ -n "${ENV_FILE}" ]]; then
  if [[ ! -f "${ENV_FILE}" ]]; then
    tp_fail "环境文件不存在: ${ENV_FILE}"
  fi
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

tp_require_cmd curl
tp_require_cmd openssl

tp_trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

tp_is_true() {
  local lowered
  lowered="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${lowered}" == "1" || "${lowered}" == "true" || "${lowered}" == "yes" ]]
}

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "${value}"
}

sha256_hex() {
  openssl dgst -sha256 | sed 's/^.*= //'
}

hmac_sha256_hex() {
  local secret="$1"
  openssl dgst -sha256 -hmac "${secret}" | sed 's/^.*= //'
}

iso_now() {
  tp_format_iso_utc "$(date +%s)"
}

iso_one_second_ago() {
  tp_format_iso_utc "$(( $(date +%s) - 1 ))"
}

build_payload_json() {
  local json=""
  json+="{"
  json+="\"tenantId\":\"$(json_escape "${TENANT_ID}")\""
  if [[ -n "${PROJECT_ID}" ]]; then
    json+=",\"projectId\":\"$(json_escape "${PROJECT_ID}")\""
  fi
  json+=",\"traceId\":\"$(json_escape "${TRACE_ID}")\""
  json+=",\"provider\":\"$(json_escape "${PROVIDER}")\""
  json+=",\"model\":\"$(json_escape "${MODEL}")\""
  json+=",\"resolvedModel\":\"$(json_escape "${RESOLVED_MODEL}")\""
  json+=",\"routePolicy\":\"$(json_escape "${ROUTE_POLICY}")\""
  if [[ -n "${ACCOUNT_ID}" ]]; then
    json+=",\"accountId\":\"$(json_escape "${ACCOUNT_ID}")\""
  fi
  json+=",\"status\":\"$(json_escape "${STATUS}")\""
  json+=",\"startedAt\":\"$(json_escape "${STARTED_AT}")\""
  if [[ -n "${FINISHED_AT}" ]]; then
    json+=",\"finishedAt\":\"$(json_escape "${FINISHED_AT}")\""
  fi
  if [[ -n "${ERROR_CODE}" ]]; then
    json+=",\"errorCode\":\"$(json_escape "${ERROR_CODE}")\""
  fi
  if [[ -n "${COST}" ]]; then
    json+=",\"cost\":\"$(json_escape "${COST}")\""
  fi
  json+="}"
  printf '%s' "${json}"
}

build_idempotency_source_json() {
  local json=""
  json+="{"
  json+="\"tenantId\":\"$(json_escape "${TENANT_ID}")\""
  json+=",\"traceId\":\"$(json_escape "${TRACE_ID}")\""
  json+=",\"provider\":\"$(json_escape "${PROVIDER}")\""
  json+=",\"model\":\"$(json_escape "${MODEL}")\""
  json+=",\"startedAt\":\"$(json_escape "${STARTED_AT}")\""
  json+="}"
  printf '%s' "${json}"
}

write_evidence() {
  local finished_at="$1"
  local contract_passed="$2"
  local failure_reason="$3"
  local first_http_code="$4"
  local first_body="$5"
  local second_http_code="$6"
  local second_body="$7"
  local second_skipped="$8"

  mkdir -p "$(dirname "${EVIDENCE_FILE}")"

  {
    printf '{\n'
    printf '  "startedAt": "%s",\n' "$(json_escape "${DRILL_STARTED_AT}")"
    printf '  "finishedAt": "%s",\n' "$(json_escape "${finished_at}")"
    printf '  "contractPassed": %s,\n' "${contract_passed}"
    printf '  "failureReason": %s,\n' "$(
      if [[ -n "${failure_reason}" ]]; then
        printf '"%s"' "$(json_escape "${failure_reason}")"
      else
        printf 'null'
      fi
    )"
    printf '  "specVersion": "%s",\n' "$(json_escape "${SPEC_VERSION}")"
    printf '  "ingestUrl": "%s",\n' "$(json_escape "${INGEST_URL}")"
    printf '  "traceId": "%s",\n' "$(json_escape "${TRACE_ID}")"
    printf '  "idempotencyKey": "%s",\n' "$(json_escape "${IDEMPOTENCY_KEY}")"
    printf '  "payloadHash": "%s",\n' "$(json_escape "${PAYLOAD_HASH}")"
    printf '  "payload": %s,\n' "${PAYLOAD_JSON}"
    printf '  "requestHeaders": {\n'
    printf '    "X-TokenPulse-Spec-Version": "%s",\n' "$(json_escape "${SPEC_VERSION}")"
    printf '    "X-TokenPulse-Key-Id": "%s",\n' "$(json_escape "${KEY_ID}")"
    printf '    "X-TokenPulse-Timestamp": "%s",\n' "$(json_escape "${REQUEST_TIMESTAMP}")"
    printf '    "X-TokenPulse-Idempotency-Key": "%s",\n' "$(json_escape "${IDEMPOTENCY_KEY}")"
    printf '    "X-TokenPulse-Signature": "%s"\n' "$(json_escape "sha256=${SIGNATURE_HEX}")"
    printf '  },\n'
    printf '  "firstDelivery": {\n'
    printf '    "expectedHttpCode": 202,\n'
    printf '    "httpCode": %s,\n' "${first_http_code}"
    printf '    "passed": %s,\n' "$([[ "${first_http_code}" == "202" ]] && printf 'true' || printf 'false')"
    printf '    "responseBody": "%s"\n' "$(json_escape "${first_body}")"
    printf '  },\n'
    printf '  "secondDelivery": '
    if [[ "${second_skipped}" == "1" ]]; then
      printf 'null\n'
    else
      printf '{\n'
      printf '    "expectedHttpCode": 200,\n'
      printf '    "httpCode": %s,\n' "${second_http_code}"
      printf '    "passed": %s,\n' "$([[ "${second_http_code}" == "200" ]] && printf 'true' || printf 'false')"
      printf '    "responseBody": "%s"\n' "$(json_escape "${second_body}")"
      printf '  }\n'
    fi
    printf '}\n'
  } > "${EVIDENCE_FILE}"
}

enabled_value="$(tp_trim "${TOKENPULSE_AGENTLEDGER_ENABLED:-}")"
INGEST_URL="$(tp_trim "${AGENTLEDGER_RUNTIME_INGEST_URL:-}")"
WEBHOOK_SECRET="$(tp_trim "${TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET:-}")"
KEY_ID="$(tp_trim "${TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID:-tokenpulse-runtime-v1}")"
SPEC_VERSION="v1"

tp_is_true "${enabled_value}" || tp_fail "TOKENPULSE_AGENTLEDGER_ENABLED 必须显式开启（true/1）"
[[ -n "${INGEST_URL}" ]] || tp_fail "AGENTLEDGER_RUNTIME_INGEST_URL 不能为空"
[[ -n "${WEBHOOK_SECRET}" ]] || tp_fail "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET 不能为空"
[[ -n "${KEY_ID}" ]] || tp_fail "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID 不能为空"

if [[ -n "${ENV_FILE}" ]]; then
  bash "${SCRIPT_DIR}/preflight_agentledger_runtime_webhook.sh" --env-file "${ENV_FILE}"
else
  bash "${SCRIPT_DIR}/preflight_agentledger_runtime_webhook.sh"
fi

TRACE_ID="$(tp_trim "${TRACE_ID}")"
if [[ -z "${TRACE_ID}" ]]; then
  TRACE_ID="trace-agentledger-drill-$(date -u +%Y%m%d%H%M%S)"
fi

STARTED_AT="$(tp_trim "${STARTED_AT}")"
FINISHED_AT="$(tp_trim "${FINISHED_AT}")"
if [[ -z "${STARTED_AT}" ]]; then
  STARTED_AT="$(iso_one_second_ago)"
fi
if [[ -z "${FINISHED_AT}" ]]; then
  FINISHED_AT="$(iso_now)"
fi

REQUEST_TIMESTAMP="$(date +%s)"
PAYLOAD_JSON="$(build_payload_json)"
IDEMPOTENCY_SOURCE_JSON="$(build_idempotency_source_json)"
IDEMPOTENCY_KEY="$(printf '%s' "${IDEMPOTENCY_SOURCE_JSON}" | sha256_hex)"
PAYLOAD_HASH="$(printf '%s' "${PAYLOAD_JSON}" | sha256_hex)"
SIGNATURE_HEX="$(
  printf '%s\n%s\n%s\n%s\n%s' \
    "${SPEC_VERSION}" \
    "${KEY_ID}" \
    "${REQUEST_TIMESTAMP}" \
    "${IDEMPOTENCY_KEY}" \
    "${PAYLOAD_JSON}" \
    | hmac_sha256_hex "${WEBHOOK_SECRET}"
)"

TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-8}"
TP_MAX_TIME="${TP_MAX_TIME:-20}"
TP_INSECURE="${INSECURE}"
TP_HEADERS=(
  "Accept: application/json"
  "X-TokenPulse-Spec-Version: ${SPEC_VERSION}"
  "X-TokenPulse-Key-Id: ${KEY_ID}"
  "X-TokenPulse-Timestamp: ${REQUEST_TIMESTAMP}"
  "X-TokenPulse-Idempotency-Key: ${IDEMPOTENCY_KEY}"
  "X-TokenPulse-Signature: sha256=${SIGNATURE_HEX}"
)

DRILL_STARTED_AT="$(iso_now)"
FIRST_HTTP_CODE="0"
FIRST_BODY=""
SECOND_HTTP_CODE="0"
SECOND_BODY=""
SECOND_SKIPPED="0"
CONTRACT_PASSED="false"
FAILURE_REASON=""

tp_log_info "1/2 首次发送 AgentLedger runtime webhook"
tp_http_call "POST" "${INGEST_URL}" "${PAYLOAD_JSON}"
FIRST_HTTP_CODE="${TP_HTTP_CODE}"
FIRST_BODY="${TP_HTTP_BODY}"
tp_log_info "首发响应: http_code=${FIRST_HTTP_CODE}"

if [[ "${FIRST_HTTP_CODE}" == "202" || "${FIRST_HTTP_CODE}" == "200" ]]; then
  tp_log_info "2/2 复用相同 idempotency-key 再次发送，验证幂等命中"
  tp_http_call "POST" "${INGEST_URL}" "${PAYLOAD_JSON}"
  SECOND_HTTP_CODE="${TP_HTTP_CODE}"
  SECOND_BODY="${TP_HTTP_BODY}"
  tp_log_info "重放响应: http_code=${SECOND_HTTP_CODE}"
else
  SECOND_SKIPPED="1"
  tp_log_warn "首发未进入成功语义，已跳过第二次幂等命中验证"
fi

if [[ "${FIRST_HTTP_CODE}" != "202" ]]; then
  FAILURE_REASON="首发请求未返回 202（实际 ${FIRST_HTTP_CODE}）"
elif [[ "${SECOND_SKIPPED}" == "1" ]]; then
  FAILURE_REASON="首发失败，未执行第二次幂等命中验证"
elif [[ "${SECOND_HTTP_CODE}" != "200" ]]; then
  FAILURE_REASON="重复投递未返回 200 幂等命中（实际 ${SECOND_HTTP_CODE}）"
else
  CONTRACT_PASSED="true"
fi

DRILL_FINISHED_AT="$(iso_now)"
write_evidence \
  "${DRILL_FINISHED_AT}" \
  "${CONTRACT_PASSED}" \
  "${FAILURE_REASON}" \
  "${FIRST_HTTP_CODE}" \
  "${FIRST_BODY}" \
  "${SECOND_HTTP_CODE}" \
  "${SECOND_BODY}" \
  "${SECOND_SKIPPED}"

if [[ "${CONTRACT_PASSED}" == "true" ]]; then
  tp_log_info "AgentLedger runtime webhook 合同演练通过"
  tp_log_info "evidence: ${EVIDENCE_FILE}"
  exit 0
fi

tp_log_error "AgentLedger runtime webhook 合同演练失败: ${FAILURE_REASON}"
tp_log_error "evidence: ${EVIDENCE_FILE}"
exit 1
