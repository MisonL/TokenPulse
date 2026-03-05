#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
OAuth 告警升级演练脚本（5m / 15m）

用法:
  ./scripts/release/drill_oauth_alert_escalation.sh [参数]

参数:
  --base-url <url>            Core 地址，默认: http://127.0.0.1:9009
  --api-secret <secret>       API_SECRET（也可用环境变量 API_SECRET）
  --admin-user <user>         x-admin-user，默认: oncall-bot
  --admin-role <role>         x-admin-role，默认: owner
  --admin-tenant <tenant>     x-admin-tenant（可选）
  --cookie <cookie>           管理员会话 Cookie（可选）
  --provider <provider>       指定 provider（可选）
  --lookback-minutes <min>    统计回看窗口，默认: 20
  --skip-evaluate             跳过手动 evaluate
  --skip-test-delivery        跳过 test-delivery 触发
  --insecure                  curl 使用 -k（仅测试环境）
  --help                      显示帮助

退出码:
  0  未命中升级（无告警或仅观测）
  11 命中 warning（critical 出现但未满 5 分钟）
  15 命中 critical（持续 >=5 且 <15 分钟）
  20 命中 P1（持续 >=15 分钟）
EOF
}

BASE_URL="http://127.0.0.1:9009"
API_SECRET_VALUE="${API_SECRET:-}"
ADMIN_USER="oncall-bot"
ADMIN_ROLE="owner"
ADMIN_TENANT=""
COOKIE=""
PROVIDER=""
LOOKBACK_MINUTES="20"
INSECURE="0"
SKIP_EVALUATE="0"
SKIP_TEST_DELIVERY="0"

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
    --admin-user)
      ADMIN_USER="${2:-}"
      shift 2
      ;;
    --admin-role)
      ADMIN_ROLE="${2:-}"
      shift 2
      ;;
    --admin-tenant)
      ADMIN_TENANT="${2:-}"
      shift 2
      ;;
    --cookie)
      COOKIE="${2:-}"
      shift 2
      ;;
    --provider)
      PROVIDER="${2:-}"
      shift 2
      ;;
    --lookback-minutes)
      LOOKBACK_MINUTES="${2:-}"
      shift 2
      ;;
    --skip-evaluate)
      SKIP_EVALUATE="1"
      shift 1
      ;;
    --skip-test-delivery)
      SKIP_TEST_DELIVERY="1"
      shift 1
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

if [[ -z "${API_SECRET_VALUE}" ]]; then
  tp_fail "缺少 --api-secret 或环境变量 API_SECRET"
fi

if ! [[ "${LOOKBACK_MINUTES}" =~ ^[0-9]+$ ]] || [[ "${LOOKBACK_MINUTES}" -lt 5 ]]; then
  tp_fail "--lookback-minutes 必须为 >=5 的整数"
fi

BASE_URL="${BASE_URL%/}"
TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-8}"
TP_MAX_TIME="${TP_MAX_TIME:-20}"
TP_INSECURE="${INSECURE}"

TP_HEADERS=(
  "Accept: application/json"
  "Authorization: Bearer ${API_SECRET_VALUE}"
)

if [[ -n "${COOKIE}" ]]; then
  TP_HEADERS+=("Cookie: ${COOKIE}")
else
  TP_HEADERS+=(
    "x-admin-user: ${ADMIN_USER}"
    "x-admin-role: ${ADMIN_ROLE}"
  )
  if [[ -n "${ADMIN_TENANT}" ]]; then
    TP_HEADERS+=("x-admin-tenant: ${ADMIN_TENANT}")
  fi
fi

now_ms="$(($(date +%s) * 1000))"
from_ms="$((now_ms - LOOKBACK_MINUTES * 60 * 1000))"
from_iso="$(tp_format_iso_utc "$((from_ms / 1000))")"
to_iso="$(tp_format_iso_utc "$((now_ms / 1000))")"

query_provider=""
if [[ -n "${PROVIDER}" ]]; then
  query_provider="&provider=${PROVIDER}"
fi

tp_log_info "1/5 读取健康状态"
tp_http_call "GET" "${BASE_URL}/health"
tp_expect_status "200" "健康检查"
tp_json_contains "${TP_HTTP_BODY}" '"status":"ok"' || tp_fail "健康检查响应异常: ${TP_HTTP_BODY}"

if [[ "${SKIP_EVALUATE}" != "1" ]]; then
  tp_log_info "2/5 手动触发 OAuth evaluate"
  tp_http_call "POST" "${BASE_URL}/api/admin/observability/oauth-alerts/evaluate" "{}"
  tp_expect_status "200" "触发 evaluate"
  tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "evaluate 响应异常: ${TP_HTTP_BODY}"
