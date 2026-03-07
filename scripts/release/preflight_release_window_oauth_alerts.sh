#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
OAuth Alertmanager 生产窗口预检脚本（仅做离线参数检查，不执行真实替换）

用法:
  ./scripts/release/preflight_release_window_oauth_alerts.sh [参数]

参数:
  --env-file <path>   参数文件路径，默认: ./scripts/release/release_window_oauth_alerts.env
  --help              显示帮助

说明:
  1) 该脚本会先校验 release_window_oauth_alerts.sh 所需必填参数。
  2) 会检测变量是否缺失、是否仍为模板默认占位值。
  3) 会阻断已被 Git 跟踪的参数文件，避免真实密钥/地址误提交。
  4) 通过参数校验后，会用同一份 Alertmanager 基线模板做本地渲染，再执行文件预检。
  5) 通过后仅输出下一步命令，不会调用 Core 管理接口；但会执行 secret-helper/兼容命令模板读取 webhook。
USAGE
}

ENV_FILE="${SCRIPT_DIR}/release_window_oauth_alerts.env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
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

if [[ ! -f "${ENV_FILE}" ]]; then
  tp_log_error "参数文件不存在: ${ENV_FILE}"
  tp_log_info "请先复制模板并填值:"
  tp_log_info "  cp scripts/release/release_window_oauth_alerts.env.example scripts/release/release_window_oauth_alerts.env"
  exit 1
fi

if [[ ! -r "${ENV_FILE}" ]]; then
  tp_fail "参数文件不可读: ${ENV_FILE}"
fi

