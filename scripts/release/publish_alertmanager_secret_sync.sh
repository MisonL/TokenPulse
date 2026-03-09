#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
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
  --config-template <path>         Alertmanager 基线模板路径
                                   默认: ./monitoring/alertmanager.yml
  --templates-path <path>          Alertmanager 模板目录路径
                                   默认读取环境变量 ALERTMANAGER_TEMPLATES_PATH，未设置时回退到 ./monitoring/alertmanager-templates
  --secret-helper <path>           Secret 读取 helper（推荐，必填其一）
                                   调用约定: <helper> <secret_ref>
                                   stdout 必须只输出 webhook URL
  --secret-cmd-template <tpl>      已弃用；兼容旧命令模板（必填其一）
                                   占位符支持: {{secret_ref}} 或 %s
                                   仅支持直接命令参数，不再通过 bash -lc 执行
  --comment <text>                 配置更新备注，默认: release publish via secret manager
  --sync-reason <text>             同步原因，默认: release sync via secret manager
  --render-only                    仅渲染最终配置并退出，不执行管理员预检与发布
  --render-format <json|yaml>      render-only 时的输出格式，默认: yaml
  --render-output <path>           render-only 时写入目标文件；未指定则输出到 stdout
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
    --secret-helper "./bin/read-alertmanager-secret"
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
CONFIG_TEMPLATE_INPUT="${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-./monitoring/alertmanager.yml}"
TEMPLATES_PATH_INPUT="${ALERTMANAGER_TEMPLATES_PATH:-./monitoring/alertmanager-templates}"
SECRET_HELPER=""
SECRET_CMD_TEMPLATE=""
COMMENT="release publish via secret manager"
SYNC_REASON="release sync via secret manager"
INSECURE="0"
RENDER_ONLY="0"
RENDER_FORMAT="yaml"
RENDER_OUTPUT=""

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
    --config-template)
      CONFIG_TEMPLATE_INPUT="${2:-}"
      shift 2
      ;;
    --templates-path)
      TEMPLATES_PATH_INPUT="${2:-}"
      shift 2
      ;;
    --secret-helper)
      SECRET_HELPER="${2:-}"
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
    --render-only)
      RENDER_ONLY="1"
      shift 1
      ;;
    --render-format)
      RENDER_FORMAT="${2:-}"
      shift 2
      ;;
    --render-output)
      RENDER_OUTPUT="${2:-}"
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

tp_require_cmd bun
if [[ "${RENDER_ONLY}" != "1" ]]; then
  tp_require_cmd curl
fi

