#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
AgentLedger outbox CSV 导出脚本

用法:
  ./scripts/release/export_agentledger_outbox.sh [参数]

参数:
  --base-url <url>         TokenPulse 管理面基地址，例如 https://tokenpulse.example.com
  --api-secret <secret>    API Secret（也可用环境变量 API_SECRET）
  --output-file <path>     CSV 保存路径，默认: ./artifacts/agentledger-outbox-export.csv
  --evidence-file <path>   输出 evidence JSON，默认: ./artifacts/agentledger-outbox-export-evidence.json
  --delivery-state <state> 可选，导出筛选：deliveryState
  --status <status>        可选，导出筛选：status
  --provider <provider>    可选，导出筛选：provider
  --tenant-id <tenantId>   可选，导出筛选：tenantId
  --project-id <projectId> 可选，导出筛选：projectId
  --trace-id <traceId>     可选，导出筛选：traceId
  --from <iso>             可选，导出筛选：from（ISO 时间）
  --to <iso>               可选，导出筛选：to（ISO 时间）
  --limit <n>              可选，导出数量上限（1-5000）
  --cookie <cookie>        复用管理员会话 Cookie；提供后不再发送 x-admin-* 头
  --owner-user <user>      头部身份模式下的 owner 用户名，默认: export-auditor
  --owner-role <role>      头部身份模式下的 owner 角色，默认: auditor
  --admin-tenant <tenant>  可选，头部身份模式下透传 x-admin-tenant
  --request-id <id>        可选，透传 x-request-id
  --insecure               curl 使用 -k（仅测试环境）
  --help                   显示帮助

说明:
  1) 脚本会先验证 /api/auth/verify-secret，再验证 /api/admin/auth/me。
  2) 导出接口: GET /api/admin/observability/agentledger-outbox/export
  3) 任一环节失败都会写 evidence JSON，并以非零退出码结束。
EOF
}

BASE_URL=""
API_SECRET_VALUE="${API_SECRET:-}"
OUTPUT_FILE="./artifacts/agentledger-outbox-export.csv"
EVIDENCE_FILE="./artifacts/agentledger-outbox-export-evidence.json"
COOKIE=""
OWNER_USER="export-auditor"
OWNER_ROLE="auditor"
ADMIN_TENANT=""
REQUEST_ID=""
INSECURE="0"
DELIVERY_STATE=""
STATUS=""
PROVIDER=""
TENANT_ID=""
PROJECT_ID=""
TRACE_ID=""
FROM_ISO=""
TO_ISO=""
LIMIT=""

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
    --output-file)
      OUTPUT_FILE="${2:-}"
      shift 2
      ;;
    --evidence-file)
      EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --delivery-state)
      DELIVERY_STATE="${2:-}"
      shift 2
      ;;
    --status)
      STATUS="${2:-}"
      shift 2
      ;;
    --provider)
      PROVIDER="${2:-}"
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
    --trace-id)
      TRACE_ID="${2:-}"
      shift 2
      ;;
    --from)
      FROM_ISO="${2:-}"
      shift 2
      ;;
    --to)
      TO_ISO="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-}"
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

