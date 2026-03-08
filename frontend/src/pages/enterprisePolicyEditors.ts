import type {
  QuotaPolicyCreatePayload,
  QuotaPolicyItem,
  QuotaPolicyUpdatePayload,
} from "../lib/client";
import {
  normalizePolicyScopeInput,
  parseOptionalNonNegativeInteger,
} from "./enterprisePolicyValidators";

export interface EnterprisePolicyCreateFormState {
  name: string;
  scopeType: QuotaPolicyItem["scopeType"];
  scopeValue: string;
  provider: string;
  modelPattern: string;
  requestsPerMinute: string;
  tokensPerMinute: string;
  tokensPerDay: string;
  enabled: boolean;
}

export interface EnterprisePolicyEditFormState {
  requestsPerMinute: string;
  tokensPerMinute: string;
  tokensPerDay: string;
  enabled: boolean;
}

export type EnterprisePolicyPayloadBuildResult<TPayload> =
  | { ok: true; value: TPayload }
  | { ok: false; error: string };

export function buildQuotaPolicyCreatePayload(
  form: EnterprisePolicyCreateFormState,
): EnterprisePolicyPayloadBuildResult<QuotaPolicyCreatePayload> {
  if (!form.name.trim()) {
    return { ok: false, error: "请填写策略名称" };
  }

  const scopeValidation = normalizePolicyScopeInput(form.scopeType, form.scopeValue);
  if (!scopeValidation.ok) {
    return { ok: false, error: scopeValidation.error };
  }

  const rpm = parseOptionalNonNegativeInteger(form.requestsPerMinute, "RPM");
  if (!rpm.ok) {
    return { ok: false, error: rpm.error };
  }

  const tpm = parseOptionalNonNegativeInteger(form.tokensPerMinute, "TPM");
  if (!tpm.ok) {
    return { ok: false, error: tpm.error };
  }

  const tpd = parseOptionalNonNegativeInteger(form.tokensPerDay, "TPD");
  if (!tpd.ok) {
    return { ok: false, error: tpd.error };
  }

  return {
    ok: true,
    value: {
      name: form.name.trim(),
      scopeType: form.scopeType,
      scopeValue: scopeValidation.value,
      provider: form.provider.trim() || undefined,
      modelPattern: form.modelPattern.trim() || undefined,
      requestsPerMinute: rpm.value,
      tokensPerMinute: tpm.value,
      tokensPerDay: tpd.value,
      enabled: form.enabled,
    },
  };
}

export function buildQuotaPolicyUpdatePayload(
  form: EnterprisePolicyEditFormState,
): EnterprisePolicyPayloadBuildResult<QuotaPolicyUpdatePayload> {
  const rpm = parseOptionalNonNegativeInteger(form.requestsPerMinute, "RPM");
  if (!rpm.ok) {
    return { ok: false, error: rpm.error };
  }

  const tpm = parseOptionalNonNegativeInteger(form.tokensPerMinute, "TPM");
  if (!tpm.ok) {
    return { ok: false, error: tpm.error };
  }

  const tpd = parseOptionalNonNegativeInteger(form.tokensPerDay, "TPD");
  if (!tpd.ok) {
    return { ok: false, error: tpd.error };
  }

  return {
    ok: true,
    value: {
      requestsPerMinute: rpm.value,
      tokensPerMinute: tpm.value,
      tokensPerDay: tpd.value,
      enabled: form.enabled,
    },
  };
}
