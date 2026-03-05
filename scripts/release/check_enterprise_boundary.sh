#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
企业域边界回归最小检查（权限边界 / 绑定冲突 / traceId 追溯）

用法:
  ./scripts/release/check_enterprise_boundary.sh [参数]

参数:
  --base-url <url>            Core 地址，默认: http://127.0.0.1:9009
  --api-secret <secret>       API_SECRET（也可用环境变量 API_SECRET）
  --admin-user <user>         owner 场景 x-admin-user，默认: boundary-owner
  --admin-role <role>         owner 场景 x-admin-role，默认: owner
  --auditor-user <user>       auditor 场景 x-admin-user，默认: boundary-auditor
  --auditor-role <role>       auditor 场景 x-admin-role，默认: auditor
  --admin-tenant <tenant>     x-admin-tenant（可选）
  --owner-cookie <cookie>     owner 管理员会话 Cookie（可选）
  --auditor-cookie <cookie>   auditor 管理员会话 Cookie（可选）
  --case-prefix <prefix>      测试资源前缀，默认: boundary-check
  --timeout <seconds>         curl connect/max-time 秒数，默认: 8
  --insecure                  curl 使用 -k（仅测试环境）
  --help                      显示帮助
USAGE
}

BASE_URL="http://127.0.0.1:9009"
API_SECRET_VALUE="${API_SECRET:-}"
ADMIN_USER="boundary-owner"
ADMIN_ROLE="owner"
AUDITOR_USER="boundary-auditor"
AUDITOR_ROLE="auditor"
ADMIN_TENANT=""
OWNER_COOKIE=""
AUDITOR_COOKIE=""
CASE_PREFIX="boundary-check"
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
    --admin-user)
      ADMIN_USER="${2:-}"
      shift 2
      ;;
    --admin-role)
      ADMIN_ROLE="${2:-}"
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
    --admin-tenant)
      ADMIN_TENANT="${2:-}"
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
    --case-prefix)
      CASE_PREFIX="${2:-}"
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

if [[ -z "${API_SECRET_VALUE}" ]]; then
  tp_fail "缺少 --api-secret 或环境变量 API_SECRET"
fi

if [[ -z "${CASE_PREFIX}" ]]; then
  tp_fail "--case-prefix 不能为空"
fi

if ! [[ "${TIMEOUT_SEC}" =~ ^[0-9]+$ ]] || [[ "${TIMEOUT_SEC}" -le 0 ]]; then
  tp_fail "--timeout 必须为正整数"
fi

BASE_URL="${BASE_URL%/}"
TP_CONNECT_TIMEOUT="${TIMEOUT_SEC}"
TP_MAX_TIME="${TIMEOUT_SEC}"
TP_INSECURE="${INSECURE}"

suffix="$(date +%Y%m%d%H%M%S)-$$-${RANDOM}"
case_id="${CASE_PREFIX}-${suffix}"

AUDITOR_BLOCK_ORG_ID="${case_id}-auditor-deny-org"
ORG_ID="${case_id}-org"
PROJECT_ID="${case_id}-project"
MEMBER_ID="${case_id}-member"
TRACE_ORG_ID="${case_id}-trace-org"
TRACE_REQUEST_ID="${case_id}-trace"
MEMBER_EMAIL="${case_id}@example.com"
BINDING_ID=""
TRACE_ID=""

set_owner_headers() {
  TP_HEADERS=(
    "Accept: application/json"
    "Authorization: Bearer ${API_SECRET_VALUE}"
  )

  if [[ -n "${OWNER_COOKIE}" ]]; then
    TP_HEADERS+=("Cookie: ${OWNER_COOKIE}")
  else
    TP_HEADERS+=(
      "x-admin-user: ${ADMIN_USER}"
      "x-admin-role: ${ADMIN_ROLE}"
    )
    if [[ -n "${ADMIN_TENANT}" ]]; then
      TP_HEADERS+=("x-admin-tenant: ${ADMIN_TENANT}")
    fi
  fi
}

set_auditor_headers() {
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
    if [[ -n "${ADMIN_TENANT}" ]]; then
      TP_HEADERS+=("x-admin-tenant: ${ADMIN_TENANT}")
    fi
  fi
}

extract_trace_id() {
  local json="$1"
  local trace=""

  if command -v jq >/dev/null 2>&1; then
    trace="$(printf '%s' "$json" | jq -r '.traceId // empty' | head -n 1)"
  fi

  if [[ -z "${trace}" ]]; then
    trace="$(tp_json_compact "$json" | sed -n 's/.*"traceId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  fi

  printf '%s' "${trace}"
}

