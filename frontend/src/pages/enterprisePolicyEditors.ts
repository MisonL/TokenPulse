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

export const DEFAULT_ENTERPRISE_POLICY_CREATE_FORM: EnterprisePolicyCreateFormState = {
  name: "",
  scopeType: "global",
  scopeValue: "",
  provider: "",
  modelPattern: "",
  requestsPerMinute: "",
  tokensPerMinute: "",
  tokensPerDay: "",
  enabled: true,
};

export const DEFAULT_ENTERPRISE_POLICY_EDIT_FORM: EnterprisePolicyEditFormState = {
  name: "",
  scopeType: "global",
  scopeValue: "",
  provider: "",
  modelPattern: "",
  requestsPerMinute: "",
  tokensPerMinute: "",
  tokensPerDay: "",
  enabled: true,
};

export type EnterprisePolicyPayloadBuildResult<TPayload> =
  | { ok: true; value: TPayload }
  | { ok: false; error: string };

export function resetEnterprisePolicyCreateForm(): EnterprisePolicyCreateFormState {
  return { ...DEFAULT_ENTERPRISE_POLICY_CREATE_FORM };
}

export function resetEnterprisePolicyEditForm(): EnterprisePolicyEditFormState {
  return { ...DEFAULT_ENTERPRISE_POLICY_EDIT_FORM };
}

export function createEnterprisePolicyEditForm(
  policy: QuotaPolicyItem,
): EnterprisePolicyEditFormState {
  return {
    name: policy.name,
    scopeType: policy.scopeType,
    scopeValue: policy.scopeValue || "",
    provider: policy.provider || "",
    modelPattern: policy.modelPattern || "",
    requestsPerMinute:
      policy.requestsPerMinute === null || policy.requestsPerMinute === undefined
        ? ""
        : String(policy.requestsPerMinute),
    tokensPerMinute:
      policy.tokensPerMinute === null || policy.tokensPerMinute === undefined
        ? ""
        : String(policy.tokensPerMinute),
    tokensPerDay:
      policy.tokensPerDay === null || policy.tokensPerDay === undefined
        ? ""
        : String(policy.tokensPerDay),
    enabled: policy.enabled !== false,
  };
}

export function buildRemovePolicyConfirmationMessage(policyId: string): string {
  return `确认删除策略 ${policyId} 吗？`;
}

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
