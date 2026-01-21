import { useState, useEffect, useRef } from "react";
import { Zap, Globe, RefreshCcw, List } from "lucide-react";
import { cn } from "../lib/utils";
import { toast } from "sonner";
import { t } from "../lib/i18n";
import { api } from "../lib/api";

interface Provider {
  id: string;
  name: string;
  desc: string;
  type: string;
  icon: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
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
}

export function CredentialsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [credentials, setCredentials] = useState<Record<string, unknown>>({});
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

  const fetchProviders = async () => {
    try {
      const json = await api.get<{ data: { id: string; name: string; description: string; authType: string; icon: string }[] }>("/api/providers");
      setProviders(json.data.map((p) => ({
        ...p,
        desc: p.description,
        type: p.authType
      })));
    } catch {
      toast.error("Failed to fetch supported providers");
    }
  };

  const fetchCredentials = async () => {
    try {
      const data = await api.get<Record<string, unknown>>(`/api/credentials/status?t=${Date.now()}`);
      setCredentials(data);
    } catch {
      // Ignored
    }
  };

  const fetchProviderModels = async (providerId: string, providerName: string) => {
    setModelsModal({ providerName, models: [], loading: true });
    try {
      const json = await api.get<{ data: Model[] }>(`/api/models?provider=${providerId}`);
      setModelsModal({ providerName, models: json.data, loading: false });
    } catch {
      toast.error("Failed to fetch models");
      setModelsModal(null);
    }
  };

  useEffect(() => {
    fetchProviders();
    fetchCredentials();
  }, []);

  const handleDelete = async (provider: string) => {
    if (!confirm(t("credentials.disconnect_default"))) return;

    setLoading((prev) => ({ ...prev, [provider]: true }));
    try {
      await api.delete(`/api/credentials/${provider}`);
      toast.success(t("credentials.toast_disconnected", { provider }));
      setCredentials((prev) => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });
      fetchCredentials();
    } catch {
      toast.error(t("credentials.toast_net_error"));
    } finally {
      setLoading((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handlePoll = async () => {
    if (!deviceModal) return;

    let url = "";
    let body = {};

    if (deviceModal.provider === "qwen") {
      url = `/api/credentials/auth/qwen/poll`;
      body = {
        deviceCode: deviceModal.device_code,
        codeVerifier: deviceModal.code_verifier,
      };
    } else if (deviceModal.provider === "kiro") {
      url = `/api/credentials/auth/kiro/poll`;
      body = {
        deviceCode: deviceModal.device_code,
        clientId: deviceModal.clientId,
        clientSecret: deviceModal.clientSecret,
      };
    } else {
      return;
    }

    try {
      const data = await api.post<{ accessToken?: string; success?: boolean; pending?: boolean; error?: string }>(url, body);

      if (data.accessToken || data.success) {
        toast.success(
          t("credentials.toast_connected", { provider: deviceModal.provider }),
        );
        setDeviceModal(null);
        fetchCredentials();
      } else if (data.pending) {
        toast.info(t("credentials.toast_waiting"));
      } else {
        toast.error(data.error || t("credentials.toast_auth_fail"));
      }
    } catch {
      toast.error(t("credentials.toast_poll_fail"));
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin if needed, but for localhost dev we can be lenient or check specific
      if (event.data?.type === "oauth-success") {
        toast.success(t("credentials.toast_connected", { provider: event.data.provider || "Provider" }));
        fetchCredentials();
        // Close any modals if open?
        setDeviceModal(null);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnect = async (p: Provider) => {
    if (p.id === "qwen") {
      try {
        const data = await api.post<DeviceModal & { provider?: string }>(`/api/credentials/auth/qwen/start`);
        setDeviceModal({ ...data, provider: "qwen" });
      } catch {
        toast.error(t("credentials.toast_start_fail"));
      }
    } else if (p.id === "kiro") {
      try {
        const data = await api.post<{ userCode: string; verificationUri: string; verificationUriComplete?: string; deviceCode: string; clientId?: string; clientSecret?: string }>(`/api/credentials/auth/kiro/start`);
        setDeviceModal({
          user_code: data.userCode,
          verification_uri: data.verificationUri,
          verification_uri_complete: data.verificationUriComplete,
          device_code: data.deviceCode,
          provider: "kiro",
          clientId: data.clientId,
          clientSecret: data.clientSecret,
          code_verifier: "",
        });
      } catch {
        toast.error(t("credentials.toast_kiro_fail"));
      }
    } else if (p.id === "codex") {
      try {
        const data = await api.post<{ url?: string }>(`/api/credentials/auth/codex/url`);

        if (data.url) {
          const width = 600;
          const height = 700;
          const left = (window.screen.width - width) / 2;
          const top = (window.screen.height - height) / 2;

          const authWindow = window.open(
            data.url,
            "Codex Auth",
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
              // Ignore COOP errors
            }

            try {
              const statusData = await api.get<Record<string, unknown>>(`/api/credentials/status`);
              if (statusData.codex) {
                clearInterval(pollInterval);
                authWindow?.close();
                toast.success(
                  t("credentials.toast_connected", { provider: "Codex" }),
                );
                fetchCredentials();
              }
            } catch {
              // Silent check
            }
          }, 2000);

          const timeoutTimer = setTimeout(
            () => clearInterval(pollInterval),
            120000,
          );
          timersRef.current.push(
            pollInterval as unknown as ReturnType<typeof setTimeout>,
            timeoutTimer,
          );
        }
      } catch {
        toast.error(t("credentials.toast_codex_fail"));
      }
    } else if (p.id === "iflow") {
      try {
        const data = await api.post<{ url?: string }>(`/api/credentials/auth/iflow/url`);

        if (data.url) {
          const width = 600;
          const height = 700;
          const left = (window.screen.width - width) / 2;
          const top = (window.screen.height - height) / 2;

          const authWindow = window.open(
            data.url,
            "iFlow Auth",
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
              // Ignore COOP errors
            }

            try {
              const statusData = await api.get<Record<string, unknown>>(`/api/credentials/status`);
              if (statusData.iflow) {
                clearInterval(pollInterval);
                authWindow?.close();
                toast.success(
                  t("credentials.toast_connected", { provider: "iFlow" }),
                );
                fetchCredentials();
              }
            } catch {
              // Silent check
            }
          }, 2000);

          const timeoutTimer = setTimeout(
            () => clearInterval(pollInterval),
            120000,
          );
          timersRef.current.push(
            pollInterval as unknown as ReturnType<typeof setTimeout>,
            timeoutTimer,
          );
        }
      } catch {
        toast.error(t("credentials.toast_iflow_fail"));
      }
    } else if (p.id === "gemini") {
      try {
        const data = await api.post<{ url?: string }>(`/api/credentials/auth/gemini/url`);
        if (data.url) createDataWindow(data.url, "gemini");
      } catch {
        toast.error(t("credentials.toast_gemini_fail"));
      }
    } else if (p.id === "claude") {
      try {
        const data = await api.post<{ url?: string }>(`/api/credentials/auth/claude/url`);
        if (data.url) createDataWindow(data.url, "claude");
      } catch {
        toast.error(t("credentials.toast_claude_fail"));
      }
    } else if (p.id === "aistudio") {
      setShowAiStudioModal(true);
    } else if (p.id === "vertex") {
      setShowVertexModal(true);
    } else if (p.id === "antigravity") {
      try {
        const data = await api.post<{ url?: string }>(`/api/credentials/auth/antigravity/url`);
        if (data.url) createDataWindow(data.url, "antigravity");
      } catch {
        toast.error(t("credentials.toast_antigravity_fail") || "Failed to start Antigravity auth");
      }
    } else {
      toast.info(t("credentials.toast_coming_soon"));
    }
  };

  const createDataWindow = (url: string, provider: string) => {
    const width = 600;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

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
        // COOP might block access to .closed, ignore and rely on status polling
      }
      try {
        const statusData = await api.get<Record<string, unknown>>(`/api/credentials/status`);
        if (statusData[provider]) {
          clearInterval(pollInterval);
          authWindow?.close();
          toast.success(t("credentials.toast_connected", { provider }));
          fetchCredentials();
        }
      } catch {
        // Silent check
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
      const res = await api.raw(`/api/credentials/auth/aistudio/save`, {
        method: "POST",
        body: JSON.stringify({ serviceAccountJson: aiStudioKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
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
      const res = await api.raw(`/api/credentials/auth/vertex/save`, {
        method: "POST",
        body: JSON.stringify({ serviceAccountJson: vertexJson }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
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
      {/* Models List Modal */}
      {modelsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
          <div className="bg-white border-4 border-black p-8 max-w-2xl w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-black uppercase tracking-tighter">
                {modelsModal.providerName} - {t("models.title") || "Models"}
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
                  {t("common.loading") || "Loading Models..."}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto border-4 border-black bg-gray-50">
                {modelsModal.models.length > 0 ? (
                   <table className="w-full text-left">
                     <thead className="bg-black text-white sticky top-0">
                       <tr>
                         <th className="p-3 text-[10px] font-black uppercase">{t("models.table_name") || "Model Name"}</th>
                         <th className="p-3 text-[10px] font-black uppercase">{t("models.table_id") || "Model ID"}</th>
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
                      {t("models.no_models") || "No models found for this channel."}
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
                {t("common.close") || "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Code Modal */}
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

      {/* AI Studio Modal (API Key) */}
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
              {t("credentials.aistudio_title") || "Connect AI Studio"}
            </h3>
            <div className="bg-[#FFD500]/20 border-l-8 border-[#FFD500] p-4 mb-6">
              <p className="text-black text-xs font-bold">
                 {t("credentials.aistudio_hint") || "Get your API Key from"} <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline font-black">Google AI Studio</a>.
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

      {/* Vertex Modal (Service Account JSON) */}
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
              {t("credentials.vertex_title") || "Connect Vertex AI"}
            </h3>
            <p className="text-gray-500 text-xs font-bold mb-6">
              {t("credentials.vertex_desc") || "Paste your Service Account JSON key."}
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
                    <button 
                      onClick={() => fetchProviderModels(p.id, p.name)}
                      className="mt-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-800 underline decoration-2 underline-offset-2"
                    >
                      <List className="w-3 h-3" />
                      {t("models.view_list") || "View Models"}
                    </button>
                  </td>
                  <td className="p-4 border-r-2 border-black text-center align-middle">
                    <span className="inline-flex items-center px-2 py-1 bg-[#005C9A]/10 border-2 border-[#005C9A] text-[#005C9A] text-[10px] font-bold uppercase rounded-none">
                      <Globe className="w-3 h-3 mr-1" />{" "}
                      {t("credentials.type_oauth")}
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
                  </td>
                  <td className="p-6 border-r-4 border-black last:border-0 relative">
                    {isConnected ? (
                      <div className="flex gap-4 items-center justify-end">
                        <span className="flex items-center gap-2 px-3 py-1 bg-emerald-500 text-white font-black text-[10px] uppercase border-2 border-black">
                          <div className="w-2 h-2 bg-white animate-pulse" />
                          {t("common.ready")}
                        </span>
                        <button
                          className="text-xs font-black uppercase underline hover:text-[#DA0414] transition-colors"
                          onClick={() => handleDelete(p.id)}
                        >
                          {t("common.revoke")}
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
