import { ShieldCheck } from "lucide-react";

interface EnterpriseBackendProbe {
  configured?: boolean;
  reachable?: boolean;
  baseUrl?: string;
  error?: string;
}

interface EnterpriseAvailabilityStateProps {
  edition?: string;
  enterpriseBackend?: EnterpriseBackendProbe | null;
}

export function EnterpriseAvailabilityState({
  edition,
  enterpriseBackend,
}: EnterpriseAvailabilityStateProps) {
  const showBackendUnavailable = edition === "advanced";

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4 border-b-8 border-black pb-6">
        <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
          <ShieldCheck className="w-10 h-10 text-black" />
        </div>
        <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
      </header>
      {showBackendUnavailable ? (
        <section className="bg-white border-4 border-black p-8 b-shadow space-y-3">
          <p className="text-2xl font-black mb-1">企业后端不可用</p>
          <p className="text-sm font-bold text-gray-600">
            Core 已启用高级版能力，但无法连接 enterprise 服务。请检查以下配置与依赖后重试：
          </p>
          <ul className="text-xs font-bold text-gray-600 list-disc pl-5 space-y-1">
            <li>
              <code>ENABLE_ADVANCED=true</code>（已开启）
            </li>
            <li>
              <code>ENTERPRISE_BASE_URL</code> 指向可达的 enterprise 地址
            </li>
            <li>
              <code>ENTERPRISE_SHARED_KEY</code>（如启用）在 core 与 enterprise 两端保持一致
            </li>
            <li>enterprise 服务已启动，且 <code>/health</code> 返回 200</li>
          </ul>
          <div className="text-xs font-bold text-gray-600">
            <p>
              当前探针：configured=<code>{String(enterpriseBackend?.configured ?? false)}</code>{" "}
              reachable=<code>{String(enterpriseBackend?.reachable ?? false)}</code>
            </p>
            {enterpriseBackend?.baseUrl ? (
              <p>
                baseUrl: <code>{enterpriseBackend.baseUrl}</code>
              </p>
            ) : null}
            {enterpriseBackend?.error ? (
              <p>
                error: <code>{enterpriseBackend.error}</code>
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="bg-white border-4 border-black p-8 b-shadow">
          <p className="text-2xl font-black mb-2">当前为标准版</p>
          <p className="text-sm font-bold text-gray-600">
            请在服务端设置环境变量 <code>ENABLE_ADVANCED=true</code> 后重启，即可启用 RBAC、审计与配额管理能力。
          </p>
        </section>
      )}
    </div>
  );
}