tp_urlencode() {
  local value="${1:-}"
  local encoded=""
  local i
  local c
  local hex=""

  for ((i = 0; i < ${#value}; i++)); do
    c="${value:i:1}"
    case "${c}" in
      [a-zA-Z0-9.~_-])
        encoded+="${c}"
        ;;
      *)
        printf -v hex '%%%02X' "'${c}"
        encoded+="${hex}"
        ;;
    esac
  done

  printf '%s' "${encoded}"
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

json_contains_true() {
  local body="${1:-}"
  local key="$2"
  tp_json_contains "${body}" "\"${key}\":true"
}

write_evidence() {
  mkdir -p "$(dirname "${EVIDENCE_FILE}")"

  local verify_passed="false"
  local admin_passed="false"
  local export_passed="false"
  if [[ "${VERIFY_HTTP_CODE}" == "200" ]] && json_contains_true "${VERIFY_HTTP_BODY}" "success"; then
    verify_passed="true"
  fi
  if [[ "${ADMIN_HTTP_CODE}" == "200" ]] && json_contains_true "${ADMIN_HTTP_BODY}" "authenticated"; then
    admin_passed="true"
  fi
  if [[ "${EXPORT_HTTP_CODE}" == "200" ]]; then
    export_passed="true"
  fi

  {
    printf '{\n'
    printf '  "startedAt": "%s",\n' "$(json_escape "${RUN_STARTED_AT}")"
    printf '  "finishedAt": "%s",\n' "$(json_escape "${RUN_FINISHED_AT}")"
    printf '  "success": %s,\n' "${SUCCESS}"
    printf '  "failedStep": %s,\n' "$(json_string_or_null "${FAILED_STEP}")"
    printf '  "failureReason": %s,\n' "$(json_string_or_null "${FAILURE_REASON}")"
    printf '  "authMode": "%s",\n' "$(json_escape "${AUTH_MODE}")"
    printf '  "outputFile": "%s",\n' "$(json_escape "${OUTPUT_FILE}")"
    printf '  "export": {\n'
    printf '    "method": "GET",\n'
    printf '    "url": "%s",\n' "$(json_escape "${EXPORT_URL}")"
    printf '    "httpCode": %s,\n' "$(json_number_or_null "${EXPORT_HTTP_CODE}")"
    printf '    "saved": %s\n' "${EXPORTED}"
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
    printf '  "exportCall": {\n'
    printf '    "httpCode": %s,\n' "$(json_number_or_null "${EXPORT_HTTP_CODE}")"
    printf '    "passed": %s\n' "${export_passed}"
    printf '  }\n'
    printf '}\n'
  } > "${EVIDENCE_FILE}"
}

BASE_URL="$(tp_trim "${BASE_URL}")"
API_SECRET_VALUE="$(tp_trim "${API_SECRET_VALUE}")"
OUTPUT_FILE="$(tp_trim "${OUTPUT_FILE}")"
EVIDENCE_FILE="$(tp_trim "${EVIDENCE_FILE}")"
COOKIE="$(tp_trim "${COOKIE}")"
OWNER_USER="$(tp_trim "${OWNER_USER}")"
OWNER_ROLE="$(tp_trim "${OWNER_ROLE}")"
ADMIN_TENANT="$(tp_trim "${ADMIN_TENANT}")"
REQUEST_ID="$(tp_trim "${REQUEST_ID}")"
DELIVERY_STATE="$(tp_trim "${DELIVERY_STATE}")"
STATUS="$(tp_trim "${STATUS}")"
PROVIDER="$(tp_trim "${PROVIDER}")"
TENANT_ID="$(tp_trim "${TENANT_ID}")"
PROJECT_ID="$(tp_trim "${PROJECT_ID}")"
TRACE_ID="$(tp_trim "${TRACE_ID}")"
FROM_ISO="$(tp_trim "${FROM_ISO}")"
TO_ISO="$(tp_trim "${TO_ISO}")"
LIMIT="$(tp_trim "${LIMIT}")"

[[ -n "${BASE_URL}" ]] || tp_fail "--base-url 不能为空"
[[ "${BASE_URL}" =~ ^https?://[^[:space:]]+$ ]] || tp_fail "--base-url 必须是合法 http/https URL"

if [[ -z "${API_SECRET_VALUE}" ]]; then
  tp_fail "缺少 --api-secret 或环境变量 API_SECRET"
fi
tp_require_single_line "--api-secret" "${API_SECRET_VALUE}"
tp_require_not_placeholder "--api-secret" "${API_SECRET_VALUE}"
if [[ -n "${COOKIE}" ]]; then
  tp_require_single_line "--cookie" "${COOKIE}"
  tp_require_not_placeholder "--cookie" "${COOKIE}"
fi
if [[ -n "${DELIVERY_STATE}" ]]; then
  tp_require_single_line "--delivery-state" "${DELIVERY_STATE}"
fi
if [[ -n "${STATUS}" ]]; then
  tp_require_single_line "--status" "${STATUS}"
fi
if [[ -n "${PROVIDER}" ]]; then
  tp_require_single_line "--provider" "${PROVIDER}"
fi
if [[ -n "${TENANT_ID}" ]]; then
  tp_require_single_line "--tenant-id" "${TENANT_ID}"
fi
if [[ -n "${PROJECT_ID}" ]]; then
  tp_require_single_line "--project-id" "${PROJECT_ID}"
fi
if [[ -n "${TRACE_ID}" ]]; then
  tp_require_single_line "--trace-id" "${TRACE_ID}"
fi
if [[ -n "${FROM_ISO}" ]]; then
  tp_require_single_line "--from" "${FROM_ISO}"
fi
if [[ -n "${TO_ISO}" ]]; then
  tp_require_single_line "--to" "${TO_ISO}"
fi
if [[ -n "${LIMIT}" ]]; then
  if [[ ! "${LIMIT}" =~ ^[0-9]+$ ]]; then
    tp_fail "--limit 必须是整数"
  fi
  limit_num="$((10#${LIMIT}))"
  if ((limit_num < 1 || limit_num > 5000)); then
    tp_fail "--limit 必须在 1-5000 之间"
  fi
fi

base_url_normalized="$(printf '%s' "${BASE_URL}" | tr '[:upper:]' '[:lower:]')"
if tp_is_reserved_example_url "${base_url_normalized}"; then
  tp_fail "--base-url 不能使用保留示例域名: ${BASE_URL}"
fi

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
EXPORT_HTTP_CODE=""
EXPORT_HTTP_BODY=""
FAILED_STEP=""
FAILURE_REASON=""
SUCCESS="false"
EXPORTED="false"

EXPORT_QUERY_PARAMS=()
if [[ -n "${DELIVERY_STATE}" ]]; then
  EXPORT_QUERY_PARAMS+=("deliveryState=$(tp_urlencode "${DELIVERY_STATE}")")
fi
if [[ -n "${STATUS}" ]]; then
  EXPORT_QUERY_PARAMS+=("status=$(tp_urlencode "${STATUS}")")
fi
if [[ -n "${PROVIDER}" ]]; then
  EXPORT_QUERY_PARAMS+=("provider=$(tp_urlencode "${PROVIDER}")")
fi
if [[ -n "${TENANT_ID}" ]]; then
  EXPORT_QUERY_PARAMS+=("tenantId=$(tp_urlencode "${TENANT_ID}")")
fi
if [[ -n "${PROJECT_ID}" ]]; then
  EXPORT_QUERY_PARAMS+=("projectId=$(tp_urlencode "${PROJECT_ID}")")
fi
if [[ -n "${TRACE_ID}" ]]; then
  EXPORT_QUERY_PARAMS+=("traceId=$(tp_urlencode "${TRACE_ID}")")
fi
if [[ -n "${FROM_ISO}" ]]; then
  EXPORT_QUERY_PARAMS+=("from=$(tp_urlencode "${FROM_ISO}")")
fi
if [[ -n "${TO_ISO}" ]]; then
  EXPORT_QUERY_PARAMS+=("to=$(tp_urlencode "${TO_ISO}")")
fi
if [[ -n "${LIMIT}" ]]; then
  EXPORT_QUERY_PARAMS+=("limit=$(tp_urlencode "${LIMIT}")")
fi

EXPORT_URL="${BASE_URL%/}/api/admin/observability/agentledger-outbox/export"
if [[ "${#EXPORT_QUERY_PARAMS[@]}" -gt 0 ]]; then
  EXPORT_QUERY_STRING="$(printf '%s&' "${EXPORT_QUERY_PARAMS[@]}")"
  EXPORT_QUERY_STRING="${EXPORT_QUERY_STRING%&}"
  EXPORT_URL="${EXPORT_URL}?${EXPORT_QUERY_STRING}"
fi

VERIFY_HEADERS=(
  "Accept: application/json"
  "Authorization: Bearer ${API_SECRET_VALUE}"
)
OWNER_HEADERS=(
  "Accept: text/csv,application/json"
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

if [[ "${VERIFY_HTTP_CODE}" != "200" ]] || ! json_contains_true "${VERIFY_HTTP_BODY}" "success"; then
  FAILED_STEP="verify_secret"
  FAILURE_REASON="API Secret 探针失败（http=${VERIFY_HTTP_CODE}）"
else
  tp_log_info "2/3 验证 owner 身份: ${BASE_URL%/}/api/admin/auth/me"
  TP_HEADERS=("${OWNER_HEADERS[@]}")
  tp_http_call "GET" "${BASE_URL%/}/api/admin/auth/me"
  ADMIN_HTTP_CODE="${TP_HTTP_CODE}"
  ADMIN_HTTP_BODY="${TP_HTTP_BODY}"

  if [[ "${ADMIN_HTTP_CODE}" != "200" ]] || ! json_contains_true "${ADMIN_HTTP_BODY}" "authenticated"; then
    FAILED_STEP="admin_auth_me"
    FAILURE_REASON="owner 身份预检失败（http=${ADMIN_HTTP_CODE}）"
  elif [[ "${AUTH_MODE}" == "header" ]] && ! tp_json_contains "${ADMIN_HTTP_BODY}" "\"roleKey\":\"${OWNER_ROLE}\""; then
    FAILED_STEP="admin_auth_me"
    FAILURE_REASON="owner 身份预检失败（roleKey 不匹配）"
  else
    tp_log_info "3/3 导出 outbox CSV: ${EXPORT_URL}"
    TP_HEADERS=("${OWNER_HEADERS[@]}")
    tp_http_call "GET" "${EXPORT_URL}"
    EXPORT_HTTP_CODE="${TP_HTTP_CODE}"
    EXPORT_HTTP_BODY="${TP_HTTP_BODY}"

    if [[ "${EXPORT_HTTP_CODE}" != "200" ]]; then
      FAILED_STEP="export"
      FAILURE_REASON="导出返回非 200（http=${EXPORT_HTTP_CODE}）"
    else
      mkdir -p "$(dirname "${OUTPUT_FILE}")"
      printf '%s' "${EXPORT_HTTP_BODY}" > "${OUTPUT_FILE}"
      EXPORTED="true"
      SUCCESS="true"
    fi
  fi
fi

RUN_FINISHED_AT="$(tp_format_iso_utc "$(date +%s)")"
write_evidence

if [[ "${SUCCESS}" == "true" ]]; then
  tp_log_info "AgentLedger outbox CSV 导出完成"
  tp_log_info "csv=${OUTPUT_FILE}"
  tp_log_info "evidence=${EVIDENCE_FILE}"
  exit 0
fi

tp_log_error "AgentLedger outbox CSV 导出失败: ${FAILURE_REASON}"
tp_log_error "evidence=${EVIDENCE_FILE}"
exit 1