else
  tp_log_info "2/5 已跳过 evaluate"
fi

if [[ "${SKIP_TEST_DELIVERY}" != "1" ]]; then
  tp_log_info "3/5 触发 test-delivery（critical 演练样本）"
  payload='{"provider":"drill","phase":"error","severity":"critical","totalCount":100,"failureCount":60,"failureRateBps":6000,"message":"release drill critical sample"}'
  if [[ -n "${PROVIDER}" ]]; then
    payload="{\"provider\":\"${PROVIDER}\",\"phase\":\"error\",\"severity\":\"critical\",\"totalCount\":100,\"failureCount\":60,\"failureRateBps\":6000,\"message\":\"release drill critical sample\"}"
  fi
  tp_http_call "POST" "${BASE_URL}/api/admin/observability/oauth-alerts/test-delivery" "${payload}"
  tp_expect_status "200" "触发 test-delivery"
else
  tp_log_info "3/5 已跳过 test-delivery"
fi

tp_log_info "4/5 查询 incidents / deliveries"
tp_http_call "GET" "${BASE_URL}/api/admin/observability/oauth-alerts/incidents?severity=critical&from=${from_iso}&to=${to_iso}${query_provider}&page=1&pageSize=200"
tp_expect_status "200" "查询 incidents"
incidents_json="${TP_HTTP_BODY}"

tp_http_call "GET" "${BASE_URL}/api/admin/observability/oauth-alerts/deliveries?from=${from_iso}&to=${to_iso}${query_provider}&page=1&pageSize=200"
tp_expect_status "200" "查询 deliveries"
deliveries_json="${TP_HTTP_BODY}"

critical_total="$(printf '%s' "${incidents_json}" | jq -r '.total // (.data | length) // 0')"
critical_recent_5m="$(printf '%s' "${incidents_json}" | jq -r --argjson t "$((now_ms - 5 * 60 * 1000))" '[.data[]? | select((.createdAt // 0) >= $t)] | length')"
oldest_created_at="$(printf '%s' "${incidents_json}" | jq -r '[.data[]? | .createdAt // empty] | min // 0')"

delivery_total="$(printf '%s' "${deliveries_json}" | jq -r '.total // (.data | length) // 0')"
delivery_failure_non_suppressed="$(printf '%s' "${deliveries_json}" | jq -r '[.data[]? | select((.status // "") == "failure" and ((.error // "") | test("muted_provider|below_min_severity|quiet_hours_suppressed") | not))] | length')"
delivery_suppressed="$(printf '%s' "${deliveries_json}" | jq -r '[.data[]? | select((.error // "") | test("muted_provider|below_min_severity|quiet_hours_suppressed"))] | length')"

tp_log_info "5/5 检查 /metrics 关键计数"
tp_http_call "GET" "${BASE_URL}/metrics"
tp_expect_status "200" "读取 metrics"
metrics_text="${TP_HTTP_BODY}"

if ! printf '%s\n' "${metrics_text}" | grep -q '^tokenpulse_oauth_alert_events_total'; then
  tp_fail "缺少指标 tokenpulse_oauth_alert_events_total"
fi
if ! printf '%s\n' "${metrics_text}" | grep -q '^tokenpulse_oauth_alert_delivery_total'; then
  tp_fail "缺少指标 tokenpulse_oauth_alert_delivery_total"
fi

critical_age_minutes="0"
if [[ "${oldest_created_at}" != "0" ]]; then
  critical_age_minutes="$(((now_ms - oldest_created_at) / 60000))"
fi

level="none"
exit_code=0
if [[ "${critical_recent_5m}" -gt 0 ]]; then
  if [[ "${critical_age_minutes}" -ge 15 ]]; then
    level="p1"
    exit_code=20
  elif [[ "${critical_age_minutes}" -ge 5 ]]; then
    level="critical"
    exit_code=15
  else
    level="warning"
    exit_code=11
  fi
fi

tp_log_info "===== 演练结果 ====="
tp_log_info "时间窗口: ${from_iso} -> ${to_iso}"
tp_log_info "critical incidents 总数: ${critical_total}"
tp_log_info "近 5m critical incidents: ${critical_recent_5m}"
tp_log_info "critical 持续分钟: ${critical_age_minutes}"
tp_log_info "deliveries 总数: ${delivery_total}"
tp_log_info "deliveries 非抑制失败: ${delivery_failure_non_suppressed}"
tp_log_info "deliveries 抑制命中: ${delivery_suppressed}"
tp_log_info "升级结论: ${level} (exit_code=${exit_code})"

exit "${exit_code}"
