#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Alertmanager 发布前预检脚本（文件存在性 + 占位值扫描）

用法:
  ./scripts/release/preflight_alertmanager_config.sh [参数]

参数:
  --config-path <path>      Alertmanager 配置文件路径。
                            默认读取环境变量 ALERTMANAGER_CONFIG_PATH，未设置时回退到 ./monitoring/alertmanager.yml
  --templates-path <path>   Alertmanager 模板目录路径。
                            默认读取环境变量 ALERTMANAGER_TEMPLATES_PATH，未设置时回退到 ./monitoring/alertmanager-templates
  --help                    显示帮助

说明:
  1) 该脚本只做离线预检，不会 reload 或启动 Alertmanager。
  2) 会拒绝仓库示例配置、本地演练配置、空 URL、明显占位值与保留示例域名。
  3) 预检失败时返回非 0，适合挂在发布 gate 前置步骤。
USAGE
}

CONFIG_PATH_INPUT="${ALERTMANAGER_CONFIG_PATH:-./monitoring/alertmanager.yml}"
TEMPLATES_PATH_INPUT="${ALERTMANAGER_TEMPLATES_PATH:-./monitoring/alertmanager-templates}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-path)
      CONFIG_PATH_INPUT="${2:-}"
      shift 2
      ;;
    --templates-path)
      TEMPLATES_PATH_INPUT="${2:-}"
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

tp_require_cmd awk

tp_trim_text() {
  local text="$1"
  text="${text#"${text%%[![:space:]]*}"}"
  text="${text%"${text##*[![:space:]]}"}"
  printf '%s' "${text}"
}

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

declare -a validation_errors=()

tp_add_error() {
  validation_errors+=("$1")
}

tp_scan_pattern() {
  local file_path="$1"
  local label="$2"
  local pattern="$3"
  local mode="${4:-case-sensitive}"
  local line=""
  local matches=""

  matches="$(
    awk -v pattern="${pattern}" -v mode="${mode}" '
      {
        raw = $0
        trimmed = raw
        sub(/^[[:space:]]+/, "", trimmed)
        if (trimmed == "" || trimmed ~ /^#/) {
          next
        }

        haystack = raw
        if (mode == "case-insensitive") {
          haystack = tolower(raw)
        }

        if (haystack ~ pattern) {
          printf "%d|%s\n", NR, raw
        }
      }
    ' "${file_path}"
  )" || tp_fail "预检执行失败：无法扫描配置文件 ${file_path}"

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    local line_no="${line%%|*}"
    local text="${line#*|}"
    text="$(tp_trim_text "${text}")"
    tp_add_error "${label}（第 ${line_no} 行）：${text}"
  done <<< "${matches}"
}

tp_scan_url_values() {
  local file_path="$1"
  local line=""
  local matches=""

  matches="$(
    awk '
      function ltrim(s) {
        sub(/^[[:space:]]+/, "", s)
        return s
      }
      function rtrim(s) {
        sub(/[[:space:]]+$/, "", s)
        return s
      }
      function trim(s) {
        return rtrim(ltrim(s))
      }
      function dequote(s) {
        s = trim(s)
        if (s ~ /^".*"$/) {
          return substr(s, 2, length(s) - 2)
        }
        if (s ~ /^'"'"'.*'"'"'$/) {
          return substr(s, 2, length(s) - 2)
        }
        return s
      }
      {
        raw = $0
        trimmed = trim(raw)
        lowered = tolower(trimmed)
        if (trimmed == "" || lowered ~ /^#/) {
          next
        }
        if (lowered !~ /^-?[[:space:]]*(url|api_url|webhook_url)[[:space:]]*:/) {
          next
        }

        value = trimmed
        sub(/^-?[[:space:]]*(url|api_url|webhook_url)[[:space:]]*:[[:space:]]*/, "", value)
        value = trim(value)
        normalized = dequote(value)
        normalized_lower = tolower(normalized)

        if (value == "" || value == "\"\"" || value == "''" || value ~ /^#/) {
          printf "empty|%d|%s\n", NR, raw
          next
        }

        if (normalized_lower ~ /example\.(invalid|com)/) {
          printf "example_domain|%d|%s\n", NR, raw
        }

        is_local = normalized_lower ~ /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)([:\/]|$)/
        is_local = is_local || normalized_lower ~ /^https?:\/\/host\.docker\.internal([:\/]|$)/
        is_local = is_local || normalized_lower ~ /^https?:\/\/\[::1\]([:\/]|$)/
        if (is_local) {
          printf "local_drill|%d|%s\n", NR, raw
        }
      }
    ' "${file_path}"
  )" || tp_fail "预检执行失败：无法解析配置文件 ${file_path}"

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    local kind="${line%%|*}"
    local remainder="${line#*|}"
    local line_no="${remainder%%|*}"
    local text="${remainder#*|}"
    text="$(tp_trim_text "${text}")"

    case "${kind}" in
      empty)
        tp_add_error "检测到空 URL（第 ${line_no} 行）：${text}"
        ;;
      example_domain)
        tp_add_error "检测到保留示例域名 example.invalid/example.com（第 ${line_no} 行）：${text}"
        ;;
      local_drill)
        tp_add_error "检测到本地演练 URL，不允许直接用于发布（第 ${line_no} 行）：${text}"
        ;;
      *)
        tp_add_error "检测到可疑 URL 配置（第 ${line_no} 行）：${text}"
        ;;
    esac
  done <<< "${matches}"
}

