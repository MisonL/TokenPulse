#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
发布 smoke（组织域）

用法:
  ./scripts/release/smoke_org.sh [参数]

参数:
  --base-url <url>            Core 地址，默认: http://127.0.0.1:9009
  --api-secret <secret>       API_SECRET（也可用环境变量 API_SECRET）
  --admin-user <user>         x-admin-user，默认: release-smoke
  --admin-role <role>         x-admin-role，默认: owner
  --admin-tenant <tenant>     x-admin-tenant（可选）
  --cookie <cookie>           管理员会话 Cookie（可选，示例: tp_admin_session=xxx）
  --org-prefix <prefix>       资源 ID 前缀，默认: smoke-org
  --timeout <seconds>         curl connect/max-time 秒数，默认: 8
  --insecure                  curl 使用 -k（仅测试环境）
  --help                      显示帮助
EOF
}

BASE_URL="http://127.0.0.1:9009"
API_SECRET_VALUE="${API_SECRET:-}"
ADMIN_USER="release-smoke"
ADMIN_ROLE="owner"
ADMIN_TENANT=""
COOKIE=""
ORG_PREFIX="smoke-org"
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
    --admin-tenant)
      ADMIN_TENANT="${2:-}"
      shift 2
      ;;
    --cookie)
      COOKIE="${2:-}"
      shift 2
      ;;
    --org-prefix)
      ORG_PREFIX="${2:-}"
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

if ! [[ "${TIMEOUT_SEC}" =~ ^[0-9]+$ ]] || [[ "${TIMEOUT_SEC}" -le 0 ]]; then
  tp_fail "--timeout 必须为正整数"
fi

BASE_URL="${BASE_URL%/}"
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

suffix="$(date +%s)-$$-${RANDOM}"
ORG_ID="${ORG_PREFIX}-${suffix}"
PROJECT_ID="${ORG_PREFIX}-project-${suffix}"
MEMBER_ID="${ORG_PREFIX}-member-${suffix}"
MEMBER_EMAIL="smoke-${suffix}@example.com"
BINDING_ID=""

cleanup() {
  set +e

  if [[ -n "${BINDING_ID}" ]]; then
    tp_log_info "回收绑定: ${BINDING_ID}"
    tp_http_call "DELETE" "${BASE_URL}/api/org/member-project-bindings/${BINDING_ID}"
    if [[ "${TP_HTTP_CODE}" != "200" && "${TP_HTTP_CODE}" != "404" ]]; then
      tp_log_warn "删除绑定返回 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
    fi
  fi

  if [[ -n "${MEMBER_ID}" ]]; then
    tp_log_info "回收成员: ${MEMBER_ID}"
    tp_http_call "DELETE" "${BASE_URL}/api/org/members/${MEMBER_ID}"
    if [[ "${TP_HTTP_CODE}" != "200" && "${TP_HTTP_CODE}" != "404" ]]; then
      tp_log_warn "删除成员返回 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
    fi
  fi

  if [[ -n "${PROJECT_ID}" ]]; then
    tp_log_info "回收项目: ${PROJECT_ID}"
    tp_http_call "DELETE" "${BASE_URL}/api/org/projects/${PROJECT_ID}"
    if [[ "${TP_HTTP_CODE}" != "200" && "${TP_HTTP_CODE}" != "404" ]]; then
      tp_log_warn "删除项目返回 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
    fi
  fi

  if [[ -n "${ORG_ID}" ]]; then
    tp_log_info "回收组织: ${ORG_ID}"
    tp_http_call "DELETE" "${BASE_URL}/api/org/organizations/${ORG_ID}"
    if [[ "${TP_HTTP_CODE}" != "200" && "${TP_HTTP_CODE}" != "404" ]]; then
      tp_log_warn "删除组织返回 ${TP_HTTP_CODE}: ${TP_HTTP_BODY}"
    fi
  fi
}

trap cleanup EXIT

tp_log_info "1/8 检查 Core 健康: ${BASE_URL}/health"
tp_http_call "GET" "${BASE_URL}/health"
tp_expect_status "200" "健康检查"
tp_json_contains "${TP_HTTP_BODY}" '"status":"ok"' || tp_fail "健康检查响应缺少 status=ok: ${TP_HTTP_BODY}"

