import type {
  AdminUserCreatePayload,
  AdminUserItem,
  TenantCreatePayload,
  TenantItem,
} from "../lib/client";

export interface EnterpriseUserCreateFormState {
  username: string;
  password: string;
  roleKey: string;
  tenantId: string;
  status: AdminUserItem["status"];
}

export interface EnterpriseTenantCreateFormState {
  name: string;
  status: TenantItem["status"];
}

export const DEFAULT_ENTERPRISE_USER_CREATE_FORM: EnterpriseUserCreateFormState = {
  username: "",
  password: "",
  roleKey: "operator",
  tenantId: "default",
  status: "active",
};

export const DEFAULT_ENTERPRISE_TENANT_CREATE_FORM: EnterpriseTenantCreateFormState = {
  name: "",
  status: "active",
};

export type EnterpriseMutationBuildResult<TPayload> =
  | { ok: true; value: TPayload }
  | { ok: false; error: string };

export const resetEnterpriseUserCreateForm = (): EnterpriseUserCreateFormState => ({
  ...DEFAULT_ENTERPRISE_USER_CREATE_FORM,
});

export const resetEnterpriseTenantCreateForm = (): EnterpriseTenantCreateFormState => ({
  ...DEFAULT_ENTERPRISE_TENANT_CREATE_FORM,
});

export const buildAdminUserCreatePayload = (
  form: EnterpriseUserCreateFormState,
): EnterpriseMutationBuildResult<AdminUserCreatePayload> => {
  const username = form.username.trim();
  const password = form.password.trim();
  if (!username || !password) {
    return { ok: false, error: "请填写用户名与密码" };
  }
  return {
    ok: true,
    value: {
      username,
      password: form.password,
      roleKey: form.roleKey,
      tenantId: form.tenantId,
      status: form.status,
    },
  };
};

export const buildTenantCreatePayload = (
  form: EnterpriseTenantCreateFormState,
): EnterpriseMutationBuildResult<TenantCreatePayload> => {
  const name = form.name.trim();
  if (!name) {
    return { ok: false, error: "请填写租户名称" };
  }
  return {
    ok: true,
    value: {
      name,
      status: form.status,
    },
  };
};

export const buildRemoveUserConfirmationMessage = (username: string) =>
  `确认删除用户 ${username} 吗？`;

export const buildRemoveTenantConfirmationMessage = (tenantId: string) =>
  `确认删除租户 ${tenantId} 吗？`;
