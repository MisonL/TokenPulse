#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
OAuth 告警 compat 兼容路径观测脚本（Prometheus 查询）

用法:
  ./scripts/release/check_oauth_alert_compat.sh [参数]

参数:
  --prometheus-url <url>          Prometheus HTTP 地址（例如 http://127.0.0.1:9090）
  --bearer-token <token>          Prometheus Bearer Token（可选）
  --mode <observe|strict>         观测模式，默认: observe
  --critical-after <YYYY-MM-DD>   compat 进入 critical 的日期，默认: 2026-07-01
  --show-limit <n>                24h topk 数量，默认: 10
  --summary-file <path>           可选：输出机器可读 JSON 摘要
  --now-date <YYYY-MM-DD>         覆盖当前日期（测试/排障用）
  --insecure                      curl 使用 -k（仅测试环境）
  --help                          显示帮助

说明:
  1) 查询 5m 与 24h 两个窗口的 compat 命中量，并输出 method/route 摘要。
  2) observe: 当前日期早于 critical-after 时，即使命中也仅告警不失败。
  3) strict: 只要 compat 命中 > 0 就失败。
  4) 当前日期 >= critical-after 时，无论 mode=observe/strict，compat 命中都直接失败。
EOF
}

PROMETHEUS_URL="${PROMETHEUS_URL:-}"
PROMETHEUS_BEARER_TOKEN="${PROMETHEUS_BEARER_TOKEN:-}"
COMPAT_MODE="observe"
CRITICAL_AFTER="2026-07-01"
SHOW_LIMIT="10"
SUMMARY_FILE=""
NOW_DATE="$(date +%F)"
INSECURE="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prometheus-url)
      PROMETHEUS_URL="${2:-}"
      shift 2
      ;;
    --bearer-token)
      PROMETHEUS_BEARER_TOKEN="${2:-}"
      shift 2
      ;;
    --mode)
      COMPAT_MODE="${2:-}"
      shift 2
      ;;
    --critical-after)
      CRITICAL_AFTER="${2:-}"
      shift 2
      ;;
    --show-limit)
      SHOW_LIMIT="${2:-}"
      shift 2
      ;;
    --summary-file)
      SUMMARY_FILE="${2:-}"
      shift 2
      ;;
    --now-date)
      NOW_DATE="${2:-}"
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
tp_require_cmd jq

if [[ -z "${PROMETHEUS_URL}" ]]; then
  tp_fail "缺少 --prometheus-url"
fi

if [[ "${COMPAT_MODE}" != "observe" && "${COMPAT_MODE}" != "strict" ]]; then
  tp_fail "--mode 仅支持 observe|strict"
fi

if ! [[ "${SHOW_LIMIT}" =~ ^[0-9]+$ ]] || [[ "${SHOW_LIMIT}" -lt 1 ]]; then
  tp_fail "--show-limit 必须为 >=1 的整数"
fi

