import { ScrollText, Users } from "lucide-react";
import type { PermissionItem, RoleItem } from "../../lib/client";

interface EnterpriseRolesPermissionsSectionProps {
  roles: RoleItem[];
  permissions: PermissionItem[];
}

export function EnterpriseRolesPermissionsSection({
  roles,
  permissions,
}: EnterpriseRolesPermissionsSectionProps) {
  return (
    <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center gap-3 mb-4">
          <Users className="w-6 h-6" />
          <h3 className="text-2xl font-black uppercase">角色与权限</h3>
        </div>
        <div className="space-y-4">
          {roles.map((role) => (
            <div key={role.key} className="border-2 border-black p-4">
              <p className="font-black text-lg">{role.name}</p>
              <p className="text-[10px] uppercase text-gray-500 mb-2">{role.key}</p>
              <div className="flex flex-wrap gap-2">
                {role.permissions.map((perm) => (
                  <span
                    key={`${role.key}-${perm}`}
                    className="px-2 py-1 border border-black text-[10px] font-bold bg-[#FFD500]/30"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center gap-3 mb-4">
          <ScrollText className="w-6 h-6" />
          <h3 className="text-2xl font-black uppercase">权限词典</h3>
        </div>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {permissions.map((permission) => (
            <div key={permission.key} className="border-2 border-black p-3">
              <p className="font-bold text-sm">{permission.name}</p>
              <p className="font-mono text-[10px] text-gray-500">{permission.key}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
