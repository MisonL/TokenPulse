#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
灰度切流前后检查脚本（可参数化）

用法:
  ./scripts/release/canary_gate.sh --phase <pre|post> --active-base-url <url> [参数]

参数:
  --phase <pre|post>          阶段：pre=切流前，post=切流后
  --active-base-url <url>     当前对外流量地址（必填）
  --candidate-base-url <url>  灰度候选地址（pre 阶段可选；post 阶段可作为回滚目标只读检查）
  --api-secret <secret>       API_SECRET（也可用环境变量 API_SECRET）
  --admin-user <user>         x-admin-user，默认: release-gate
  --admin-role <role>         x-admin-role，默认: owner
  --admin-tenant <tenant>     x-admin-tenant（可选）
  --cookie <cookie>           管理员会话 Cookie（可选）
  --expect-enterprise <bool>  是否期望高级版组织域可用，默认: true
  --with-smoke <auto|true|false>
                              是否执行写入 smoke。默认: pre=false, post=true
  --with-boundary <auto|true|false>
                              是否执行企业域边界检查。默认: pre=true, post=false
  --smoke-script <path>       smoke 脚本路径，默认: scripts/release/smoke_org.sh
  --smoke-org-prefix <prefix> smoke 资源前缀，默认: canary-smoke
  --boundary-script <path>    边界脚本路径，默认: scripts/release/check_enterprise_boundary.sh
  --boundary-case-prefix <prefix>
                              边界检查资源前缀，默认: canary-boundary
  --auditor-user <user>       边界脚本 auditor 用户名，默认: release-auditor
  --auditor-role <role>       边界脚本 auditor 角色，默认: auditor
  --auditor-cookie <cookie>   边界脚本 auditor 会话 Cookie（可选）
  --with-compat <false|observe|strict>
                              是否执行 compat 退场观测。默认: false
  --prometheus-url <url>      Prometheus HTTP 地址（启用 compat 时必填）
  --prometheus-bearer-token <token>
                              Prometheus Bearer Token（可选）
  --compat-critical-after <YYYY-MM-DD>
                              compat 升级为 critical 的日期，默认: 2026-07-01
  --compat-show-limit <n>     compat 24h topk 数量，默认: 10
  --timeout <seconds>         curl connect/max-time 秒数，默认: 8
  --insecure                  curl 使用 -k（仅测试环境）
  --help                      显示帮助
EOF
}

PHASE=""
ACTIVE_BASE_URL=""
CANDIDATE_BASE_URL=""
API_SECRET_VALUE="${API_SECRET:-}"
ADMIN_USER="release-gate"
ADMIN_ROLE="owner"
ADMIN_TENANT=""
COOKIE=""
EXPECT_ENTERPRISE="true"
WITH_SMOKE="auto"
SMOKE_SCRIPT="${SCRIPT_DIR}/smoke_org.sh"
SMOKE_ORG_PREFIX="canary-smoke"
WITH_BOUNDARY="auto"
BOUNDARY_SCRIPT="${SCRIPT_DIR}/check_enterprise_boundary.sh"
BOUNDARY_CASE_PREFIX="canary-boundary"
AUDITOR_USER="release-auditor"
AUDITOR_ROLE="auditor"
AUDITOR_COOKIE=""
WITH_COMPAT="false"
PROMETHEUS_URL="${PROMETHEUS_URL:-}"
PROMETHEUS_BEARER_TOKEN="${PROMETHEUS_BEARER_TOKEN:-}"
COMPAT_CRITICAL_AFTER="2026-07-01"
COMPAT_SHOW_LIMIT="10"
TIMEOUT_SEC="8"
INSECURE="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      PHASE="${2:-}"
      shift 2
      ;;
    --active-base-url)
      ACTIVE_BASE_URL="${2:-}"
      shift 2
      ;;
    --candidate-base-url)
      CANDIDATE_BASE_URL="${2:-}"
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
    --expect-enterprise)
      EXPECT_ENTERPRISE="${2:-}"
      shift 2
      ;;
    --with-smoke)
      WITH_SMOKE="${2:-}"
      shift 2
      ;;
    --with-boundary)
      WITH_BOUNDARY="${2:-}"
      shift 2
      ;;
    --smoke-script)
      SMOKE_SCRIPT="${2:-}"
      shift 2
      ;;
    --smoke-org-prefix)
      SMOKE_ORG_PREFIX="${2:-}"
      shift 2
      ;;
    --boundary-script)
      BOUNDARY_SCRIPT="${2:-}"
      shift 2
      ;;
    --boundary-case-prefix)
      BOUNDARY_CASE_PREFIX="${2:-}"
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

tp_require_cmd curl

if [[ "${PHASE}" != "pre" && "${PHASE}" != "post" ]]; then
  tp_fail "--phase 必须为 pre 或 post"
fi

if [[ -z "${ACTIVE_BASE_URL}" ]]; then
  tp_fail "缺少 --active-base-url"
fi

if [[ -z "${API_SECRET_VALUE}" ]]; then
  tp_fail "缺少 --api-secret 或环境变量 API_SECRET"
fi