tp_log_info "1.5/8 检查登录探针: ${BASE_URL}/api/auth/verify-secret"
tp_require_api_secret_probe "${BASE_URL}" "${API_SECRET_VALUE}" "登录探针检查"

tp_log_info "2/8 检查高级版探针: ${BASE_URL}/api/admin/features"
tp_http_call "GET" "${BASE_URL}/api/admin/features"
tp_expect_status "200" "高级版探针检查"
tp_json_contains "${TP_HTTP_BODY}" '"edition":"advanced"' || tp_fail "探针未处于 advanced: ${TP_HTTP_BODY}"
tp_json_contains "${TP_HTTP_BODY}" '"enterprise":true' || tp_fail "探针 enterprise=false: ${TP_HTTP_BODY}"
tp_json_contains "${TP_HTTP_BODY}" '"reachable":true' || tp_fail "探针 enterpriseBackend.reachable!=true: ${TP_HTTP_BODY}"

tp_log_info "2.5/8 管理员身份预检: ${BASE_URL}/api/admin/auth/me"
tp_require_admin_identity "${BASE_URL}" "smoke(owner)" "owner"

tp_log_info "3/8 组织域只读检查: GET /api/org/organizations"
tp_http_call "GET" "${BASE_URL}/api/org/organizations"
tp_expect_status "200" "组织域只读检查"

tp_log_info "4/8 创建组织: ${ORG_ID}"
tp_http_call "POST" "${BASE_URL}/api/org/organizations" "{\"id\":\"${ORG_ID}\",\"name\":\"Smoke Org ${suffix}\",\"status\":\"active\"}"
tp_expect_status "200" "创建组织"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建组织未成功: ${TP_HTTP_BODY}"

tp_log_info "5/8 创建项目: ${PROJECT_ID}"
tp_http_call "POST" "${BASE_URL}/api/org/projects" "{\"id\":\"${PROJECT_ID}\",\"organizationId\":\"${ORG_ID}\",\"name\":\"Smoke Project ${suffix}\",\"status\":\"active\"}"
tp_expect_status "200" "创建项目"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建项目未成功: ${TP_HTTP_BODY}"

tp_log_info "6/8 创建成员: ${MEMBER_ID}"
tp_http_call "POST" "${BASE_URL}/api/org/members" "{\"id\":\"${MEMBER_ID}\",\"organizationId\":\"${ORG_ID}\",\"email\":\"${MEMBER_EMAIL}\",\"role\":\"member\",\"status\":\"active\"}"
tp_expect_status "200" "创建成员"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建成员未成功: ${TP_HTTP_BODY}"

tp_log_info "7/8 创建成员项目绑定"
tp_http_call "POST" "${BASE_URL}/api/org/member-project-bindings" "{\"organizationId\":\"${ORG_ID}\",\"memberId\":\"${MEMBER_ID}\",\"projectId\":\"${PROJECT_ID}\"}"
tp_expect_status "200" "创建成员项目绑定"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "创建成员项目绑定未成功: ${TP_HTTP_BODY}"

tp_http_call "GET" "${BASE_URL}/api/org/member-project-bindings?organizationId=${ORG_ID}&memberId=${MEMBER_ID}&projectId=${PROJECT_ID}"
tp_expect_status "200" "查询成员项目绑定"
BINDING_ID="$(tp_extract_binding_id "${TP_HTTP_BODY}" "${MEMBER_ID}" "${PROJECT_ID}")"
if [[ -z "${BINDING_ID}" ]]; then
  tp_fail "无法从绑定列表中解析绑定 ID: ${TP_HTTP_BODY}"
fi

tp_log_info "8/8 删除回收（绑定/成员/项目/组织）"
tp_http_call "DELETE" "${BASE_URL}/api/org/member-project-bindings/${BINDING_ID}"
tp_expect_status "200" "删除成员项目绑定"
BINDING_ID=""

tp_http_call "DELETE" "${BASE_URL}/api/org/members/${MEMBER_ID}"
tp_expect_status "200" "删除成员"
MEMBER_ID=""

tp_http_call "DELETE" "${BASE_URL}/api/org/projects/${PROJECT_ID}"
tp_expect_status "200" "删除项目"
PROJECT_ID=""

tp_http_call "DELETE" "${BASE_URL}/api/org/organizations/${ORG_ID}"
tp_expect_status "200" "删除组织"
ORG_ID=""

tp_log_info "组织域 smoke 通过"
