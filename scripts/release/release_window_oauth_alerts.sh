#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
生产窗口编排脚本（Secret 下发 + 演练 + sync-history + 可选回滚 + 证据输出）

用法:
  ./scripts/release/release_window_oauth_alerts.sh [参数]

最小参数:
  --base-url <url>
  --api-secret <secret>
  --owner-user <user>
  --owner-role <role>
  --auditor-user <user>
  --auditor-role <role>
  --warning-secret-ref <ref>
  --critical-secret-ref <ref>
  --p1-secret-ref <ref>
  --secret-cmd-template <tpl>

可选参数:
  --owner-tenant <tenant>         owner 租户（可选）
  --auditor-tenant <tenant>       auditor 租户（可选）
  --with-rollback <true|false>    是否按最新 historyId 回滚，默认: false
  --evidence-file <path>          证据输出文件路径（可选）
  --run-tag <text>                本次窗口标识（可选，默认自动生成）
  --insecure                      curl 使用 -k（仅测试环境）
  --help                          显示帮助

说明:
  1) 本脚本会调用:
     - publish_alertmanager_secret_sync.sh
     - drill_oauth_alert_escalation.sh
  2) 证据摘要至少包含: historyId、traceId、drillExitCode、rollbackResult。
EOF
}

BASE_URL=""
API_SECRET_VALUE="${API_SECRET:-}"
OWNER_USER=""
OWNER_ROLE=""
OWNER_TENANT=""
AUDITOR_USER=""
AUDITOR_ROLE=""
AUDITOR_TENANT=""
WARNING_SECRET_REF=""
CRITICAL_SECRET_REF=""
P1_SECRET_REF=""
SECRET_CMD_TEMPLATE=""
WITH_ROLLBACK="false"
EVIDENCE_FILE=""
RUN_TAG=""
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
    --owner-user)
      OWNER_USER="${2:-}"
      shift 2
      ;;
    --owner-role)
      OWNER_ROLE="${2:-}"
      shift 2
      ;;
    --owner-tenant)
      OWNER_TENANT="${2:-}"
      shift 2
      ;;
    --auditor-user)
      AUDITOR_USER="${2:-}"
      shift 2
      ;;
    --auditor-role)
      AUDITOR_ROLE="${2:-}"
      shift 2
      ;;
    --auditor-tenant)
      AUDITOR_TENANT="${2:-}"
      shift 2
      ;;
    --warning-secret-ref)
      WARNING_SECRET_REF="${2:-}"
      shift 2
      ;;
    --critical-secret-ref)
      CRITICAL_SECRET_REF="${2:-}"
      shift 2
      ;;
    --p1-secret-ref)
      P1_SECRET_REF="${2:-}"
      shift 2
      ;;
    --secret-cmd-template)
      SECRET_CMD_TEMPLATE="${2:-}"
      shift 2
      ;;
    --with-rollback)
      WITH_ROLLBACK="${2:-}"
      shift 2
      ;;
    --evidence-file)
      EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --run-tag)
      RUN_TAG="${2:-}"
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

tp_require_cmd bash
tp_require_cmd curl
tp_require_cmd jq

if [[ -z "${BASE_URL}" ]]; then
  tp_fail "缺少 --base-url"
fi
if [[ -z "${API_SECRET_VALUE}" ]]; then
  tp_fail "缺少 --api-secret 或环境变量 API_SECRET"
fi
if [[ -z "${OWNER_USER}" ]]; then
  tp_fail "缺少 --owner-user"
fi
if [[ -z "${OWNER_ROLE}" ]]; then
  tp_fail "缺少 --owner-role"
fi
if [[ -z "${AUDITOR_USER}" ]]; then
  tp_fail "缺少 --auditor-user"
fi
if [[ -z "${AUDITOR_ROLE}" ]]; then
  tp_fail "缺少 --auditor-role"
fi
if [[ -z "${WARNING_SECRET_REF}" ]]; then
  tp_fail "缺少 --warning-secret-ref"
fi
if [[ -z "${CRITICAL_SECRET_REF}" ]]; then
  tp_fail "缺少 --critical-secret-ref"
fi
if [[ -z "${P1_SECRET_REF}" ]]; then
  tp_fail "缺少 --p1-secret-ref"
