#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Alertmanager 发布脚本（Secret Manager 注入 + config 更新 + sync）

用法:
  ./scripts/release/publish_alertmanager_secret_sync.sh [参数]

参数:
  --base-url <url>                 Core 地址，默认: http://127.0.0.1:9009
  --api-secret <secret>            API_SECRET（也可用环境变量 API_SECRET）
  --admin-user <user>              x-admin-user，默认: release-bot
  --admin-role <role>              x-admin-role，默认: owner
  --admin-tenant <tenant>          x-admin-tenant（可选）
  --cookie <cookie>                管理员会话 Cookie（可选，示例: tp_admin_session=xxx）
  --warning-secret-ref <ref>       warning webhook 的 Secret 引用名（必填）
  --critical-secret-ref <ref>      critical webhook 的 Secret 引用名（必填）
  --p1-secret-ref <ref>            P1 webhook 的 Secret 引用名（必填）
  --secret-cmd-template <tpl>      Secret 读取命令模板（必填）
                                   占位符支持: {{secret_ref}} 或 %s
  --comment <text>                 配置更新备注，默认: release publish via secret manager
  --sync-reason <text>             同步原因，默认: release sync via secret manager
  --insecure                        curl 使用 -k（仅测试环境）
  --help                           显示帮助

示例:
  ./scripts/release/publish_alertmanager_secret_sync.sh \
    --base-url "https://core.example.com" \
    --api-secret "$API_SECRET" \
    --admin-user "release-bot" \
    --admin-role "owner" \
    --warning-secret-ref "tokenpulse/prod/alertmanager_warning_webhook_url" \
    --critical-secret-ref "tokenpulse/prod/alertmanager_critical_webhook_url" \
    --p1-secret-ref "tokenpulse/prod/alertmanager_p1_webhook_url" \
    --secret-cmd-template 'secret-manager read {{secret_ref}}'
USAGE
}

BASE_URL="http://127.0.0.1:9009"
API_SECRET_VALUE="${API_SECRET:-}"
ADMIN_USER="release-bot"
ADMIN_ROLE="owner"
ADMIN_TENANT=""
COOKIE=""
WARNING_SECRET_REF=""
CRITICAL_SECRET_REF=""
P1_SECRET_REF=""
SECRET_CMD_TEMPLATE=""
COMMENT="release publish via secret manager"
SYNC_REASON="release sync via secret manager"
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
    --warning-secret-ref)
      WARNING_SECRET_REF="${2:-}"
      shift 2
      ;;
    --critical-secret-ref)
      CRITICAL_SECRET_REF="${2:-}"
      shift 2
      ;;
    --p1-secret-ref)
      P1_SECRET_REF="${2:-}"
      shift 2
      ;;
    --secret-cmd-template)
      SECRET_CMD_TEMPLATE="${2:-}"
      shift 2
      ;;
    --comment)
      COMMENT="${2:-}"
      shift 2
      ;;
    --sync-reason)
      SYNC_REASON="${2:-}"
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
tp_require_cmd bash

if [[ -z "${API_SECRET_VALUE}" ]]; then
  tp_fail "缺少 --api-secret 或环境变量 API_SECRET"
fi

if [[ -z "${WARNING_SECRET_REF}" ]]; then
  tp_fail "缺少 --warning-secret-ref"
fi
if [[ -z "${CRITICAL_SECRET_REF}" ]]; then
  tp_fail "缺少 --critical-secret-ref"
fi
if [[ -z "${P1_SECRET_REF}" ]]; then
  tp_fail "缺少 --p1-secret-ref"
