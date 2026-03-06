import { lazy, Suspense, useState, useEffect } from "react";
import { 
  Search, 
  Cpu, 
  Code, 
  Zap, 
  Layers
} from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { client } from "../lib/client";
import { toast } from "sonner";

interface RawModel {
  id: string;
  name: string;
  provider: string;
}

interface Model extends RawModel {
  capability: "general" | "reasoning" | "coding";
}

const CAPABILITY_MAP: Record<string, "general" | "reasoning" | "coding"> = {
  "claude-3-5-sonnet": "coding",
  "claude-3-opus": "reasoning",
  "claude-3-sonnet": "general",
  "claude-3-haiku": "general",
  "gemini-2.0-flash-thinking": "reasoning",
  "gemini-2.0-pro": "general",
  "qwen-max-2025-01": "general",
  "qv-max": "reasoning",
  "qwen2.5-coder": "coding",
};

const ModelsIntegrationGuide = lazy(() =>
  import("../components/models/ModelsIntegrationGuide").then((module) => ({
    default: module.ModelsIntegrationGuide,
  })),
);

export function ModelsCenterPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"models" | "guide">("models");

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await client.api.models.$get();
        if (res.ok) {
          const json = await res.json() as { data: RawModel[] };
          const processed: Model[] = (json.data || []).map(m => ({
            ...m,
            capability: Object.entries(CAPABILITY_MAP).find(([key]) => m.id.toLowerCase().includes(key))?.[1] || "general"
          }));
          setModels(processed);
        }
      } catch (err) {
        console.error(err);
        toast.error(t("settings.toast_load_fail"));
      } finally {
        setLoading(false);
      }
    };
    fetchModels();
  }, []);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success(t("models.copy_success"));
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredModels = models.filter(m => {
    const matchesSearch = m.id.toLowerCase().includes(search.toLowerCase()) || 
                         m.name.toLowerCase().includes(search.toLowerCase()) ||
                         m.provider.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === "all" || m.capability === category;
    return matchesSearch && matchesCategory;
  });

  const originBaseUrl = `${window.location.protocol}//${window.location.host}`;
  const gatewayV1BaseUrl = `${originBaseUrl}/v1`;

  return (
    <div className="space-y-10 pb-20">
      {/* Header */}
      <div className="flex items-center gap-6 border-b-8 border-black pb-8">
        <div className="bg-[#FFD500] text-black p-5 border-4 border-black b-shadow">
          <Layers className="w-12 h-12" />
        </div>
        <div>
          <h2 className="text-6xl font-black uppercase tracking-tighter text-black leading-none">
            {t("models.title")}
          </h2>
          <div className="h-3 bg-[#DA0414] w-48 mt-2" />
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex gap-4 border-b-4 border-black pb-4">
        <button
          onClick={() => setActiveTab("models")}
          className={cn(
            "px-8 py-3 font-black uppercase tracking-widest text-lg border-4 border-black transition-all",
            activeTab === "models" 
              ? "bg-[#005C9A] text-white shadow-[4px_4px_0_0_#000000]" 
              : "bg-white text-black hover:bg-gray-100"
          )}
        >
          {t("models.catalog")}
        </button>
        <button
          onClick={() => setActiveTab("guide")}
          className={cn(
            "px-8 py-3 font-black uppercase tracking-widest text-lg border-4 border-black transition-all",
            activeTab === "guide" 
              ? "bg-[#DA0414] text-white shadow-[4px_4px_0_0_#000000]" 
              : "bg-white text-black hover:bg-gray-100"
          )}
        >
          {t("models.integration")}
        </button>
      </div>

      {activeTab === "models" ? (
        <div className="space-y-8 animate-slide-in">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <label htmlFor="model-search" className="sr-only">
                {t("models.search_placeholder")}
              </label>
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
                id="model-search"
                name="model-search"
                type="text"
                placeholder={t("models.search_placeholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 border-4 border-black font-black text-sm focus:shadow-[4px_4px_0_0_#FFD500] outline-none transition-all"
              />
            </div>
            <div className="flex gap-2">
              {["all", "general", "reasoning", "coding"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "px-4 py-2 border-4 border-black font-black text-xs uppercase transition-all",
                    category === cat ? "bg-black text-white" : "bg-white hover:bg-gray-100"
                  )}
                >
                  {t(`models.categories.${cat}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-40 bg-gray-100 border-4 border-black animate-pulse" />
              ))
            ) : filteredModels.length > 0 ? (
              filteredModels.map((m) => (
                <ModelCard key={m.id} model={m} />
              ))
            ) : (
              <div className="col-span-full py-20 text-center border-4 border-dashed border-black/20 text-gray-400 font-black uppercase italic">
                暂无匹配当前筛选条件的模型
              </div>
            )}
          </div>
        </div>
      ) : (
        <Suspense fallback={<IntegrationGuideFallback />}>
          <ModelsIntegrationGuide
            copiedKey={copiedKey}
            gatewayV1BaseUrl={gatewayV1BaseUrl}
            onCopy={handleCopy}
          />
        </Suspense>
      )}
    </div>
  );
}

function ModelCard({ model }: { model: Model }) {
  const Icon = model.capability === "reasoning" ? Zap : model.capability === "coding" ? Code : Cpu;
  const colorClass = model.capability === "reasoning" ? "bg-[#FFD500]" : model.capability === "coding" ? "bg-[#005C9A]" : "bg-gray-200";
  const textColorClass = model.capability === "coding" ? "text-white" : "text-black";

  return (
    <div className="group border-4 border-black bg-white hover:translate-x-[-4px] hover:translate-y-[-4px] hover:shadow-[8px_8px_0_0_#000000] transition-all p-5 flex flex-col justify-between min-h-[160px]">
      <div>
        <div className="flex justify-between items-start mb-4">
          <div className={cn("p-2 border-2 border-black", colorClass, textColorClass)}>
            <Icon className="w-5 h-5" />
          </div>
          <span className="font-black text-[10px] uppercase bg-black text-white px-2 py-1 tracking-widest leading-none">
            {model.provider}
          </span>
        </div>
        <h4 className="font-black text-xl tracking-tighter truncate mb-1">
          {model.name}
        </h4>
        <p className="font-mono text-xs text-gray-500 truncate">
          ID: {model.id}
        </p>
      </div>
    </div>
  );
}

function IntegrationGuideFallback() {
  return (
    <div className="flex flex-col gap-10 animate-slide-in">
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 border-2 border-black bg-[#005C9A]" />
          <div className="h-10 w-48 bg-gray-100 border-2 border-black animate-pulse" />
        </div>
        <div className="h-72 border-4 border-black bg-gray-100 animate-pulse" />
      </div>
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 border-2 border-black bg-[#DA0414]" />
          <div className="h-10 w-56 bg-gray-100 border-2 border-black animate-pulse" />
        </div>
        <div className="h-[42rem] border-4 border-black bg-gray-100 animate-pulse" />
      </div>
    </div>
  );
}
