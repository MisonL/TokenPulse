#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
AgentLedger outbox 批量 replay 脚本

用法:
  ./scripts/release/replay_agentledger_outbox.sh [参数]

参数:
  --base-url <url>         TokenPulse 管理面基地址，例如 https://tokenpulse.example.com
  --api-secret <secret>    API Secret，用于 /api/auth/verify-secret 与管理接口鉴权
  --ids <list>             逗号或空格分隔的 outbox id 列表，例如 101,102 103
  --evidence-file <path>   输出 evidence JSON，默认: ./artifacts/agentledger-outbox-replay-evidence.json
  --cookie <cookie>        复用管理员会话 Cookie；提供后不再发送 x-admin-* 头
  --owner-user <user>      头部身份模式下的 owner 用户名，默认: replay-owner
  --owner-role <role>      头部身份模式下的 owner 角色，默认: owner
  --admin-tenant <tenant>  可选，头部身份模式下透传 x-admin-tenant
  --request-id <id>        可选，透传 x-request-id 到 owner 预检与 replay-batch
  --insecure               curl 使用 -k（仅测试环境）
  --help                   显示帮助

说明:
  1) 脚本会先验证 /api/auth/verify-secret，再验证 /api/admin/auth/me。
  2) 仅当 replay-batch 返回 200 且 success=true 时视为成功。
  3) 任一环节失败都会写 evidence JSON，并以非零退出码结束。
EOF
}

BASE_URL=""
API_SECRET_VALUE=""
IDS_RAW=""
EVIDENCE_FILE="./artifacts/agentledger-outbox-replay-evidence.json"
COOKIE=""
OWNER_USER="replay-owner"
OWNER_ROLE="owner"
ADMIN_TENANT=""
REQUEST_ID=""
INSECURE="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --api-secret)
      API_SECRET_VALUE="${2:-}"
      shift 2
      ;;
    --ids)
      IDS_RAW="${2:-}"
      shift 2
      ;;
    --evidence-file)
      EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --cookie)
      COOKIE="${2:-}"
      shift 2
      ;;
    --owner-user)
      OWNER_USER="${2:-}"
      shift 2
      ;;
    --owner-role)
      OWNER_ROLE="${2:-}"
      shift 2
      ;;
    --admin-tenant)
      ADMIN_TENANT="${2:-}"
      shift 2
      ;;
    --request-id)
      REQUEST_ID="${2:-}"
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

tp_require_cmd curl

tp_trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
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