if command -v git >/dev/null 2>&1 && git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ "${ENV_FILE}" == /* ]]; then
    env_file_abs="${ENV_FILE}"
  else
    env_file_abs="${PWD}/${ENV_FILE}"
  fi
  if [[ "${env_file_abs}" == "${REPO_ROOT}/"* ]]; then
    env_file_git_path="${env_file_abs#${REPO_ROOT}/}"
  else
    env_file_git_path="${ENV_FILE}"
  fi
  if git -C "${REPO_ROOT}" ls-files --error-unmatch "${env_file_git_path}" >/dev/null 2>&1; then
    tp_fail "参数文件已被 Git 跟踪：${ENV_FILE}。请移出版本控制后重试（仓库已忽略 scripts/release/release_window_oauth_alerts.env）"
  fi
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

tp_require_cmd bash

declare -a required_vars=(
  "RW_BASE_URL"
  "RW_API_SECRET"
  "RW_WARNING_SECRET_REF"
  "RW_CRITICAL_SECRET_REF"
  "RW_P1_SECRET_REF"
)

tp_default_placeholder() {
  case "$1" in
    RW_BASE_URL) printf '%s' "https://core.example.com" ;;
    RW_API_SECRET) printf '%s' "__REPLACE_WITH_API_SECRET__" ;;
    RW_OWNER_USER) printf '%s' "__REPLACE_WITH_OWNER_USER__" ;;
    RW_OWNER_ROLE) printf '%s' "__REPLACE_WITH_OWNER_ROLE__" ;;
    RW_AUDITOR_USER) printf '%s' "__REPLACE_WITH_AUDITOR_USER__" ;;
    RW_AUDITOR_ROLE) printf '%s' "__REPLACE_WITH_AUDITOR_ROLE__" ;;
    RW_OWNER_COOKIE) printf '%s' "__REPLACE_WITH_OWNER_COOKIE__" ;;
    RW_AUDITOR_COOKIE) printf '%s' "__REPLACE_WITH_AUDITOR_COOKIE__" ;;
    RW_WARNING_SECRET_REF) printf '%s' "__REPLACE_WITH_WARNING_SECRET_REF__" ;;
    RW_CRITICAL_SECRET_REF) printf '%s' "__REPLACE_WITH_CRITICAL_SECRET_REF__" ;;
    RW_P1_SECRET_REF) printf '%s' "__REPLACE_WITH_P1_SECRET_REF__" ;;
    RW_SECRET_HELPER) printf '%s' "__REPLACE_WITH_SECRET_HELPER__" ;;
    RW_SECRET_CMD_TEMPLATE) printf '%s' "__REPLACE_WITH_SECRET_CMD_TEMPLATE__" ;;
    *) printf '%s' "" ;;
  esac
}

declare -a missing_vars=()
declare -a placeholder_vars=()
declare -a invalid_vars=()

tp_is_reserved_example_url() {
  local normalized_url="$1"
  [[ "${normalized_url}" =~ ^https?://([^/@]+@)?([^.\/]+\.)*example\.(invalid|com|local)([:/]|$) ]]
}

for var_name in "${required_vars[@]}"; do
  value="${!var_name:-}"
  default_value="$(tp_default_placeholder "${var_name}")"
  if [[ -z "${value}" ]]; then
    missing_vars+=("${var_name}")
    continue
  fi

  if [[ "${value}" == "${default_value}" ]] || [[ "${value}" == __REPLACE_WITH_*__ ]]; then
    placeholder_vars+=("${var_name}")
  fi
done

rw_base_url_normalized="$(printf '%s' "${RW_BASE_URL:-}" | tr '[:upper:]' '[:lower:]')"
if [[ -n "${rw_base_url_normalized}" ]]; then
  if tp_is_reserved_example_url "${rw_base_url_normalized}"; then
    invalid_vars+=("RW_BASE_URL=${RW_BASE_URL}（仍为示例域名，不可用于生产窗口预检）")
  fi

  if [[ "${rw_base_url_normalized}" =~ ^https?://(127\.0\.0\.1|localhost|0\.0\.0\.0)([:/]|$) ]] ||
     [[ "${rw_base_url_normalized}" =~ ^https?://host\.docker\.internal([:/]|$) ]] ||
     [[ "${rw_base_url_normalized}" =~ ^https?://\[::1\]([:/]|$) ]]; then
    invalid_vars+=("RW_BASE_URL=${RW_BASE_URL}（命中本地地址，不可用于生产窗口预检）")
  fi
fi

validate_optional_cookie() {
  local var_name="$1"
  local cookie_value="${!var_name:-}"
  local default_value=""

  if [[ -z "${cookie_value}" ]]; then
    return 0
  fi

  default_value="$(tp_default_placeholder "${var_name}")"
  if [[ "${cookie_value}" == "${default_value}" ]] || [[ "${cookie_value}" == __REPLACE_WITH_*__ ]]; then
    placeholder_vars+=("${var_name}")
    return 0
  fi

  if [[ "${cookie_value}" != *=* ]]; then
    invalid_vars+=("${var_name}（必须形如 tp_admin_session=<session-id>）")
  fi
}

validate_header_identity_pair() {
  local user_var="$1"
  local role_var="$2"
  local cookie_var="$3"
  local cookie_value="${!cookie_var:-}"
  local user_value="${!user_var:-}"
  local role_value="${!role_var:-}"
  local user_default=""
  local role_default=""

  if [[ -n "${cookie_value}" ]]; then
    return 0
  fi

  user_default="$(tp_default_placeholder "${user_var}")"
  role_default="$(tp_default_placeholder "${role_var}")"

  if [[ -z "${user_value}" ]]; then
    missing_vars+=("${user_var}")
  elif [[ "${user_value}" == "${user_default}" ]] || [[ "${user_value}" == __REPLACE_WITH_*__ ]]; then
    placeholder_vars+=("${user_var}")
  fi

  if [[ -z "${role_value}" ]]; then
    missing_vars+=("${role_var}")
  elif [[ "${role_value}" == "${role_default}" ]] || [[ "${role_value}" == __REPLACE_WITH_*__ ]]; then
    placeholder_vars+=("${role_var}")
  fi
}

if [[ -n "${RW_WITH_ROLLBACK:-}" ]] && [[ "${RW_WITH_ROLLBACK}" != "true" && "${RW_WITH_ROLLBACK}" != "false" ]]; then
  invalid_vars+=("RW_WITH_ROLLBACK=${RW_WITH_ROLLBACK}（仅支持 true/false）")
fi

if [[ -n "${RW_INSECURE:-}" ]] && [[ "${RW_INSECURE}" != "true" && "${RW_INSECURE}" != "false" ]]; then
  invalid_vars+=("RW_INSECURE=${RW_INSECURE}（仅支持 true/false）")
fi

rw_with_compat="${RW_WITH_COMPAT:-false}"
if [[ "${rw_with_compat}" != "false" && "${rw_with_compat}" != "observe" && "${rw_with_compat}" != "strict" ]]; then
  invalid_vars+=("RW_WITH_COMPAT=${rw_with_compat}（仅支持 false/observe/strict）")
fi

if [[ "${rw_with_compat}" != "false" ]]; then
  if [[ -z "${RW_PROMETHEUS_URL:-}" ]]; then
    missing_vars+=("RW_PROMETHEUS_URL（启用 compat 时必填）")
  fi

  if [[ -z "${RW_COMPAT_CRITICAL_AFTER:-}" ]]; then
    missing_vars+=("RW_COMPAT_CRITICAL_AFTER（启用 compat 时必填）")
  elif ! [[ "${RW_COMPAT_CRITICAL_AFTER}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    invalid_vars+=("RW_COMPAT_CRITICAL_AFTER=${RW_COMPAT_CRITICAL_AFTER}（必须为 YYYY-MM-DD）")
  fi

  if [[ -z "${RW_COMPAT_SHOW_LIMIT:-}" ]]; then
    missing_vars+=("RW_COMPAT_SHOW_LIMIT（启用 compat 时必填）")
  elif ! [[ "${RW_COMPAT_SHOW_LIMIT}" =~ ^[0-9]+$ ]] || [[ "${RW_COMPAT_SHOW_LIMIT}" -lt 1 ]]; then
    invalid_vars+=("RW_COMPAT_SHOW_LIMIT=${RW_COMPAT_SHOW_LIMIT}（必须为 >=1 的整数）")
  fi
fi

validate_optional_cookie "RW_OWNER_COOKIE"
validate_optional_cookie "RW_AUDITOR_COOKIE"
validate_header_identity_pair "RW_OWNER_USER" "RW_OWNER_ROLE" "RW_OWNER_COOKIE"
validate_header_identity_pair "RW_AUDITOR_USER" "RW_AUDITOR_ROLE" "RW_AUDITOR_COOKIE"

has_secret_helper="false"
has_secret_template="false"

if [[ -n "${RW_SECRET_HELPER:-}" ]]; then
  if [[ "${RW_SECRET_HELPER}" == "$(tp_default_placeholder RW_SECRET_HELPER)" ]] || [[ "${RW_SECRET_HELPER}" == __REPLACE_WITH_*__ ]]; then
    placeholder_vars+=("RW_SECRET_HELPER")
  else
    has_secret_helper="true"
    if [[ "${RW_SECRET_HELPER}" == */* ]]; then
      if [[ ! -e "${RW_SECRET_HELPER}" ]]; then
        invalid_vars+=("RW_SECRET_HELPER（路径不存在: ${RW_SECRET_HELPER}）")
      elif [[ ! -x "${RW_SECRET_HELPER}" ]]; then
        invalid_vars+=("RW_SECRET_HELPER（不可执行: ${RW_SECRET_HELPER}）")
      fi
    elif ! command -v "${RW_SECRET_HELPER}" >/dev/null 2>&1; then
      invalid_vars+=("RW_SECRET_HELPER（PATH 中不存在命令: ${RW_SECRET_HELPER}）")
    fi
  fi