trace_event_exists() {
  local json="$1"
  local trace_id="$2"
  local resource_id="$3"

  if command -v jq >/dev/null 2>&1; then
    local count=""
    count="$(printf '%s' "$json" | jq -r --arg trace "$trace_id" --arg resource "$resource_id" '[.data[]? | select((.traceId // "") == $trace and (.action // "") == "org.organization.create" and (.resourceId // "") == $resource)] | length')"
    [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -ge 1 ]]
    return
  fi

  tp_json_contains "$json" "\"traceId\":\"${trace_id}\"" &&
    tp_json_contains "$json" "\"resourceId\":\"${resource_id}\"" &&
    tp_json_contains "$json" '"action":"org.organization.create"'
}

cleanup_resource() {
  local label="$1"
  local url="$2"

  set_owner_headers
  tp_http_call "DELETE" "${url}"
  if [[ "${TP_HTTP_CODE}" != "200" && "${TP_HTTP_CODE}" != "404" ]]; then
    tp_log_warn "回收 ${label} 返回 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
    return
  fi
  tp_log_info "回收 ${label} -> ${TP_HTTP_CODE}"
}

cleanup() {
  set +e

  if [[ -n "${BINDING_ID}" ]]; then
    cleanup_resource "绑定(${BINDING_ID})" "${BASE_URL}/api/org/member-project-bindings/${BINDING_ID}"
  fi

  if [[ -n "${MEMBER_ID}" ]]; then
    cleanup_resource "成员(${MEMBER_ID})" "${BASE_URL}/api/org/members/${MEMBER_ID}"
  fi

  if [[ -n "${PROJECT_ID}" ]]; then
    cleanup_resource "项目(${PROJECT_ID})" "${BASE_URL}/api/org/projects/${PROJECT_ID}"
  fi

  if [[ -n "${ORG_ID}" ]]; then
    cleanup_resource "组织(${ORG_ID})" "${BASE_URL}/api/org/organizations/${ORG_ID}"
  fi

  if [[ -n "${TRACE_ORG_ID}" ]]; then
    cleanup_resource "追踪组织(${TRACE_ORG_ID})" "${BASE_URL}/api/org/organizations/${TRACE_ORG_ID}"
  fi

  if [[ -n "${AUDITOR_BLOCK_ORG_ID}" ]]; then
    cleanup_resource "权限边界测试组织(${AUDITOR_BLOCK_ORG_ID})" "${BASE_URL}/api/org/organizations/${AUDITOR_BLOCK_ORG_ID}"
  fi
}

trap cleanup EXIT

tp_log_info "1/12 检查 Core 健康: ${BASE_URL}/health"
set_owner_headers
tp_http_call "GET" "${BASE_URL}/health"
tp_expect_status "200" "健康检查"
tp_json_contains "${TP_HTTP_BODY}" '"status":"ok"' || tp_fail "健康检查响应缺少 status=ok: ${TP_HTTP_BODY}"

tp_log_info "2/12 检查高级版探针: ${BASE_URL}/api/admin/features"
set_owner_headers
tp_http_call "GET" "${BASE_URL}/api/admin/features"
tp_expect_status "200" "高级版探针检查"
tp_json_contains "${TP_HTTP_BODY}" '"edition":"advanced"' || tp_fail "探针 edition 不是 advanced: ${TP_HTTP_BODY}"
tp_json_contains "${TP_HTTP_BODY}" '"enterprise":true' || tp_fail "探针 features.enterprise != true: ${TP_HTTP_BODY}"
tp_json_contains "${TP_HTTP_BODY}" '"reachable":true' || tp_fail "探针 enterpriseBackend.reachable != true: ${TP_HTTP_BODY}"

tp_log_info "3/12 权限边界-读：auditor 读取组织列表"
set_auditor_headers
tp_http_call "GET" "${BASE_URL}/api/org/organizations"
tp_expect_status "200" "auditor 读取组织列表"

tp_log_info "4/12 权限边界-写：auditor 写组织应被拒绝"
set_auditor_headers
tp_http_call "POST" "${BASE_URL}/api/org/organizations" "{\"id\":\"${AUDITOR_BLOCK_ORG_ID}\",\"name\":\"Boundary Auditor Deny ${suffix}\",\"status\":\"active\"}"
if [[ "${TP_HTTP_CODE}" != "403" ]]; then
  tp_fail "auditor 写组织期望 403，实际 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
fi
tp_json_contains "${TP_HTTP_BODY}" '"error":"权限不足"' || tp_fail "auditor 写组织响应缺少 error=权限不足: ${TP_HTTP_BODY}"
tp_json_contains "${TP_HTTP_BODY}" '"required":"admin.org.manage"' || tp_fail "auditor 写组织响应缺少 required=admin.org.manage: ${TP_HTTP_BODY}"

