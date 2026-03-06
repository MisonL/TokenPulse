#!/usr/bin/env bash
set -euo pipefail

secret_ref="${1:-}"
if [[ -z "${secret_ref}" ]]; then
  echo "缺少 secret_ref 参数" >&2
  exit 1
fi

warning_ref="${TOKENPULSE_ALERTMANAGER_WARNING_SECRET_REF:-tokenpulse/prod/alertmanager_warning_webhook_url}"
critical_ref="${TOKENPULSE_ALERTMANAGER_CRITICAL_SECRET_REF:-tokenpulse/prod/alertmanager_critical_webhook_url}"
p1_ref="${TOKENPULSE_ALERTMANAGER_P1_SECRET_REF:-tokenpulse/prod/alertmanager_p1_webhook_url}"

env_var_name=""
case "${secret_ref}" in
  "${warning_ref}")
    env_var_name="TOKENPULSE_ALERTMANAGER_WARNING_WEBHOOK_URL"
    ;;
  "${critical_ref}")
    env_var_name="TOKENPULSE_ALERTMANAGER_CRITICAL_WEBHOOK_URL"
    ;;
  "${p1_ref}")
    env_var_name="TOKENPULSE_ALERTMANAGER_P1_WEBHOOK_URL"
    ;;
  *)
    echo "未知 secret_ref: ${secret_ref}" >&2
    echo "请通过 TOKENPULSE_ALERTMANAGER_*_SECRET_REF 环境变量覆盖默认映射" >&2
    exit 1
    ;;
esac

webhook_url="${!env_var_name:-}"
if [[ -z "${webhook_url}" ]]; then
  echo "缺少环境变量 ${env_var_name}" >&2
  exit 1
fi

printf '%s' "${webhook_url}"