json_string_or_null() {
  local value="${1:-}"
  if [[ -n "${value}" ]]; then
    printf '"%s"' "$(json_escape "${value}")"
  else
    printf 'null'
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

build_ids_json_array() {
  local raw="${1:-}"
  local normalized="${raw//,/ }"
  local item=""
  local trimmed=""
  local json="["
  local appended="0"

  for item in ${normalized}; do
    trimmed="$(tp_trim "${item}")"
    [[ -n "${trimmed}" ]] || continue
    [[ "${trimmed}" =~ ^[1-9][0-9]*$ ]] || tp_fail "--ids 只能包含正整数，实际: ${trimmed}"
    if [[ "${appended}" == "1" ]]; then
      json+=","
    fi
    json+="${trimmed}"
    appended="1"
  done

  [[ "${appended}" == "1" ]] || tp_fail "--ids 不能为空"
  json+="]"
  printf '%s' "${json}"
}

extract_trace_id() {
  local body="${1:-}"
  printf '%s' "${body}" | tr -d '\n' | sed -n 's/.*"traceId":"\([^"]*\)".*/\1/p' | head -n 1
}

json_contains_true() {
  local body="${1:-}"
  local key="$2"
  tp_json_contains "${body}" "\"${key}\":true"
}

extract_number_field() {
  local body="${1:-}"
  local key="$2"
  printf '%s' "${body}" | tr -d '\n' | sed -n "s/.*\"${key}\":\([0-9][0-9]*\).*/\1/p" | head -n 1
}

resolve_success_flag() {
  local body="${1:-}"
  if tp_json_contains "${body}" '"success":true'; then
    printf 'true'
  elif tp_json_contains "${body}" '"success":false'; then
    printf 'false'
  else
    printf 'null'
  fi
}

write_evidence() {
  mkdir -p "$(dirname "${EVIDENCE_FILE}")"

  local replay_success_flag
  replay_success_flag="$(resolve_success_flag "${REPLAY_HTTP_BODY}")"
  local verify_passed="false"
  local admin_passed="false"
  local replay_passed="false"

  if [[ "${VERIFY_HTTP_CODE}" == "200" ]] && json_contains_true "${VERIFY_HTTP_BODY}" "success"; then
    verify_passed="true"
  fi
  if [[ "${ADMIN_HTTP_CODE}" == "200" ]] && json_contains_true "${ADMIN_HTTP_BODY}" "authenticated"; then
    admin_passed="true"
  fi
  if [[ "${REPLAY_HTTP_CODE}" == "200" ]] && [[ "${replay_success_flag}" == "true" ]]; then
    replay_passed="true"
  fi

  {
    printf '{\n'
    printf '  "startedAt": "%s",\n' "$(json_escape "${RUN_STARTED_AT}")"
    printf '  "finishedAt": "%s",\n' "$(json_escape "${RUN_FINISHED_AT}")"
    printf '  "success": %s,\n' "${SUCCESS}"
    printf '  "failedStep": %s,\n' "$(json_string_or_null "${FAILED_STEP}")"
    printf '  "failureReason": %s,\n' "$(json_string_or_null "${FAILURE_REASON}")"
    printf '  "authMode": "%s",\n' "$(json_escape "${AUTH_MODE}")"
    printf '  "requestId": %s,\n' "$(json_string_or_null "${REQUEST_ID}")"
    printf '  "requestedIds": %s,\n' "${IDS_JSON_ARRAY}"
    printf '  "responseTraceId": %s,\n' "$(json_string_or_null "${RESPONSE_TRACE_ID}")"
    printf '  "ownerIdentity": {\n'
    printf '    "cookieUsed": %s,\n' "$([[ "${AUTH_MODE}" == "cookie" ]] && printf 'true' || printf 'false')"
    printf '    "ownerUser": %s,\n' "$([[ "${AUTH_MODE}" == "cookie" ]] && printf 'null' || json_string_or_null "${OWNER_USER}")"
    printf '    "ownerRole": %s,\n' "$([[ "${AUTH_MODE}" == "cookie" ]] && printf 'null' || json_string_or_null "${OWNER_ROLE}")"
    printf '    "adminTenant": %s\n' "$([[ "${AUTH_MODE}" == "cookie" ]] && printf 'null' || json_string_or_null "${ADMIN_TENANT}")"
    printf '  },\n'
    printf '  "prechecks": {\n'
    printf '    "verifySecret": {\n'
    printf '      "httpCode": %s,\n' "$(json_number_or_null "${VERIFY_HTTP_CODE}")"
    printf '      "passed": %s\n' "${verify_passed}"
    printf '    },\n'
    printf '    "adminAuthMe": {\n'
    printf '      "httpCode": %s,\n' "$(json_number_or_null "${ADMIN_HTTP_CODE}")"
    printf '      "passed": %s\n' "${admin_passed}"
    printf '    }\n'
    printf '  },\n'
    printf '  "replayBatch": {\n'
    printf '    "httpCode": %s,\n' "$(json_number_or_null "${REPLAY_HTTP_CODE}")"
    printf '    "passed": %s,\n' "${replay_passed}"
    printf '    "successFlag": %s,\n' "${replay_success_flag}"
    printf '    "requestedCount": %s,\n' "$(json_number_or_null "$(extract_number_field "${REPLAY_HTTP_BODY}" "requestedCount")")"
    printf '    "processedCount": %s,\n' "$(json_number_or_null "$(extract_number_field "${REPLAY_HTTP_BODY}" "processedCount")")"
    printf '    "successCount": %s,\n' "$(json_number_or_null "$(extract_number_field "${REPLAY_HTTP_BODY}" "successCount")")"
    printf '    "failureCount": %s,\n' "$(json_number_or_null "$(extract_number_field "${REPLAY_HTTP_BODY}" "failureCount")")"
    printf '    "notFoundCount": %s,\n' "$(json_number_or_null "$(extract_number_field "${REPLAY_HTTP_BODY}" "notFoundCount")")"
    printf '    "notConfiguredCount": %s\n' "$(json_number_or_null "$(extract_number_field "${REPLAY_HTTP_BODY}" "notConfiguredCount")")"
    printf '  }\n'
    printf '}\n'
  } > "${EVIDENCE_FILE}"
}

BASE_URL="$(tp_trim "${BASE_URL}")"
API_SECRET_VALUE="$(tp_trim "${API_SECRET_VALUE}")"
IDS_RAW="$(tp_trim "${IDS_RAW}")"
COOKIE="$(tp_trim "${COOKIE}")"
OWNER_USER="$(tp_trim "${OWNER_USER}")"
OWNER_ROLE="$(tp_trim "${OWNER_ROLE}")"
ADMIN_TENANT="$(tp_trim "${ADMIN_TENANT}")"
REQUEST_ID="$(tp_trim "${REQUEST_ID}")"

[[ -n "${BASE_URL}" ]] || tp_fail "--base-url 不能为空"
[[ "${BASE_URL}" =~ ^https?://[^[:space:]]+$ ]] || tp_fail "--base-url 必须是合法 http/https URL"
[[ -n "${API_SECRET_VALUE}" ]] || tp_fail "--api-secret 不能为空"
[[ -n "${IDS_RAW}" ]] || tp_fail "--ids 不能为空"

IDS_JSON_ARRAY="$(build_ids_json_array "${IDS_RAW}")"
REQUEST_BODY="{\"ids\":${IDS_JSON_ARRAY}}"
AUTH_MODE="header"
if [[ -n "${COOKIE}" ]]; then
  AUTH_MODE="cookie"
fi

TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-5}"
TP_MAX_TIME="${TP_MAX_TIME:-15}"
TP_INSECURE="${INSECURE}"

RUN_STARTED_AT="$(tp_format_iso_utc "$(date +%s)")"
RUN_FINISHED_AT="${RUN_STARTED_AT}"
VERIFY_HTTP_CODE=""
VERIFY_HTTP_BODY=""
ADMIN_HTTP_CODE=""
ADMIN_HTTP_BODY=""
REPLAY_HTTP_CODE=""
REPLAY_HTTP_BODY=""
RESPONSE_TRACE_ID=""
FAILED_STEP=""
FAILURE_REASON=""
SUCCESS="false"

VERIFY_HEADERS=(
  "Accept: application/json"
  "Authorization: Bearer ${API_SECRET_VALUE}"
)
OWNER_HEADERS=(
  "Accept: application/json"
  "Authorization: Bearer ${API_SECRET_VALUE}"
)
if [[ -n "${COOKIE}" ]]; then
  OWNER_HEADERS+=("Cookie: ${COOKIE}")
else
  [[ -n "${OWNER_USER}" ]] || tp_fail "--owner-user 不能为空"
  [[ -n "${OWNER_ROLE}" ]] || tp_fail "--owner-role 不能为空"
  OWNER_HEADERS+=(
    "x-admin-user: ${OWNER_USER}"
    "x-admin-role: ${OWNER_ROLE}"
  )
  if [[ -n "${ADMIN_TENANT}" ]]; then
    OWNER_HEADERS+=("x-admin-tenant: ${ADMIN_TENANT}")
  fi
fi
if [[ -n "${REQUEST_ID}" ]]; then
  OWNER_HEADERS+=("x-request-id: ${REQUEST_ID}")
fi

tp_log_info "1/3 验证 API Secret: ${BASE_URL%/}/api/auth/verify-secret"
TP_HEADERS=("${VERIFY_HEADERS[@]}")
tp_http_call "GET" "${BASE_URL%/}/api/auth/verify-secret"
VERIFY_HTTP_CODE="${TP_HTTP_CODE}"
VERIFY_HTTP_BODY="${TP_HTTP_BODY}"
RESPONSE_TRACE_ID="$(extract_trace_id "${VERIFY_HTTP_BODY}")"

if [[ "${VERIFY_HTTP_CODE}" != "200" ]] || ! json_contains_true "${VERIFY_HTTP_BODY}" "success"; then
  FAILED_STEP="verify_secret"
  FAILURE_REASON="API Secret 探针失败（http=${VERIFY_HTTP_CODE}）"
else
  tp_log_info "2/3 验证 owner 身份: ${BASE_URL%/}/api/admin/auth/me"
  TP_HEADERS=("${OWNER_HEADERS[@]}")
  tp_http_call "GET" "${BASE_URL%/}/api/admin/auth/me"
  ADMIN_HTTP_CODE="${TP_HTTP_CODE}"
  ADMIN_HTTP_BODY="${TP_HTTP_BODY}"
  RESPONSE_TRACE_ID="$(extract_trace_id "${ADMIN_HTTP_BODY}")"

  if [[ "${ADMIN_HTTP_CODE}" != "200" ]] || ! json_contains_true "${ADMIN_HTTP_BODY}" "authenticated"; then
    FAILED_STEP="admin_auth_me"
    FAILURE_REASON="owner 身份预检失败（http=${ADMIN_HTTP_CODE}）"
  elif [[ "${AUTH_MODE}" == "header" ]] && ! tp_json_contains "${ADMIN_HTTP_BODY}" "\"roleKey\":\"${OWNER_ROLE}\""; then
    FAILED_STEP="admin_auth_me"
    FAILURE_REASON="owner 身份预检失败（roleKey 不匹配）"
  else
    tp_log_info "3/3 执行批量 replay: ${BASE_URL%/}/api/admin/observability/agentledger-outbox/replay-batch"
    TP_HEADERS=("${OWNER_HEADERS[@]}")
    tp_http_call "POST" "${BASE_URL%/}/api/admin/observability/agentledger-outbox/replay-batch" "${REQUEST_BODY}"
    REPLAY_HTTP_CODE="${TP_HTTP_CODE}"
    REPLAY_HTTP_BODY="${TP_HTTP_BODY}"
    RESPONSE_TRACE_ID="$(extract_trace_id "${REPLAY_HTTP_BODY}")"

    if [[ "${REPLAY_HTTP_CODE}" != "200" ]]; then
      FAILED_STEP="replay_batch"
      FAILURE_REASON="批量 replay 返回非 200（http=${REPLAY_HTTP_CODE}）"
    elif ! tp_json_contains "${REPLAY_HTTP_BODY}" '"success":true'; then
      FAILED_STEP="replay_batch"
      FAILURE_REASON="批量 replay 未全成功"
    else
      SUCCESS="true"
    fi
  fi
fi

RUN_FINISHED_AT="$(tp_format_iso_utc "$(date +%s)")"
write_evidence

if [[ "${SUCCESS}" == "true" ]]; then
  tp_log_info "AgentLedger outbox 批量 replay 完成"
  tp_log_info "evidence=${EVIDENCE_FILE}"
  exit 0
fi

tp_log_error "AgentLedger outbox 批量 replay 失败: ${FAILURE_REASON}"
tp_log_error "evidence=${EVIDENCE_FILE}"
exit 1
