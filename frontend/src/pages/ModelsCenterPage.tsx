import { useState, useEffect } from "react";
import { 
  Box, 
  Search, 
  Terminal, 
  Code2, 
  Copy, 
  CheckCircle2, 
  ChevronRight, 
  Cpu, 
  Code, 
  Zap, 
  Layers
} from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";
import { client } from "../lib/client";
import { toast } from "sonner";

interface Model {
  id: string;
  name: string;
  provider: string;
  capability?: "general" | "reasoning" | "coding";
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

export function ModelsCenterPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await client.api.models.$get();
        if (res.ok) {
          const data = await res.json() as any[];
          const processed = data.map(m => ({
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

  const baseUrl = `${window.location.protocol}//${window.location.host}/api`;

  const codeExamples = {
    curl: `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_SECRET" \\
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="YOUR_API_SECRET"
)

response = client.chat.completions.create(
    model="claude-3-5-sonnet",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)`,
    js: `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${baseUrl}',
  apiKey: 'YOUR_API_SECRET'
});

const stream = await client.chat.completions.create({
  model: 'claude-3-5-sonnet',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});`
  };

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Left Column: Catalog */}
        <div className="lg:col-span-2 space-y-8">
          <SectionTitle title={t("models.catalog")} icon={<Box className="w-6 h-6" />} color="bg-[#005C9A]" />
          
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-32 bg-gray-100 border-4 border-black animate-pulse" />
              ))
            ) : filteredModels.length > 0 ? (
              filteredModels.map((m) => (
                <ModelCard key={m.id} model={m} />
              ))
            ) : (
              <div className="col-span-full py-20 text-center border-4 border-dashed border-black/20 text-gray-400 font-black uppercase italic">
                No models matches your search
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Integration Guide */}
        <div className="space-y-8">
          <SectionTitle title={t("models.integration")} icon={<Terminal className="w-6 h-6" />} color="bg-[#DA0414]" />
          
          <div className="bg-white border-4 border-black b-shadow p-6 space-y-6">
            <div className="space-y-2">
              <h4 className="font-black uppercase text-[#DA0414] text-lg flex items-center gap-2">
                <ChevronRight className="w-5 h-5" />
                {t("models.endpoint_url")}
              </h4>
              <div className="flex gap-2 items-center">
                <code className="flex-1 p-3 bg-gray-100 font-mono text-sm border-2 border-black break-all">
                  {baseUrl}
                </code>
                <button 
                  onClick={() => handleCopy(baseUrl, 'endpoint')}
                  className="p-3 bg-black text-white border-2 border-black hover:bg-[#DA0414] transition-colors"
                >
                  {copiedKey === 'endpoint' ? <CheckCircle2 className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-black uppercase text-[#DA0414] text-lg flex items-center gap-2">
                <ChevronRight className="w-5 h-5" />
                {t("models.auth_header")}
              </h4>
              <code className="block p-3 bg-black text-[#FFD500] font-mono text-xs border-2 border-black">
                Authorization: Bearer YOUR_API_SECRET
              </code>
            </div>

            <hr className="border-2 border-black/10" />

            <div className="space-y-4">
              <h4 className="font-black uppercase text-black text-xl flex items-center gap-2">
                <Code2 className="w-6 h-6" />
                {t("models.example_code")}
              </h4>
              <p className="text-sm text-gray-600 font-medium">
                {t("models.integration_desc")}
              </p>
              
              <CodeBlock title="cURL" code={codeExamples.curl} onCopy={() => handleCopy(codeExamples.curl, 'curl')} isCopied={copiedKey === 'curl'} />
              <CodeBlock title="Python (OpenAI SDK)" code={codeExamples.python} onCopy={() => handleCopy(codeExamples.python, 'python')} isCopied={copiedKey === 'python'} />
              <CodeBlock title="Node.js (OpenAI SDK)" code={codeExamples.js} onCopy={() => handleCopy(codeExamples.js, 'js')} isCopied={copiedKey === 'js'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, icon, color }: { title: string; icon: React.ReactNode; color: string }) {
  return (
        <div className="flex items-center gap-4">
          <div className={cn("p-2 text-white border-2 border-black", color)}>
            {icon}
          </div>
          <h3 className="text-3xl font-black uppercase tracking-tight text-black">
            {title}
          </h3>
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

function CodeBlock({ title, code, onCopy, isCopied }: { title: string; code: string; onCopy: () => void; isCopied: boolean }) {
  return (
    <div className="space-y-2 border-2 border-black overflow-hidden bg-[#F8F8F8]">
      <div className="flex justify-between items-center bg-black px-3 py-1 text-[10px] font-black uppercase text-white">
        <span>{title}</span>
        <button onClick={onCopy} className="hover:text-[#FFD500] transition-colors uppercase">
          {isCopied ? "Success" : "Copy"}
        </button>
      </div>
      <pre className="p-4 font-mono text-[11px] leading-relaxed overflow-x-auto custom-scrollbar whitespace-pre text-black">
        {code}
      </pre>
    </div>
  );
}
