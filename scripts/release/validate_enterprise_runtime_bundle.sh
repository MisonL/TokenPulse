#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
企业域运行时编排校验脚本

用法:
  ./scripts/release/validate_enterprise_runtime_bundle.sh [参数]

说明:
  1) 顺序执行 enterprise boundary gate。
  2) 顺序执行 AgentLedger runtime webhook drill。
  3) 可选执行 canary_gate.sh --phase post --with-boundary true --with-smoke false。

参数:
  --base-url <url>               Core 地址（必填）
  --api-secret <secret>          API_SECRET（也可用环境变量 API_SECRET）
  --env-file <path>              传给 AgentLedger drill 的环境文件（可选）
  --with-agentledger-negative <bool>
                                 是否追加 AgentLedger 负向用例演练，默认: false
  --with-post-canary <bool>      是否追加执行 post canary，默认: false
  --evidence-file <path>         输出编排级 evidence JSON（可选）
  --boundary-script <path>       边界脚本路径，默认: scripts/release/check_enterprise_boundary.sh
  --agentledger-script <path>    AgentLedger drill 脚本路径，默认: scripts/release/drill_agentledger_runtime_webhook.sh
  --canary-script <path>         canary gate 脚本路径，默认: scripts/release/canary_gate.sh
  --boundary-case-prefix <prefix>
                                 边界检查资源前缀，默认: runtime-bundle-boundary
  --admin-user <user>            owner 场景 x-admin-user，默认: runtime-bundle-owner
  --admin-role <role>            owner 场景 x-admin-role，默认: owner
  --admin-tenant <tenant>        x-admin-tenant（可选）
  --owner-cookie <cookie>        owner 管理员会话 Cookie（可选）
  --auditor-user <user>          auditor 场景 x-admin-user，默认: runtime-bundle-auditor
  --auditor-role <role>          auditor 场景 x-admin-role，默认: auditor
  --auditor-cookie <cookie>      auditor 管理员会话 Cookie（可选）
  --drill-evidence-file <path>   传给 AgentLedger drill 的 evidence 路径（可选）
  --canary-evidence-file <path>  传给 post canary 的 evidence 路径（可选）
  --timeout <seconds>            透传给 boundary/canary 的超时秒数，默认: 8
  --insecure                     透传 -k 给 boundary/drill/canary（仅测试环境）
  --help                         显示帮助
EOF
}

BASE_URL=""
API_SECRET_VALUE="${API_SECRET:-}"
ENV_FILE=""
WITH_POST_CANARY="false"
WITH_AGENTLEDGER_NEGATIVE="false"
BOUNDARY_SCRIPT="${SCRIPT_DIR}/check_enterprise_boundary.sh"
AGENTLEDGER_SCRIPT="${SCRIPT_DIR}/drill_agentledger_runtime_webhook.sh"
CANARY_SCRIPT="${SCRIPT_DIR}/canary_gate.sh"
BOUNDARY_CASE_PREFIX="runtime-bundle-boundary"
ADMIN_USER="runtime-bundle-owner"
ADMIN_ROLE="owner"
ADMIN_TENANT=""
OWNER_COOKIE=""
AUDITOR_USER="runtime-bundle-auditor"
AUDITOR_ROLE="auditor"
AUDITOR_COOKIE=""
DRILL_EVIDENCE_FILE=""
CANARY_EVIDENCE_FILE=""
EVIDENCE_FILE=""
TIMEOUT_SEC="8"
INSECURE="0"
OVERALL_STATUS="failed"
BUNDLE_STARTED_AT=""
BUNDLE_FINISHED_AT=""
declare -a STEP_NAMES=("enterprise_boundary" "agentledger_runtime_webhook" "post_canary_gate")
declare -a STEP_STATUS=("pending" "pending" "pending")
declare -a STEP_COMMAND=("" "" "")
declare -a STEP_STARTED_AT=("" "" "")
declare -a STEP_FINISHED_AT=("" "" "")
declare -a STEP_EXIT_CODE=("" "" "")
declare -a STEP_EVIDENCE_FILE=("" "" "")
declare -a BOUNDARY_CMD=()
declare -a AGENTLEDGER_CMD=()
declare -a POST_CANARY_CMD=()

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
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --with-post-canary)
      WITH_POST_CANARY="${2:-}"
      shift 2
      ;;
    --with-agentledger-negative)
      WITH_AGENTLEDGER_NEGATIVE="${2:-}"
      shift 2
      ;;
    --boundary-script)
      BOUNDARY_SCRIPT="${2:-}"
      shift 2
      ;;
    --agentledger-script)
      AGENTLEDGER_SCRIPT="${2:-}"
      shift 2
      ;;
    --canary-script)
      CANARY_SCRIPT="${2:-}"
      shift 2
      ;;
    --boundary-case-prefix)
      BOUNDARY_CASE_PREFIX="${2:-}"
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
    --owner-cookie)
      OWNER_COOKIE="${2:-}"
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
    --auditor-cookie)
      AUDITOR_COOKIE="${2:-}"
      shift 2
      ;;
    --drill-evidence-file)
      DRILL_EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --canary-evidence-file)
      CANARY_EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --evidence-file)
      EVIDENCE_FILE="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SEC="${2:-}"
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

