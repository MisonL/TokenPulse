import type { AdminUserUpdatePayload, RoleBindingItem } from "../lib/client";

export interface EnterpriseUserEditFormState {
  roleKey: string;
  tenantId: string;
  roleBindingsText: string;
  tenantIdsText: string;
  status: "active" | "disabled";
  password: string;
}

export const parseRoleBindingsText = (value: string): RoleBindingItem[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [roleRaw, tenantRaw] = item.split("@");
      return {
        roleKey: (roleRaw || "operator").trim().toLowerCase(),
        tenantId: (tenantRaw || "default").trim(),
      };
    });

export const parseTenantIdsText = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const buildAdminUserUpdatePayload = (
  form: EnterpriseUserEditFormState,
): AdminUserUpdatePayload => {
  const roleBindings = parseRoleBindingsText(form.roleBindingsText);
  const tenantIds = parseTenantIdsText(form.tenantIdsText);
  const payload: AdminUserUpdatePayload = {
    status: form.status,
    password: form.password || undefined,
  };

  if (roleBindings.length > 0 || tenantIds.length > 0) {
    if (roleBindings.length > 0) {
      payload.roleBindings = roleBindings;
    }
    if (tenantIds.length > 0) {
      payload.tenantIds = tenantIds;
    }
    return payload;
  }

  payload.roleKey = form.roleKey;
  payload.tenantId = form.tenantId;
  return payload;
};
