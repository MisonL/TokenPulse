#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
统一运行时集成预检脚本

用法:
  ./scripts/release/preflight_runtime_integrations.sh [参数]

参数:
  --env-file <path>                    加载环境变量文件后执行预检
  --with-alertmanager                  仅/额外执行 Alertmanager 配置预检
  --with-oauth-release-window          仅/额外执行 OAuth release window 预检
  --with-agentledger                   仅/额外执行 AgentLedger runtime webhook 预检
  --evidence-file <path>               输出 JSON evidence，默认: ./artifacts/runtime-integrations-preflight.json
  --alertmanager-script <path>         Alertmanager 预检脚本路径，默认: ./scripts/release/preflight_alertmanager_config.sh
  --oauth-release-window-script <path> OAuth release window 预检脚本路径，默认: ./scripts/release/preflight_release_window_oauth_alerts.sh
  --agentledger-script <path>          AgentLedger runtime webhook 预检脚本路径，默认: ./scripts/release/preflight_agentledger_runtime_webhook.sh
  --help                               显示帮助

说明:
  1) 未显式指定 --with-* 时，默认依次执行 Alertmanager / OAuth release window / AgentLedger 三项预检。
  2) 任一子预检失败时整体返回非 0，但仍会输出完整 evidence 供排查。
  3) 该脚本只编排已有子预检，不替代子脚本的细粒度校验逻辑。
USAGE
}

ENV_FILE=""
EVIDENCE_FILE="./artifacts/runtime-integrations-preflight.json"
ALERTMANAGER_SCRIPT="${SCRIPT_DIR}/preflight_alertmanager_config.sh"
OAUTH_RELEASE_WINDOW_SCRIPT="${SCRIPT_DIR}/preflight_release_window_oauth_alerts.sh"
AGENTLEDGER_SCRIPT="${SCRIPT_DIR}/preflight_agentledger_runtime_webhook.sh"
RUN_ALERTMANAGER=0
RUN_OAUTH_RELEASE_WINDOW=0
RUN_AGENTLEDGER=0
SELECTED_COUNT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --with-alertmanager)
      RUN_ALERTMANAGER=1
      SELECTED_COUNT=$((SELECTED_COUNT + 1))
      shift 1
      ;;
    --with-oauth-release-window)
      RUN_OAUTH_RELEASE_WINDOW=1
      SELECTED_COUNT=$((SELECTED_COUNT + 1))
      shift 1
      ;;
    --with-agentledger)
      RUN_AGENTLEDGER=1
      SELECTED_COUNT=$((SELECTED_COUNT + 1))
      shift 1
      ;;
    --evidence-file)
      EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --alertmanager-script)
      ALERTMANAGER_SCRIPT="${2:-}"
      shift 2
      ;;
    --oauth-release-window-script)
      OAUTH_RELEASE_WINDOW_SCRIPT="${2:-}"
      shift 2
      ;;
    --agentledger-script)
      AGENTLEDGER_SCRIPT="${2:-}"
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

if [[ "${SELECTED_COUNT}" -eq 0 ]]; then
  RUN_ALERTMANAGER=1
  RUN_OAUTH_RELEASE_WINDOW=1
  RUN_AGENTLEDGER=1
fi

if [[ -n "${ENV_FILE}" ]]; then
  if [[ ! -f "${ENV_FILE}" ]]; then
    tp_fail "环境文件不存在: ${ENV_FILE}"
  fi
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

if [[ -z "${ALERTMANAGER_CONFIG_PATH:-}" && -n "${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-}" ]]; then
  export ALERTMANAGER_CONFIG_PATH="${ALERTMANAGER_CONFIG_TEMPLATE_PATH}"
fi
if [[ -z "${ALERTMANAGER_TEMPLATES_PATH:-}" ]]; then
  export ALERTMANAGER_TEMPLATES_PATH="./monitoring/alertmanager-templates"
fi

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "${value}"
}

join_command() {
  local result=""
  local part=""
  for part in "$@"; do
    local escaped=""
    printf -v escaped '%q' "${part}"
    result+="${escaped} "
  done
  printf '%s' "${result% }"
}

to_summary_line() {
  local text="${1:-}"
  local line=""
  line="$(printf '%s' "${text}" | awk 'NF { last=$0 } END { print last }')"
  printf '%s' "${line}"
}

to_snippet() {
  local text="${1:-}"
  printf '%s' "${text}" | awk 'NF { gsub(/\r/, "", $0); print; count += 1; if (count >= 5) exit }'
}

declare -a CHECKS_JSON=()
declare -a NEXT_STEPS_JSON=()
OVERALL_STATUS="passed"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PASSED_COUNT=0
FAILED_COUNT=0
SKIPPED_COUNT=0

