import type { QuotaPolicyItem } from "../lib/client";

export type OptionalNonNegativeIntegerParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

export type PolicyScopeNormalizationResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

export function parseOptionalNonNegativeInteger(
  rawValue: string,
  label: string,
): OptionalNonNegativeIntegerParseResult {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${label} 必须是非负整数` };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: `${label} 数值过大` };
  }
  return { ok: true, value };
}

export function normalizePolicyScopeInput(
  scopeType: QuotaPolicyItem["scopeType"],
  scopeValue: string,
): PolicyScopeNormalizationResult {
  const trimmed = scopeValue.trim();
  if (scopeType === "global") {
    if (trimmed) {
      return { ok: false, error: "scopeType=global 时 scopeValue 必须留空" };
    }
    return { ok: true, value: undefined };
  }
  if (!trimmed) {
    return { ok: false, error: `scopeType=${scopeType} 时必须填写 scopeValue` };
  }
  if (scopeType === "role") {
    return { ok: true, value: trimmed.toLowerCase() };
  }
  return { ok: true, value: trimmed };
}