fi

if [[ -n "${RW_SECRET_CMD_TEMPLATE:-}" ]]; then
  if [[ "${RW_SECRET_CMD_TEMPLATE}" == "$(tp_default_placeholder RW_SECRET_CMD_TEMPLATE)" ]] || [[ "${RW_SECRET_CMD_TEMPLATE}" == __REPLACE_WITH_*__ ]]; then
    placeholder_vars+=("RW_SECRET_CMD_TEMPLATE")
  else
    has_secret_template="true"
    if [[ "${RW_SECRET_CMD_TEMPLATE}" != *"{{secret_ref}}"* && "${RW_SECRET_CMD_TEMPLATE}" != *"%s"* ]]; then
      invalid_vars+=("RW_SECRET_CMD_TEMPLATE（必须包含 {{secret_ref}} 或 %s 占位符）")
    fi
  fi
fi

if [[ "${has_secret_helper}" != "true" && "${has_secret_template}" != "true" ]]; then
  missing_vars+=("RW_SECRET_HELPER（推荐）/RW_SECRET_CMD_TEMPLATE（兼容）")
fi

if [[ -n "${RW_WARNING_SECRET_REF:-}" && -n "${RW_CRITICAL_SECRET_REF:-}" ]] && \
   [[ "${RW_WARNING_SECRET_REF}" == "${RW_CRITICAL_SECRET_REF}" ]]; then
  invalid_vars+=("RW_WARNING_SECRET_REF / RW_CRITICAL_SECRET_REF（真实值班链路禁止复用同一 Secret 引用名）")