fi
if [[ -z "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_fail "缺少 --secret-cmd-template"
fi

if [[ "${SECRET_CMD_TEMPLATE}" != *"{{secret_ref}}"* && "${SECRET_CMD_TEMPLATE}" != *"%s"* ]]; then
  tp_fail "--secret-cmd-template 必须包含占位符 {{secret_ref}} 或 %s"
fi

BASE_URL="${BASE_URL%/}"
TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-8}"
TP_MAX_TIME="${TP_MAX_TIME:-25}"
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

tp_log_info "0/4 管理员身份预检: ${BASE_URL}/api/admin/auth/me"
tp_require_admin_identity "${BASE_URL}" "alertmanager publish(owner)" "owner"

tp_render_secret_command() {
  local secret_ref="$1"
  local command_template="${SECRET_CMD_TEMPLATE}"
  local command_line=""

  if [[ "${command_template}" == *"{{secret_ref}}"* ]]; then
    command_line="${command_template//\{\{secret_ref\}\}/${secret_ref}}"
    printf '%s' "${command_line}"
    return 0
  fi

  if [[ "${command_template}" == *"%s"* ]]; then
    printf -v command_line "${command_template}" "${secret_ref}"
    printf '%s' "${command_line}"
    return 0
  fi

  tp_fail "Secret 命令模板不包含可替换占位符"
}

tp_trim_text() {
  local text="$1"
  # 去首尾空白，避免 Secret 命令返回尾部换行。
  text="${text#"${text%%[![:space:]]*}"}"
  text="${text%"${text##*[![:space:]]}"}"
  printf '%s' "${text}"
}

tp_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

tp_read_secret_value() {
  local secret_ref="$1"
  local command_line=""
  local command_output=""

  command_line="$(tp_render_secret_command "${secret_ref}")"

  if ! command_output="$(bash -lc "${command_line}" 2>/dev/null)"; then
    tp_fail "Secret 读取失败（ref=${secret_ref}），请检查命令模板与访问权限"
  fi

  command_output="$(tp_trim_text "${command_output}")"
  if [[ -z "${command_output}" ]]; then
    tp_fail "Secret 返回为空（ref=${secret_ref}）"
  fi

  if [[ "${command_output}" != http://* && "${command_output}" != https://* ]]; then
    tp_fail "Secret 值不是有效 webhook URL（ref=${secret_ref}）"
  fi

  printf '%s' "${command_output}"
}

tp_log_info "1/4 读取 Secret Manager 引用"
warning_webhook_url="$(tp_read_secret_value "${WARNING_SECRET_REF}")"
critical_webhook_url="$(tp_read_secret_value "${CRITICAL_SECRET_REF}")"
p1_webhook_url="$(tp_read_secret_value "${P1_SECRET_REF}")"

tp_log_info "2/4 写入 Alertmanager 控制面配置"
alertmanager_config_payload="$(cat <<EOF_PAYLOAD
{"comment":"$(tp_json_escape "${COMMENT}")","config":{"global":{"resolve_timeout":"5m"},"route":{"receiver":"warning-webhook","group_by":["alertname","service","severity","provider"],"group_wait":"30s","group_interval":"5m","repeat_interval":"2h","routes":[{"receiver":"p1-webhook","matchers":["severity=\"critical\"","escalation=\"p1-15m\""],"group_wait":"10s","group_interval":"1m","repeat_interval":"15m","continue":false},{"receiver":"critical-webhook","matchers":["severity=\"critical\""],"group_wait":"10s","group_interval":"2m","repeat_interval":"30m","continue":false},{"receiver":"warning-webhook","matchers":["severity=\"warning\""],"group_wait":"30s","group_interval":"5m","repeat_interval":"4h","continue":false}]},"receivers":[{"name":"warning-webhook","webhook_configs":[{"url":"$(tp_json_escape "${warning_webhook_url}")","send_resolved":true}]},{"name":"critical-webhook","webhook_configs":[{"url":"$(tp_json_escape "${critical_webhook_url}")","send_resolved":true}]},{"name":"p1-webhook","webhook_configs":[{"url":"$(tp_json_escape "${p1_webhook_url}")","send_resolved":true}]}]}}
EOF_PAYLOAD
)"

tp_http_call "PUT" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/config" "${alertmanager_config_payload}"
tp_expect_status "200" "Alertmanager 配置更新"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "Alertmanager 配置更新响应异常: ${TP_HTTP_BODY}"

tp_log_info "3/4 执行 Alertmanager sync"
sync_payload="$(cat <<EOF_SYNC
{"reason":"$(tp_json_escape "${SYNC_REASON}")","comment":"$(tp_json_escape "${COMMENT}")"}
EOF_SYNC
)"
tp_http_call "POST" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/sync" "${sync_payload}"
tp_expect_status "200" "Alertmanager 同步"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "Alertmanager 同步响应异常: ${TP_HTTP_BODY}"

tp_log_info "4/4 发布完成"
tp_log_info "已完成 Alertmanager 配置下发与同步（secret refs: warning=${WARNING_SECRET_REF}, critical=${CRITICAL_SECRET_REF}, p1=${P1_SECRET_REF}）"
