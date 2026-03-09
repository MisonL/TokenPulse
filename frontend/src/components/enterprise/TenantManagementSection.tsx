import { Building2, Trash2 } from "lucide-react";
import type { TenantItem } from "../../lib/client";
import type { EnterpriseTenantCreateFormState } from "../../pages/enterpriseAdminMutations";

interface TenantManagementSectionProps {
  sectionId?: string;
  createForm: EnterpriseTenantCreateFormState;
  tenants: TenantItem[];
  onCreateFormChange: (patch: Partial<EnterpriseTenantCreateFormState>) => void;
  onCreate: () => void;
  onRemove: (tenant: TenantItem) => void;
}

export function TenantManagementSection({
  sectionId = "tenant-management-section",
  createForm,
  tenants,
  onCreateFormChange,
  onCreate,
  onRemove,
}: TenantManagementSectionProps) {
  return (
    <section id={sectionId} className="bg-white border-4 border-black p-6 b-shadow space-y-4">
      <div className="flex items-center gap-3">
        <Building2 className="w-6 h-6" />
        <h3 className="text-2xl font-black uppercase">租户管理</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          className="b-input h-10"
          placeholder="租户名称"
          value={createForm.name}
          onChange={(e) => onCreateFormChange({ name: e.target.value })}
        />
        <select
          className="b-input h-10"
          value={createForm.status}
          onChange={(e) =>
            onCreateFormChange({
              status: e.target.value as "active" | "disabled",
            })
          }
        >
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </select>
      </div>
      <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={onCreate}>
        创建租户
      </button>

      <div className="space-y-2">
        {tenants.map((tenant) => (
          <div key={tenant.id} className="border-2 border-black p-3 flex items-center justify-between">
            <div>
              <p className="font-bold">{tenant.name}</p>
              <p className="font-mono text-xs text-gray-500">
                {tenant.id} · {tenant.status}
              </p>
            </div>
            <button
              className="b-btn bg-white text-xs"
              disabled={tenant.id === "default"}
              onClick={() => onRemove(tenant)}
            >
              <Trash2 className="w-3 h-3" />
              删除
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
