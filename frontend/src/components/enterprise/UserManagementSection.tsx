import { Trash2, UserPlus } from "lucide-react";
import type { AdminUserItem, RoleItem, TenantItem } from "../../lib/client";
import type { EnterpriseUserCreateFormState } from "../../pages/enterpriseAdminMutations";
import type { EnterpriseUserEditFormState } from "../../pages/enterpriseUserBindingEditors";

interface UserManagementSectionProps {
  sectionId?: string;
  roles: RoleItem[];
  tenants: TenantItem[];
  users: AdminUserItem[];
  createForm: EnterpriseUserCreateFormState;
  editForm: EnterpriseUserEditFormState;
  editingUserId: string | null;
  onCreateFormChange: (patch: Partial<EnterpriseUserCreateFormState>) => void;
  onEditFormChange: (patch: Partial<EnterpriseUserEditFormState>) => void;
  onCreate: () => void;
  onStartEdit: (user: AdminUserItem) => void;
  onSaveEdit: (userId: string) => void;
  onCancelEdit: () => void;
  onRemove: (user: AdminUserItem) => void;
}

export function UserManagementSection({
  sectionId = "user-management-section",
  roles,
  tenants,
  users,
  createForm,
  editForm,
  editingUserId,
  onCreateFormChange,
  onEditFormChange,
  onCreate,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
}: UserManagementSectionProps) {
  const tenantOptions = tenants.length
    ? tenants
    : [{ id: "default", name: "默认租户", status: "active" as const }];

  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow space-y-4">
      <div className="flex items-center gap-3">
        <UserPlus className="w-6 h-6" />
        <h3 className="text-2xl font-black uppercase">用户管理</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          className="b-input h-10"
          value={createForm.username}
          placeholder="用户名"
          onChange={(e) => onCreateFormChange({ username: e.target.value })}
        />
        <input
          type="password"
          className="b-input h-10"
          value={createForm.password}
          placeholder="密码（至少 8 位）"
          onChange={(e) => onCreateFormChange({ password: e.target.value })}
        />
        <select
          className="b-input h-10"
          value={createForm.roleKey}
          onChange={(e) => onCreateFormChange({ roleKey: e.target.value })}
        >
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.name} ({role.key})
            </option>
          ))}
        </select>
        <select
          className="b-input h-10"
          value={createForm.tenantId}
          onChange={(e) => onCreateFormChange({ tenantId: e.target.value })}
        >
          {tenantOptions.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name} ({tenant.id})
            </option>
          ))}
        </select>
      </div>
      <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={onCreate}>
        创建用户
      </button>

      <div className="border-2 border-black overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-black text-white text-xs uppercase">
            <tr>
              <th className="p-2">用户名</th>
              <th className="p-2">状态</th>
              <th className="p-2">角色绑定</th>
              <th className="p-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="p-2">
                  <p className="font-bold">{user.username}</p>
                  {user.displayName ? <p className="text-xs text-gray-500">{user.displayName}</p> : null}
                </td>
                <td className="p-2">
                  {editingUserId === user.id ? (
                    <select
                      className="b-input h-8 text-xs"
                      value={editForm.status}
                      onChange={(e) =>
                        onEditFormChange({
                          status: e.target.value as "active" | "disabled",
                        })
                      }
                    >
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  ) : user.status === "active" ? (
                    "启用"
                  ) : (
                    "禁用"
                  )}
                </td>
                <td className="p-2 text-xs font-mono">
                  {editingUserId === user.id ? (
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        className="b-input h-8 text-xs"
                        value={editForm.displayName}
                        placeholder="显示名称（可选）"
                        onChange={(e) => onEditFormChange({ displayName: e.target.value })}
                      />
                      <select
                        className="b-input h-8 text-xs"
                        value={editForm.roleKey}
                        onChange={(e) => onEditFormChange({ roleKey: e.target.value })}
                      >
                        {roles.map((role) => (
                          <option key={role.key} value={role.key}>
                            {role.key}
                          </option>
                        ))}
                      </select>
                      <select
                        className="b-input h-8 text-xs"
                        value={editForm.tenantId}
                        onChange={(e) => onEditFormChange({ tenantId: e.target.value })}
                      >
                        {tenantOptions.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.id}
                          </option>
                        ))}
                      </select>
                      <input
                        type="password"
                        className="b-input h-8 text-xs"
                        value={editForm.password}
                        placeholder="可选：重置密码"
                        onChange={(e) => onEditFormChange({ password: e.target.value })}
                      />
                      <input
                        className="b-input h-8 text-xs"
                        value={editForm.roleBindingsText}
                        placeholder="多角色绑定：role@tenant,role@tenant"
                        onChange={(e) => onEditFormChange({ roleBindingsText: e.target.value })}
                      />
                      <input
                        className="b-input h-8 text-xs"
                        value={editForm.tenantIdsText}
                        placeholder="租户绑定：tenant1,tenant2"
                        onChange={(e) => onEditFormChange({ tenantIdsText: e.target.value })}
                      />
                    </div>
                  ) : (
                    user.roles.map((item) => `${item.roleKey}@${item.tenantId || "default"}`).join(", ") || "-"
                  )}
                </td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-2">
                    {editingUserId === user.id ? (
                      <>
                        <button className="b-btn bg-[#FFD500] text-xs" onClick={() => onSaveEdit(user.id)}>
                          保存
                        </button>
                        <button className="b-btn bg-white text-xs" onClick={onCancelEdit}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="b-btn bg-white text-xs" onClick={() => onStartEdit(user)}>
                          编辑
                        </button>
                        <button className="b-btn bg-white text-xs" onClick={() => onRemove(user)}>
                          <Trash2 className="w-3 h-3" />
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