if [[ -z "${BASE_URL}" ]]; then
  tp_fail "缺少 --base-url"
fi

if [[ -z "${API_SECRET_VALUE}" ]]; then
  tp_fail "缺少 --api-secret 或环境变量 API_SECRET"
fi

tp_require_single_line "API_SECRET" "${API_SECRET_VALUE}"
tp_require_not_placeholder "API_SECRET" "${API_SECRET_VALUE}"
if [[ -n "${OWNER_COOKIE}" ]]; then
  tp_require_single_line "--owner-cookie" "${OWNER_COOKIE}"
  tp_require_not_placeholder "--owner-cookie" "${OWNER_COOKIE}"
fi
if [[ -n "${AUDITOR_COOKIE}" ]]; then
  tp_require_single_line "--auditor-cookie" "${AUDITOR_COOKIE}"
  tp_require_not_placeholder "--auditor-cookie" "${AUDITOR_COOKIE}"
fi

base_url_normalized="$(printf '%s' "${BASE_URL%/}" | tr '[:upper:]' '[:lower:]')"
if tp_is_reserved_example_url "${base_url_normalized}"; then
  tp_fail "--base-url 不能使用保留示例域名: ${BASE_URL}"
fi

if [[ -n "${ENV_FILE}" && ! -f "${ENV_FILE}" ]]; then
  tp_fail "环境文件不存在: ${ENV_FILE}"
fi

if [[ "${WITH_POST_CANARY}" != "true" && "${WITH_POST_CANARY}" != "false" ]]; then
  tp_fail "--with-post-canary 仅支持 true/false"
fi

if [[ -z "${BOUNDARY_CASE_PREFIX}" ]]; then
  tp_fail "--boundary-case-prefix 不能为空"
fi

if ! [[ "${TIMEOUT_SEC}" =~ ^[0-9]+$ ]] || [[ "${TIMEOUT_SEC}" -le 0 ]]; then
  tp_fail "--timeout 必须为正整数"
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

iso_now() {
  tp_format_iso_utc "$(date +%s)"
}

format_command() {
  local rendered=""
  printf -v rendered '%q ' "$@"
  rendered="${rendered% }"
  printf '%s' "${rendered}"
}

mark_step_skipped() {
  local index="$1"
  if [[ "${STEP_STATUS[$index]}" != "pending" ]]; then
    return 0
  fi
  local now_iso
  now_iso="$(iso_now)"
  STEP_STATUS[$index]="skipped"
  STEP_STARTED_AT[$index]="${now_iso}"
  STEP_FINISHED_AT[$index]="${now_iso}"
  STEP_EXIT_CODE[$index]=""
}