fi
if [[ -z "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_fail "缺少 --secret-cmd-template"
fi
if [[ "${WITH_ROLLBACK}" != "true" && "${WITH_ROLLBACK}" != "false" ]]; then
  tp_fail "--with-rollback 仅支持 true/false"
fi

BASE_URL="${BASE_URL%/}"
TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-8}"
TP_MAX_TIME="${TP_MAX_TIME:-25}"
TP_INSECURE="${INSECURE}"

window_started_at="$(tp_format_iso_utc "$(date +%s)")"
if [[ -z "${RUN_TAG}" ]]; then
  RUN_TAG="release-window-$(date -u +%Y%m%dT%H%M%SZ)"
fi

publish_comment="release window ${RUN_TAG}"
sync_reason="release window sync ${RUN_TAG}"
rollback_reason="release window rollback ${RUN_TAG}"
rollback_comment="rollback from ${RUN_TAG}"

history_id=""
history_outcome=""
history_started_at=""
sync_trace_id=""
rollback_trace_id=""
rollback_result="skip"
rollback_error=""
rollback_http_code=""
drill_exit_code="0"
final_exit_code=0

tp_log_info "1/5 执行 Secret Manager 下发 + Alertmanager sync"
publish_cmd=(
  bash "${SCRIPT_DIR}/publish_alertmanager_secret_sync.sh"
  --base-url "${BASE_URL}"
  --api-secret "${API_SECRET_VALUE}"
  --admin-user "${OWNER_USER}"
  --admin-role "${OWNER_ROLE}"
  --warning-secret-ref "${WARNING_SECRET_REF}"
  --critical-secret-ref "${CRITICAL_SECRET_REF}"
  --p1-secret-ref "${P1_SECRET_REF}"
  --secret-cmd-template "${SECRET_CMD_TEMPLATE}"
  --comment "${publish_comment}"
  --sync-reason "${sync_reason}"
)
if [[ -n "${OWNER_TENANT}" ]]; then
  publish_cmd+=(--admin-tenant "${OWNER_TENANT}")
fi
if [[ "${INSECURE}" == "1" ]]; then
  publish_cmd+=(--insecure)
fi
"${publish_cmd[@]}"

tp_log_info "2/5 执行 OAuth 升级演练"
drill_cmd=(
  bash "${SCRIPT_DIR}/drill_oauth_alert_escalation.sh"
  --base-url "${BASE_URL}"
  --api-secret "${API_SECRET_VALUE}"
  --admin-user "${OWNER_USER}"
  --admin-role "${OWNER_ROLE}"
)
if [[ -n "${OWNER_TENANT}" ]]; then
  drill_cmd+=(--admin-tenant "${OWNER_TENANT}")
fi
if [[ "${INSECURE}" == "1" ]]; then
  drill_cmd+=(--insecure)
fi

set +e
"${drill_cmd[@]}"
drill_exit_code="$?"
set -e

case "${drill_exit_code}" in
  0|11|15|20)
    tp_log_info "演练执行完成（exit_code=${drill_exit_code}）"
    ;;
  *)
    tp_fail "演练脚本返回异常退出码: ${drill_exit_code}"
    ;;
esac

tp_log_info "3/5 auditor 抓取最新 sync-history"
TP_HEADERS=(
  "Accept: application/json"
  "Authorization: Bearer ${API_SECRET_VALUE}"
  "x-admin-user: ${AUDITOR_USER}"
  "x-admin-role: ${AUDITOR_ROLE}"
)
if [[ -n "${AUDITOR_TENANT}" ]]; then
  TP_HEADERS+=("x-admin-tenant: ${AUDITOR_TENANT}")
fi

tp_http_call "GET" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=1"
tp_expect_status "200" "读取 sync-history"
history_response_json="${TP_HTTP_BODY}"

history_id="$(printf '%s' "${history_response_json}" | jq -r '.data[0].historyId // .data[0].id // empty')"
history_outcome="$(printf '%s' "${history_response_json}" | jq -r '.data[0].outcome // empty')"
history_started_at="$(printf '%s' "${history_response_json}" | jq -r '.data[0].startedAt // .data[0].ts // empty')"

if [[ -z "${history_id}" ]]; then
  tp_fail "sync-history 未返回可用 historyId: ${history_response_json}"
fi

tp_log_info "4/5 查询审计事件提取 traceId"
tp_http_call "GET" "${BASE_URL}/api/admin/audit/events?action=oauth.alert.alertmanager.sync&keyword=${RUN_TAG}&from=${window_started_at}&page=1&pageSize=1"
tp_expect_status "200" "查询审计事件"
sync_trace_id="$(printf '%s' "${TP_HTTP_BODY}" | jq -r '.data[0].traceId // empty')"
if [[ -z "${sync_trace_id}" ]]; then
  tp_http_call "GET" "${BASE_URL}/api/admin/audit/events?action=oauth.alert.alertmanager.sync&page=1&pageSize=1"
  tp_expect_status "200" "查询最新 sync 审计事件"
  sync_trace_id="$(printf '%s' "${TP_HTTP_BODY}" | jq -r '.data[0].traceId // empty')"
