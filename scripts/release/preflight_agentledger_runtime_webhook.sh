#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
AgentLedger runtime webhook 发布前预检脚本

用法:
  ./scripts/release/preflight_agentledger_runtime_webhook.sh [参数]

参数:
  --env-file <path>    加载环境变量文件后执行预检。
  --tenant-id <id>     指定默认 tenantId（优先级: CLI > TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID > default）。
  --help               显示帮助。

校验项:
  1) TOKENPULSE_AGENTLEDGER_ENABLED 必须显式开启。
  2) AGENTLEDGER_RUNTIME_INGEST_URL 必须是合法 http/https URL，且不能使用示例域名或占位值。
  3) TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET / KEY_ID 不得为空或占位值。
  4) timeout / attempts / retention / batch-size 必须为合法正整数。
  5) retry schedule（若显式提供）必须为逗号分隔的非负整数列表。
USAGE
}

ENV_FILE=""
TENANT_ID=""
TENANT_ID_FROM_CLI="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --tenant-id)
      TENANT_ID="${2:-}"
      TENANT_ID_FROM_CLI="1"
      shift 2
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

tp_trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

TENANT_ID="$(tp_trim "${TENANT_ID}")"
if [[ "${TENANT_ID_FROM_CLI}" != "1" ]]; then
  TENANT_ID="$(tp_trim "${TOKENPULSE_AGENTLEDGER_DEFAULT_TENANT_ID:-default}")"
  if [[ -z "${TENANT_ID}" ]]; then
    TENANT_ID="default"
  fi
fi

tp_is_true() {
  local lowered
  lowered="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${lowered}" == "1" || "${lowered}" == "true" || "${lowered}" == "yes" ]]
}

tp_is_positive_int() {
  local value
  value="$(tp_trim "${1:-}")"
  [[ "${value}" =~ ^[0-9]+$ ]] && [[ "${value}" -ge 1 ]]
}

tp_is_non_negative_int() {
  local value
  value="$(tp_trim "${1:-}")"
  [[ "${value}" =~ ^[0-9]+$ ]]
}

tp_has_example_domain() {
  local lowered
  lowered="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${lowered}" =~ ^https?://([^/@]+@)?([^.\/]+\.)*example\.(invalid|com|local)([:/]|$) ]]
}

tp_has_placeholder_text() {
  local lowered
  lowered="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"

  if [[ -z "${lowered}" ]]; then
    return 0
  fi

  printf '%s' "${lowered}" | grep -Eq \
    'replace([_-]?with|[_-]?me)|change[_-]?me|your[-_ ]?(secret|key|webhook|url)|dummy[-_ ]?(secret|key|webhook|url)|placeholder|^<.*>$'
}

tp_validate_url() {
  local label="$1"
  local url
  url="$(tp_trim "${2:-}")"

  [[ -n "${url}" ]] || tp_fail "${label} 不能为空"
  [[ "${url}" =~ ^https?://[^[:space:]]+$ ]] || tp_fail "${label} 必须是合法 http/https URL: ${url}"
  if tp_has_example_domain "${url}"; then
    tp_fail "${label} 不能使用示例域名: ${url}"
  fi
  if tp_has_placeholder_text "${url}"; then
    tp_fail "${label} 不能使用占位值: ${url}"
  fi
}

tp_validate_secret_like() {
  local label="$1"
  local value
  value="$(tp_trim "${2:-}")"

  [[ -n "${value}" ]] || tp_fail "${label} 不能为空"
  if [[ "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
    tp_fail "${label} 必须为单行（禁止换行）"
  fi
  if tp_has_placeholder_text "${value}"; then
    tp_fail "${label} 不能使用占位值"
  fi
}

tp_validate_positive_int() {
  local label="$1"
  local value="$2"
  tp_is_positive_int "${value}" || tp_fail "${label} 必须为 >= 1 的整数，实际: ${value}"
}

tp_validate_retry_schedule() {
  local raw
  raw="$(tp_trim "${1:-}")"
  [[ -z "${raw}" ]] && return 0

  local item=""
  IFS=',' read -r -a schedule_items <<< "${raw}"
  [[ "${#schedule_items[@]}" -gt 0 ]] || tp_fail "TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC 不能为空列表"

  for item in "${schedule_items[@]}"; do
    item="$(tp_trim "${item}")"
    tp_is_non_negative_int "${item}" || tp_fail "TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC 必须为逗号分隔的非负整数，实际包含: ${item}"
  done
}

enabled_value="$(tp_trim "${TOKENPULSE_AGENTLEDGER_ENABLED:-}")"
ingest_url="$(tp_trim "${AGENTLEDGER_RUNTIME_INGEST_URL:-}")"
webhook_secret="$(tp_trim "${TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET:-}")"
key_id="$(tp_trim "${TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID:-tokenpulse-runtime-v1}")"
request_timeout_ms="$(tp_trim "${TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS:-10000}")"
max_attempts="$(tp_trim "${TOKENPULSE_AGENTLEDGER_MAX_ATTEMPTS:-5}")"
retry_schedule_sec="$(tp_trim "${TOKENPULSE_AGENTLEDGER_RETRY_SCHEDULE_SEC:-0,30,120,600,1800}")"
retention_days="$(tp_trim "${TOKENPULSE_AGENTLEDGER_OUTBOX_RETENTION_DAYS:-7}")"
worker_batch_size="$(tp_trim "${TOKENPULSE_AGENTLEDGER_WORKER_BATCH_SIZE:-20}")"

tp_is_true "${enabled_value}" || tp_fail "TOKENPULSE_AGENTLEDGER_ENABLED 必须显式开启（true/1）"
tp_validate_url "AGENTLEDGER_RUNTIME_INGEST_URL" "${ingest_url}"
tp_validate_secret_like "TOKENPULSE_AGENTLEDGER_WEBHOOK_SECRET" "${webhook_secret}"
tp_validate_secret_like "TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID" "${key_id}"
tp_validate_positive_int "TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS" "${request_timeout_ms}"
tp_validate_positive_int "TOKENPULSE_AGENTLEDGER_MAX_ATTEMPTS" "${max_attempts}"
tp_validate_positive_int "TOKENPULSE_AGENTLEDGER_OUTBOX_RETENTION_DAYS" "${retention_days}"
tp_validate_positive_int "TOKENPULSE_AGENTLEDGER_WORKER_BATCH_SIZE" "${worker_batch_size}"
tp_validate_retry_schedule "${retry_schedule_sec}"

if [[ "${request_timeout_ms}" -lt 1000 ]]; then
  tp_fail "TOKENPULSE_AGENTLEDGER_REQUEST_TIMEOUT_MS 不能小于 1000ms，实际: ${request_timeout_ms}"
fi

tp_log_info "AgentLedger runtime webhook 预检通过"
tp_log_info "  ingest_url=${ingest_url}"
tp_log_info "  tenant_id=${TENANT_ID}"
tp_log_info "  key_id=${key_id}"
tp_log_info "  max_attempts=${max_attempts}"
tp_log_info "  retry_schedule_sec=${retry_schedule_sec}"
tp_log_info "  retention_days=${retention_days}"
tp_log_info "  worker_batch_size=${worker_batch_size}"
