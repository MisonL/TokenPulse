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
  --secret-helper <path>

可选参数:
  --config-template <path>         Alertmanager 基线模板路径，默认: ./monitoring/alertmanager.yml
  --secret-cmd-template <tpl>      已弃用；兼容旧命令模板
  --owner-tenant <tenant>         owner 租户（可选）
  --auditor-tenant <tenant>       auditor 租户（可选）
  --owner-cookie <cookie>         owner 管理员会话 Cookie（可选，示例: tp_admin_session=xxx）
  --auditor-cookie <cookie>       auditor 管理员会话 Cookie（可选，示例: tp_admin_session=xxx）
  --with-compat <false|observe|strict>
                                  是否执行 compat 退场观测，默认: false
  --prometheus-url <url>          Prometheus HTTP 地址（启用 compat 时必填）
  --prometheus-bearer-token <token>
                                  Prometheus Bearer Token（可选）
  --compat-critical-after <YYYY-MM-DD>
                                  compat 升级为 critical 的日期，默认: 2026-07-01
  --compat-show-limit <n>         compat 24h topk 数量，默认: 10
  --with-rollback <true|false>    是否按最新 historyId 回滚，默认: false
  --evidence-file <path>          证据输出文件路径（可选）
  --run-tag <text>                本次窗口标识（可选，默认自动生成）
  --insecure                      curl 使用 -k（仅测试环境）
  --help                          显示帮助

说明:
  1) 本脚本会调用:
     - publish_alertmanager_secret_sync.sh
     - drill_oauth_alert_escalation.sh
  2) 证据摘要至少包含: historyId、historyReason、traceId、drillExitCode、rollbackResult。
EOF
}

BASE_URL=""
API_SECRET_VALUE="${API_SECRET:-}"
OWNER_USER=""
OWNER_ROLE=""
OWNER_TENANT=""
OWNER_COOKIE=""
AUDITOR_USER=""
AUDITOR_ROLE=""
AUDITOR_TENANT=""
AUDITOR_COOKIE=""
WARNING_SECRET_REF=""
CRITICAL_SECRET_REF=""
P1_SECRET_REF=""
CONFIG_TEMPLATE_PATH="${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-./monitoring/alertmanager.yml}"
SECRET_HELPER=""
SECRET_CMD_TEMPLATE=""
WITH_COMPAT="false"
PROMETHEUS_URL="${PROMETHEUS_URL:-}"
PROMETHEUS_BEARER_TOKEN="${PROMETHEUS_BEARER_TOKEN:-}"
COMPAT_CRITICAL_AFTER="2026-07-01"
COMPAT_SHOW_LIMIT="10"
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
    --owner-cookie)
      OWNER_COOKIE="${2:-}"
      shift 2
      ;;
    --auditor-cookie)
      AUDITOR_COOKIE="${2:-}"
      shift 2
      ;;
    --with-compat)
      WITH_COMPAT="${2:-}"
      shift 2
      ;;
    --prometheus-url)
      PROMETHEUS_URL="${2:-}"
      shift 2
      ;;
    --prometheus-bearer-token)
      PROMETHEUS_BEARER_TOKEN="${2:-}"
      shift 2
      ;;
    --compat-critical-after)
      COMPAT_CRITICAL_AFTER="${2:-}"
      shift 2
      ;;
    --compat-show-limit)
      COMPAT_SHOW_LIMIT="${2:-}"
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
    --config-template)
      CONFIG_TEMPLATE_PATH="${2:-}"
      shift 2
      ;;
    --secret-helper)
      SECRET_HELPER="${2:-}"
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
if [[ -z "${OWNER_COOKIE}" && -z "${OWNER_USER}" ]]; then
  tp_fail "缺少 --owner-user"
fi
if [[ -z "${OWNER_COOKIE}" && -z "${OWNER_ROLE}" ]]; then
  tp_fail "缺少 --owner-role"
fi
if [[ -z "${AUDITOR_COOKIE}" && -z "${AUDITOR_USER}" ]]; then
  tp_fail "缺少 --auditor-user"
