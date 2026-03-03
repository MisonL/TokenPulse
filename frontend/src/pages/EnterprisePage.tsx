import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Users, ScrollText, Gauge, LogOut } from "lucide-react";
import { client } from "../lib/client";
import { cn } from "../lib/utils";

interface FeaturePayload {
  edition: "standard" | "advanced";
  features: Record<string, boolean>;
}

interface PermissionItem {
  key: string;
  name: string;
}

interface RoleItem {
  key: string;
  name: string;
  permissions: string[];
}

interface AuditEventItem {
  id: number;
  actor: string;
  action: string;
  resource: string;
  result: "success" | "failure";
  createdAt: string;
  details?: Record<string, unknown> | string | null;
}

interface AuditQueryResult {
  data: AuditEventItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface BillingQuotaResult {
  data: {
    mode: string;
    message: string;
    limits: {
      requestsPerMinute: number;
      tokensPerDay: number;
    };
  };
}

export function EnterprisePage() {
  const [featurePayload, setFeaturePayload] = useState<FeaturePayload | null>(null);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [auditResult, setAuditResult] = useState<AuditQueryResult | null>(null);
  const [quotas, setQuotas] = useState<BillingQuotaResult["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [enterpriseEnabled, setEnterpriseEnabled] = useState(true);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [auditKeyword, setAuditKeyword] = useState("");
  const [auditPage, setAuditPage] = useState(1);

  const canLoadEnterprise = useMemo(
    () => enterpriseEnabled && featurePayload?.edition === "advanced",
    [enterpriseEnabled, featurePayload?.edition],
  );

  const loadAuditEvents = async (page = 1, keyword = auditKeyword) => {
    const resp = await client.api.admin.audit.events.$get({
      query: {
        page: String(page),
        pageSize: "10",
        keyword: keyword || undefined,
      },
    });
    if (!resp.ok) {
      throw new Error("加载审计日志失败");
    }
    const json = await resp.json();
    setAuditResult(json);
    setAuditPage(json.page);
  };

  const bootstrap = async () => {
    setLoading(true);
    setAdminAuthenticated(false);
    const featureRes = await client.api.admin.features.$get();

    if (!featureRes.ok) {
      toast.error("企业能力加载失败");
      setLoading(false);
      return;
    }

    const featureJson = await featureRes.json();
    setFeaturePayload(featureJson);
    const advancedEnabled =
      featureJson?.edition === "advanced" &&
      featureJson?.features?.enterprise === true;
    setEnterpriseEnabled(advancedEnabled);

    if (!advancedEnabled) {
      setLoading(false);
      return;
    }

    const meRes = await client.api.admin.auth.me.$get();
    const meJson = (await meRes.json().catch(() => ({ authenticated: false }))) as {
      authenticated?: boolean;
    };
    if (!meRes.ok || meJson.authenticated !== true) {
      setLoading(false);
      setAdminAuthenticated(false);
      return;
    }
    setAdminAuthenticated(true);

    const [roleRes, permRes, quotaRes] = await Promise.allSettled([
      client.api.admin.rbac.roles.$get(),
      client.api.admin.rbac.permissions.$get(),
      client.api.admin.billing.quotas.$get(),
    ]);

    if (roleRes.status === "fulfilled" && roleRes.value.ok) {
      const json = await roleRes.value.json();
      setRoles(json.data || []);
    }
    if (permRes.status === "fulfilled" && permRes.value.ok) {
      const json = await permRes.value.json();
      setPermissions(json.data || []);
    }
    if (quotaRes.status === "fulfilled" && quotaRes.value.ok) {
      const json = await quotaRes.value.json();
      setQuotas(json.data || null);
    }

    try {
      await loadAuditEvents(1, auditKeyword);
    } catch {
      toast.error("审计日志加载失败");
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    if (!adminUsername.trim() || !adminPassword) {
      toast.error("请输入管理员账号和密码");
      return;
    }

    setAuthSubmitting(true);
    try {
      const resp = await client.api.admin.auth.login.$post({
        json: {
          username: adminUsername.trim(),
          password: adminPassword,
        },
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({} as { error?: string }));
        toast.error(data.error || "管理员登录失败");
        return;
      }
      toast.success("管理员登录成功");
      setAdminPassword("");
      await bootstrap();
    } catch {
      toast.error("管理员登录失败");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await client.api.admin.auth.logout.$post();
    } catch {
      // ignore
    }
    setAdminAuthenticated(false);
    setRoles([]);
    setPermissions([]);
    setAuditResult(null);
    setQuotas(null);
    toast.success("已退出管理员会话");
  };

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeTestAuditEvent = async () => {
    try {
      const resp = await client.api.admin.audit.events.$post({
        json: {
          action: "admin.audit.write",
          resource: "enterprise-panel",
          result: "success",
          details: { source: "enterprise-ui", type: "manual-check" },
        },
      });
      if (!resp.ok) {
        toast.error("写入测试审计事件失败");
        return;
      }
      toast.success("测试审计事件已写入");
      await loadAuditEvents(auditPage, auditKeyword);
    } catch {
      toast.error("写入测试审计事件失败");
    }
  };

  if (loading) {
    return (
      <div className="bg-white border-4 border-black p-10 b-shadow">
        <p className="text-xl font-black uppercase animate-pulse">企业中心加载中...</p>
      </div>
    );
  }

  if (!enterpriseEnabled || !canLoadEnterprise) {
    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4 border-b-8 border-black pb-6">
          <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
            <ShieldCheck className="w-10 h-10 text-black" />
          </div>
          <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
        </header>
        <section className="bg-white border-4 border-black p-8 b-shadow">
          <p className="text-2xl font-black mb-2">当前为标准版</p>
          <p className="text-sm font-bold text-gray-600">
            请在服务端设置环境变量 <code>ENABLE_ADVANCED=true</code> 后重启，即可启用 RBAC、审计与配额管理能力。
          </p>
        </section>
      </div>
    );
  }

  if (!adminAuthenticated) {
    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4 border-b-8 border-black pb-6">
          <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
            <ShieldCheck className="w-10 h-10 text-black" />
          </div>
          <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
        </header>
        <section className="bg-white border-4 border-black p-8 b-shadow space-y-4 max-w-xl">
          <p className="text-2xl font-black">管理员登录</p>
          <p className="text-xs font-bold text-gray-500">
            当前后端已启用企业管理员会话，请先登录后再访问 RBAC、审计与配额能力。
          </p>
          <div className="space-y-3">
            <input
              className="b-input h-11 w-full"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              placeholder="管理员用户名"
            />
            <input
              type="password"
              className="b-input h-11 w-full"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="管理员密码"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleAdminLogin();
                }
              }}
            />
          </div>
          <button
            className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
            disabled={authSubmitting}
            onClick={handleAdminLogin}
          >
            {authSubmitting ? "登录中..." : "登录管理员会话"}
          </button>
        </section>
      </div>
    );
  }

  const featureEntries = Object.entries(featurePayload?.features || {});

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between border-b-8 border-black pb-6">
        <div className="flex items-center gap-4">
          <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
            <ShieldCheck className="w-10 h-10 text-black" />
          </div>
          <div>
            <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-gray-500">
              高级版能力编排与审计追踪
            </p>
          </div>
        </div>
        <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={writeTestAuditEvent}>
          写入测试审计事件
        </button>
        <button className="b-btn bg-white" onClick={handleAdminLogout}>
          <LogOut className="w-4 h-4" />
          退出管理员
        </button>
      </header>

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center gap-3 mb-4">
          <Gauge className="w-6 h-6" />
          <h3 className="text-2xl font-black uppercase">能力开关</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {featureEntries.map(([key, enabled]) => (
            <div
              key={key}
              className={cn(
                "border-2 border-black p-4 flex items-center justify-between",
                enabled ? "bg-emerald-50" : "bg-gray-100",
              )}
            >
              <span className="font-bold uppercase text-xs tracking-wider">{key}</span>
              <span className={cn("text-xs font-black", enabled ? "text-emerald-700" : "text-gray-500")}>
                {enabled ? "已启用" : "未启用"}
              </span>
            </div>
          ))}
        </div>
      </section>

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

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="text-2xl font-black uppercase">审计事件</h3>
          <div className="flex gap-2">
            <input
              className="b-input h-10 w-64"
              value={auditKeyword}
              onChange={(e) => setAuditKeyword(e.target.value)}
              placeholder="关键词筛选（actor/action/resource）"
            />
            <button
              className="b-btn bg-white"
              onClick={async () => {
                try {
                  await loadAuditEvents(1, auditKeyword);
                } catch {
                  toast.error("审计日志加载失败");
                }
              }}
            >
              查询
            </button>
          </div>
        </div>

        <div className="border-2 border-black overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-black text-white text-xs uppercase">
              <tr>
                <th className="p-3">时间</th>
                <th className="p-3">操作人</th>
                <th className="p-3">动作</th>
                <th className="p-3">资源</th>
                <th className="p-3">结果</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20 text-sm">
              {(auditResult?.data || []).map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="p-3 font-mono text-xs">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="p-3">{item.actor}</td>
                  <td className="p-3 font-mono text-xs">{item.action}</td>
                  <td className="p-3 font-mono text-xs">{item.resource}</td>
                  <td className="p-3">
                    <span className={cn("font-black text-xs", item.result === "success" ? "text-emerald-600" : "text-red-600")}>
                      {item.result === "success" ? "成功" : "失败"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500">
            共 {auditResult?.total || 0} 条，第 {auditResult?.page || 1}/{auditResult?.totalPages || 1} 页
          </p>
          <div className="flex gap-2">
            <button
              className="b-btn bg-white"
              disabled={(auditResult?.page || 1) <= 1}
              onClick={async () => {
                try {
                  const prev = Math.max(1, (auditResult?.page || 1) - 1);
                  await loadAuditEvents(prev, auditKeyword);
                } catch {
                  toast.error("审计日志加载失败");
                }
              }}
            >
              上一页
            </button>
            <button
              className="b-btn bg-white"
              disabled={(auditResult?.page || 1) >= (auditResult?.totalPages || 1)}
              onClick={async () => {
                try {
                  const next = Math.min(
                    auditResult?.totalPages || 1,
                    (auditResult?.page || 1) + 1,
                  );
                  await loadAuditEvents(next, auditKeyword);
                } catch {
                  toast.error("审计日志加载失败");
                }
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 b-shadow">
        <h3 className="text-2xl font-black uppercase mb-3">计费与配额</h3>
        <p className="text-sm font-bold mb-3">{quotas?.message || "暂无配额信息"}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-black p-4">
            <p className="text-xs uppercase text-gray-500">每分钟请求数</p>
            <p className="text-2xl font-black">{quotas?.limits.requestsPerMinute ?? 0}</p>
          </div>
          <div className="border-2 border-black p-4">
            <p className="text-xs uppercase text-gray-500">每日 Token 限额</p>
            <p className="text-2xl font-black">{quotas?.limits.tokensPerDay ?? 0}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
