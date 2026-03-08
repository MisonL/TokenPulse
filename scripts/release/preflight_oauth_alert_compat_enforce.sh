#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
OAuth compat 切换到 enforce 前置检查脚本

用法:
  ./scripts/release/preflight_oauth_alert_compat_enforce.sh [参数]

参数:
  --prometheus-url <url>      Prometheus HTTP 地址（必填）
  --bearer-token <token>      Prometheus Bearer Token（可选）
  --triage-log <path>         compat 归因/清点记录文件（必填）
  --current-mode <mode>       当前服务端模式，默认读取 OAUTH_ALERT_COMPAT_MODE，否则回退 observe
  --show-limit <n>            compat 24h topk 数量，默认: 10
  --summary-file <path>       可选：输出 JSON 摘要
  --insecure                  curl 使用 -k（仅测试环境）
  --help                      显示帮助

说明:
  1) 本脚本不会修改 OAUTH_ALERT_COMPAT_MODE，只判断是否具备切换到 enforce 的前置条件。
  2) 前置条件最小集为：compat 指标当前归零、已有归因/清点记录文件、当前模式不是 enforce。
  3) compat 指标检查复用 check_oauth_alert_compat.sh，并强制按 strict 语义判断。
EOF
}

PROMETHEUS_URL="${PROMETHEUS_URL:-}"
PROMETHEUS_BEARER_TOKEN="${PROMETHEUS_BEARER_TOKEN:-}"
TRIAGE_LOG=""
CURRENT_MODE="${OAUTH_ALERT_COMPAT_MODE:-observe}"
SHOW_LIMIT="10"
SUMMARY_FILE=""
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
    --triage-log)
      TRIAGE_LOG="${2:-}"
      shift 2
      ;;
    --current-mode)
      CURRENT_MODE="${2:-}"
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
tp_require_cmd jq

if [[ -z "${PROMETHEUS_URL}" ]]; then
  tp_fail "缺少 --prometheus-url"
fi

if [[ -z "${TRIAGE_LOG}" ]]; then
  tp_fail "缺少 --triage-log"
fi

if [[ ! -f "${TRIAGE_LOG}" ]]; then
  tp_fail "compat 归因/清点记录不存在: ${TRIAGE_LOG}"
fi

if [[ ! -s "${TRIAGE_LOG}" ]]; then
  tp_fail "compat 归因/清点记录为空: ${TRIAGE_LOG}"
fi

if ! [[ "${SHOW_LIMIT}" =~ ^[0-9]+$ ]] || [[ "${SHOW_LIMIT}" -lt 1 ]]; then
  tp_fail "--show-limit 必须为 >=1 的整数"
fi

CURRENT_MODE="$(printf '%s' "${CURRENT_MODE}" | tr '[:upper:]' '[:lower:]' | xargs)"
if [[ -z "${CURRENT_MODE}" ]]; then
  CURRENT_MODE="observe"
fi

if [[ "${CURRENT_MODE}" != "observe" && "${CURRENT_MODE}" != "enforce" ]]; then
  tp_fail "--current-mode 仅支持 observe/enforce"
fi

summary_status="failed"
compat_5m_hits=""
compat_24h_hits=""
compat_gate_result=""
compat_checked_at=""
summary_started_at="$(tp_format_iso_utc "$(date +%s)")"

write_summary() {
  [[ -n "${SUMMARY_FILE}" ]] || return 0

  mkdir -p "$(dirname "${SUMMARY_FILE}")"
  jq -cn \
    --arg startedAt "${summary_started_at}" \
    --arg finishedAt "$(tp_format_iso_utc "$(date +%s)")" \
    --arg status "${summary_status}" \
    --arg currentMode "${CURRENT_MODE}" \
    --arg triageLog "${TRIAGE_LOG}" \
    --arg compat5mHits "${compat_5m_hits}" \
    --arg compat24hHits "${compat_24h_hits}" \
    --arg compatGateResult "${compat_gate_result}" \
    --arg compatCheckedAt "${compat_checked_at}" \
    '{
      startedAt: $startedAt,
      finishedAt: $finishedAt,
      overallStatus: $status,
      currentMode: $currentMode,
      triageLog: $triageLog,
      compat5mHits: (if $compat5mHits == "" then null else ($compat5mHits | tonumber) end),
      compat24hHits: (if $compat24hHits == "" then null else ($compat24hHits | tonumber) end),
      compatGateResult: (if $compatGateResult == "" then null else $compatGateResult end),
      compatCheckedAt: (if $compatCheckedAt == "" then null else $compatCheckedAt end)
    }' > "${SUMMARY_FILE}"
}

trap 'write_summary' EXIT

if [[ "${CURRENT_MODE}" == "enforce" ]]; then
  tp_fail "当前 OAUTH_ALERT_COMPAT_MODE 已是 enforce，无需再执行 enforce 前置检查"
fi

compat_summary_file="$(mktemp -t tokenpulse-compat-enforce.XXXXXX.json)"
check_cmd=(
  bash "${SCRIPT_DIR}/check_oauth_alert_compat.sh"
  --prometheus-url "${PROMETHEUS_URL}"
  --mode "strict"
  --show-limit "${SHOW_LIMIT}"
  --summary-file "${compat_summary_file}"
)

if [[ -n "${PROMETHEUS_BEARER_TOKEN}" ]]; then
  check_cmd+=(--bearer-token "${PROMETHEUS_BEARER_TOKEN}")
fi

if [[ "${INSECURE}" == "1" ]]; then
  check_cmd+=(--insecure)
fi

tp_log_info "执行 compat enforce 前置检查"
set +e
check_output="$("${check_cmd[@]}" 2>&1)"
check_exit="$?"
set -e

if [[ -n "${check_output}" ]]; then
  printf '%s\n' "${check_output}"
fi

compat_5m_hits="$(jq -er '.compat5mHits' "${compat_summary_file}" 2>/dev/null || true)"
compat_24h_hits="$(jq -er '.compat24hHits' "${compat_summary_file}" 2>/dev/null || true)"
compat_gate_result="$(jq -er '.gateResult' "${compat_summary_file}" 2>/dev/null || true)"
compat_checked_at="$(jq -er '.checkedAt' "${compat_summary_file}" 2>/dev/null || true)"

if [[ "${check_exit}" -ne 0 ]]; then
  tp_fail "compat 指标未归零，当前不允许切到 enforce"
fi

summary_status="passed"
tp_log_info "compat enforce 前置检查通过：可准备切换 OAUTH_ALERT_COMPAT_MODE=enforce"
if [[ -n "${SUMMARY_FILE}" ]]; then
  tp_log_info "summary: ${SUMMARY_FILE}"
fi