fi
if [[ -z "${AUDITOR_COOKIE}" && -z "${AUDITOR_ROLE}" ]]; then
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
if [[ -z "${SECRET_HELPER}" && -z "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_fail "缺少 --secret-helper 或 --secret-cmd-template"
fi
if [[ "${WITH_ROLLBACK}" != "true" && "${WITH_ROLLBACK}" != "false" ]]; then
  tp_fail "--with-rollback 仅支持 true/false"
fi
if [[ "${WITH_COMPAT}" != "false" && "${WITH_COMPAT}" != "observe" && "${WITH_COMPAT}" != "strict" ]]; then
  tp_fail "--with-compat 仅支持 false/observe/strict"
fi
if [[ "${WITH_COMPAT}" != "false" && -z "${PROMETHEUS_URL}" ]]; then
  tp_fail "启用 compat 观测时必须传入 --prometheus-url"
fi
if ! [[ "${COMPAT_SHOW_LIMIT}" =~ ^[0-9]+$ ]] || [[ "${COMPAT_SHOW_LIMIT}" -lt 1 ]]; then
  tp_fail "--compat-show-limit 必须为 >=1 的整数"
fi
if ! [[ "${COMPAT_CRITICAL_AFTER}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  tp_fail "--compat-critical-after 必须为 YYYY-MM-DD"
fi

if [[ -n "${SECRET_HELPER}" && -n "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_log_warn "同时传入 --secret-helper 与 --secret-cmd-template，已优先使用 --secret-helper；--secret-cmd-template 已弃用"
elif [[ -n "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_log_warn "--secret-cmd-template 已弃用，请尽快改用 --secret-helper <path>"
fi

BASE_URL="${BASE_URL%/}"
TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-8}"
TP_MAX_TIME="${TP_MAX_TIME:-25}"
TP_INSECURE="${INSECURE}"
DRILL_LOOKBACK_MINUTES="20"

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
history_reason=""
sync_trace_id=""
rollback_trace_id=""
rollback_result="skip"
rollback_error=""
rollback_http_code=""
drill_exit_code="0"
drill_completed_at_epoch=""
drill_incident_from=""
drill_incident_to=""
incident_id=""
incident_created_at=""
compat_check_mode=""
compat_5m_hits=""
compat_24h_hits=""
compat_gate_result="skipped"
compat_checked_at=""
final_exit_code=0
owner_auth_mode="header"
auditor_auth_mode="header"

if [[ -n "${OWNER_COOKIE}" ]]; then
  owner_auth_mode="cookie"
fi
if [[ -n "${AUDITOR_COOKIE}" ]]; then
  auditor_auth_mode="cookie"
fi

parse_compat_total() {
  local marker="$1"
  local output="$2"

  awk -v marker="${marker}" '
    index($0, marker ": ") > 0 {
      line = $0
      sub("^.*" marker ": ", "", line)
      print line
      exit
    }
  ' <<<"${output}"
}

validate_compat_total() {
  local label="$1"
  local value="$2"

  if [[ -z "${value}" ]]; then
    tp_fail "compat 退场观测缺少 ${label} 输出"
  fi

  if ! jq -nr --arg value "${value}" 'try ($value | tonumber) catch empty' | grep -Eq '^-?[0-9]+(\.[0-9]+)?$'; then
    tp_fail "compat 退场观测的 ${label} 不是合法数字: ${value}"
  fi
}

read_compat_summary_value() {
  local summary_file="$1"
  local key="$2"

  [[ -n "${summary_file}" && -f "${summary_file}" ]] || return 1
  jq -er ".${key}" "${summary_file}" 2>/dev/null
}

compat_total_is_zero() {
  local value="$1"
  [[ "$(jq -nr --arg value "${value}" '($value | tonumber) == 0')" == "true" ]]
}

run_compat_gate() {
  local -a cmd
  local compat_output=""
  local compat_exit_code=0
  local compat_summary_file=""

  if [[ "${WITH_COMPAT}" == "false" ]]; then
    tp_log_info "2.5/5 已跳过 compat 退场观测（--with-compat=false）"
    return 0
  fi

  compat_check_mode="${WITH_COMPAT}"
  compat_checked_at="$(tp_format_iso_utc "$(date +%s)")"

  cmd=(
    bash "${SCRIPT_DIR}/check_oauth_alert_compat.sh"
    --prometheus-url "${PROMETHEUS_URL}"
    --mode "${WITH_COMPAT}"
    --critical-after "${COMPAT_CRITICAL_AFTER}"
    --show-limit "${COMPAT_SHOW_LIMIT}"
  )
  compat_summary_file="$(mktemp -t tokenpulse-compat-summary.XXXXXX.json)"
  cmd+=(--summary-file "${compat_summary_file}")

  if [[ -n "${PROMETHEUS_BEARER_TOKEN}" ]]; then
    cmd+=(--bearer-token "${PROMETHEUS_BEARER_TOKEN}")
  fi

  if [[ "${INSECURE}" == "1" ]]; then
    cmd+=(--insecure)
  fi

  tp_log_info "2.5/5 执行 compat 退场观测"
  set +e
  compat_output="$("${cmd[@]}" 2>&1)"
  compat_exit_code="$?"
  set -e

  if [[ -n "${compat_output}" ]]; then
    printf '%s\n' "${compat_output}"
  fi

  compat_5m_hits="$(read_compat_summary_value "${compat_summary_file}" "compat5mHits" || true)"
  compat_24h_hits="$(read_compat_summary_value "${compat_summary_file}" "compat24hHits" || true)"
  compat_gate_result="$(read_compat_summary_value "${compat_summary_file}" "gateResult" || true)"
  compat_checked_at="$(read_compat_summary_value "${compat_summary_file}" "checkedAt" || true)"

  if [[ -z "${compat_5m_hits}" || -z "${compat_24h_hits}" ]]; then
    compat_5m_hits="$(parse_compat_total "compat 5m 总命中" "${compat_output}")"
    compat_24h_hits="$(parse_compat_total "compat 24h top${COMPAT_SHOW_LIMIT} 总命中" "${compat_output}")"
  fi

  if [[ "${compat_exit_code}" -ne 0 ]] && [[ -z "${compat_5m_hits}" || -z "${compat_24h_hits}" ]]; then
    tp_fail "compat 退场观测失败（mode=${WITH_COMPAT}, exit_code=${compat_exit_code}）"
  fi

  validate_compat_total "compat 5m 总命中" "${compat_5m_hits}"
  validate_compat_total "compat 24h 总命中" "${compat_24h_hits}"

  if [[ "${compat_exit_code}" -ne 0 ]]; then
    tp_fail "compat 退场观测失败（mode=${WITH_COMPAT}, exit_code=${compat_exit_code}）"
  fi

  if [[ -z "${compat_gate_result}" || "${compat_gate_result}" == "null" ]]; then
    if compat_total_is_zero "${compat_5m_hits}" && compat_total_is_zero "${compat_24h_hits}"; then
      compat_gate_result="pass"
    else
      compat_gate_result="warn"
    fi
  fi
  if [[ -z "${compat_checked_at}" || "${compat_checked_at}" == "null" ]]; then
    compat_checked_at="$(tp_format_iso_utc "$(date +%s)")"
  fi

  if compat_total_is_zero "${compat_5m_hits}" && compat_total_is_zero "${compat_24h_hits}"; then
    compat_gate_result="pass"
  elif [[ "${compat_gate_result}" != "fail" ]]; then
    compat_gate_result="warn"
  fi
}

tp_log_info "1/5 执行 Secret Manager 下发 + Alertmanager sync"
publish_cmd=(
  bash "${SCRIPT_DIR}/publish_alertmanager_secret_sync.sh"
  --base-url "${BASE_URL}"
  --api-secret "${API_SECRET_VALUE}"
  --warning-secret-ref "${WARNING_SECRET_REF}"
  --critical-secret-ref "${CRITICAL_SECRET_REF}"
  --p1-secret-ref "${P1_SECRET_REF}"
  --config-template "${CONFIG_TEMPLATE_PATH}"
  --comment "${publish_comment}"
  --sync-reason "${sync_reason}"
)
if [[ -n "${OWNER_USER}" ]]; then
  publish_cmd+=(--admin-user "${OWNER_USER}")
fi
if [[ -n "${OWNER_ROLE}" ]]; then
  publish_cmd+=(--admin-role "${OWNER_ROLE}")
fi
if [[ -n "${SECRET_HELPER}" ]]; then
  publish_cmd+=(--secret-helper "${SECRET_HELPER}")
else
  publish_cmd+=(--secret-cmd-template "${SECRET_CMD_TEMPLATE}")
fi
if [[ -n "${OWNER_COOKIE}" ]]; then
  publish_cmd+=(--cookie "${OWNER_COOKIE}")
fi
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
)
if [[ -n "${OWNER_USER}" ]]; then
  drill_cmd+=(--admin-user "${OWNER_USER}")
fi
if [[ -n "${OWNER_ROLE}" ]]; then
  drill_cmd+=(--admin-role "${OWNER_ROLE}")
fi
if [[ -n "${OWNER_COOKIE}" ]]; then
  drill_cmd+=(--cookie "${OWNER_COOKIE}")
fi
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
drill_completed_at_epoch="$(date +%s)"
drill_incident_from="$(tp_format_iso_utc "$((drill_completed_at_epoch - DRILL_LOOKBACK_MINUTES * 60))")"
drill_incident_to="$(tp_format_iso_utc "${drill_completed_at_epoch}")"

case "${drill_exit_code}" in
  0|11|15|20)
    tp_log_info "演练执行完成（exit_code=${drill_exit_code}）"
    ;;
  *)
    tp_fail "演练脚本返回异常退出码: ${drill_exit_code}"
    ;;
esac

run_compat_gate

tp_log_info "3/5 auditor 抓取最新 sync-history"
TP_HEADERS=(
  "Accept: application/json"
  "Authorization: Bearer ${API_SECRET_VALUE}"
)
if [[ -n "${AUDITOR_COOKIE}" ]]; then
  TP_HEADERS+=("Cookie: ${AUDITOR_COOKIE}")
else
  TP_HEADERS+=(
    "x-admin-user: ${AUDITOR_USER}"
    "x-admin-role: ${AUDITOR_ROLE}"
  )
  if [[ -n "${AUDITOR_TENANT}" ]]; then
    TP_HEADERS+=("x-admin-tenant: ${AUDITOR_TENANT}")
  fi
fi

tp_require_admin_identity "${BASE_URL}" "release-window(auditor)" "auditor"

tp_http_call "GET" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/sync-history?page=1&pageSize=200"
tp_expect_status "200" "读取 sync-history"
history_response_json="${TP_HTTP_BODY}"

history_match_json="$(printf '%s' "${history_response_json}" | jq -c --arg reason "${sync_reason}" --arg tag "${RUN_TAG}" '
  [.data[]? | select(((.reason // "") == $reason) or ((.reason // "") | contains($tag)))] | first // empty
')"

history_id="$(printf '%s' "${history_match_json}" | jq -r '.historyId // .id // empty')"
history_outcome="$(printf '%s' "${history_match_json}" | jq -r '.outcome // empty')"
history_started_at="$(printf '%s' "${history_match_json}" | jq -r '.startedAt // .ts // empty')"
history_reason="$(printf '%s' "${history_match_json}" | jq -r '.reason // empty')"

if [[ -z "${history_id}" ]]; then
  tp_fail "sync-history 未找到与本次 RUN_TAG 匹配的 historyId（run_tag=${RUN_TAG}, reason=${sync_reason}）: ${history_response_json}"
fi

tp_log_info "4/5 查询审计事件提取 traceId，并补齐 drill incident 证据"
tp_http_call "GET" "${BASE_URL}/api/admin/audit/events?action=oauth.alert.alertmanager.sync&keyword=${RUN_TAG}&from=${window_started_at}&page=1&pageSize=1"
tp_expect_status "200" "查询审计事件"
sync_trace_id="$(printf '%s' "${TP_HTTP_BODY}" | jq -r '.data[0].traceId // empty')"
if [[ -z "${sync_trace_id}" ]]; then
  sync_trace_id="$(printf '%s' "${history_match_json}" | jq -r '.traceId // empty')"
fi

if [[ "${drill_exit_code}" != "0" ]]; then
  tp_http_call "GET" "${BASE_URL}/api/admin/observability/oauth-alerts/incidents?severity=critical&from=${drill_incident_from}&to=${drill_incident_to}&page=1&pageSize=200"
  tp_expect_status "200" "查询 drill incidents"
  incident_match_json="$(printf '%s' "${TP_HTTP_BODY}" | jq -c '
    [.data[]? | select((.createdAt // 0) > 0)] | sort_by(.createdAt, (.id // 0)) | first // empty
  ')"
  incident_id="$(printf '%s' "${incident_match_json}" | jq -r '.incidentId // empty')"
  incident_created_at="$(printf '%s' "${incident_match_json}" | jq -r '.createdAt // empty')"

  if [[ -z "${incident_id}" || -z "${incident_created_at}" ]]; then
    incident_id=""
    incident_created_at=""
    tp_log_warn "drill exit_code=${drill_exit_code}，但未在 ${drill_incident_from} -> ${drill_incident_to} 解析到可追溯 incident 证据"
  fi
else
  tp_log_info "drill 未命中升级，跳过 incident 证据补齐"
fi

if [[ "${WITH_ROLLBACK}" == "true" ]]; then
  tp_log_info "5/5 owner 按最新 historyId 执行 rollback"
  TP_HEADERS=(
    "Accept: application/json"
    "Authorization: Bearer ${API_SECRET_VALUE}"
  )
  if [[ -n "${OWNER_COOKIE}" ]]; then
    TP_HEADERS+=("Cookie: ${OWNER_COOKIE}")
  else
    TP_HEADERS+=(
      "x-admin-user: ${OWNER_USER}"
      "x-admin-role: ${OWNER_ROLE}"
    )
    if [[ -n "${OWNER_TENANT}" ]]; then
      TP_HEADERS+=("x-admin-tenant: ${OWNER_TENANT}")
    fi
  fi

  tp_require_admin_identity "${BASE_URL}" "release-window(owner)" "owner"

  rollback_payload="$(jq -cn \
    --arg reason "${rollback_reason}" \
    --arg comment "${rollback_comment}" \
    '{reason:$reason,comment:$comment}')"

  tp_http_call "POST" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/sync-history/${history_id}/rollback" "${rollback_payload}"
  rollback_http_code="${TP_HTTP_CODE}"
  rollback_trace_id="$(printf '%s' "${TP_HTTP_BODY}" | jq -r '.traceId // empty')"

  if [[ "${rollback_http_code}" == "200" ]] && tp_json_contains "${TP_HTTP_BODY}" '"success":true'; then
    rollback_result="success"
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
  --arg ownerAuthMode "${owner_auth_mode}" \
  --arg ownerUser "${OWNER_USER}" \
  --arg ownerRole "${OWNER_ROLE}" \
  --arg auditorAuthMode "${auditor_auth_mode}" \
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
  --arg historyReason "${history_reason}" \
  --arg incidentId "${incident_id}" \
  --arg incidentCreatedAt "${incident_created_at}" \
  --arg compatCheckMode "${compat_check_mode}" \
  --arg compat5mHits "${compat_5m_hits}" \
  --arg compat24hHits "${compat_24h_hits}" \
  --arg compatGateResult "${compat_gate_result}" \
  --arg compatCheckedAt "${compat_checked_at}" \
  '{
    generatedAt: $generatedAt,
    runTag: $runTag,
    baseUrl: $baseUrl,
    owner: {
      authMode: $ownerAuthMode,
      user: (if $ownerUser == "" then null else $ownerUser end),
      role: (if $ownerRole == "" then null else $ownerRole end)
    },
    auditor: {
      authMode: $auditorAuthMode,
      user: (if $auditorUser == "" then null else $auditorUser end),
      role: (if $auditorRole == "" then null else $auditorRole end)
    },
    withRollback: ($withRollback == "true"),
    historyId: $historyId,
    traceId: $traceId,
    drillExitCode: ($drillExitCode | tonumber),
    rollbackResult: $rollbackResult,
    rollbackHttpCode: (if $rollbackHttpCode == "" then null else ($rollbackHttpCode | tonumber) end),
    rollbackTraceId: (if $rollbackTraceId == "" then null else $rollbackTraceId end),
    rollbackError: (if $rollbackError == "" then null else $rollbackError end),
    historyOutcome: (if $historyOutcome == "" then null else $historyOutcome end),
    historyStartedAt: (if $historyStartedAt == "" then null else $historyStartedAt end),
    historyReason: (if $historyReason == "" then null else $historyReason end),
    incidentId: (if $incidentId == "" then null else $incidentId end),
    incidentCreatedAt: (if $incidentCreatedAt == "" then null else ($incidentCreatedAt | tonumber) end),
    compatCheckMode: (if $compatCheckMode == "" then null else $compatCheckMode end),
    compat5mHits: (if $compat5mHits == "" then null else ($compat5mHits | tonumber) end),
    compat24hHits: (if $compat24hHits == "" then null else ($compat24hHits | tonumber) end),
    compatGateResult: $compatGateResult,
    compatCheckedAt: (if $compatCheckedAt == "" then null else $compatCheckedAt end)
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
