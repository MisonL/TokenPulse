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

tp_require_cmd bun
tp_require_cmd curl

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

iso_now() {
  tp_format_iso_utc "$(date +%s)"
}

iso_one_second_ago() {
  tp_format_iso_utc "$(( $(date +%s) - 1 ))"
}

to_summary_line() {
  local text="${1:-}"
  local line=""
  line="$(printf '%s' "${text}" | awk 'NF { last=$0 } END { print last }')"
  printf '%s' "${line}"
}

resolve_contract_via_bun() {
  local output=""
  local -a cmd=(
    bun
    run
    "${SCRIPT_DIR}/build_agentledger_runtime_contract.ts"
    --format
    shell
    --trace-id
    "${TRACE_ID}"
    --tenant-id
    "${TENANT_ID}"
    --provider
    "${PROVIDER}"
    --model
    "${MODEL}"
    --resolved-model
    "${RESOLVED_MODEL}"
    --route-policy
    "${ROUTE_POLICY}"
    --status
    "${STATUS}"
    --started-at
    "${STARTED_AT}"
    --spec-version
    "${SPEC_VERSION}"
    --key-id
    "${KEY_ID}"
    --secret
    "${WEBHOOK_SECRET}"
    --timestamp
    "${REQUEST_TIMESTAMP}"
  )
  if [[ -n "${PROJECT_ID}" ]]; then
    cmd+=(--project-id "${PROJECT_ID}")
  fi
  if [[ -n "${ACCOUNT_ID}" ]]; then
    cmd+=(--account-id "${ACCOUNT_ID}")
  fi
  if [[ -n "${FINISHED_AT}" ]]; then
    cmd+=(--finished-at "${FINISHED_AT}")
  fi
  if [[ -n "${ERROR_CODE}" ]]; then
    cmd+=(--error-code "${ERROR_CODE}")
  fi
  if [[ -n "${COST}" ]]; then
    cmd+=(--cost "${COST}")
  fi
  if ! output="$("${cmd[@]}" 2>&1)"; then
    printf '%s' "${output}"
    return 1
  fi
  if [[ -z "${output}" ]]; then
    printf '%s' "AgentLedger contract builder 返回空输出"
    return 1
  fi
  set +e
  eval "${output}"
  local eval_exit="$?"
  set -e
  if [[ "${eval_exit}" -ne 0 ]]; then
    printf '%s' "AgentLedger contract 输出解析失败（eval exit=${eval_exit}）"
    return 1
  fi
}

