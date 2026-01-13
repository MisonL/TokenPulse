import { useState, useEffect, useRef } from 'react'
import { Zap, Globe } from 'lucide-react'
import { cn } from '../lib/utils'
import { toast } from 'sonner'
import { t } from '../lib/i18n'

interface Provider {
  id: string;
  name: string;
  desc: string;
  type: string;
  icon: string;
}

const PROVIDERS: Provider[] = [
  { id: 'claude', name: 'Claude', desc: 'Anthropic AI', type: 'oauth', icon: '/assets/icons/claude.png' },
  { id: 'gemini', name: 'Gemini', desc: 'Google DeepMind', type: 'oauth', icon: '/assets/icons/gemini.png' },
  { id: 'antigravity', name: 'Antigravity', desc: 'Google AI IDE', type: 'oauth', icon: '/assets/icons/antigravity.png' },
  { id: 'kiro', name: 'Kiro', desc: 'Amazon AWS AI IDE', type: 'oauth', icon: '/assets/icons/kiro.png' },
  { id: 'codex', name: 'Codex', desc: 'OpenAI Responses', type: 'oauth', icon: '/assets/icons/codex.png' },
  { id: 'qwen', name: 'Qwen', desc: 'Alibaba Cloud', type: 'oauth', icon: '/assets/icons/qwen.png' },
  { id: 'iflow', name: 'iFlow', desc: '阿里巴巴心流', type: 'oauth', icon: '/assets/icons/iflow.png' },
  { id: 'aistudio', name: 'AI Studio', desc: 'Google Cloud', type: 'oauth', icon: '/assets/icons/aistudio.png' }
]

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
  const [credentials, setCredentials] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [deviceModal, setDeviceModal] = useState<DeviceModal | null>(null);
  const [search, setSearch] = useState('');
  
  // 跟踪所有定时器，以便在组件卸载时清理
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 清理所有定时器
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current = [];
    };
  }, []);

  const fetchCredentials = async () => {
    try {
        const res = await fetch('/api/credentials/status');
        if (res.ok) {
            setCredentials(await res.json());
        }
    } catch {
        // Ignored
    }
  }

  useEffect(() => {
    fetchCredentials();
  }, [])

  const handleDelete = async (provider: string) => {
      if (!confirm(t('credentials.disconnect_default'))) return;

      setLoading(prev => ({ ...prev, [provider]: true }));
      try {
          const res = await fetch(`/api/credentials/${provider}`, { method: 'DELETE' });
          if (res.ok) {
              toast.success(t('credentials.toast_disconnected', { provider }));
              fetchCredentials();
          } else {
              toast.error(t('credentials.toast_disconnect_fail'));
          }
      } catch {
          toast.error(t('credentials.toast_net_error'));
      } finally {
        setLoading(prev => ({ ...prev, [provider]: false }));
      }
  }

  const handlePoll = async () => {
      if (!deviceModal) return;

      let url = '';
      let body = {};

      if (deviceModal.provider === 'qwen') {
          url = `/api/credentials/auth/qwen/poll`;
          body = { device_code: deviceModal.device_code, code_verifier: deviceModal.code_verifier };
      } else if (deviceModal.provider === 'kiro') {
          url = `/api/credentials/auth/kiro/poll`;
          body = {
              deviceCode: deviceModal.device_code,
              clientId: deviceModal.clientId,
              clientSecret: deviceModal.clientSecret
          };
      } else {
          return;
      }

      try {
          const res = await fetch(url, {
              method: 'POST',
              body: JSON.stringify(body)
          });
          const data = await res.json();

          if (data.accessToken || data.success) {
                  toast.success(t('credentials.toast_connected', { provider: deviceModal.provider }));
                  setDeviceModal(null);
                  fetchCredentials();
          } else if (data.pending) {
              toast.info(t('credentials.toast_waiting'));
          } else {
              toast.error(data.error || t('credentials.toast_auth_fail'));
          }
      } catch {
          toast.error(t('credentials.toast_poll_fail'));
      }
  };

  const handleConnect = async (p: Provider) => {
      if (p.id === 'qwen') {
          try {
              const res = await fetch(`/api/credentials/auth/qwen/start`, { method: 'POST' });
              if (!res.ok) throw new Error("Start failed");
              const data = await res.json();
              setDeviceModal({ ...data, provider: 'qwen' });
          } catch {
              toast.error(t('credentials.toast_start_fail'));
          }
      } else if (p.id === 'kiro') {
          try {
              const res = await fetch(`/api/credentials/auth/kiro/start`, { method: 'POST' });
              if (!res.ok) throw new Error("Start failed");
              const data = await res.json();
              setDeviceModal({
                  user_code: data.userCode,
                  verification_uri: data.verificationUri,
                  verification_uri_complete: data.verificationUriComplete,
                  device_code: data.deviceCode,
                  provider: 'kiro',
                  clientId: data.clientId,
                  clientSecret: data.clientSecret,
                  code_verifier: '' // Kiro doesn't use it in poll but modal needs it for TS
              });
          } catch {
              toast.error(t('credentials.toast_kiro_fail'));
          }
      } else if (p.id === 'codex') {
          try {
              const res = await fetch(`/api/credentials/auth/codex/url`, { method: 'POST' });
              const data = await res.json();

              if (data.url) {
                  const width = 600;
                  const height = 700;
                  const left = (window.screen.width - width) / 2;
                  const top = (window.screen.height - height) / 2;

                  const authWindow = window.open(data.url, 'Codex Auth', `width=${width},height=${height},top=${top},left=${left}`);

                  const pollInterval = setInterval(async () => {
                      if (authWindow?.closed) {
                          clearInterval(pollInterval);
                          fetchCredentials();
                          return;
                      }

                      try {
                          const statusRes = await fetch(`/api/credentials/status`);
                          const statusData = await statusRes.json();
                          if (statusData.codex) {
                              clearInterval(pollInterval);
                              authWindow?.close();
                              toast.success(t('credentials.toast_connected', { provider: 'Codex' }));
                              fetchCredentials();
                          }
                      } catch {
                          // Silent check
                      }
                  }, 2000);

                  const timeoutTimer = setTimeout(() => clearInterval(pollInterval), 120000);
                  timersRef.current.push(pollInterval as unknown as ReturnType<typeof setTimeout>, timeoutTimer);
              }
          } catch {
              toast.error(t('credentials.toast_codex_fail'));
          }
      } else if (p.id === 'iflow') {
          try {
              const res = await fetch(`/api/credentials/auth/iflow/url`, { method: 'POST' });
              const data = await res.json();

              if (data.url) {
                  const width = 600;
                  const height = 700;
                  const left = (window.screen.width - width) / 2;
                  const top = (window.screen.height - height) / 2;

                  const authWindow = window.open(data.url, 'iFlow Auth', `width=${width},height=${height},top=${top},left=${left}`);

                  const pollInterval = setInterval(async () => {
                      if (authWindow?.closed) {
                          clearInterval(pollInterval);
                          fetchCredentials();
                          return;
                      }

                      try {
                          const statusRes = await fetch(`/api/credentials/status`);
                          const statusData = await statusRes.json();
                          if (statusData.iflow) {
                              clearInterval(pollInterval);
                              authWindow?.close();
                              toast.success(t('credentials.toast_connected', { provider: 'iFlow' }));
                              fetchCredentials();
                          }
                      } catch {
                          // Silent check
                      }
                  }, 2000);

                  const timeoutTimer = setTimeout(() => clearInterval(pollInterval), 120000);
                  timersRef.current.push(pollInterval as unknown as ReturnType<typeof setTimeout>, timeoutTimer);
              }
          } catch {
              toast.error(t('credentials.toast_iflow_fail'));
          }
      } else if (p.id === 'gemini') {
           try {
              const res = await fetch(`/api/credentials/auth/gemini/url`, { method: 'POST' });
              const data = await res.json();
              if (data.url) createDataWindow(data.url, 'gemini');
           } catch { toast.error(t('credentials.toast_gemini_fail')); }
      } else if (p.id === 'claude') {
           try {
              const res = await fetch(`/api/credentials/auth/claude/url`, { method: 'POST' });
              const data = await res.json();
              if (data.url) createDataWindow(data.url, 'claude');
           } catch { toast.error(t('credentials.toast_claude_fail')); }
      } else if (p.id === 'aistudio') {
          setShowVertex(true);
      } else {
         toast.info(t('credentials.toast_coming_soon'));
      }
  };
  
  const createDataWindow = (url: string, provider: string) => {
      const width = 600;
      const height = 700;
      const left = (window.screen.width - width) / 2;
      const top = (window.screen.height - height) / 2;

      const authWindow = window.open(url, provider, `width=${width},height=${height},top=${top},left=${left}`);

      const pollInterval = setInterval(async () => {
          if (authWindow?.closed) {
              clearInterval(pollInterval);
              fetchCredentials();
              return;
          }
          try {
              const statusRes = await fetch(`/api/credentials/status`);
              const statusData = await statusRes.json();
              if (statusData[provider]) {
                  clearInterval(pollInterval);
                  authWindow?.close();
                  toast.success(t('credentials.toast_connected', { provider }));
                  fetchCredentials();
              }
          } catch {
              // Silent check
          }
      }, 2000);
      const timeoutTimer = setTimeout(() => clearInterval(pollInterval), 120000);
      timersRef.current.push(pollInterval as unknown as ReturnType<typeof setTimeout>, timeoutTimer);
  };

  const [showVertex, setShowVertex] = useState(false);
  const [vertexJson, setVertexJson] = useState('');

  const saveVertex = async () => {
      try {
          const res = await fetch(`/api/credentials/auth/aistudio/save`, {
              method: 'POST',
              body: JSON.stringify({ serviceAccountJson: vertexJson })
          });
          const data = await res.json();
          if (data.success) {
              toast.success(t('credentials.toast_connected', { provider: 'AI Studio' }));
              setShowVertex(false);
              setVertexJson('');
              fetchCredentials();
          } else {
              toast.error(data.error || t('credentials.toast_save_fail'));
          }
      } catch {
          toast.error(t('credentials.toast_save_fail'));
      }
  };

  return (
    <div className="space-y-6">
       
       {/* Device Code Modal */}
        {deviceModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white border-4 border-black p-8 max-w-md w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <h3 className="text-xl font-black uppercase mb-4">{t('credentials.connect_provider', { provider: deviceModal.provider })}</h3>
                    <p className="mb-4 whitespace-pre-line">{t('credentials.device_instructions')}</p>
                    
                    <div className="bg-gray-100 p-4 font-mono text-center text-2xl tracking-widest font-bold select-all border-2 border-dashed border-gray-300 mb-6">
                        {deviceModal.user_code}
                    </div>

                    <div className="flex flex-col gap-3">
                        <a
                            href={deviceModal.verification_uri_complete || deviceModal.verification_uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="b-btn b-btn-primary text-center justify-center"
                        >
                            {t('credentials.open_login_page')}
                        </a>
                        
                        <div className="grid grid-cols-2 gap-3">
                             <button onClick={handlePoll} className="b-btn bg-[#FFD500] hover:bg-[#ffe033]">{t('credentials.check_status')}</button>
                             <button onClick={() => setDeviceModal(null)} className="b-btn bg-red-100 hover:bg-red-200">{t('common.cancel')}</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

       {/* Vertex Modal */}
      {showVertex && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-[#1e1e2e] border border-white/10 rounded-xl p-6 max-w-lg w-full shadow-2xl relative">
                <button onClick={() => setShowVertex(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">✕</button>
                <h3 className="text-xl font-black mb-4 uppercase">{t('credentials.vertex_title')}</h3>
                <p className="text-gray-400 text-sm mb-4">
                    {t('credentials.vertex_desc')}
                </p>
                <label htmlFor="vertex-json" className="sr-only">{t('common.service_account_json')}</label>
                <textarea
                    id="vertex-json"
                    name="vertex-json"
                    className="w-full h-48 bg-black/30 border border-white/10 rounded-lg p-3 text-xs font-mono text-gray-300 focus:border-teal-500 outline-none resize-none"
                    value={vertexJson}
                    onChange={(e) => setVertexJson(e.target.value)}
                    placeholder='{"type": "service_account", ...}'
                ></textarea>
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => setShowVertex(false)} className="px-4 py-2 hover:bg-white/10 rounded-lg text-gray-300">{t('common.cancel')}</button>
                    <button onClick={saveVertex} className="px-6 py-2 bg-teal-600 hover:bg-teal-500 text-black font-bold rounded-lg">{t('common.save')}</button>
                </div>
            </div>
        </div>
      )}

       <div className="flex items-center justify-between border-b-4 border-black pb-4">
          <div className="flex items-center gap-4">
              <div className="bg-[#FFD500] text-black p-3 border-2 border-black">
                <Zap className="w-8 h-8" />
              </div>
              <h2 className="text-4xl font-black uppercase text-black">{t('credentials.title')}</h2>
          </div>
           <div className="relative">
               <label htmlFor="provider-search" className="sr-only">{t('credentials.search_providers')}</label>
               <input
                  id="provider-search"
                  name="provider-search"
                  type="text"
                  placeholder={t('credentials.search_providers')}
                  className="border-2 border-black px-3 py-2 font-mono text-sm focus:bg-[#FFD500] focus:outline-none transition-colors w-64"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
               />
           </div>
       </div>

       <div className="bg-white border-4 border-black p-0 overflow-hidden b-shadow">
          <table className="w-full text-left border-collapse">
             <thead className="bg-[#1A1A1A] text-white">
                <tr>
                   <th className="p-4 uppercase tracking-wider border-r border-white/20 w-16 text-center">{t('credentials.table_icon')}</th>
                   <th className="p-4 uppercase tracking-wider border-r border-white/20">{t('credentials.table_provider')}</th>
                   <th className="p-4 uppercase tracking-wider border-r border-white/20 text-center w-32">{t('credentials.table_type')}</th>
                   <th className="p-4 uppercase tracking-wider border-r border-white/20 text-center w-32">{t('credentials.table_status')}</th>
                   <th className="p-4 uppercase tracking-wider text-right">{t('credentials.table_action')}</th>
                </tr>
             </thead>
             <tbody className="divide-y-2 divide-black">
                {PROVIDERS.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.desc.toLowerCase().includes(search.toLowerCase())).map(p => {
                    const isConnected = !!credentials[p.id];
                    return (
                   <tr key={p.id} className="hover:bg-blue-50 transition-colors group">
                      <td className="p-4 border-r-2 border-black text-center text-2xl align-middle">
                         {p.icon.startsWith('/') ? <img src={p.icon} className="w-8 h-8 mx-auto" alt={p.name} /> : p.icon}
                      </td>
                      <td className="p-4 border-r-2 border-black align-middle">
                         <div className="font-black text-lg">{p.name}</div>
                         <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">{p.desc}</div>
                      </td>
                      <td className="p-4 border-r-2 border-black text-center align-middle">
                         <span className="inline-flex items-center px-2 py-1 bg-[#005C9A]/10 border-2 border-[#005C9A] text-[#005C9A] text-[10px] font-bold uppercase rounded-none">
                            <Globe className="w-3 h-3 mr-1" /> {t('credentials.type_oauth')}
                         </span>
                      </td>
                      <td className="p-4 border-r-2 border-black text-center align-middle">
                          <div className="flex items-center justify-center gap-2">
                             <div className={cn(
                               "w-3 h-3 rounded-full border-2 border-black transition-colors duration-300",
                                isConnected ? "bg-green-500" : "bg-gray-300"
                             )} />
                             <span className={cn(
                                 "font-mono text-xs font-bold uppercase",
                                 isConnected ? "text-black" : "text-gray-400"
                             )}>
                               {isConnected ? t('credentials.status_connected') : t('credentials.status_disconnected')}
                             </span>
                         </div>
                      </td>
                      <td className="p-4 border-r-2 border-black last:border-0 relative">
                          {isConnected ? (
                             <div className="flex gap-2 items-center justify-end">
                                  <span className="text-emerald-700 font-bold text-xs uppercase bg-emerald-100 px-2 py-1 rounded-full border border-emerald-700">{t('common.ready')}</span>
                                  <button className="text-xs underline hover:text-red-600 font-bold" onClick={() => handleDelete(p.id)}>{t('common.revoke')}</button>
                             </div>
                         ) : (
                            <div className="flex gap-2 w-full justify-end">
                               {loading[p.id] ? (
                                 <span className="text-xs font-bold animate-pulse">{t('common.running')}</span>
                               ) : (
                                <button onClick={() => handleConnect(p)} className="b-btn text-xs py-1 px-3 bg-white hover:bg-gray-100">
                                  {t('common.connect')}
                                </button>
                               )}
                            </div>
                         )}
                      </td>
                   </tr>
                )})}
             </tbody>
          </table>
       </div>
    </div>
  )
}