fi
if [[ -z "${sync_trace_id}" ]]; then
  sync_trace_id="$(printf '%s' "${history_response_json}" | jq -r '.data[0].traceId // empty')"
fi

if [[ "${WITH_ROLLBACK}" == "true" ]]; then
  tp_log_info "5/5 owner 按最新 historyId 执行 rollback"
  TP_HEADERS=(
    "Accept: application/json"
    "Authorization: Bearer ${API_SECRET_VALUE}"
    "x-admin-user: ${OWNER_USER}"
    "x-admin-role: ${OWNER_ROLE}"
  )
  if [[ -n "${OWNER_TENANT}" ]]; then
    TP_HEADERS+=("x-admin-tenant: ${OWNER_TENANT}")
  fi

  rollback_payload="$(jq -cn \
    --arg reason "${rollback_reason}" \
    --arg comment "${rollback_comment}" \
    '{reason:$reason,comment:$comment}')"

  tp_http_call "POST" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/sync-history/${history_id}/rollback" "${rollback_payload}"
  rollback_http_code="${TP_HTTP_CODE}"

  if [[ "${rollback_http_code}" == "200" ]] && tp_json_contains "${TP_HTTP_BODY}" '"success":true'; then
    rollback_result="success"
    rollback_trace_id="$(printf '%s' "${TP_HTTP_BODY}" | jq -r '.traceId // empty')"
  else
    rollback_result="failure"
    rollback_error="$(printf '%s' "${TP_HTTP_BODY}" | jq -r '.error // .details // "rollback request failed"')"
    final_exit_code=1
    tp_log_warn "rollback 执行失败（http_code=${rollback_http_code}）: ${rollback_error}"
  fi
else
  tp_log_info "5/5 已跳过 rollback（--with-rollback=false）"
fi

evidence_trace_id="${rollback_trace_id:-}"
if [[ -z "${evidence_trace_id}" ]]; then
  evidence_trace_id="${sync_trace_id:-}"
fi
if [[ -z "${evidence_trace_id}" ]]; then
  evidence_trace_id="unknown"
  tp_log_warn "未解析到 traceId，证据中将使用 unknown"
fi

evidence_json="$(jq -cn \
  --arg generatedAt "$(tp_format_iso_utc "$(date +%s)")" \
  --arg runTag "${RUN_TAG}" \
  --arg baseUrl "${BASE_URL}" \
  --arg ownerUser "${OWNER_USER}" \
  --arg ownerRole "${OWNER_ROLE}" \
  --arg auditorUser "${AUDITOR_USER}" \
  --arg auditorRole "${AUDITOR_ROLE}" \
  --arg withRollback "${WITH_ROLLBACK}" \
  --arg historyId "${history_id}" \
  --arg traceId "${evidence_trace_id}" \
  --arg drillExitCode "${drill_exit_code}" \
  --arg rollbackResult "${rollback_result}" \
  --arg rollbackHttpCode "${rollback_http_code}" \
  --arg rollbackTraceId "${rollback_trace_id}" \
  --arg rollbackError "${rollback_error}" \
  --arg historyOutcome "${history_outcome}" \
  --arg historyStartedAt "${history_started_at}" \
  '{
    generatedAt: $generatedAt,
    runTag: $runTag,
    baseUrl: $baseUrl,
    owner: { user: $ownerUser, role: $ownerRole },
    auditor: { user: $auditorUser, role: $auditorRole },
    withRollback: ($withRollback == "true"),
    historyId: $historyId,
    traceId: $traceId,
    drillExitCode: ($drillExitCode | tonumber),
    rollbackResult: $rollbackResult,
    rollbackHttpCode: (if $rollbackHttpCode == "" then null else ($rollbackHttpCode | tonumber) end),
    rollbackTraceId: (if $rollbackTraceId == "" then null else $rollbackTraceId end),
    rollbackError: (if $rollbackError == "" then null else $rollbackError end),
    historyOutcome: (if $historyOutcome == "" then null else $historyOutcome end),
    historyStartedAt: (if $historyStartedAt == "" then null else $historyStartedAt end)
  }')"

tp_log_info "证据摘要（stdout）:"
printf '%s\n' "${evidence_json}"

if [[ -n "${EVIDENCE_FILE}" ]]; then
  mkdir -p "$(dirname "${EVIDENCE_FILE}")"
  printf '%s\n' "${evidence_json}" >"${EVIDENCE_FILE}"
  tp_log_info "证据文件已写入: ${EVIDENCE_FILE}"
fi

if [[ "${final_exit_code}" -ne 0 ]]; then
  tp_log_error "生产窗口编排完成，但 rollback 失败（rollbackResult=${rollback_result}）"
  exit "${final_exit_code}"
fi

tp_log_info "生产窗口编排完成"