json_number_or_null() {
  local value="${1:-}"
  if [[ "${value}" =~ ^[0-9]+$ ]]; then
    printf '%s' "${value}"
  else
    printf 'null'
  fi
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

  local first_http_json=""
  local second_http_json=""
  first_http_json="$(json_number_or_null "${first_http_code}")"
  second_http_json="$(json_number_or_null "${second_http_code}")"

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
    printf '  "payload": '
    if [[ -n "${PAYLOAD_JSON}" ]]; then
      printf '%s,\n' "${PAYLOAD_JSON}"
    else
      printf 'null,\n'
    fi
    printf '  "requestHeaders": {\n'
    printf '    "X-TokenPulse-Spec-Version": "%s",\n' "$(json_escape "${SPEC_VERSION}")"
    printf '    "X-TokenPulse-Key-Id": "%s",\n' "$(json_escape "${KEY_ID}")"
    printf '    "X-TokenPulse-Timestamp": "%s",\n' "$(json_escape "${REQUEST_TIMESTAMP}")"
    printf '    "X-TokenPulse-Idempotency-Key": "%s",\n' "$(json_escape "${HEADER_IDEMPOTENCY_KEY}")"
    printf '    "X-TokenPulse-Signature": "%s"\n' "$(json_escape "${HEADER_SIGNATURE}")"
    printf '  },\n'
    printf '  "firstDelivery": '
    if [[ "${first_http_json}" == "null" ]]; then
      printf 'null,\n'
    else
      printf '{\n'
      printf '    "expectedHttpCode": 202,\n'
      printf '    "httpCode": %s,\n' "${first_http_json}"
      printf '    "passed": %s,\n' "$([[ "${first_http_code}" == "202" ]] && printf 'true' || printf 'false')"
      printf '    "responseBody": "%s"\n' "$(json_escape "${first_body}")"
      printf '  },\n'
    fi
    printf '  "secondDelivery": '
    if [[ "${second_skipped}" == "1" || "${second_http_json}" == "null" ]]; then
      printf 'null\n'
    else
      printf '{\n'
      printf '    "expectedHttpCode": 200,\n'
      printf '    "httpCode": %s,\n' "${second_http_json}"
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
DRILL_STARTED_AT="$(iso_now)"
FIRST_HTTP_CODE=""
FIRST_BODY=""
SECOND_HTTP_CODE=""
SECOND_BODY=""
SECOND_SKIPPED="1"
CONTRACT_PASSED="false"
FAILURE_REASON=""
PAYLOAD_JSON=""
PAYLOAD_HASH=""
IDEMPOTENCY_KEY=""
HEADER_IDEMPOTENCY_KEY=""
HEADER_SIGNATURE=""

tp_log_info "0/2 执行 AgentLedger runtime webhook 发布前预检"
set +e
if [[ -n "${ENV_FILE}" ]]; then
  preflight_output="$(bash "${SCRIPT_DIR}/preflight_agentledger_runtime_webhook.sh" --env-file "${ENV_FILE}" 2>&1)"
  preflight_exit="$?"
else
  preflight_output="$(bash "${SCRIPT_DIR}/preflight_agentledger_runtime_webhook.sh" 2>&1)"
  preflight_exit="$?"
fi
set -e
if [[ "${preflight_exit}" -ne 0 ]]; then
  if [[ -n "${preflight_output}" ]]; then
    printf '%s\n' "${preflight_output}" >&2
  fi
  FAILURE_REASON="预检失败: $(to_summary_line "${preflight_output}")"
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
  tp_log_error "AgentLedger runtime webhook 合同演练失败: ${FAILURE_REASON}"
  tp_log_error "evidence: ${EVIDENCE_FILE}"
  exit 1
fi

tp_log_info "0.5/2 构建签名合同 payload/headers"
contract_error=""
contract_error_file="$(mktemp)"
if ! resolve_contract_via_bun >"${contract_error_file}" 2>&1; then
  contract_error="$(cat "${contract_error_file}" 2>/dev/null || true)"
  rm -f "${contract_error_file}"
  if [[ -n "${contract_error}" ]]; then
    printf '%s\n' "${contract_error}" >&2
  fi
  FAILURE_REASON="合同构建失败: $(to_summary_line "${contract_error}")"
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
  tp_log_error "AgentLedger runtime webhook 合同演练失败: ${FAILURE_REASON}"
  tp_log_error "evidence: ${EVIDENCE_FILE}"
  exit 1
	fi
	rm -f "${contract_error_file}"

	# 默认超时应与运行时对接配置一致（TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS，默认 10s）
	# curl 的 --max-time 使用秒，这里从毫秒向上取整到秒；仍允许通过 TP_MAX_TIME/TP_CONNECT_TIMEOUT 手动覆盖。
	request_timeout_ms_raw="$(tp_trim "${TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS:-10000}")"
	if [[ "${request_timeout_ms_raw}" =~ ^[0-9]+$ ]]; then
	  request_timeout_ms="${request_timeout_ms_raw}"
	else
	  request_timeout_ms="10000"
	fi
	default_max_time="$(( (request_timeout_ms + 999) / 1000 ))"
	if [[ "${default_max_time}" -lt 1 ]]; then
	  default_max_time="1"
	fi
	default_connect_timeout="5"
	if [[ "${default_max_time}" -lt 5 ]]; then
	  default_connect_timeout="${default_max_time}"
	fi

	TP_MAX_TIME="${TP_MAX_TIME:-${default_max_time}}"
	TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-${default_connect_timeout}}"
	TP_INSECURE="${INSECURE}"
	TP_HEADERS=(
	  "Accept: application/json"
	  "X-TokenPulse-Spec-Version: ${HEADER_SPEC_VERSION}"
	  "X-TokenPulse-Key-Id: ${HEADER_KEY_ID}"
  "X-TokenPulse-Timestamp: ${HEADER_TIMESTAMP}"
  "X-TokenPulse-Idempotency-Key: ${HEADER_IDEMPOTENCY_KEY}"
  "X-TokenPulse-Signature: ${HEADER_SIGNATURE}"
)

DRILL_STARTED_AT="$(iso_now)"
FIRST_BODY=""
SECOND_BODY=""
SECOND_SKIPPED="0"

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
