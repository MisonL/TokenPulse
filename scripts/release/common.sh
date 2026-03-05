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

  if ! code="$(curl "${args[@]}")"; then
    local curl_exit="$?"
    local curl_body=""
    curl_body="$(cat "$tmp_file" 2>/dev/null || true)"
    rm -f "$tmp_file"
    tp_fail "HTTP 请求失败: ${method} ${url} (curl_exit=${curl_exit}) ${curl_body}"
  fi

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
