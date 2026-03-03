import { useState, useEffect, useRef } from "react";
import { Zap, Globe, RefreshCcw, List } from "lucide-react";
import { cn } from "../lib/utils";
import { toast } from "sonner";
import { t } from "../lib/i18n";
import { client } from "../lib/client";

interface Provider {
  id: string;
  name: string;
  desc: string;
  type: string;
  icon: string;
  description?: string;
  authType?: string;
  flow?: string;
  flows?: string[];
  supportsModelList?: boolean;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface CredentialItem {
  id: string;
  provider: string;
  accountId?: string;
  email?: string | null;
  status?: string | null;
}




interface DeviceModal {
  provider: string;
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  code_verifier: string;
  clientId?: string;
  clientSecret?: string;
  state?: string;
}

interface OAuthPollResponse {
  success?: boolean;
  pending?: boolean;
  status?: string;
  error?: string;
  accessToken?: string;
}

type OAuthPayload = Record<string, unknown>;

export function CredentialsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [credentials, setCredentials] = useState<Record<string, unknown>>({});
  const [credentialList, setCredentialList] = useState<CredentialItem[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [deviceModal, setDeviceModal] = useState<DeviceModal | null>(null);
  const [modelsModal, setModelsModal] = useState<{
    providerName: string;
    models: Model[];
    loading: boolean;
  } | null>(null);
  const [search, setSearch] = useState("");


  // 跟踪所有定时器，以便在组件卸载时清理
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 清理所有定时器
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current = [];
    };
  }, []);

  const extractStateFromOAuthUrl = (url: string) => {
    try {
      const parsed = new URL(
        url.startsWith("http") ? url : `http://localhost${url.startsWith("?") ? "" : "/"}${url}`,
      );
      return parsed.searchParams.get("state") || "";
    } catch {
      return "";
    }
  };

  const getPayloadText = (payload: OAuthPayload, ...keys: string[]) => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
    return "";
  };

  const buildDeviceModalFromStart = (
    providerId: string,
    payload: OAuthPayload,
  ): DeviceModal | null => {
    const deviceCode = getPayloadText(payload, "deviceCode", "device_code");
    if (!deviceCode) return null;
    const verificationUri =
      getPayloadText(payload, "verificationUri", "verification_uri", "url");
    const verificationUriComplete =
      getPayloadText(
        payload,
        "verificationUriComplete",
        "verification_uri_complete",
        "url",
      );
    return {
      provider: providerId,
      device_code: deviceCode,
      user_code: getPayloadText(payload, "userCode", "user_code", "code"),
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      code_verifier: getPayloadText(payload, "codeVerifier", "code_verifier"),
      clientId: getPayloadText(payload, "clientId", "client_id"),
      clientSecret: getPayloadText(payload, "clientSecret", "client_secret"),
      state: getPayloadText(payload, "state"),
    };
  };

  const fetchProviders = async () => {
    try {
      const resp = await client.api.providers.$get();
      if (!resp.ok) throw new Error();
      const json = await resp.json();
      setProviders((json.data as (Provider & { description: string; authType: string })[]).map((p) => ({
        ...p,
        desc: p.description,
        type: p.authType,
      })));
    } catch {
      toast.error("获取支持的渠道失败");
    }
  };

  const getAuthTypeLabel = (authType: string) => {
    switch (authType) {
      case "device_code":
        return "DEVICE CODE";
      case "api_key":
        return "API KEY";
      case "service_account":
        return "SERVICE ACCOUNT";
      default:
        return "OAUTH";
    }
  };

  const fetchCredentials = async () => {
    try {
      const [statusResp, listResp] = await Promise.all([
        client.api.oauth.status.$get(),
        client.api.credentials.$get(),
      ]);

      if (statusResp.ok) {
        const data = await statusResp.json();
        setCredentials(data);
      }

      if (listResp.ok) {
        const list = await listResp.json();
        setCredentialList(Array.isArray(list) ? list : []);
      }
    } catch {
      return;
    }
  };

  const fetchProviderModels = async (providerId: string, providerName: string) => {
    setModelsModal({ providerName, models: [], loading: true });
    try {
      const resp = await client.api.models.$get({ query: { provider: providerId } });
      if (!resp.ok) throw new Error();
      const json = await resp.json();
      setModelsModal({ providerName, models: json.data, loading: false });
    } catch {
      toast.error("获取模型失败");
      setModelsModal(null);
    }
  };

  useEffect(() => {
    fetchProviders();
    fetchCredentials();
  }, []);

  const handleDelete = async (provider: string, accountId?: string) => {
    const confirmText = accountId
      ? `确认断开账号 ${accountId} 吗？`
      : t("credentials.disconnect_default");
    if (!confirm(confirmText)) return;

    const loadingKey = accountId ? `${provider}:${accountId}` : provider;
    setLoading((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      const resp = await client.api.credentials[":provider"].$delete({
        param: { provider },
        query: accountId ? { accountId } : undefined,
      });
      if (!resp.ok) throw new Error();
      
      const providerLabel = accountId ? `${provider}:${accountId}` : provider;
      toast.success(t("credentials.toast_disconnected", { provider: providerLabel }));
      fetchCredentials();
    } catch {
      toast.error(t("credentials.toast_net_error"));
    } finally {
      setLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handlePoll = async () => {
    if (!deviceModal) return;

    try {
      const resp = await client.api.oauth[":provider"].poll.$post({
        param: { provider: deviceModal.provider },
        json: {
          deviceCode: deviceModal.device_code || undefined,
          codeVerifier: deviceModal.code_verifier || undefined,
          clientId: deviceModal.clientId || undefined,
          clientSecret: deviceModal.clientSecret || undefined,
          state: deviceModal.state || undefined,
        },
      });

      if (!resp.ok) {
         const errData = (await resp.json().catch(() => ({}))) as Record<string, string>;
         throw new Error(errData.error || "轮询失败");
      }

      const data = (await resp.json()) as OAuthPollResponse;

      if (data.accessToken || data.success || data.status === "completed") {
        toast.success(
          t("credentials.toast_connected", { provider: deviceModal.provider }),
        );
        setDeviceModal(null);
        fetchCredentials();
      } else if (data.pending || data.status === "pending") {
        toast.info(t("credentials.toast_waiting"));
      } else {
        toast.error(data.error || t("credentials.toast_auth_fail"));
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t("credentials.toast_poll_fail");
      toast.error(message);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 如果需要可以验证 origin，但在 localhost 开发中我们可以宽松一些或检查特定项
      if (event.data?.type === "oauth-success") {
        toast.success(t("credentials.toast_connected", { provider: event.data.provider || "渠道" }));
        fetchCredentials();
        // 如果打开了模态框，关闭它？
        setDeviceModal(null);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnect = async (p: Provider) => {
    if (p.id === "aistudio") {
      setShowAiStudioModal(true);
      return;
    }
    if (p.id === "vertex") {
      setShowVertexModal(true);
      return;
    }

    if (p.id === "kiro") {
      try {
        const resp = await client.api.oauth.kiro.register.$post();
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        const modal = buildDeviceModalFromStart("kiro", data as OAuthPayload);
        if (!modal) {
          throw new Error("Kiro 设备码参数不完整");
        }
        setDeviceModal(modal);
      } catch {
        toast.error(t("credentials.toast_kiro_fail"));
      }
      return;
    }

    try {
      const resp = await client.api.oauth[":provider"].start.$post({
        param: { provider: p.id },
      });
      const data = (await resp.json().catch(() => ({}))) as OAuthPayload;
      if (!resp.ok) {
        throw new Error(String(data.error || `启动 ${p.name} 授权失败`));
      }

      const flow = String(data.flow || p.flow || p.type || "").toLowerCase();
      if (flow === "manual_key") {
        if (p.id === "aistudio") {
          setShowAiStudioModal(true);
          return;
        }
        toast.info("该渠道需要手动录入凭据，前端暂未适配。");
        return;
      }
      if (flow === "service_account") {
        if (p.id === "vertex") {
          setShowVertexModal(true);
          return;
        }
        toast.info("该渠道需要服务账号配置，前端暂未适配。");
        return;
      }

      if (flow === "device_code" || data.deviceCode || data.device_code) {
        const modal = buildDeviceModalFromStart(p.id, data);
        if (!modal) {
          throw new Error(`${p.name} 设备码参数不完整`);
        }
        setDeviceModal(modal);
        return;
      }

      const oauthUrl = getPayloadText(data, "url");
      if (oauthUrl) {
        const oauthState = getPayloadText(data, "state");
        createDataWindow(
          oauthUrl,
          p.id,
          oauthState || extractStateFromOAuthUrl(oauthUrl),
          p.name,
        );
        return;
      }

      toast.info(t("credentials.toast_coming_soon"));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `启动 ${p.name} 授权失败`;
      toast.error(message);
    }
  };

  const createDataWindow = (
    url: string,
    provider: string,
    state?: string,
    providerLabel?: string,
  ) => {
    const width = 600;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    const oauthState = (state || extractStateFromOAuthUrl(url) || "").trim();
    const connectLabel = providerLabel || provider;

    const authWindow = window.open(
      url,
      provider,
      `width=${width},height=${height},top=${top},left=${left}`,
    );

    const pollInterval = setInterval(async () => {
      try {
        if (authWindow?.closed) {
          clearInterval(pollInterval);
          fetchCredentials();
          return;
        }
      } catch {
        // COOP 可能会阻止访问 .closed，忽略并依赖状态轮询
      }
      try {
        if (oauthState) {
          const resp = await client.api.oauth[":provider"].poll.$post({
            param: { provider },
            json: { state: oauthState },
          });
          const pollData = (await resp.json().catch(() => ({}))) as OAuthPollResponse;
          if (!resp.ok || pollData.status === "error" || pollData.error) {
            if (pollData.status === "error" || pollData.error) {
              clearInterval(pollInterval);
              authWindow?.close();
              toast.error(pollData.error || t("credentials.toast_auth_fail"));
            }
            return;
          }
          if (pollData.success || pollData.status === "completed") {
            clearInterval(pollInterval);
            authWindow?.close();
            toast.success(t("credentials.toast_connected", { provider: connectLabel }));
            fetchCredentials();
          }
          return;
        }

        const resp = await client.api.oauth.status.$get();
        if (!resp.ok) {
          return;
        }
        const statusData = await resp.json();
        if (statusData[provider]) {
          clearInterval(pollInterval);
          authWindow?.close();
          toast.success(t("credentials.toast_connected", { provider: connectLabel }));
          fetchCredentials();
        }
      } catch {
        // 静默检查
      }
    }, 2000);
    const timeoutTimer = setTimeout(() => clearInterval(pollInterval), 120000);
    timersRef.current.push(
      pollInterval as unknown as ReturnType<typeof setTimeout>,
      timeoutTimer,
    );
  };

  const [showAiStudioModal, setShowAiStudioModal] = useState(false);
  const [aiStudioKey, setAiStudioKey] = useState("");
  const [showVertexModal, setShowVertexModal] = useState(false);
  const [vertexJson, setVertexJson] = useState("");

  const saveAiStudio = async () => {
    try {
      const resp = await client.api.credentials.auth.aistudio.save.$post({
        json: { serviceAccountJson: aiStudioKey }
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        toast.success(t("credentials.toast_connected", { provider: "AI Studio" }));
        setShowAiStudioModal(false);
        setAiStudioKey("");
        fetchCredentials();
      } else {
        toast.error(data.error || t("credentials.toast_save_fail"));
      }
    } catch {
      toast.error(t("credentials.toast_save_fail"));
    }
  };

  const saveVertex = async () => {
    try {
      const resp = await client.api.credentials.auth.vertex.save.$post({
        json: { serviceAccountJson: vertexJson }
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        toast.success(t("credentials.toast_connected", { provider: "Vertex AI" }));
        setShowVertexModal(false);
        setVertexJson("");
        fetchCredentials();
      } else {
        toast.error(data.error || t("credentials.toast_save_fail"));
      }
    } catch {
      toast.error(t("credentials.toast_save_fail"));
    }
  };

  return (
    <div className="space-y-6">
      {/* 模型列表模态框 */}
      {modelsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
          <div className="bg-white border-4 border-black p-8 max-w-2xl w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-black uppercase tracking-tighter">
                {modelsModal.providerName} - {t("models.title") || "模型"}
              </h3>
              <button 
                onClick={() => setModelsModal(null)}
                className="text-2xl font-black hover:text-gray-500 transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {modelsModal.loading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 gap-4">
                <RefreshCcw className="w-12 h-12 animate-spin text-blue-600" />
                <p className="font-black uppercase text-sm animate-pulse">
                  {t("common.loading") || "正在加载模型..."}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto border-4 border-black bg-gray-50">
                {modelsModal.models.length > 0 ? (
                   <table className="w-full text-left">
                     <thead className="bg-black text-white sticky top-0">
                       <tr>
                         <th className="p-3 text-[10px] font-black uppercase">{t("models.table_name") || "模型名称"}</th>
                         <th className="p-3 text-[10px] font-black uppercase">{t("models.table_id") || "模型 ID"}</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y-2 divide-gray-200">
                       {modelsModal.models.map(m => (
                         <tr key={m.id} className="hover:bg-white transition-colors">
                           <td className="p-3 font-bold text-sm text-black">{m.name}</td>
                           <td className="p-3 font-mono text-xs text-blue-600 select-all">{m.id}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                ) : (
                  <div className="p-12 text-center">
                    <p className="font-black uppercase text-gray-400">
                      {t("models.no_models") || "当前渠道暂无可用模型。"}
                    </p>
                  </div>
                )}
              </div>
            )}
            
            <div className="mt-8 flex justify-end">
              <button 
                onClick={() => setModelsModal(null)}
                className="b-btn-primary px-8"
              >
                {t("common.close") || "关闭"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 设备代码模态框 */}
      {deviceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border-4 border-black p-8 max-w-md w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="text-xl font-black uppercase mb-4">
              {t("credentials.connect_provider", {
                provider: deviceModal.provider,
              })}
            </h3>
            <p className="mb-4 whitespace-pre-line">
              {t("credentials.device_instructions")}
            </p>

            <div className="bg-gray-100 p-4 font-mono text-center text-2xl tracking-widest font-bold select-all border-2 border-dashed border-gray-300 mb-6">
              {deviceModal.user_code}
            </div>

            <div className="flex flex-col gap-3">
              <a
                href={
                  deviceModal.verification_uri_complete ||
                  deviceModal.verification_uri
                }
                target="_blank"
                rel="noopener noreferrer"
                className="b-btn b-btn-primary text-center justify-center"
              >
                {t("credentials.open_login_page")}
              </a>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handlePoll}
                  className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
                >
                  {t("credentials.check_status")}
                </button>
                <button
                  onClick={() => setDeviceModal(null)}
                  className="b-btn bg-red-100 hover:bg-red-200"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Studio 模态框 (API Key) */}
      {showAiStudioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white border-4 border-black p-8 max-w-lg w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative">
            <button
              onClick={() => setShowAiStudioModal(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-black font-black"
            >
              ✕
            </button>
            <h3 className="text-2xl font-black mb-6 uppercase tracking-tighter">
              {t("credentials.aistudio_title") || "连接 AI Studio"}
            </h3>
            <div className="bg-[#FFD500]/20 border-l-8 border-[#FFD500] p-4 mb-6">
              <p className="text-black text-xs font-bold">
                 {t("credentials.aistudio_hint") || "请前往以下页面获取 API Key："} <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline font-black">Google AI Studio</a>。
              </p>
            </div>
            <label htmlFor="aistudio-key" className="text-[10px] font-black uppercase text-gray-500 block mb-2">
              API Key
            </label>
            <input
              type="password"
              id="aistudio-key"
              name="aistudio-key"
              className="b-input w-full h-12 mb-6"
              value={aiStudioKey}
              onChange={(e) => setAiStudioKey(e.target.value)}
              placeholder="AIzaSy..."
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAiStudioModal(false)}
                className="b-btn bg-white hover:bg-gray-100"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={saveAiStudio}
                className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vertex 模态框 (Service Account JSON) */}
      {showVertexModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white border-4 border-black p-8 max-w-lg w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative">
            <button
              onClick={() => setShowVertexModal(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-black font-black"
            >
              ✕
            </button>
            <h3 className="text-2xl font-black mb-4 uppercase tracking-tighter">
              {t("credentials.vertex_title") || "连接 Vertex AI"}
            </h3>
            <p className="text-gray-500 text-xs font-bold mb-6">
              {t("credentials.vertex_desc") || "请粘贴你的 Service Account JSON 密钥。"}
            </p>
            <label htmlFor="vertex-json" className="text-[10px] font-black uppercase text-gray-500 block mb-2">
              {t("common.service_account_json")}
            </label>
            <textarea
              id="vertex-json"
              name="vertex-json"
              className="b-input w-full h-48 mb-6 font-mono text-[10px]"
              value={vertexJson}
              onChange={(e) => setVertexJson(e.target.value)}
              placeholder='{"type": "service_account", ...}'
            ></textarea>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowVertexModal(false)}
                className="b-btn bg-white hover:bg-gray-100"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={saveVertex}
                className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-b-8 border-black pb-6">
        <div className="flex items-center gap-6">
          <div className="bg-[#FFD500] text-black p-4 border-4 border-black b-shadow">
            <Zap className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-5xl font-black uppercase text-black tracking-tighter">
              {t("credentials.title")}
            </h2>
            <div className="h-2 bg-black w-24 mt-1" />
          </div>
        </div>
        <div className="relative group">
          <label htmlFor="provider-search" className="sr-only">
            {t("credentials.search_providers")}
          </label>
          <input
            id="provider-search"
            name="provider-search"
            type="text"
            placeholder={t("credentials.search_providers")}
            className="b-input w-72 h-14"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white border-4 border-black p-0 overflow-hidden b-shadow mb-12">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#1A1A1A] text-white border-b-4 border-black">
            <tr>
              <th className="p-6 font-black uppercase tracking-widest border-r-4 border-black/30 w-24 text-center">
                {t("credentials.table_icon")}
              </th>
              <th className="p-6 font-black uppercase tracking-widest border-r-4 border-black/30">
                {t("credentials.table_provider")}
              </th>
              <th className="p-6 font-black uppercase tracking-widest border-r-4 border-black/30 text-center w-40">
                {t("credentials.table_type")}
              </th>
              <th className="p-6 font-black uppercase tracking-widest border-r-4 border-black/30 text-center w-48">
                {t("credentials.table_status")}
              </th>
              <th className="p-6 font-black uppercase tracking-widest text-right">
                {t("credentials.table_action")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-black">
            {providers.filter(
              (p) =>
                !search ||
                p.name.toLowerCase().includes(search.toLowerCase()) ||
                p.desc.toLowerCase().includes(search.toLowerCase()),
            ).map((p) => {
              const isConnected = !!credentials[p.id];
              const accountCountRaw = (
                credentials as { counts?: Record<string, number> }
              )?.counts?.[p.id];
              const accountCount =
                typeof accountCountRaw === "number"
                  ? accountCountRaw
                  : isConnected
                    ? 1
                    : 0;
              const providerAccounts = credentialList.filter((item) => {
                if (item.provider !== p.id) return false;
                const status = item.status || "active";
                return status !== "revoked" && status !== "disabled";
              });
              return (
                <tr
                  key={p.id}
                  className="hover:bg-blue-50 transition-colors group"
                >
                  <td className="p-4 border-r-2 border-black text-center text-2xl align-middle">
                    {p.icon.startsWith("/") ? (
                      <img
                        src={p.icon}
                        className="w-8 h-8 mx-auto"
                        alt={p.name}
                      />
                    ) : (
                      p.icon
                    )}
                  </td>
                  <td className="p-4 border-r-2 border-black align-middle">
                    <div className="font-black text-lg">{p.name}</div>
                    <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
                      {p.desc}
                    </div>
                    {p.supportsModelList !== false && (
                      <button 
                        onClick={() => fetchProviderModels(p.id, p.name)}
                        className="mt-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-800 underline decoration-2 underline-offset-2"
                      >
                        <List className="w-3 h-3" />
                        {t("models.view_list") || "查看模型"}
                      </button>
                    )}
                  </td>
                  <td className="p-4 border-r-2 border-black text-center align-middle">
                    <span className="inline-flex items-center px-2 py-1 bg-[#005C9A]/10 border-2 border-[#005C9A] text-[#005C9A] text-[10px] font-bold uppercase rounded-none">
                      <Globe className="w-3 h-3 mr-1" />{" "}
                      {getAuthTypeLabel(p.type)}
                    </span>
                  </td>
                  <td className="p-4 border-r-2 border-black text-center align-middle">
                    <div className="flex items-center justify-center gap-2">
                      <div
                        className={cn(
                          "w-3 h-3 rounded-full border-2 border-black transition-colors duration-300",
                          isConnected ? "bg-green-500" : "bg-gray-300",
                        )}
                      />
                      <span
                        className={cn(
                          "font-mono text-xs font-bold uppercase",
                          isConnected ? "text-black" : "text-gray-400",
                        )}
                      >
                        {isConnected
                          ? t("credentials.status_connected")
                          : t("credentials.status_disconnected")}
                      </span>
                    </div>
                    {isConnected ? (
                      <div className="mt-1 text-[10px] font-bold text-gray-500">
                        已连接 {accountCount} 个账号
                      </div>
                    ) : null}
                  </td>
                  <td className="p-6 border-r-4 border-black last:border-0 relative">
                    {isConnected ? (
                      <div className="flex flex-col gap-2 items-end">
                        <span className="flex items-center gap-2 px-3 py-1 bg-emerald-500 text-white font-black text-[10px] uppercase border-2 border-black">
                          <div className="w-2 h-2 bg-white animate-pulse" />
                          {t("common.ready")}
                        </span>
                        {providerAccounts.length > 1 ? (
                          <div className="flex flex-wrap gap-1.5 justify-end max-w-[360px]">
                            {providerAccounts.map((item) => {
                              const key = `${p.id}:${item.accountId || "default"}`;
                              return (
                                <button
                                  key={key}
                                  className="px-2 py-1 border-2 border-black text-[10px] font-bold hover:bg-red-100 transition-colors"
                                  onClick={() => handleDelete(p.id, item.accountId || "default")}
                                  title={item.email || item.accountId || "default"}
                                >
                                  断开 {item.email || item.accountId || "default"}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        <button
                          className="text-xs font-black uppercase underline hover:text-[#DA0414] transition-colors"
                          onClick={() => handleDelete(p.id)}
                        >
                          撤销全部
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2 w-full justify-end">
                        {loading[p.id] ? (
                          <div className="flex items-center gap-2 text-xs font-black uppercase animate-pulse">
                            <RefreshCcw className="w-4 h-4 animate-spin" />
                            {t("common.running")}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleConnect(p)}
                            className="b-btn text-xs py-2 px-6 h-auto"
                          >
                            {t("common.connect")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