fi
if [[ -n "${RW_WARNING_SECRET_REF:-}" && -n "${RW_P1_SECRET_REF:-}" ]] && \
   [[ "${RW_WARNING_SECRET_REF}" == "${RW_P1_SECRET_REF}" ]]; then
  invalid_vars+=("RW_WARNING_SECRET_REF / RW_P1_SECRET_REF（真实值班链路禁止复用同一 Secret 引用名）")
fi
if [[ -n "${RW_CRITICAL_SECRET_REF:-}" && -n "${RW_P1_SECRET_REF:-}" ]] && \
   [[ "${RW_CRITICAL_SECRET_REF}" == "${RW_P1_SECRET_REF}" ]]; then
  invalid_vars+=("RW_CRITICAL_SECRET_REF / RW_P1_SECRET_REF（真实值班链路禁止复用同一 Secret 引用名）")
fi

show_next_steps() {
  local secret_arg=""
  local owner_auth_args=""
  local auditor_auth_args=""
  local compat_args=""
  local config_template_arg=""
  if [[ "${has_secret_helper}" == "true" ]]; then
    secret_arg='    --secret-helper "${RW_SECRET_HELPER}" \'
  else
    secret_arg='    --secret-cmd-template "${RW_SECRET_CMD_TEMPLATE}" \'
  fi
  config_template_arg='    --config-template "${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-./monitoring/alertmanager.yml}" \'
  if [[ -n "${RW_OWNER_COOKIE:-}" ]]; then
    owner_auth_args='    --owner-cookie "${RW_OWNER_COOKIE}" \'
  else
    owner_auth_args=$'    --owner-user "${RW_OWNER_USER}" \\\n    --owner-role "${RW_OWNER_ROLE}" \\'
  fi
  if [[ -n "${RW_AUDITOR_COOKIE:-}" ]]; then
    auditor_auth_args='    --auditor-cookie "${RW_AUDITOR_COOKIE}" \'
  else
    auditor_auth_args=$'    --auditor-user "${RW_AUDITOR_USER}" \\\n    --auditor-role "${RW_AUDITOR_ROLE}" \\'
  fi
  if [[ "${rw_with_compat}" != "false" ]]; then
    compat_args=$'    --with-compat "${RW_WITH_COMPAT:-false}" \\\n    --prometheus-url "${RW_PROMETHEUS_URL}" \\'
    if [[ -n "${RW_PROMETHEUS_BEARER_TOKEN:-}" ]]; then
      compat_args+=$'\n    --prometheus-bearer-token "${RW_PROMETHEUS_BEARER_TOKEN}" \\'
    fi
    compat_args+=$'\n    --compat-critical-after "${RW_COMPAT_CRITICAL_AFTER}" \\'
    compat_args+=$'\n    --compat-show-limit "${RW_COMPAT_SHOW_LIMIT}" \\'
  fi
  cat <<EOF_NEXT
下一步命令:
  source "${ENV_FILE}"
  ./scripts/release/release_window_oauth_alerts.sh \
    --base-url "\${RW_BASE_URL}" \
    --api-secret "\${RW_API_SECRET}" \
${owner_auth_args}
${auditor_auth_args}
    --warning-secret-ref "\${RW_WARNING_SECRET_REF}" \
    --critical-secret-ref "\${RW_CRITICAL_SECRET_REF}" \
    --p1-secret-ref "\${RW_P1_SECRET_REF}" \
${config_template_arg}
${secret_arg}
${compat_args}
    --with-rollback "\${RW_WITH_ROLLBACK:-false}" \
    --evidence-file "\${RW_EVIDENCE_FILE:-./artifacts/release-window-evidence.json}"
EOF_NEXT
}

