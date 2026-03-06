#!/usr/bin/env bash

tp_log_info() {
  printf '[INFO] %s\n' "$*"
}

tp_log_warn() {
  printf '[WARN] %s\n' "$*" >&2
}

tp_log_error() {
  printf '[ERROR] %s\n' "$*" >&2
}

tp_fail() {
  tp_log_error "$*"
  exit 1
}

tp_require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    tp_fail "缺少依赖命令: $1"
  fi
}

tp_json_compact() {
  printf '%s' "$1" | tr -d '\n' | tr -d '\r'
}

tp_json_contains() {
  local json="$1"
  local needle="$2"
  tp_json_compact "$json" | grep -Fq -- "$needle"
}

tp_http_call() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local tmp_file
  local code
  local -a args

  tmp_file="$(mktemp)"
  args=(
    --silent
    --show-error
    --location
    --connect-timeout "${TP_CONNECT_TIMEOUT:-5}"
    --max-time "${TP_MAX_TIME:-15}"
    --output "$tmp_file"
    --write-out "%{http_code}"
    --request "$method"
    "$url"
  )

  if [[ "${TP_INSECURE:-0}" == "1" ]]; then
    args=(--insecure "${args[@]}")
  fi

  if [[ "${#TP_HEADERS[@]}" -gt 0 ]]; then
    local header
    for header in "${TP_HEADERS[@]}"; do
      args+=(--header "$header")
    done
  fi

  if [[ -n "$body" ]]; then
    args+=(--header "Content-Type: application/json" --data "$body")
  fi

  code="$(curl "${args[@]}")" || {
    local curl_exit="$?"
    local curl_body=""
    curl_body="$(cat "$tmp_file" 2>/dev/null || true)"
    rm -f "$tmp_file"
    tp_fail "HTTP 请求失败: ${method} ${url} (curl_exit=${curl_exit}) ${curl_body}"
  }

  TP_HTTP_CODE="$code"
  TP_HTTP_BODY="$(cat "$tmp_file" 2>/dev/null || true)"
  rm -f "$tmp_file"
}

tp_expect_status() {
  local expected="$1"
  local context="$2"
  if [[ "${TP_HTTP_CODE}" != "${expected}" ]]; then
    tp_fail "${context} 失败，期望状态码 ${expected}，实际 ${TP_HTTP_CODE}，响应: ${TP_HTTP_BODY}"
  fi
}

tp_require_admin_identity() {
  local base_url="$1"
  local label="${2:-管理员}"
  local expected_role="${3:-}"
  local url="${base_url%/}/api/admin/auth/me"

  tp_http_call "GET" "${url}"
  if [[ "${TP_HTTP_CODE}" != "200" ]]; then
    tp_fail "${label} 身份预检失败：GET ${url} 返回 ${TP_HTTP_CODE}，响应: ${TP_HTTP_BODY}"
  fi

  if ! tp_json_contains "${TP_HTTP_BODY}" '"authenticated":true'; then
    tp_fail "${label} 身份未就绪（未登录或头部身份未生效）：${TP_HTTP_BODY}\n修复方式：\n1) 可信代理环境：设置 TRUST_PROXY=true 且 ADMIN_TRUST_HEADER_AUTH=true（并确保仅在可信链路注入 x-admin-user/x-admin-role）。\n2) 本地/非可信代理：先调用 /api/admin/auth/login 获取管理员会话 Cookie，然后在脚本中通过 --cookie/--owner-cookie/--auditor-cookie 传入（注意：若 ADMIN_AUTH_MODE=header，Cookie 会被忽略）。"
  fi

  if [[ -n "${expected_role}" ]]; then
    if ! tp_json_contains "${TP_HTTP_BODY}" "\"roleKey\":\"${expected_role}\""; then
      tp_fail "${label} 身份角色不匹配，期望 roleKey=${expected_role}，实际: ${TP_HTTP_BODY}"
    fi
  fi
}

tp_require_api_secret_probe() {
  local base_url="$1"
  local api_secret="$2"
  local label="${3:-登录探针}"
  local url="${base_url%/}/api/auth/verify-secret"
  local previous_headers_decl=""
  local had_headers="0"

  if previous_headers_decl="$(declare -p TP_HEADERS 2>/dev/null)"; then
    had_headers="1"
  else
    declare -ag TP_HEADERS=()
  fi

  TP_HEADERS+=("Authorization: Bearer ${api_secret}")
  tp_http_call "GET" "${url}"
  if [[ "${had_headers}" == "1" ]]; then
    eval "${previous_headers_decl}"
  else
    unset TP_HEADERS
  fi

  if [[ "${TP_HTTP_CODE}" != "200" ]]; then
    tp_fail "${label} 失败：GET ${url} 返回 ${TP_HTTP_CODE}，响应: ${TP_HTTP_BODY}"
  fi

  if ! tp_json_contains "${TP_HTTP_BODY}" '"success":true'; then
    tp_fail "${label} 响应缺少 success=true: ${TP_HTTP_BODY}"
  fi
}

tp_extract_binding_id() {
  local json="$1"
  local member_id="$2"
  local project_id="$3"
  local result=""

  if command -v jq >/dev/null 2>&1; then
    result="$(printf '%s' "$json" | jq -r --arg m "$member_id" --arg p "$project_id" '.data[]? | select(.memberId == $m and .projectId == $p) | .id' | head -n 1)"
    if [[ -n "$result" && "$result" != "null" ]]; then
      printf '%s' "$result"
      return 0
    fi
  fi

  result="$(tp_json_compact "$json" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' | head -n 1)"
  printf '%s' "$result"
}

tp_format_iso_utc() {
  local epoch_seconds="$1"
  if date -u -r 0 +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
    date -u -r "$epoch_seconds" +"%Y-%m-%dT%H:%M:%SZ"
    return 0
  fi
  if date -u -d "@0" +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
    date -u -d "@$epoch_seconds" +"%Y-%m-%dT%H:%M:%SZ"
    return 0
  fi
  tp_fail "当前系统 date 命令不支持时间戳转 ISO（缺少 -r 或 -d @）"
}