if [[ "${EXPECT_ENTERPRISE}" != "true" && "${EXPECT_ENTERPRISE}" != "false" ]]; then
  tp_fail "--expect-enterprise 仅支持 true/false"
fi

if [[ "${WITH_SMOKE}" != "auto" && "${WITH_SMOKE}" != "true" && "${WITH_SMOKE}" != "false" ]]; then
  tp_fail "--with-smoke 仅支持 auto/true/false"
fi

if [[ "${WITH_BOUNDARY}" != "auto" && "${WITH_BOUNDARY}" != "true" && "${WITH_BOUNDARY}" != "false" ]]; then
  tp_fail "--with-boundary 仅支持 auto/true/false"
fi

if [[ "${WITH_COMPAT}" != "false" && "${WITH_COMPAT}" != "observe" && "${WITH_COMPAT}" != "strict" ]]; then
  tp_fail "--with-compat 仅支持 false/observe/strict"
fi

if [[ -z "${BOUNDARY_CASE_PREFIX}" ]]; then
  tp_fail "--boundary-case-prefix 不能为空"
fi

if ! [[ "${TIMEOUT_SEC}" =~ ^[0-9]+$ ]] || [[ "${TIMEOUT_SEC}" -le 0 ]]; then
  tp_fail "--timeout 必须为正整数"
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

if [[ "${WITH_SMOKE}" == "auto" ]]; then
  if [[ "${PHASE}" == "post" ]]; then
    WITH_SMOKE="true"
  else
    WITH_SMOKE="false"
  fi
fi

if [[ "${WITH_BOUNDARY}" == "auto" ]]; then
  if [[ "${PHASE}" == "pre" ]]; then
    WITH_BOUNDARY="true"
  else
    WITH_BOUNDARY="false"
  fi
fi

ACTIVE_BASE_URL="${ACTIVE_BASE_URL%/}"
CANDIDATE_BASE_URL="${CANDIDATE_BASE_URL%/}"
TP_CONNECT_TIMEOUT="${TIMEOUT_SEC}"
TP_MAX_TIME="${TIMEOUT_SEC}"
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

run_read_checks() {
  local label="$1"
  local base_url="$2"

  tp_log_info "[${label}] 检查健康: ${base_url}/health"
  tp_http_call "GET" "${base_url}/health"
  tp_expect_status "200" "[${label}] 健康检查"
  tp_json_contains "${TP_HTTP_BODY}" '"status":"ok"' || tp_fail "[${label}] 健康响应缺少 status=ok: ${TP_HTTP_BODY}"

  tp_log_info "[${label}] 检查登录探针: ${base_url}/api/auth/verify-secret"
  tp_require_api_secret_probe "${base_url}" "${API_SECRET_VALUE}" "[${label}] 登录探针"

  tp_log_info "[${label}] 检查高级版探针: ${base_url}/api/admin/features"
  tp_http_call "GET" "${base_url}/api/admin/features"
  tp_expect_status "200" "[${label}] 高级版探针"

  if [[ "${EXPECT_ENTERPRISE}" == "true" ]]; then
    tp_json_contains "${TP_HTTP_BODY}" '"edition":"advanced"' || tp_fail "[${label}] edition 不是 advanced: ${TP_HTTP_BODY}"
    tp_json_contains "${TP_HTTP_BODY}" '"enterprise":true' || tp_fail "[${label}] features.enterprise != true: ${TP_HTTP_BODY}"
    tp_json_contains "${TP_HTTP_BODY}" '"reachable":true' || tp_fail "[${label}] enterpriseBackend.reachable != true: ${TP_HTTP_BODY}"

    tp_log_info "[${label}] 管理员身份预检: ${base_url}/api/admin/auth/me"
    tp_require_admin_identity "${base_url}" "[${label}] owner" "owner"
  else
    tp_json_contains "${TP_HTTP_BODY}" '"enterprise":false' || tp_fail "[${label}] 期望 enterprise=false: ${TP_HTTP_BODY}"
  fi

  tp_log_info "[${label}] 检查组织域只读: ${base_url}/api/org/organizations"
  tp_http_call "GET" "${base_url}/api/org/organizations"

  if [[ "${EXPECT_ENTERPRISE}" == "true" ]]; then
    tp_expect_status "200" "[${label}] 组织域只读"
  else
    if [[ "${TP_HTTP_CODE}" != "503" && "${TP_HTTP_CODE}" != "404" ]]; then
      tp_fail "[${label}] 组织域只读期望 503/404，实际 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
    fi
  fi
}

run_smoke() {
  local target_url="$1"
  local -a cmd

  if [[ ! -x "${SMOKE_SCRIPT}" ]]; then
    tp_fail "smoke 脚本不可执行: ${SMOKE_SCRIPT}"
  fi

  cmd=(
    "${SMOKE_SCRIPT}"
    --base-url "${target_url}"
    --api-secret "${API_SECRET_VALUE}"
    --org-prefix "${SMOKE_ORG_PREFIX}-${PHASE}"
    --timeout "${TIMEOUT_SEC}"
  )

  if [[ "${INSECURE}" == "1" ]]; then
    cmd+=(--insecure)
  fi

  if [[ -n "${COOKIE}" ]]; then
    cmd+=(--cookie "${COOKIE}")
  else
    cmd+=(--admin-user "${ADMIN_USER}" --admin-role "${ADMIN_ROLE}")
    if [[ -n "${ADMIN_TENANT}" ]]; then
      cmd+=(--admin-tenant "${ADMIN_TENANT}")
    fi
  fi

  tp_log_info "执行写入 smoke: ${target_url}"
  "${cmd[@]}"
}

