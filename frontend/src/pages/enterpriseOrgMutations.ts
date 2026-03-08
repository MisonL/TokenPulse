import type {
  AdminUserItem,
  OrgMemberBindingItem,
  OrgOrganizationItem,
  OrgProjectItem,
} from "../lib/client";

export interface EnterpriseOrgCreateFormState {
  name: string;
}

export interface EnterpriseOrgProjectCreateFormState {
  name: string;
  organizationId: string;
}

export interface EnterpriseOrgMemberCreateFormState {
  organizationId: string;
  userId: string;
}

export const DEFAULT_ENTERPRISE_ORG_CREATE_FORM: EnterpriseOrgCreateFormState = {
  name: "",
};

export const DEFAULT_ENTERPRISE_ORG_PROJECT_CREATE_FORM: EnterpriseOrgProjectCreateFormState = {
  name: "",
  organizationId: "",
};

export const DEFAULT_ENTERPRISE_ORG_MEMBER_CREATE_FORM: EnterpriseOrgMemberCreateFormState = {
  organizationId: "",
  userId: "",
};

export type EnterpriseOrgMutationBuildResult<TPayload> =
  | { ok: true; value: TPayload }
  | { ok: false; error: string };

export const resetEnterpriseOrgCreateForm = (): EnterpriseOrgCreateFormState => ({
  ...DEFAULT_ENTERPRISE_ORG_CREATE_FORM,
});

export const resetEnterpriseOrgProjectCreateForm = (): EnterpriseOrgProjectCreateFormState => ({
  ...DEFAULT_ENTERPRISE_ORG_PROJECT_CREATE_FORM,
});

export const resetEnterpriseOrgMemberCreateForm = (): EnterpriseOrgMemberCreateFormState => ({
  ...DEFAULT_ENTERPRISE_ORG_MEMBER_CREATE_FORM,
});

export const buildOrganizationCreatePayload = (
  form: EnterpriseOrgCreateFormState,
): EnterpriseOrgMutationBuildResult<{ name: string }> => {
  const name = form.name.trim();
  if (!name) {
    return { ok: false, error: "请填写组织名称" };
  }
  return { ok: true, value: { name } };
};

export const buildProjectCreatePayload = (
  form: EnterpriseOrgProjectCreateFormState,
): EnterpriseOrgMutationBuildResult<{ name: string; organizationId: string }> => {
  const organizationId = form.organizationId.trim().toLowerCase();
  const name = form.name.trim();
  if (!organizationId) {
    return { ok: false, error: "请先选择组织" };
  }
  if (!name) {
    return { ok: false, error: "请填写项目名称" };
  }
  return {
    ok: true,
    value: {
      name,
      organizationId,
    },
  };
};

export const resolveOrgMemberDisplayName = (
  userId: string,
  users: AdminUserItem[],
): EnterpriseOrgMutationBuildResult<{
  userId: string;
  displayName?: string;
}> => {
  const normalizedUserId = userId.trim().toLowerCase();
  if (!normalizedUserId) {
    return { ok: false, error: "请先选择管理员用户" };
  }
  const selectedUser = users.find((item) => item.id === normalizedUserId);
  return {
    ok: true,
    value: {
      userId: normalizedUserId,
      displayName: selectedUser?.displayName?.trim() || selectedUser?.username || undefined,
    },
  };
};

export const buildMemberCreatePayload = (
  form: EnterpriseOrgMemberCreateFormState,
  users: AdminUserItem[],
): EnterpriseOrgMutationBuildResult<{
  organizationId: string;
  userId: string;
  displayName?: string;
}> => {
  const organizationId = form.organizationId.trim().toLowerCase();
  if (!organizationId) {
    return { ok: false, error: "请先选择组织" };
  }
  const userResult = resolveOrgMemberDisplayName(form.userId, users);
  if (!userResult.ok) {
    return userResult;
  }
  return {
    ok: true,
    value: {
      organizationId,
      ...userResult.value,
    },
  };
};

export const buildRemoveOrganizationConfirmationMessage = (organization: OrgOrganizationItem) =>
  `确认删除组织 ${organization.name} (${organization.id}) 吗？`;

export const buildToggleOrganizationStatusConfirmationMessage = (
  organization: OrgOrganizationItem,
) => {
  const nextStatus = organization.status === "disabled" ? "active" : "disabled";
  return nextStatus === "disabled"
    ? `确认禁用组织 ${organization.name} (${organization.id}) 吗？禁用后将阻止新增项目、成员和成员项目绑定，但不会删除既有数据。`
    : `确认启用组织 ${organization.name} (${organization.id}) 吗？启用后可继续新增项目、成员和成员项目绑定。`;
};

export const buildRemoveProjectConfirmationMessage = (project: OrgProjectItem) =>
  `确认删除项目 ${project.name} (${project.id}) 吗？`;

export const buildToggleProjectStatusConfirmationMessage = (project: OrgProjectItem) => {
  const nextStatus = project.status === "disabled" ? "active" : "disabled";
  return nextStatus === "disabled"
    ? `确认禁用项目 ${project.name} (${project.id}) 吗？禁用后将阻止新增成员项目绑定，但不会删除既有绑定。`
    : `确认启用项目 ${project.name} (${project.id}) 吗？启用后可继续新增成员项目绑定。`;
};

export const buildRemoveMemberConfirmationMessage = (member: OrgMemberBindingItem) =>
  `确认删除成员 ${member.username} (${member.memberId}) 吗？`;
