import type { AdminUserItem, AdminUserUpdatePayload, RoleBindingItem } from "../lib/client";

export interface EnterpriseUserEditFormState {
  displayName: string;
  roleKey: string;
  tenantId: string;
  roleBindingsText: string;
  tenantIdsText: string;
  initialRoleBindingsText: string;
  initialTenantIdsText: string;
  status: "active" | "disabled";
  password: string;
}

export const DEFAULT_ENTERPRISE_USER_EDIT_FORM: EnterpriseUserEditFormState = {
  displayName: "",
  roleKey: "operator",
  tenantId: "default",
  roleBindingsText: "operator@default",
  tenantIdsText: "default",
  initialRoleBindingsText: "operator@default",
  initialTenantIdsText: "default",
  status: "active",
  password: "",
};

export const formatRoleBindingsText = (roles: RoleBindingItem[]) =>
  roles.length > 0
    ? roles.map((item) => `${item.roleKey}@${item.tenantId || "default"}`).join(",")
    : DEFAULT_ENTERPRISE_USER_EDIT_FORM.roleBindingsText;

export const formatTenantIdsText = (roles: RoleBindingItem[]) =>
  Array.from(new Set(roles.map((item) => item.tenantId || "default").filter(Boolean))).join(",") ||
  DEFAULT_ENTERPRISE_USER_EDIT_FORM.tenantIdsText;

export const createEnterpriseUserEditForm = (
  user: AdminUserItem,
): EnterpriseUserEditFormState => {
  const firstBinding = user.roles[0];
  return {
    displayName: user.displayName?.trim() || "",
    roleKey: firstBinding?.roleKey || DEFAULT_ENTERPRISE_USER_EDIT_FORM.roleKey,
    tenantId: firstBinding?.tenantId || DEFAULT_ENTERPRISE_USER_EDIT_FORM.tenantId,
    roleBindingsText: formatRoleBindingsText(user.roles),
    tenantIdsText: formatTenantIdsText(user.roles),
    initialRoleBindingsText: formatRoleBindingsText(user.roles),
    initialTenantIdsText: formatTenantIdsText(user.roles),
    status: user.status,
    password: "",
  };
};

export const resetEnterpriseUserEditForm = (): EnterpriseUserEditFormState => ({
  ...DEFAULT_ENTERPRISE_USER_EDIT_FORM,
});

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
  const normalizedRoleBindingsText = roleBindings
    .map((item) => `${item.roleKey}@${item.tenantId || "default"}`)
    .join(",");
  const normalizedTenantIdsText = tenantIds.join(",");
  const initialRoleBindingsText = parseRoleBindingsText(form.initialRoleBindingsText)
    .map((item) => `${item.roleKey}@${item.tenantId || "default"}`)
    .join(",");
  const initialTenantIdsText = parseTenantIdsText(form.initialTenantIdsText).join(",");
  const payload: AdminUserUpdatePayload = {
    displayName: form.displayName.trim() || undefined,
    status: form.status,
    password: form.password || undefined,
  };

  const bindingsChanged =
    normalizedRoleBindingsText !== initialRoleBindingsText ||
    normalizedTenantIdsText !== initialTenantIdsText;

  if (bindingsChanged && (roleBindings.length > 0 || tenantIds.length > 0)) {
    if (roleBindings.length > 0) {
      payload.roleBindings = roleBindings;
    }
    if (tenantIds.length > 0) {
      payload.tenantIds = tenantIds;
    }
    return payload;
  }

  if (bindingsChanged) {
    payload.roleKey = form.roleKey;
    payload.tenantId = form.tenantId;
  }
  return payload;
};