write_bundle_evidence() {
  if [[ -z "${EVIDENCE_FILE}" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "${EVIDENCE_FILE}")"
  {
    printf '{\n'
    printf '  "overallStatus": "%s",\n' "$(json_escape "${OVERALL_STATUS}")"
    printf '  "baseUrl": "%s",\n' "$(json_escape "${BASE_URL}")"
    if [[ -n "${ENV_FILE}" ]]; then
      printf '  "envFile": "%s",\n' "$(json_escape "${ENV_FILE}")"
    else
      printf '  "envFile": null,\n'
    fi
    printf '  "withPostCanary": %s,\n' "${WITH_POST_CANARY}"
    printf '  "startedAt": "%s",\n' "$(json_escape "${BUNDLE_STARTED_AT}")"
    printf '  "finishedAt": "%s",\n' "$(json_escape "${BUNDLE_FINISHED_AT}")"
    printf '  "steps": [\n'
    local index
    for index in 0 1 2; do
      printf '    {\n'
      printf '      "name": "%s",\n' "$(json_escape "${STEP_NAMES[$index]}")"
      printf '      "status": "%s",\n' "$(json_escape "${STEP_STATUS[$index]}")"
      printf '      "command": "%s",\n' "$(json_escape "${STEP_COMMAND[$index]}")"
      if [[ -n "${STEP_STARTED_AT[$index]}" ]]; then
        printf '      "startedAt": "%s",\n' "$(json_escape "${STEP_STARTED_AT[$index]}")"
      else
        printf '      "startedAt": null,\n'
      fi
      if [[ -n "${STEP_FINISHED_AT[$index]}" ]]; then
        printf '      "finishedAt": "%s",\n' "$(json_escape "${STEP_FINISHED_AT[$index]}")"
      else
        printf '      "finishedAt": null,\n'
      fi
      if [[ -n "${STEP_EXIT_CODE[$index]}" ]]; then
        printf '      "exitCode": %s,\n' "${STEP_EXIT_CODE[$index]}"
      else
        printf '      "exitCode": null,\n'
      fi
      if [[ -n "${STEP_EVIDENCE_FILE[$index]}" ]]; then
        printf '      "evidenceFile": "%s"\n' "$(json_escape "${STEP_EVIDENCE_FILE[$index]}")"
      else
        printf '      "evidenceFile": null\n'
      fi
      if [[ "${index}" -lt 2 ]]; then
        printf '    },\n'
      else
        printf '    }\n'
      fi
    done
    printf '  ]\n'
    printf '}\n'
  } > "${EVIDENCE_FILE}"
}

finish_bundle() {
  local exit_code="$1"
  BUNDLE_FINISHED_AT="$(iso_now)"
  if [[ "${exit_code}" -ne 0 ]]; then
    OVERALL_STATUS="failed"
  fi
  write_bundle_evidence
  if [[ "${exit_code}" -eq 0 && -n "${EVIDENCE_FILE}" ]]; then
    tp_log_info "evidence: ${EVIDENCE_FILE}"
  fi
  exit "${exit_code}"
}

run_step() {
  local index="$1"
  shift
  STEP_STARTED_AT[$index]="$(iso_now)"
  set +e
  "$@"
  local exit_code="$?"
  set -e
  STEP_FINISHED_AT[$index]="$(iso_now)"
  STEP_EXIT_CODE[$index]="${exit_code}"
  if [[ "${exit_code}" -eq 0 ]]; then
    STEP_STATUS[$index]="passed"
    return 0
  fi
  STEP_STATUS[$index]="failed"
  return "${exit_code}"
}

build_boundary_cmd() {
  BOUNDARY_CMD=(
    bash
    "${BOUNDARY_SCRIPT}"
    --base-url "${BASE_URL}"
    --api-secret "${API_SECRET_VALUE}"
    --case-prefix "${BOUNDARY_CASE_PREFIX}"
    --timeout "${TIMEOUT_SEC}"
  )

  if [[ -n "${OWNER_COOKIE}" ]]; then
    BOUNDARY_CMD+=(--owner-cookie "${OWNER_COOKIE}")
  else
    BOUNDARY_CMD+=(--admin-user "${ADMIN_USER}" --admin-role "${ADMIN_ROLE}")
    if [[ -n "${ADMIN_TENANT}" ]]; then
      BOUNDARY_CMD+=(--admin-tenant "${ADMIN_TENANT}")
    fi
  fi

  if [[ -n "${AUDITOR_COOKIE}" ]]; then
    BOUNDARY_CMD+=(--auditor-cookie "${AUDITOR_COOKIE}")
  else
    BOUNDARY_CMD+=(--auditor-user "${AUDITOR_USER}" --auditor-role "${AUDITOR_ROLE}")
  fi

  if [[ "${INSECURE}" == "1" ]]; then
    BOUNDARY_CMD+=(--insecure)
  fi

  STEP_COMMAND[0]="$(format_command "${BOUNDARY_CMD[@]}")"
  STEP_EVIDENCE_FILE[0]=""
}

run_boundary_step() {
  tp_log_info "1/3 执行 enterprise boundary gate"
  run_step 0 "${BOUNDARY_CMD[@]}"
}

build_agentledger_cmd() {
  AGENTLEDGER_CMD=(
    bash
    "${AGENTLEDGER_SCRIPT}"
  )

  if [[ -n "${ENV_FILE}" ]]; then
    AGENTLEDGER_CMD+=(--env-file "${ENV_FILE}")
  fi
  if [[ -n "${DRILL_EVIDENCE_FILE}" ]]; then
    AGENTLEDGER_CMD+=(--evidence-file "${DRILL_EVIDENCE_FILE}")
  fi
  if [[ "${WITH_AGENTLEDGER_NEGATIVE}" == "true" ]]; then
    AGENTLEDGER_CMD+=(--with-negative)
  fi
  if [[ "${INSECURE}" == "1" ]]; then
    AGENTLEDGER_CMD+=(--insecure)
  fi

  STEP_COMMAND[1]="$(format_command "${AGENTLEDGER_CMD[@]}")"
  STEP_EVIDENCE_FILE[1]="${DRILL_EVIDENCE_FILE}"
}

run_agentledger_step() {
  tp_log_info "2/3 执行 AgentLedger runtime webhook drill"
  run_step 1 "${AGENTLEDGER_CMD[@]}"
}

build_post_canary_cmd() {
  POST_CANARY_CMD=(
    bash
    "${CANARY_SCRIPT}"
    --phase post
    --active-base-url "${BASE_URL}"
    --api-secret "${API_SECRET_VALUE}"
    --with-boundary true
    --with-smoke false
    --boundary-script "${BOUNDARY_SCRIPT}"
    --boundary-case-prefix "${BOUNDARY_CASE_PREFIX}"
    --timeout "${TIMEOUT_SEC}"
  )

  if [[ -n "${OWNER_COOKIE}" ]]; then
    POST_CANARY_CMD+=(--cookie "${OWNER_COOKIE}")
  else
    POST_CANARY_CMD+=(--admin-user "${ADMIN_USER}" --admin-role "${ADMIN_ROLE}")
    if [[ -n "${ADMIN_TENANT}" ]]; then
      POST_CANARY_CMD+=(--admin-tenant "${ADMIN_TENANT}")
    fi
  fi

  if [[ -n "${AUDITOR_COOKIE}" ]]; then
    POST_CANARY_CMD+=(--auditor-cookie "${AUDITOR_COOKIE}")
  else
    POST_CANARY_CMD+=(--auditor-user "${AUDITOR_USER}" --auditor-role "${AUDITOR_ROLE}")
  fi

  if [[ -n "${CANARY_EVIDENCE_FILE}" ]]; then
    POST_CANARY_CMD+=(--evidence-file "${CANARY_EVIDENCE_FILE}")
  fi

  if [[ "${INSECURE}" == "1" ]]; then
    POST_CANARY_CMD+=(--insecure)
  fi

  STEP_COMMAND[2]="$(format_command "${POST_CANARY_CMD[@]}")"
  STEP_EVIDENCE_FILE[2]="${CANARY_EVIDENCE_FILE}"
}

run_post_canary_step() {
  tp_log_info "3/3 执行 post canary gate"
  run_step 2 "${POST_CANARY_CMD[@]}"
}

BUNDLE_STARTED_AT="$(iso_now)"
build_boundary_cmd
build_agentledger_cmd
build_post_canary_cmd

run_boundary_step || {
  mark_step_skipped 1
  mark_step_skipped 2
  tp_log_error "enterprise boundary gate 执行失败"
  finish_bundle 1
}

run_agentledger_step || {
  mark_step_skipped 2
  tp_log_error "AgentLedger runtime webhook drill 执行失败"
  finish_bundle 1
}

if [[ "${WITH_POST_CANARY}" == "true" ]]; then
  run_post_canary_step || {
    tp_log_error "post canary gate 执行失败"
    finish_bundle 1
  }
else
  tp_log_info "3/3 已跳过 post canary gate"
  mark_step_skipped 2
fi

OVERALL_STATUS="passed"
tp_log_info "企业域运行时编排校验通过"
finish_bundle 0