if [[ "${RENDER_ONLY}" != "1" && -z "${API_SECRET_VALUE}" ]]; then
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
if [[ -z "${SECRET_HELPER}" && -z "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_fail "缺少 --secret-helper 或 --secret-cmd-template"
fi
if [[ "${RENDER_FORMAT}" != "json" && "${RENDER_FORMAT}" != "yaml" ]]; then
  tp_fail "--render-format 仅支持 json/yaml"
fi

BASE_URL="${BASE_URL%/}"
TP_CONNECT_TIMEOUT="${TP_CONNECT_TIMEOUT:-8}"
TP_MAX_TIME="${TP_MAX_TIME:-25}"
TP_INSECURE="${INSECURE}"

tp_resolve_repo_path() {
  local raw_path="$1"
  if [[ -z "${raw_path}" ]]; then
    printf '%s' ""
    return 0
  fi

  if [[ "${raw_path}" == /* ]]; then
    printf '%s' "${raw_path}"
    return 0
  fi

  printf '%s/%s' "${REPO_ROOT}" "${raw_path#./}"
}

CONFIG_TEMPLATE_PATH="$(tp_resolve_repo_path "${CONFIG_TEMPLATE_INPUT}")"
TEMPLATES_PATH_ABS="$(tp_resolve_repo_path "${TEMPLATES_PATH_INPUT}")"
if [[ ! -f "${CONFIG_TEMPLATE_PATH}" ]]; then
  tp_fail "Alertmanager 基线模板不存在: ${CONFIG_TEMPLATE_INPUT}"
fi
if [[ ! -r "${CONFIG_TEMPLATE_PATH}" ]]; then
  tp_fail "Alertmanager 基线模板不可读: ${CONFIG_TEMPLATE_INPUT}"
fi

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

tp_validate_secret_ref() {
  local secret_ref="$1"
  if [[ ! "${secret_ref}" =~ ^[A-Za-z0-9._/@:-]+$ ]]; then
    tp_fail "Secret 引用名包含非法字符（ref=${secret_ref}），仅允许字母/数字/./_/@/:-"
  fi
}

tp_require_distinct_secret_refs() {
  local warning_ref="$1"
  local critical_ref="$2"
  local p1_ref="$3"

  if [[ "${warning_ref}" == "${critical_ref}" ]] ||
     [[ "${warning_ref}" == "${p1_ref}" ]] ||
     [[ "${critical_ref}" == "${p1_ref}" ]]; then
    tp_fail "warning/critical/p1 Secret 引用名必须彼此不同，禁止在真实值班链路中复用同一 Secret"
  fi
}

tp_is_reserved_example_url() {
  local normalized_url="$1"
  [[ "${normalized_url}" =~ ^https?://([^/@]+@)?([^.\/]+\.)*example\.(invalid|com|local)([:/]|$) ]]
}

tp_has_placeholder_webhook_marker() {
  local normalized_url="$1"

  if [[ "${normalized_url}" == *"replace_with"* ]] ||
     [[ "${normalized_url}" == *"replacewith"* ]] ||
     [[ "${normalized_url}" == *"replace_me"* ]] ||
     [[ "${normalized_url}" == *"replace-me"* ]] ||
     [[ "${normalized_url}" == *"change_me"* ]] ||
     [[ "${normalized_url}" == *"change-me"* ]] ||
     [[ "${normalized_url}" == *"changeme"* ]] ||
     [[ "${normalized_url}" == *"your-webhook"* ]] ||
     [[ "${normalized_url}" == *"your_webhook"* ]] ||
     [[ "${normalized_url}" == *"dummy-webhook"* ]] ||
     [[ "${normalized_url}" == *"dummy_webhook"* ]] ||
     [[ "${normalized_url}" == *"<webhook>"* ]]; then
    return 0
  fi

  [[ "${normalized_url}" =~ (^|[/?#=&])(todo|placeholder)([/?#=&]|$) ]]
}

tp_validate_webhook_url() {
  local secret_ref="$1"
  local url="$2"
  local normalized=""

  normalized="$(printf '%s' "${url}" | tr '[:upper:]' '[:lower:]')"

  if tp_is_reserved_example_url "${normalized}"; then
    tp_fail "Secret 值仍是保留示例域名（ref=${secret_ref}），禁止进入发布窗口"
  fi

  if tp_has_placeholder_webhook_marker "${normalized}"; then
    tp_fail "Secret 值仍包含占位 webhook 标记（ref=${secret_ref}），禁止进入发布窗口"
  fi

  if [[ "${normalized}" =~ ^https?://(127\.0\.0\.1|localhost|0\.0\.0\.0)([:/]|$) ]] ||
     [[ "${normalized}" =~ ^https?://host\.docker\.internal([:/]|$) ]] ||
     [[ "${normalized}" =~ ^https?://\[::1\]([:/]|$) ]]; then
    tp_fail "Secret 值命中本地演练地址（ref=${secret_ref}），禁止进入发布窗口"
  fi
}

tp_resolve_secret_helper() {
  local helper_input="$1"

  if [[ "${helper_input}" == */* ]]; then
    if [[ ! -e "${helper_input}" ]]; then
      tp_fail "Secret helper 不存在: ${helper_input}"
    fi
    if [[ ! -x "${helper_input}" ]]; then
      tp_fail "Secret helper 不可执行: ${helper_input}"
    fi
    printf '%s' "${helper_input}"
    return 0
  fi

  if ! command -v "${helper_input}" >/dev/null 2>&1; then
    tp_fail "Secret helper 不存在于 PATH: ${helper_input}"
  fi

  command -v "${helper_input}"
}

tp_is_shell_binary() {
  local candidate="$1"
  case "$(basename "${candidate}")" in
    bash|sh|zsh|dash|ash|ksh)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

TP_SECRET_HELPER_BIN=""
TP_SECRET_CMD_ARGS=()

tp_assert_template_safe_command() {
  local idx=0
  local current=""
  local next=""

  for ((idx=0; idx<${#TP_SECRET_CMD_ARGS[@]}; idx++)); do
    current="${TP_SECRET_CMD_ARGS[$idx]}"
    next="${TP_SECRET_CMD_ARGS[$((idx + 1))]:-}"

    if tp_is_shell_binary "${current}"; then
      case "${next}" in
        -c|-lc|-ic|--command)
          tp_fail "--secret-cmd-template 已弃用，且不允许通过 shell -c 形式执行任意模板；请改用 --secret-helper"
          ;;
      esac
    fi
  done
}

tp_prepare_secret_template_args() {
  local secret_ref="$1"
  local marker="__TP_SECRET_REF__"
  local template_input="${SECRET_CMD_TEMPLATE}"
  local rendered_template=""
  local idx=0

  if [[ "${template_input}" != *"{{secret_ref}}"* && "${template_input}" != *"%s"* ]]; then
    tp_fail "--secret-cmd-template 必须包含占位符 {{secret_ref}} 或 %s"
  fi

  if [[ "${template_input}" == *"{{secret_ref}}"* ]]; then
    rendered_template="${template_input//\{\{secret_ref\}\}/${marker}}"
  else
    printf -v rendered_template "${template_input}" "${marker}"
  fi

  read -r -a TP_SECRET_CMD_ARGS <<< "${rendered_template}"
  if [[ "${#TP_SECRET_CMD_ARGS[@]}" -eq 0 ]]; then
    tp_fail "--secret-cmd-template 解析后为空"
  fi

  tp_assert_template_safe_command

  for ((idx=0; idx<${#TP_SECRET_CMD_ARGS[@]}; idx++)); do
    TP_SECRET_CMD_ARGS[$idx]="${TP_SECRET_CMD_ARGS[$idx]//${marker}/${secret_ref}}"
  done
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

tp_render_alertmanager_config() {
  local format="$1"
  local rendered_output=""

  if ! rendered_output="$(
    bun "${SCRIPT_DIR}/render_alertmanager_config.ts" \
      --template-path "${CONFIG_TEMPLATE_PATH}" \
      --output-format "${format}" \
      --warning-webhook-url "${warning_webhook_url}" \
      --critical-webhook-url "${critical_webhook_url}" \
      --p1-webhook-url "${p1_webhook_url}" 2>&1
  )"; then
    tp_fail "渲染 Alertmanager 基线失败: ${rendered_output}"
  fi

  printf '%s' "${rendered_output}"
}

tp_preflight_rendered_config() {
  local rendered_config_path="$1"
  local preflight_output=""

  if ! preflight_output="$(
    bash "${SCRIPT_DIR}/preflight_alertmanager_config.sh" \
      --config-path "${rendered_config_path}" \
      --templates-path "${TEMPLATES_PATH_ABS}" 2>&1
  )"; then
    tp_fail "渲染后的 Alertmanager 配置本地预检失败: ${preflight_output}"
  fi
}

tp_read_secret_value() {
  local secret_ref="$1"
  local command_output=""

  tp_validate_secret_ref "${secret_ref}"

  if [[ -n "${SECRET_HELPER}" ]]; then
    if ! command_output="$(TP_SECRET_REF="${secret_ref}" "${TP_SECRET_HELPER_BIN}" "${secret_ref}" 2>/dev/null)"; then
      tp_fail "Secret helper 执行失败（ref=${secret_ref}），请检查 helper 路径与访问权限"
    fi
  else
    tp_prepare_secret_template_args "${secret_ref}"
    if ! command_output="$("${TP_SECRET_CMD_ARGS[@]}" 2>/dev/null)"; then
      tp_fail "Secret 读取失败（ref=${secret_ref}），请检查命令模板与访问权限"
    fi
  fi

  command_output="$(tp_trim_text "${command_output}")"
  if [[ -z "${command_output}" ]]; then
    tp_fail "Secret 返回为空（ref=${secret_ref}）"
  fi

  if [[ "${command_output}" == *$'\n'* || "${command_output}" == *$'\r'* ]]; then
    tp_fail "Secret 值必须是单行 webhook URL（ref=${secret_ref}），stdout 不允许混入日志"
  fi

  if [[ ! "${command_output}" =~ ^https?://[^[:space:]]+$ ]]; then
    tp_fail "Secret 值不是有效 webhook URL（ref=${secret_ref}）"
  fi

  tp_validate_webhook_url "${secret_ref}" "${command_output}"

  printf '%s' "${command_output}"
}

if [[ -n "${SECRET_HELPER}" ]]; then
  TP_SECRET_HELPER_BIN="$(tp_resolve_secret_helper "${SECRET_HELPER}")"
fi

if [[ -n "${SECRET_HELPER}" && -n "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_log_warn "同时传入 --secret-helper 与 --secret-cmd-template，已优先使用 --secret-helper；--secret-cmd-template 已弃用"
elif [[ -n "${SECRET_CMD_TEMPLATE}" ]]; then
  tp_log_warn "--secret-cmd-template 已弃用，请尽快改用 --secret-helper <path>"
fi

tp_require_distinct_secret_refs "${WARNING_SECRET_REF}" "${CRITICAL_SECRET_REF}" "${P1_SECRET_REF}"

tp_log_info "1/6 读取 Secret Manager 引用"
warning_webhook_url="$(tp_read_secret_value "${WARNING_SECRET_REF}")"
critical_webhook_url="$(tp_read_secret_value "${CRITICAL_SECRET_REF}")"
p1_webhook_url="$(tp_read_secret_value "${P1_SECRET_REF}")"

tp_log_info "2/6 渲染 Alertmanager 基线模板"
rendered_alertmanager_json="$(tp_render_alertmanager_config "json")"
rendered_alertmanager_yaml="$(tp_render_alertmanager_config "yaml")"
render_temp_dir="$(mktemp -d)"
render_temp_config="${render_temp_dir}/alertmanager.rendered.yml"
cleanup_render_temp() {
  rm -rf "${render_temp_dir}"
}
trap cleanup_render_temp EXIT
printf '%s\n' "${rendered_alertmanager_yaml}" > "${render_temp_config}"

tp_log_info "3/6 执行渲染结果本地预检"
tp_preflight_rendered_config "${render_temp_config}"

if [[ "${RENDER_ONLY}" == "1" ]]; then
  rendered_alertmanager_output="${rendered_alertmanager_json}"
  if [[ "${RENDER_FORMAT}" == "yaml" ]]; then
    rendered_alertmanager_output="${rendered_alertmanager_yaml}"
  fi

  if [[ -n "${RENDER_OUTPUT}" ]]; then
    printf '%s\n' "${rendered_alertmanager_output}" > "${RENDER_OUTPUT}"
  else
    printf '%s\n' "${rendered_alertmanager_output}"
  fi

  tp_log_info "render-only 完成（template=${CONFIG_TEMPLATE_INPUT}, format=${RENDER_FORMAT}）"
  exit 0
fi

tp_log_info "4/6 管理员身份预检: ${BASE_URL}/api/admin/auth/me"
tp_require_admin_identity "${BASE_URL}" "alertmanager publish(owner)" "owner"

tp_log_info "5/6 写入 Alertmanager 控制面配置"
alertmanager_config_payload="$(cat <<EOF_PAYLOAD
{"comment":"$(tp_json_escape "${COMMENT}")","config":${rendered_alertmanager_json}}
EOF_PAYLOAD
)"

tp_http_call "PUT" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/config" "${alertmanager_config_payload}"
tp_expect_status "200" "Alertmanager 配置更新"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "Alertmanager 配置更新响应异常: ${TP_HTTP_BODY}"

tp_log_info "6/6 执行 Alertmanager sync"
sync_payload="$(cat <<EOF_SYNC
{"reason":"$(tp_json_escape "${SYNC_REASON}")","comment":"$(tp_json_escape "${COMMENT}")"}
EOF_SYNC
)"
tp_http_call "POST" "${BASE_URL}/api/admin/observability/oauth-alerts/alertmanager/sync" "${sync_payload}"
tp_expect_status "200" "Alertmanager 同步"
tp_json_contains "${TP_HTTP_BODY}" '"success":true' || tp_fail "Alertmanager 同步响应异常: ${TP_HTTP_BODY}"

tp_log_info "7/7 发布完成"
tp_log_info "已完成 Alertmanager 配置下发与同步（template=${CONFIG_TEMPLATE_INPUT}, secret refs: warning=${WARNING_SECRET_REF}, critical=${CRITICAL_SECRET_REF}, p1=${P1_SECRET_REF}）"
