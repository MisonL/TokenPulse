import { Trash2 } from "lucide-react";
import type {
  AdminUserItem,
  OrgMemberBindingItem,
  OrgOrganizationItem,
  OrgProjectItem,
} from "../../lib/client";

interface OrgMemberCreateFormValue {
  organizationId: string;
  userId: string;
}

interface OrgMemberEditFormValue {
  organizationId: string;
  projectIds: string[];
}

interface OrgMembersSectionProps {
  title?: string;
  writeHint?: string;
  writeDisabled: boolean;
  organizations: OrgOrganizationItem[];
  users: AdminUserItem[];
  projects: OrgProjectItem[];
  editableProjectsForMember: OrgProjectItem[];
  memberBindings: OrgMemberBindingItem[];
  createForm: OrgMemberCreateFormValue;
  editForm: OrgMemberEditFormValue;
  editingMemberId: string | null;
  resolveAdminUserLabel: (userId: string, users: AdminUserItem[]) => string;
  resolveOrganizationDisplayName: (
    organizationId: string,
    organizations: OrgOrganizationItem[],
  ) => string;
  resolveProjectDisplay: (projectIds: string[], projects: OrgProjectItem[]) => string;
  onCreateFormChange: (patch: Partial<OrgMemberCreateFormValue>) => void;
  onCreate: () => void;
  onStartEdit: (member: OrgMemberBindingItem) => void;
  onCancelEdit: () => void;
  onEditOrganizationChange: (organizationId: string) => void;
  onToggleEditProject: (projectId: string, checked: boolean) => void;
  onSaveEdit: (memberId: string) => void;
  onViewAudit: (member: OrgMemberBindingItem) => void;
  onViewBindingAudit: (member: OrgMemberBindingItem) => void;
  onRemove: (member: OrgMemberBindingItem) => void;
}

export function OrgMembersSection({
  title = "成员管理与绑定",
  writeHint = "",
  writeDisabled,
  organizations,
  users,
  projects,
  editableProjectsForMember,
  memberBindings,
  createForm,
  editForm,
  editingMemberId,
  resolveAdminUserLabel,
  resolveOrganizationDisplayName,
  resolveProjectDisplay,
  onCreateFormChange,
  onCreate,
  onStartEdit,
  onCancelEdit,
  onEditOrganizationChange,
  onToggleEditProject,
  onSaveEdit,
  onViewAudit,
  onViewBindingAudit,
  onRemove,
}: OrgMembersSectionProps) {
  return (
    <div className="border-2 border-black p-4 space-y-3">
      <h4 className="text-lg font-black uppercase">{title}</h4>
      {writeHint ? (
        <p className="text-[10px] font-bold text-amber-700">{writeHint}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2">
        <select
          className="b-input h-10"
          disabled={writeDisabled}
          value={createForm.organizationId}
          onChange={(e) => onCreateFormChange({ organizationId: e.target.value })}
        >
          <option value="">选择组织</option>
          {organizations.map((organization) => (
            <option
              key={organization.id}
              value={organization.id}
              disabled={organization.status === "disabled"}
            >
              {organization.name} ({organization.id})
              {organization.status === "disabled" ? " · disabled" : ""}
            </option>
          ))}
        </select>
        <select
          className="b-input h-10"
          disabled={writeDisabled}
          value={createForm.userId}
          onChange={(e) => onCreateFormChange({ userId: e.target.value })}
        >
          <option value="">选择管理员用户</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {resolveAdminUserLabel(user.id, users)}
            </option>
          ))}
        </select>
        <button
          className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
          disabled={writeDisabled}
          onClick={onCreate}
        >
          创建成员
        </button>
      </div>
      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-black text-white uppercase">
            <tr>
              <th className="p-2">成员</th>
              <th className="p-2">组织</th>
              <th className="p-2">项目</th>
              <th className="p-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20">
            {memberBindings.map((member) => (
              <tr key={member.memberId}>
                <td className="p-2">
                  <p className="font-bold">{member.username}</p>
                  <p className="font-mono text-[10px] text-gray-500">{member.memberId}</p>
                  <p className="text-[10px] text-gray-500">
                    {member.userId ? `userId: ${member.userId}` : member.email || "未绑定 userId"}
                    {" · "}
                    {(member.status || "active") === "disabled" ? "disabled" : "active"}
                  </p>
                </td>
                <td className="p-2">
                  {editingMemberId === member.memberId ? (
                    <select
                      className="b-input h-8 text-xs w-40"
                      disabled={writeDisabled}
                      value={editForm.organizationId}
                      onChange={(e) => onEditOrganizationChange(e.target.value)}
                    >
                      <option value="">选择组织</option>
                      {organizations.map((organization) => (
                        <option
                          key={organization.id}
                          value={organization.id}
                          disabled={organization.status === "disabled"}
                        >
                          {organization.name}
                          {organization.status === "disabled" ? " · disabled" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-mono">
                      {resolveOrganizationDisplayName(member.organizationId, organizations)}
                    </span>
                  )}
                </td>
                <td className="p-2">
                  {editingMemberId === member.memberId ? (
                    <div className="flex flex-wrap gap-2 max-w-[300px]">
                      {editableProjectsForMember.map((project) => {
                        const checked = editForm.projectIds.includes(project.id);
                        return (
                          <label
                            key={`${member.memberId}-${project.id}`}
                            className="inline-flex items-center gap-1 border border-black px-2 py-1 bg-white"
                          >
                            <input
                              type="checkbox"
                              disabled={writeDisabled || project.status === "disabled"}
                              checked={checked}
                              onChange={(e) => onToggleEditProject(project.id, e.target.checked)}
                            />
                            <span className="font-mono text-[10px]">
                              {project.name}
                              {project.status === "disabled" ? " · disabled" : ""}
                            </span>
                          </label>
                        );
                      })}
                      {editableProjectsForMember.length === 0 ? (
                        <span className="text-[10px] font-bold text-gray-500">
                          当前组织下暂无可选项目
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="font-mono">
                      {resolveProjectDisplay(member.projectIds, projects)}
                    </span>
                  )}
                </td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-2">
                    {editingMemberId === member.memberId ? (
                      <>
                        <button className="b-btn bg-white text-xs" onClick={() => onViewAudit(member)}>
                          查看审计
                        </button>
                        <button
                          className="b-btn bg-[#FFD500] text-xs"
                          disabled={writeDisabled}
                          onClick={() => onSaveEdit(member.memberId)}
                        >
                          保存
                        </button>
                        <button className="b-btn bg-white text-xs" onClick={onCancelEdit}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="b-btn bg-white text-xs"
                          disabled={writeDisabled}
                          onClick={() => onStartEdit(member)}
                        >
                          编辑绑定
                        </button>
                        <button
                          className="b-btn bg-white text-xs"
                          onClick={() => onViewBindingAudit(member)}
                        >
                          查看审计
                        </button>
                        <button
                          className="b-btn bg-white text-xs"
                          disabled={writeDisabled}
                          onClick={() => onRemove(member)}
                        >
                          <Trash2 className="w-3 h-3" />
                          删除成员
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {memberBindings.length === 0 ? (
              <tr>
                <td className="p-3 text-gray-500 font-bold" colSpan={4}>
                  暂无成员绑定数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