append_check() {
  local name="$1"
  local status="$2"
  local command_text="$3"
  local summary="$4"
  local stderr_snippet="${5:-}"
  local entry=""

  entry="{\"name\":\"$(json_escape "${name}")\",\"status\":\"$(json_escape "${status}")\",\"command\":\"$(json_escape "${command_text}")\",\"summary\":\"$(json_escape "${summary}")\""
  if [[ -n "${stderr_snippet}" ]]; then
    entry+=",\"stderrSnippet\":\"$(json_escape "${stderr_snippet}")\""
  fi
  entry+="}"
  CHECKS_JSON+=("${entry}")
}

append_next_step() {
  local step="${1:-}"
  [[ -n "${step}" ]] || return 0
  NEXT_STEPS_JSON+=("\"$(json_escape "${step}")\"")
}

run_check() {
  local selected="$1"
  local name="$2"
  local label="$3"
  shift 3

  if [[ "${selected}" != "1" ]]; then
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    append_check "${name}" "skipped" "(skipped)" "${label}未选择执行"
    return 0
  fi

  local -a cmd=("$@")
  local command_text=""
  command_text="$(join_command "${cmd[@]}")"
  local stdout_file=""
  local stderr_file=""
  stdout_file="$(mktemp)"
  stderr_file="$(mktemp)"
  local exit_code=0

  if "${cmd[@]}" >"${stdout_file}" 2>"${stderr_file}"; then
    exit_code=0
  else
    exit_code=$?
    OVERALL_STATUS="failed"
  fi

  local stdout_text=""
  local stderr_text=""
  local summary=""
  local stderr_snippet=""
  stdout_text="$(cat "${stdout_file}" 2>/dev/null || true)"
  stderr_text="$(cat "${stderr_file}" 2>/dev/null || true)"
  rm -f "${stdout_file}" "${stderr_file}"

  if [[ "${exit_code}" -eq 0 ]]; then
    PASSED_COUNT=$((PASSED_COUNT + 1))
    summary="$(to_summary_line "${stdout_text}")"
    if [[ -z "${summary}" ]]; then
      summary="${label}通过"
    fi
    tp_log_info "${label} 通过"
    append_check "${name}" "passed" "${command_text}" "${summary}" "$(to_snippet "${stderr_text}")"
    return 0
  fi

  summary="$(to_summary_line "${stderr_text}")"
  if [[ -z "${summary}" ]]; then
    summary="$(to_summary_line "${stdout_text}")"
  fi
  if [[ -z "${summary}" ]]; then
    summary="${label}失败（exit=${exit_code}）"
  fi
  stderr_snippet="$(to_snippet "${stderr_text}")"
  if [[ -z "${stderr_snippet}" ]]; then
    stderr_snippet="$(to_snippet "${stdout_text}")"
  fi
  FAILED_COUNT=$((FAILED_COUNT + 1))
  tp_log_error "${label} 失败（exit=${exit_code}）"
  append_check "${name}" "failed" "${command_text}" "${summary}" "${stderr_snippet}"
  return 0
}

declare -a ALERTMANAGER_CMD=("bash" "${ALERTMANAGER_SCRIPT}")
if [[ -n "${ALERTMANAGER_CONFIG_PATH:-}" ]]; then
  ALERTMANAGER_CMD+=("--config-path" "${ALERTMANAGER_CONFIG_PATH}")
fi
if [[ -n "${ALERTMANAGER_TEMPLATES_PATH:-}" ]]; then
  ALERTMANAGER_CMD+=("--templates-path" "${ALERTMANAGER_TEMPLATES_PATH}")
fi

declare -a OAUTH_RELEASE_WINDOW_CMD=("bash" "${OAUTH_RELEASE_WINDOW_SCRIPT}")
if [[ -n "${ENV_FILE}" ]]; then
  OAUTH_RELEASE_WINDOW_CMD+=("--env-file" "${ENV_FILE}")
fi

declare -a AGENTLEDGER_CMD=("bash" "${AGENTLEDGER_SCRIPT}")
if [[ -n "${ENV_FILE}" ]]; then
  AGENTLEDGER_CMD+=("--env-file" "${ENV_FILE}")
fi

run_check "${RUN_ALERTMANAGER}" "alertmanager_config" "Alertmanager 配置预检" "${ALERTMANAGER_CMD[@]}"
run_check "${RUN_OAUTH_RELEASE_WINDOW}" "oauth_release_window" "OAuth release window 预检" "${OAUTH_RELEASE_WINDOW_CMD[@]}"
run_check "${RUN_AGENTLEDGER}" "agentledger_runtime_webhook" "AgentLedger runtime webhook 预检" "${AGENTLEDGER_CMD[@]}"