if [[ -z "${CONFIG_PATH_INPUT}" ]]; then
  tp_add_error "ALERTMANAGER_CONFIG_PATH 不能为空"
fi

if [[ -z "${TEMPLATES_PATH_INPUT}" ]]; then
  tp_add_error "ALERTMANAGER_TEMPLATES_PATH 不能为空"
fi

CONFIG_PATH_ABS="$(tp_resolve_repo_path "${CONFIG_PATH_INPUT}")"
TEMPLATES_PATH_ABS="$(tp_resolve_repo_path "${TEMPLATES_PATH_INPUT}")"

if [[ -n "${CONFIG_PATH_INPUT}" ]]; then
  case "${CONFIG_PATH_INPUT}" in
    *.example.yml|*.example.yaml)
      tp_add_error "ALERTMANAGER_CONFIG_PATH 当前指向示例/演练配置（${CONFIG_PATH_INPUT}），发布前请改为运行时注入的生产文件"
      ;;
  esac
fi

if [[ -n "${CONFIG_PATH_ABS}" && ! -e "${CONFIG_PATH_ABS}" ]]; then
  tp_add_error "ALERTMANAGER_CONFIG_PATH 指向的文件不存在：${CONFIG_PATH_INPUT}（解析后：${CONFIG_PATH_ABS}）"
elif [[ -n "${CONFIG_PATH_ABS}" && ! -f "${CONFIG_PATH_ABS}" ]]; then
  tp_add_error "ALERTMANAGER_CONFIG_PATH 必须指向文件：${CONFIG_PATH_INPUT}（解析后：${CONFIG_PATH_ABS}）"
fi

if [[ -n "${TEMPLATES_PATH_ABS}" && ! -e "${TEMPLATES_PATH_ABS}" ]]; then
  tp_add_error "ALERTMANAGER_TEMPLATES_PATH 指向的目录不存在：${TEMPLATES_PATH_INPUT}（解析后：${TEMPLATES_PATH_ABS}）"
elif [[ -n "${TEMPLATES_PATH_ABS}" && ! -d "${TEMPLATES_PATH_ABS}" ]]; then
  tp_add_error "ALERTMANAGER_TEMPLATES_PATH 必须指向目录：${TEMPLATES_PATH_INPUT}（解析后：${TEMPLATES_PATH_ABS}）"
fi

if [[ -f "${CONFIG_PATH_ABS}" ]]; then
  tp_scan_pattern "${CONFIG_PATH_ABS}" "检测到明显占位配置" "(replace_with|__replace_with_|changeme|placeholder|your[-_ ]?webhook|dummy[-_ ]?webhook|todo[-_ ]?webhook|<webhook)" "case-insensitive"
  tp_scan_url_values "${CONFIG_PATH_ABS}"
fi

if [[ "${#validation_errors[@]}" -gt 0 ]]; then
  tp_log_error "Alertmanager 发布前预检失败"
  for item in "${validation_errors[@]}"; do
    tp_log_error "  - ${item}"
  done
  tp_log_info "修复建议："
  tp_log_info "  1) ALERTMANAGER_CONFIG_PATH 指向运行时注入的生产配置文件，不要直接使用仓库中的 *.example.yml。"
  tp_log_info "  2) ALERTMANAGER_TEMPLATES_PATH 指向可读模板目录，至少保证与当前配置中 templates 引用一致。"
  tp_log_info "  3) 生产配置内不要保留 example.invalid/example.com、本地 webhook sink 或 REPLACE_WITH 类占位值。"
  exit 1
fi

tp_log_info "Alertmanager 发布前预检通过"
tp_log_info "  配置文件: ${CONFIG_PATH_INPUT}"
tp_log_info "  模板目录: ${TEMPLATES_PATH_INPUT}"