run_boundary_checks() {
  local target_url="$1"
  local -a cmd

  if [[ ! -x "${BOUNDARY_SCRIPT}" ]]; then
    tp_fail "边界脚本不可执行: ${BOUNDARY_SCRIPT}"
  fi

  cmd=(
    "${BOUNDARY_SCRIPT}"
    --base-url "${target_url}"
    --api-secret "${API_SECRET_VALUE}"
    --admin-user "${ADMIN_USER}"
    --admin-role "${ADMIN_ROLE}"
    --auditor-user "${AUDITOR_USER}"
    --auditor-role "${AUDITOR_ROLE}"
    --case-prefix "${BOUNDARY_CASE_PREFIX}-${PHASE}"
    --timeout "${TIMEOUT_SEC}"
  )

  if [[ "${INSECURE}" == "1" ]]; then
    cmd+=(--insecure)
  fi

  if [[ -n "${ADMIN_TENANT}" ]]; then
    cmd+=(--admin-tenant "${ADMIN_TENANT}")
  fi

  if [[ -n "${COOKIE}" ]]; then
    cmd+=(--owner-cookie "${COOKIE}")
  fi

  if [[ -n "${AUDITOR_COOKIE}" ]]; then
    cmd+=(--auditor-cookie "${AUDITOR_COOKIE}")
  fi

  if [[ -n "${COOKIE}" && -z "${AUDITOR_COOKIE}" ]]; then
    tp_log_warn "已提供 --cookie 但未提供 --auditor-cookie，边界检查将使用 auditor 头部身份；若未启用 ADMIN_TRUST_HEADER_AUTH 可能失败"
  fi

  tp_log_info "执行企业域边界检查: ${target_url}"
  "${cmd[@]}"
}

run_compat_checks() {
  local label="$1"
  local -a cmd

  if [[ "${WITH_COMPAT}" == "false" ]]; then
    tp_log_info "[${label}] 已跳过 compat 退场观测（--with-compat=false）"
    return 0
  fi

  cmd=(
    bash "${SCRIPT_DIR}/check_oauth_alert_compat.sh"
    --prometheus-url "${PROMETHEUS_URL}"
    --mode "${WITH_COMPAT}"
    --critical-after "${COMPAT_CRITICAL_AFTER}"
    --show-limit "${COMPAT_SHOW_LIMIT}"
  )

  if [[ -n "${PROMETHEUS_BEARER_TOKEN}" ]]; then
    cmd+=(--bearer-token "${PROMETHEUS_BEARER_TOKEN}")
  fi

  if [[ "${INSECURE}" == "1" ]]; then
    cmd+=(--insecure)
  fi

  tp_log_info "[${label}] 执行 compat 退场观测"
  "${cmd[@]}"
}

if [[ "${PHASE}" == "pre" ]]; then
  tp_log_info "阶段 pre：切流前检查开始"
  run_read_checks "active" "${ACTIVE_BASE_URL}"
  if [[ -n "${CANDIDATE_BASE_URL}" ]]; then
    run_read_checks "candidate" "${CANDIDATE_BASE_URL}"
  fi
else
  tp_log_info "阶段 post：切流后检查开始"
  run_read_checks "active" "${ACTIVE_BASE_URL}"
  if [[ -n "${CANDIDATE_BASE_URL}" ]]; then
    tp_log_info "附加检查 rollback 目标（只读）"
    run_read_checks "rollback-target" "${CANDIDATE_BASE_URL}"
  fi
fi

compat_target_label="active"
if [[ "${PHASE}" == "pre" && -n "${CANDIDATE_BASE_URL}" ]]; then
  compat_target_label="candidate"
fi

run_compat_checks "${compat_target_label}"

if [[ "${WITH_SMOKE}" == "true" ]]; then
  smoke_target="${ACTIVE_BASE_URL}"
  if [[ "${PHASE}" == "pre" && -n "${CANDIDATE_BASE_URL}" ]]; then
    smoke_target="${CANDIDATE_BASE_URL}"
  fi
  run_smoke "${smoke_target}"
fi

if [[ "${WITH_BOUNDARY}" == "true" ]]; then
  boundary_target="${ACTIVE_BASE_URL}"
  if [[ "${PHASE}" == "pre" && -n "${CANDIDATE_BASE_URL}" ]]; then
    boundary_target="${CANDIDATE_BASE_URL}"
  fi
  run_boundary_checks "${boundary_target}"
fi

tp_log_info "灰度检查通过（phase=${PHASE}, with_smoke=${WITH_SMOKE}, with_boundary=${WITH_BOUNDARY})"