if [[ "${#missing_vars[@]}" -gt 0 || "${#placeholder_vars[@]}" -gt 0 || "${#invalid_vars[@]}" -gt 0 ]]; then
  tp_log_error "预检失败：参数文件未准备完成 (${ENV_FILE})"

  if [[ "${#missing_vars[@]}" -gt 0 ]]; then
    tp_log_error "缺失变量:"
    for item in "${missing_vars[@]}"; do
      tp_log_error "  - ${item}"
    done
  fi

  if [[ "${#placeholder_vars[@]}" -gt 0 ]]; then
    tp_log_error "仍为默认占位值:"
    for item in "${placeholder_vars[@]}"; do
      tp_log_error "  - ${item}"
    done
  fi

  if [[ "${#invalid_vars[@]}" -gt 0 ]]; then
    tp_log_error "格式非法变量:"
    for item in "${invalid_vars[@]}"; do
      tp_log_error "  - ${item}"
    done
  fi

  tp_log_info "请先更新参数文件后重试："
  tp_log_info "  ./scripts/release/preflight_release_window_oauth_alerts.sh --env-file \"${ENV_FILE}\""
  exit 1
fi

alertmanager_config_template_path="${ALERTMANAGER_CONFIG_TEMPLATE_PATH:-${ALERTMANAGER_CONFIG_PATH:-./monitoring/alertmanager.yml}}"
alertmanager_templates_path="${ALERTMANAGER_TEMPLATES_PATH:-./monitoring/alertmanager-templates}"
render_temp_dir="$(mktemp -d)"
render_temp_config="${render_temp_dir}/alertmanager.rendered.yml"
render_cmd=(
  bash "${SCRIPT_DIR}/publish_alertmanager_secret_sync.sh"
  --api-secret "${RW_API_SECRET}"
  --warning-secret-ref "${RW_WARNING_SECRET_REF}"
  --critical-secret-ref "${RW_CRITICAL_SECRET_REF}"
  --p1-secret-ref "${RW_P1_SECRET_REF}"
  --config-template "${alertmanager_config_template_path}"
  --render-only
  --render-format yaml
  --render-output "${render_temp_config}"
)

cleanup_render_temp() {
  rm -rf "${render_temp_dir}"
}

trap cleanup_render_temp EXIT

tp_log_info "执行 Alertmanager 文件预检..."
if [[ -n "${RW_SECRET_HELPER:-}" ]]; then
  render_cmd+=(--secret-helper "${RW_SECRET_HELPER}")
fi
if [[ -n "${RW_SECRET_CMD_TEMPLATE:-}" ]]; then
  render_cmd+=(--secret-cmd-template "${RW_SECRET_CMD_TEMPLATE}")
fi

"${render_cmd[@]}"

bash "${SCRIPT_DIR}/preflight_alertmanager_config.sh" \
  --config-path "${render_temp_config}" \
  --templates-path "${alertmanager_templates_path}"

tp_log_info "预检通过：release window 参数与 Alertmanager 发布基线已就绪 (${ENV_FILE})"
if [[ "${has_secret_template}" == "true" && "${has_secret_helper}" != "true" ]]; then
  tp_log_warn "检测到 RW_SECRET_CMD_TEMPLATE；该变量已弃用，建议改为 RW_SECRET_HELPER"
fi
show_next_steps
