import { Wrench, Save, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { type ReactNode, useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        toast.error(t('settings.toast_load_fail'));
        setLoading(false);
      });
  }, []);

  const handleUpdate = async (key: string, value: string) => {
    setSaving(key);
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
        if (res.ok) {
            setSettings(prev => ({ ...prev, [key]: value }));
            toast.success(t('settings.saved'));
        } else {
            toast.error(t('settings.toast_save_fail'));
        }
    } catch {
        toast.error(t('credentials.toast_net_error'));
    } finally {
        setSaving(null);
    }
  };

  if (loading) return <div className="p-8"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6">
       <div className="flex items-center gap-4 border-b-4 border-black pb-4">
          <div className="bg-[#DA0414] text-white p-3 border-2 border-black">
             <Wrench className="w-8 h-8" />
          </div>
          <h2 className="text-4xl font-black uppercase text-black">{t('settings.title')}</h2>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Section title={t('settings.general_title')} color="bg-[#005C9A]">
             <SettingInput label={t('settings.sys_name')} sKey="system_name" value={settings['system_name']} onSave={handleUpdate} saving={saving === 'system_name'} />
             <SettingSelect label={t('settings.maint_mode')} sKey="maintenance_mode" value={settings['maintenance_mode']} options={["true", "false"]} onSave={handleUpdate} saving={saving === 'maintenance_mode'} />
             <SettingSelect label={t('settings.log_level')} sKey="log_level" value={settings['log_level']} options={["DEBUG", "INFO", "WARN", "ERROR"]} onSave={handleUpdate} saving={saving === 'log_level'} />
          </Section>

          <Section title={t('settings.security_title')} color="bg-[#DA0414]">
             <SettingInput label={t('settings.api_key')} sKey="api_key" value={settings['api_key']} onSave={handleUpdate} saving={saving === 'api_key'} type="password" />
             <SettingInput label={t('settings.token_expiry')} sKey="token_expiry" value={settings['token_expiry']} onSave={handleUpdate} saving={saving === 'token_expiry'} />
             <SettingSelect label={t('settings.allow_reg')} sKey="allow_registration" value={settings['allow_registration']} options={["true", "false"]} onSave={handleUpdate} saving={saving === 'allow_registration'} />
          </Section>

          <Section title={t('settings.provider_title')} color="bg-[#FFD500]" textColor="text-black">
             <SettingSelect label={t('settings.default_provider')} sKey="default_provider" value={settings['default_provider']} options={["Antigravity", "Claude", "Gemini"]} onSave={handleUpdate} saving={saving === 'default_provider'} />
             <SettingSelect label={t('settings.fallback')} sKey="failure_fallback" value={settings['failure_fallback']} options={["true", "false"]} onSave={handleUpdate} saving={saving === 'failure_fallback'} />
             <SettingInput label={t('settings.retry')} sKey="max_retries" value={settings['max_retries']} onSave={handleUpdate} saving={saving === 'max_retries'} />
          </Section>
       </div>
    </div>
  )
}

interface SectionProps {
  title: string;
  children: ReactNode;
  color: string;
  textColor?: string;
}

function Section({ title, children, color, textColor = 'text-white' }: SectionProps) {
  return (
    <div className="border-4 border-black b-shadow">
       <div className={cn("p-4 border-b-4 border-black font-bold uppercase tracking-widest", color, textColor)}>
         {title}
       </div>
       <div className="bg-white p-6 space-y-4">
         {children}
       </div>
    </div>
  )
}


interface SettingInputProps {
    label: string;
    sKey: string;
    value: string;
    onSave: (key: string, value: string) => void;
    saving: boolean;
    type?: string;
}

function SettingInput({ label, sKey, value, onSave, saving, type = "text" }: SettingInputProps) {
    const [localValue, setLocalValue] = useState(value);
    
    // reset local value if external changes
    useEffect(() => { setLocalValue(value) }, [value]);

    return (
        <div className="flex flex-col gap-2 mb-6">
           <label htmlFor={sKey} className="b-label">{label}</label>
           <div className="flex gap-2 items-center group">
               <div className="relative flex-1">
                 <Input
                   id={sKey}
                   name={sKey}
                   type={type}
                   value={localValue || ''}
                   onChange={e => setLocalValue(e.target.value)}
                   className="b-input w-full"
                 />
                 <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none">
                    <span className="text-[10px] font-bold bg-[#FFD500] px-1 border border-black">{t('settings.editing')}</span>
                 </div>
               </div>

               <button
                 onClick={() => onSave(sKey, localValue)}
                 disabled={saving || localValue === value}
                 className="b-btn b-btn-icon hover:bg-[#005C9A] disabled:opacity-20 disabled:hover:bg-transparent"
                 title={t('common.save')}
               >
                 {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
               </button>
           </div>
        </div>
    )
}

interface SettingSelectProps {
    label: string;
    sKey: string;
    value: string;
    options: string[];
    onSave: (key: string, value: string) => void;
    saving: boolean;
}

function SettingSelect({ label, sKey, value, options, onSave, saving }: SettingSelectProps) {
    return (
        <div className="flex flex-col gap-2 mb-6">
           <label htmlFor={sKey} className="b-label">{label}</label>
           <div className="flex gap-2 items-center">
               <select 
                 id={sKey}
                 name={sKey}
                 value={value} 
                 onChange={e => onSave(sKey, e.target.value)}
                 disabled={saving}
                 className="b-input w-full appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%20stroke%3D%22black%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%222%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-size-[1.5em_1.5em] bg-position-[right_0.5rem_center] bg-no-repeat pr-10"
               >
                  {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
               </select>
               {saving && <div className="p-2"><Loader2 className="w-5 h-5 animate-spin" /></div>}
           </div>
        </div>
    )
}