if [[ "${OVERALL_STATUS}" == "passed" ]]; then
  if [[ "${RUN_ALERTMANAGER}" == "1" ]]; then
    append_next_step "确认发布窗口使用运行时生产 Alertmanager 配置，而非仓库示例配置"
  fi
  if [[ "${RUN_OAUTH_RELEASE_WINDOW}" == "1" ]]; then
    if [[ -n "${ENV_FILE}" ]]; then
      append_next_step "./scripts/release/release_window_oauth_alerts.sh --env-file \"${ENV_FILE}\""
    else
      append_next_step "./scripts/release/release_window_oauth_alerts.sh"
    fi
  fi
  if [[ "${RUN_AGENTLEDGER}" == "1" ]]; then
    if [[ -n "${ENV_FILE}" ]]; then
      append_next_step "./scripts/release/drill_agentledger_runtime_webhook.sh --env-file \"${ENV_FILE}\" --evidence-file \"./artifacts/agentledger-runtime-drill-evidence.json\""
    else
      append_next_step "./scripts/release/drill_agentledger_runtime_webhook.sh --evidence-file \"./artifacts/agentledger-runtime-drill-evidence.json\""
    fi
  fi
else
  append_next_step "修复失败项后重新执行 ./scripts/release/preflight_runtime_integrations.sh"
fi

FINISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
mkdir -p "$(dirname "${EVIDENCE_FILE}")"

{
  printf '{\n'
  printf '  "startedAt": "%s",\n' "$(json_escape "${STARTED_AT}")"
  printf '  "finishedAt": "%s",\n' "$(json_escape "${FINISHED_AT}")"
  printf '  "overallStatus": "%s",\n' "$(json_escape "${OVERALL_STATUS}")"
  printf '  "environment": {\n'
  printf '    "envFile": '
  if [[ -n "${ENV_FILE}" ]]; then
    printf '"%s"\n' "$(json_escape "${ENV_FILE}")"
  else
    printf 'null\n'
  fi
  printf '  },\n'
  printf '  "selectedChecks": {\n'
  printf '    "alertmanager": %s,\n' "$([[ "${RUN_ALERTMANAGER}" == "1" ]] && printf 'true' || printf 'false')"
  printf '    "oauthReleaseWindow": %s,\n' "$([[ "${RUN_OAUTH_RELEASE_WINDOW}" == "1" ]] && printf 'true' || printf 'false')"
  printf '    "agentledger": %s\n' "$([[ "${RUN_AGENTLEDGER}" == "1" ]] && printf 'true' || printf 'false')"
  printf '  },\n'
  printf '  "summary": {\n'
  printf '    "passed": %s,\n' "${PASSED_COUNT}"
  printf '    "failed": %s,\n' "${FAILED_COUNT}"
  printf '    "skipped": %s\n' "${SKIPPED_COUNT}"
  printf '  },\n'
  printf '  "configSnapshot": {\n'
  printf '    "alertmanagerConfigPath": "%s",\n' "$(json_escape "${ALERTMANAGER_CONFIG_PATH:-}")"
  printf '    "alertmanagerTemplatesPath": "%s",\n' "$(json_escape "${ALERTMANAGER_TEMPLATES_PATH:-}")"
  printf '    "agentledgerEnabled": "%s",\n' "$(json_escape "${TOKENPULSE_AGENTLEDGER_ENABLED:-}")"
  printf '    "agentledgerIngestUrl": "%s",\n' "$(json_escape "${AGENTLEDGER_RUNTIME_INGEST_URL:-}")"
  printf '    "agentledgerKeyId": "%s"\n' "$(json_escape "${TOKENPULSE_AGENTLEDGER_WEBHOOK_KEY_ID:-}")"
  printf '  },\n'
  printf '  "checks": [\n'
  for index in "${!CHECKS_JSON[@]}"; do
    if [[ "${index}" -gt 0 ]]; then
      printf ',\n'
    fi
    printf '    %s' "${CHECKS_JSON[${index}]}"
  done
  printf '\n  ],\n'
  printf '  "nextSteps": [\n'
  for index in "${!NEXT_STEPS_JSON[@]}"; do
    if [[ "${index}" -gt 0 ]]; then
      printf ',\n'
    fi
    printf '    %s' "${NEXT_STEPS_JSON[${index}]}"
  done
  printf '\n  ]\n'
  printf '}\n'
} > "${EVIDENCE_FILE}"

if [[ "${OVERALL_STATUS}" == "passed" ]]; then
  tp_log_info "统一运行时集成预检通过"
  tp_log_info "evidence: ${EVIDENCE_FILE}"
  exit 0
fi

tp_log_error "统一运行时集成预检失败"
tp_log_error "evidence: ${EVIDENCE_FILE}"
exit 1
