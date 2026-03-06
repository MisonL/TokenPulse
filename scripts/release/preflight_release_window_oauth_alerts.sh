#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
  3) 通过参数校验后，会继续执行 Alertmanager 文件预检（配置文件/模板目录/占位 webhook）。
  4) 通过后仅输出下一步命令，不会发起任何线上 API 调用。
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

# shellcheck disable=SC1090
source "${ENV_FILE}"

tp_require_cmd bash

declare -a required_vars=(
  "RW_BASE_URL"
  "RW_API_SECRET"
  "RW_OWNER_USER"
  "RW_OWNER_ROLE"
  "RW_AUDITOR_USER"
  "RW_AUDITOR_ROLE"
  "RW_WARNING_SECRET_REF"
  "RW_CRITICAL_SECRET_REF"
  "RW_P1_SECRET_REF"
  "RW_SECRET_CMD_TEMPLATE"
)

tp_default_placeholder() {
  case "$1" in
    RW_BASE_URL) printf '%s' "https://core.example.com" ;;
    RW_API_SECRET) printf '%s' "__REPLACE_WITH_API_SECRET__" ;;
    RW_OWNER_USER) printf '%s' "__REPLACE_WITH_OWNER_USER__" ;;
    RW_OWNER_ROLE) printf '%s' "__REPLACE_WITH_OWNER_ROLE__" ;;
    RW_AUDITOR_USER) printf '%s' "__REPLACE_WITH_AUDITOR_USER__" ;;
    RW_AUDITOR_ROLE) printf '%s' "__REPLACE_WITH_AUDITOR_ROLE__" ;;
    RW_WARNING_SECRET_REF) printf '%s' "__REPLACE_WITH_WARNING_SECRET_REF__" ;;
    RW_CRITICAL_SECRET_REF) printf '%s' "__REPLACE_WITH_CRITICAL_SECRET_REF__" ;;
    RW_P1_SECRET_REF) printf '%s' "__REPLACE_WITH_P1_SECRET_REF__" ;;
    RW_SECRET_CMD_TEMPLATE) printf '%s' "__REPLACE_WITH_SECRET_CMD_TEMPLATE__" ;;
    *) printf '%s' "" ;;
  esac
}

declare -a missing_vars=()
declare -a placeholder_vars=()
declare -a invalid_vars=()

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

if [[ -n "${RW_WITH_ROLLBACK:-}" ]] && [[ "${RW_WITH_ROLLBACK}" != "true" && "${RW_WITH_ROLLBACK}" != "false" ]]; then
  invalid_vars+=("RW_WITH_ROLLBACK=${RW_WITH_ROLLBACK}（仅支持 true/false）")
fi

if [[ -n "${RW_INSECURE:-}" ]] && [[ "${RW_INSECURE}" != "true" && "${RW_INSECURE}" != "false" ]]; then
  invalid_vars+=("RW_INSECURE=${RW_INSECURE}（仅支持 true/false）")
fi

if [[ -n "${RW_SECRET_CMD_TEMPLATE:-}" ]]; then
  if [[ "${RW_SECRET_CMD_TEMPLATE}" != __REPLACE_WITH_*__ ]]; then
    if [[ "${RW_SECRET_CMD_TEMPLATE}" != *"{{secret_ref}}"* && "${RW_SECRET_CMD_TEMPLATE}" != *"%s"* ]]; then
      invalid_vars+=("RW_SECRET_CMD_TEMPLATE（必须包含 {{secret_ref}} 或 %s 占位符）")
    fi
  fi
fi

show_next_steps() {
  cat <<EOF_NEXT
下一步命令:
  source "${ENV_FILE}"
  ./scripts/release/release_window_oauth_alerts.sh \
    --base-url "\${RW_BASE_URL}" \
    --api-secret "\${RW_API_SECRET}" \
    --owner-user "\${RW_OWNER_USER}" \
    --owner-role "\${RW_OWNER_ROLE}" \
    --auditor-user "\${RW_AUDITOR_USER}" \
    --auditor-role "\${RW_AUDITOR_ROLE}" \
    --warning-secret-ref "\${RW_WARNING_SECRET_REF}" \
    --critical-secret-ref "\${RW_CRITICAL_SECRET_REF}" \
    --p1-secret-ref "\${RW_P1_SECRET_REF}" \
    --secret-cmd-template "\${RW_SECRET_CMD_TEMPLATE}" \
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

alertmanager_config_path="${ALERTMANAGER_CONFIG_PATH:-./monitoring/alertmanager.yml}"
alertmanager_templates_path="${ALERTMANAGER_TEMPLATES_PATH:-./monitoring/alertmanager-templates}"

tp_log_info "执行 Alertmanager 文件预检..."
bash "${SCRIPT_DIR}/preflight_alertmanager_config.sh" \
  --config-path "${alertmanager_config_path}" \
  --templates-path "${alertmanager_templates_path}"

tp_log_info "预检通过：release window 参数与 Alertmanager 发布文件已就绪 (${ENV_FILE})"
show_next_steps
