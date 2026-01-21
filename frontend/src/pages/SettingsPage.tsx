import { Wrench, Save, Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "../lib/utils";
import { type ReactNode, useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { Input } from "../components/ui/input";
import { CustomSelect } from "../components/CustomSelect";
import { toast } from "sonner";
import { client, getApiSecret, setApiSecret } from "../lib/client";

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await client.api.settings.$get();
        if (res.ok) {
           const data = await res.json();
           setSettings(data as Record<string, string>);
        }
      } catch (err) {
        console.error(err);
        toast.error(t("settings.toast_load_fail"));
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleUpdate = async (key: string, value: string) => {
    setSaving(key);
    try {
      // client.api.settings.$post({ json: { key, value } })
      const res = await client.api.settings.$post({
        json: { key, value }
      });
      if (!res.ok) throw new Error();
      setSettings((prev) => ({ ...prev, [key]: value }));
      toast.success(t("settings.saved"));
    } catch {
      toast.error(t("settings.toast_save_fail"));
    } finally {
      setSaving(null);
    }
  };

  if (loading)
    return (
      <div className="p-8">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6 border-b-8 border-black pb-6">
        <div className="bg-[#DA0414] text-white p-4 border-4 border-black b-shadow">
          <Wrench className="w-10 h-10" />
        </div>
        <div>
          <h2 className="text-5xl font-black uppercase text-black tracking-tighter">
            {t("settings.title")}
          </h2>
          <div className="h-2 bg-black w-24 mt-1" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Section title={t("settings.general_title")} color="bg-[#005C9A]">
          <SettingInput
            label={t("settings.sys_name")}
            sKey="system_name"
            value={settings["system_name"]}
            onSave={handleUpdate}
            saving={saving === "system_name"}
          />
          <SettingSelect
            label={t("settings.maint_mode")}
            sKey="maintenance_mode"
            value={settings["maintenance_mode"]}
            options={["true", "false"]}
            onSave={handleUpdate}
            saving={saving === "maintenance_mode"}
          />
          <SettingSelect
            label={t("settings.log_level")}
            sKey="log_level"
            value={settings["log_level"]}
            options={["DEBUG", "INFO", "WARN", "ERROR"]}
            onSave={handleUpdate}
            saving={saving === "log_level"}
          />
        </Section>

        <Section title={t("settings.security_title")} color="bg-[#DA0414]">
          {/* 本地 API Secret - 存储在浏览器 localStorage 中 */}
          <LocalSecretInput
            label={t("settings.local_api_secret") || "Local API Secret"}
            description={t("settings.local_api_secret_desc") || "Stored in browser, used for API authentication"}
          />
          <SettingInput
            label={t("settings.api_key")}
            sKey="api_key"
            value={settings["api_key"]}
            onSave={handleUpdate}
            saving={saving === "api_key"}
            type="password"
          />
          <SettingInput
            label={t("settings.token_expiry")}
            sKey="token_expiry"
            value={settings["token_expiry"]}
            onSave={handleUpdate}
            saving={saving === "token_expiry"}
          />
          <SettingSelect
            label={t("settings.allow_reg")}
            sKey="allow_registration"
            value={settings["allow_registration"]}
            options={["true", "false"]}
            onSave={handleUpdate}
            saving={saving === "allow_registration"}
          />
        </Section>

        <Section
          title={t("settings.provider_title")}
          color="bg-[#FFD500]"
          textColor="text-black"
        >
          <SettingSelect
            label={t("settings.default_provider")}
            sKey="default_provider"
            value={settings["default_provider"]}
            options={["Antigravity", "Claude", "Gemini"]}
            onSave={handleUpdate}
            saving={saving === "default_provider"}
          />
          <SettingSelect
            label={t("settings.fallback")}
            sKey="failure_fallback"
            value={settings["failure_fallback"]}
            options={["true", "false"]}
            onSave={handleUpdate}
            saving={saving === "failure_fallback"}
          />
          <SettingInput
            label={t("settings.retry")}
            sKey="max_retries"
            value={settings["max_retries"]}
            onSave={handleUpdate}
            saving={saving === "max_retries"}
          />
        </Section>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
  color: string;
  textColor?: string;
}

function Section({
  title,
  children,
  color,
  textColor = "text-white",
}: SectionProps) {
  return (
    <div className="border-4 border-black b-shadow group hover:translate-x-[-2px] hover:translate-y-[-2px] transition-all">
      <div
        className={cn(
          "p-6 border-b-4 border-black font-black uppercase tracking-widest text-lg",
          color,
          textColor,
        )}
      >
        {title}
      </div>
      <div className="bg-white p-8 space-y-8">{children}</div>
    </div>
  );
}

interface SettingInputProps {
  label: string;
  sKey: string;
  value: string;
  onSave: (key: string, value: string) => void;
  saving: boolean;
  type?: string;
}

function SettingInput({
  label,
  sKey,
  value,
  onSave,
  saving,
  type = "text",
}: SettingInputProps) {
  const [localValue, setLocalValue] = useState(value);

  // 如果外部发生变化，重置本地值
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-2 mb-6">
      <label htmlFor={sKey} className="b-label">
        {label}
      </label>
      <div className="flex gap-2 items-center group">
        <div className="relative flex-1">
          <Input
            id={sKey}
            name={sKey}
            type={type}
            value={localValue || ""}
            onChange={(e) => setLocalValue(e.target.value)}
            className="b-input w-full"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none">
            <span className="text-[10px] font-bold bg-[#FFD500] px-1 border border-black">
              {t("settings.editing")}
            </span>
          </div>
        </div>

        <button
          onClick={() => onSave(sKey, localValue)}
          disabled={saving || localValue === value}
          className="b-btn b-btn-icon hover:bg-[#005C9A] disabled:opacity-20 disabled:hover:bg-transparent"
          title={t("common.save")}
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
}

interface SettingSelectProps {
  label: string;
  sKey: string;
  value: string;
  options: string[];
  onSave: (key: string, value: string) => void;
  saving: boolean;
}

function SettingSelect({
  label,
  sKey,
  value,
  options,
  onSave,
  saving,
}: SettingSelectProps) {
  return (
    <div className="flex flex-col gap-2 mb-6">
      <label htmlFor={sKey} className="b-label">
        {label}
      </label>
      <div className="flex gap-2 items-center">
        <CustomSelect
          id={sKey}
          name={sKey}
          value={value}
          onChange={(val) => onSave(sKey, val)}
          disabled={saving}
          options={options.map(o => ({ id: o, name: o }))}
          className="w-full"
        />
        {saving && (
          <div className="p-2">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * LocalSecretInput - 存储在浏览器 localStorage 中的 API Secret 配置
 * 这允许前端自动在 API 调用中包含 Authorization 标头
 */
function LocalSecretInput({ label, description }: { label: string; description: string }) {
  const [value, setValue] = useState(() => getApiSecret());
  const [saved, setSaved] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const handleSave = () => {
    setApiSecret(value);
    setSaved(true);
    toast.success(t("settings.saved"));
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-2 mb-6">
      <label htmlFor="local-api-secret" className="b-label">{label}</label>
      <p className="text-sm text-gray-600 mb-1">{description}</p>
      <div className="flex gap-2 items-center">
        <div className="relative w-full">
          <Input
            id="local-api-secret"
            name="local-api-secret"
            type={showSecret ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter your API Secret"
            className="w-full pr-10"
          />
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black transition-colors"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saved}
          className={cn(
            "flex items-center gap-1 px-3 py-2 border-4 border-black b-shadow",
            saved ? "bg-green-500 text-white" : "bg-[#FFD000] hover:bg-[#ffdd33]"
          )}
        >
          {saved ? "✓" : <Save className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