if ! [[ "${CRITICAL_AFTER}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  tp_fail "--critical-after 必须为 YYYY-MM-DD"
fi

if ! [[ "${NOW_DATE}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  tp_fail "--now-date 必须为 YYYY-MM-DD"
fi

PROMETHEUS_URL="${PROMETHEUS_URL%/}"
TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-8}"
TP_MAX_TIME="${TP_MAX_TIME:-20}"
TP_INSECURE="${INSECURE}"

prometheus_query() {
  local query="$1"
  local context="$2"
  local encoded_query
  local previous_headers_decl=""
  local had_headers="0"

  encoded_query="$(printf '%s' "${query}" | jq -sRr @uri)"

  if previous_headers_decl="$(declare -p TP_HEADERS 2>/dev/null)"; then
    had_headers="1"
  else
    TP_HEADERS=()
  fi

  TP_HEADERS=("Accept: application/json")
  if [[ -n "${PROMETHEUS_BEARER_TOKEN}" ]]; then
    TP_HEADERS+=("Authorization: Bearer ${PROMETHEUS_BEARER_TOKEN}")
  fi

  tp_http_call "GET" "${PROMETHEUS_URL}/api/v1/query?query=${encoded_query}"

  if [[ "${had_headers}" == "1" ]]; then
    eval "${previous_headers_decl}"
  else
    unset TP_HEADERS
  fi

  tp_expect_status "200" "${context}"
  tp_json_contains "${TP_HTTP_BODY}" '"status":"success"' || tp_fail "${context} 响应异常: ${TP_HTTP_BODY}"
}

print_hits() {
  local label="$1"
  local payload="$2"
  local line

  while IFS=$'\t' read -r method route value; do
    [[ -n "${method}" ]] || continue
    tp_log_info "${label}: method=${method} route=${route} hits=${value}"
  done < <(
    printf '%s' "${payload}" | jq -r '
      [.data.result[]? | {
        method: (.metric.method // "unknown"),
        route: (.metric.route // "unknown"),
        value: ((.value[1] // "0") | tonumber)
      }]
      | sort_by(.value, .route, .method)
      | reverse[]
      | "\(.method)\t\(.route)\t\(.value)"
    '
  )
}

sum_hits() {
  printf '%s' "$1" | jq -r '
    [.data.result[]? | ((.value[1] // "0") | tonumber)] | add // 0
  '
}

write_summary_file() {
  local gate_result="$1"
  local checked_at="$2"

  [[ -n "${SUMMARY_FILE}" ]] || return 0

  mkdir -p "$(dirname "${SUMMARY_FILE}")"
  jq -cn \
    --arg mode "${COMPAT_MODE}" \
    --arg criticalAfter "${CRITICAL_AFTER}" \
    --arg nowDate "${NOW_DATE}" \
    --arg checkedAt "${checked_at}" \
    --arg gateResult "${gate_result}" \
    --arg compat5mHits "${compat_5m_total}" \
    --arg compat24hHits "${compat_24h_total}" \
    --arg showLimit "${SHOW_LIMIT}" \
    '{
      mode: $mode,
      criticalAfter: $criticalAfter,
      nowDate: $nowDate,
      checkedAt: $checkedAt,
      gateResult: $gateResult,
      compat5mHits: ($compat5mHits | tonumber),
      compat24hHits: ($compat24hHits | tonumber),
      showLimit: ($showLimit | tonumber)
    }' > "${SUMMARY_FILE}"
}

query_5m='sum(increase(tokenpulse_oauth_alert_compat_route_hits_total[5m])) by (method, route)'
query_24h="topk(${SHOW_LIMIT}, sum by (method, route) (increase(tokenpulse_oauth_alert_compat_route_hits_total[24h])))"

tp_log_info "1/2 查询 compat 5m 命中"
prometheus_query "${query_5m}" "查询 compat 5m 指标"
compat_5m_json="${TP_HTTP_BODY}"
compat_5m_total="$(sum_hits "${compat_5m_json}")"
tp_log_info "compat 5m 总命中: ${compat_5m_total}"
print_hits "compat 5m" "${compat_5m_json}"

tp_log_info "2/2 查询 compat 24h top${SHOW_LIMIT}"
prometheus_query "${query_24h}" "查询 compat 24h 指标"
compat_24h_json="${TP_HTTP_BODY}"
compat_24h_total="$(sum_hits "${compat_24h_json}")"
tp_log_info "compat 24h top${SHOW_LIMIT} 总命中: ${compat_24h_total}"
print_hits "compat 24h" "${compat_24h_json}"

compat_checked_at="$(tp_format_iso_utc "$(date +%s)")"

if [[ "${compat_5m_total}" == "0" && "${compat_24h_total}" == "0" ]]; then
  write_summary_file "pass" "${compat_checked_at}"
  tp_log_info "compat 指标为 0，可继续发布窗口观测"
  exit 0
fi

if [[ "${NOW_DATE}" > "${CRITICAL_AFTER}" || "${NOW_DATE}" == "${CRITICAL_AFTER}" ]]; then
  write_summary_file "fail" "${compat_checked_at}"
  tp_fail "compat 指标仍有命中，且当前日期 ${NOW_DATE} 已达到 critical-after=${CRITICAL_AFTER}"
fi

if [[ "${COMPAT_MODE}" == "strict" ]]; then
  write_summary_file "fail" "${compat_checked_at}"
  tp_fail "compat 指标命中 > 0（5m=${compat_5m_total}, 24h_top${SHOW_LIMIT}=${compat_24h_total}），strict 模式阻断继续发布"
fi

write_summary_file "warn" "${compat_checked_at}"
tp_log_warn "compat 指标命中 > 0（5m=${compat_5m_total}, 24h_top${SHOW_LIMIT}=${compat_24h_total}）；请记录 method/route/时间窗口/疑似来源/责任人/处置结论"
