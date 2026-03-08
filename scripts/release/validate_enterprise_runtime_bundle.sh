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
  --with-post-canary <bool>      是否追加执行 post canary，默认: false
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
TIMEOUT_SEC="8"
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
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --with-post-canary)
      WITH_POST_CANARY="${2:-}"
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

run_boundary_step() {
  local -a cmd=(
    bash
    "${BOUNDARY_SCRIPT}"
    --base-url "${BASE_URL}"
    --api-secret "${API_SECRET_VALUE}"
    --case-prefix "${BOUNDARY_CASE_PREFIX}"
    --timeout "${TIMEOUT_SEC}"
  )

  if [[ -n "${OWNER_COOKIE}" ]]; then
    cmd+=(--owner-cookie "${OWNER_COOKIE}")
  else
    cmd+=(--admin-user "${ADMIN_USER}" --admin-role "${ADMIN_ROLE}")
    if [[ -n "${ADMIN_TENANT}" ]]; then
      cmd+=(--admin-tenant "${ADMIN_TENANT}")
    fi
  fi

  if [[ -n "${AUDITOR_COOKIE}" ]]; then
    cmd+=(--auditor-cookie "${AUDITOR_COOKIE}")
  else
    cmd+=(--auditor-user "${AUDITOR_USER}" --auditor-role "${AUDITOR_ROLE}")
  fi

  if [[ "${INSECURE}" == "1" ]]; then
    cmd+=(--insecure)
  fi

  tp_log_info "1/3 执行 enterprise boundary gate"
  "${cmd[@]}"
}

run_agentledger_step() {
  local -a cmd=(
    bash
    "${AGENTLEDGER_SCRIPT}"
  )

  if [[ -n "${ENV_FILE}" ]]; then
    cmd+=(--env-file "${ENV_FILE}")
  fi
  if [[ -n "${DRILL_EVIDENCE_FILE}" ]]; then
    cmd+=(--evidence-file "${DRILL_EVIDENCE_FILE}")
  fi
  if [[ "${INSECURE}" == "1" ]]; then
    cmd+=(--insecure)
  fi

  tp_log_info "2/3 执行 AgentLedger runtime webhook drill"
  "${cmd[@]}"
}

run_post_canary_step() {
  local -a cmd=(
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
    cmd+=(--cookie "${OWNER_COOKIE}")
  else
    cmd+=(--admin-user "${ADMIN_USER}" --admin-role "${ADMIN_ROLE}")
    if [[ -n "${ADMIN_TENANT}" ]]; then
      cmd+=(--admin-tenant "${ADMIN_TENANT}")
    fi
  fi

  if [[ -n "${AUDITOR_COOKIE}" ]]; then
    cmd+=(--auditor-cookie "${AUDITOR_COOKIE}")
  else
    cmd+=(--auditor-user "${AUDITOR_USER}" --auditor-role "${AUDITOR_ROLE}")
  fi

  if [[ -n "${CANARY_EVIDENCE_FILE}" ]]; then
    cmd+=(--evidence-file "${CANARY_EVIDENCE_FILE}")
  fi

  if [[ "${INSECURE}" == "1" ]]; then
    cmd+=(--insecure)
  fi

  tp_log_info "3/3 执行 post canary gate"
  "${cmd[@]}"
}

run_boundary_step
run_agentledger_step

if [[ "${WITH_POST_CANARY}" == "true" ]]; then
  run_post_canary_step
else
  tp_log_info "3/3 已跳过 post canary gate"
fi

tp_log_info "企业域运行时编排校验通过"