tp_log_info "5/12 创建组织(OWNER): ${ORG_ID}"
set_owner_headers
tp_http_call "POST" "${BASE_URL}/api/org/organizations" "{\"id\":\"${ORG_ID}\",\"name\":\"Boundary Org ${suffix}\",\"status\":\"active\"}"
tp_expect_status "200" "创建组织"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建组织未成功: ${TP_HTTP_BODY}"

tp_log_info "6/12 创建项目(OWNER): ${PROJECT_ID}"
set_owner_headers
tp_http_call "POST" "${BASE_URL}/api/org/projects" "{\"id\":\"${PROJECT_ID}\",\"organizationId\":\"${ORG_ID}\",\"name\":\"Boundary Project ${suffix}\",\"status\":\"active\"}"
tp_expect_status "200" "创建项目"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建项目未成功: ${TP_HTTP_BODY}"

tp_log_info "7/12 创建成员(OWNER): ${MEMBER_ID}"
set_owner_headers
tp_http_call "POST" "${BASE_URL}/api/org/members" "{\"id\":\"${MEMBER_ID}\",\"organizationId\":\"${ORG_ID}\",\"email\":\"${MEMBER_EMAIL}\",\"role\":\"member\",\"status\":\"active\"}"
tp_expect_status "200" "创建成员"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建成员未成功: ${TP_HTTP_BODY}"

tp_log_info "8/12 创建成员-项目绑定(首次应成功)"
set_owner_headers
tp_http_call "POST" "${BASE_URL}/api/org/member-project-bindings" "{\"organizationId\":\"${ORG_ID}\",\"memberId\":\"${MEMBER_ID}\",\"projectId\":\"${PROJECT_ID}\"}"
tp_expect_status "200" "首次创建绑定"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "首次创建绑定未成功: ${TP_HTTP_BODY}"

tp_log_info "9/12 查询绑定 ID（用于自动清理）"
set_owner_headers
tp_http_call "GET" "${BASE_URL}/api/org/member-project-bindings?organizationId=${ORG_ID}&memberId=${MEMBER_ID}&projectId=${PROJECT_ID}"
tp_expect_status "200" "查询绑定列表"
BINDING_ID="$(tp_extract_binding_id "${TP_HTTP_BODY}" "${MEMBER_ID}" "${PROJECT_ID}")"
if [[ -z "${BINDING_ID}" ]]; then
  tp_fail "无法解析绑定 ID: ${TP_HTTP_BODY}"
fi

tp_log_info "10/12 绑定冲突：同参数重复绑定应返回 409"
set_owner_headers
tp_http_call "POST" "${BASE_URL}/api/org/member-project-bindings" "{\"organizationId\":\"${ORG_ID}\",\"memberId\":\"${MEMBER_ID}\",\"projectId\":\"${PROJECT_ID}\"}"
if [[ "${TP_HTTP_CODE}" != "409" ]]; then
  tp_fail "重复绑定期望 409，实际 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
fi
tp_json_contains "${TP_HTTP_BODY}" '"error":"成员与项目绑定已存在"' || tp_fail "重复绑定响应异常: ${TP_HTTP_BODY}"

tp_log_info "11/12 traceId 追溯：创建追踪组织"
set_owner_headers
TP_HEADERS+=("x-request-id: ${TRACE_REQUEST_ID}")
tp_http_call "POST" "${BASE_URL}/api/org/organizations" "{\"id\":\"${TRACE_ORG_ID}\",\"name\":\"Boundary Trace ${suffix}\",\"status\":\"active\"}"
tp_expect_status "200" "创建追踪组织"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建追踪组织未成功: ${TP_HTTP_BODY}"
TRACE_ID="$(extract_trace_id "${TP_HTTP_BODY}")"
if [[ -z "${TRACE_ID}" ]]; then
  tp_fail "创建追踪组织响应缺少 traceId: ${TP_HTTP_BODY}"
fi
if [[ "${TRACE_ID}" != "${TRACE_REQUEST_ID}" ]]; then
  tp_fail "traceId 未按请求透传（expect=${TRACE_REQUEST_ID}, actual=${TRACE_ID}）"
fi

tp_log_info "12/12 traceId 审计检索: ${TRACE_ID}"
set_owner_headers
tp_http_call "GET" "${BASE_URL}/api/admin/audit/events?traceId=${TRACE_ID}&page=1&pageSize=20"
tp_expect_status "200" "按 traceId 查询审计事件"
if ! trace_event_exists "${TP_HTTP_BODY}" "${TRACE_ID}" "${TRACE_ORG_ID}"; then
  tp_fail "审计未检索到 traceId 对应的组织创建事件: ${TP_HTTP_BODY}"
fi

tp_log_info "企业域边界回归最小检查通过（case_id=${case_id}, traceId=${TRACE_ID}）。资源将在退出时自动清理。"
