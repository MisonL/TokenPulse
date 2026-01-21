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

const response = await client.chat.completions.create({
  model: 'antigravity:claude-3-5-sonnet',
  messages: [{ role: 'user', content: 'Hello!' }],
});`,
    ts: `import OpenAI from 'openai';

const client: OpenAI = new OpenAI({
  baseURL: '${baseUrl}',
  apiKey: 'YOUR_API_SECRET'
});

async function main() {
  const response = await client.chat.completions.create({
    model: 'antigravity:claude-3-5-sonnet',
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  console.log(response.choices[0].message.content);
}

main();`,
    go: `package main

import (
    "context"
    "fmt"
    "github.com/openai/openai-go"
    "github.com/openai/openai-go/option"
)

func main() {
    client := openai.NewClient(
        option.WithBaseURL("${baseUrl}"),
        option.WithAPIKey("YOUR_API_SECRET"),
    )

    resp, _ := client.Chat.Completions.New(context.TODO(), openai.ChatCompletionNewParams{
        Model: openai.F("antigravity:claude-3-5-sonnet"),
        Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
            openai.UserMessage("Hello!"),
        }),
    })

    fmt.Println(resp.Choices[0].Message.Content)
}`
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
                No models matches your search
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-10 animate-slide-in">
          {/* Tool Integration */}
          <div className="space-y-8">
            <SectionTitle title={t("models.tool_integration")} icon={<Box className="w-6 h-6" />} color="bg-[#005C9A]" />
            <div className="border-4 border-black p-8 bg-white shadow-[8px_8px_0_0_#000000] space-y-8">
              <div className="space-y-4">
                <p className="font-black text-sm uppercase text-[#005C9A] flex items-center gap-2">
                  <Terminal className="w-5 h-5" /> Claude Code (命令行工具)
                </p>
                <div className="p-4 bg-gray-100 border-2 border-black font-mono text-xs space-y-2 leading-relaxed">
                  <p>export ANTHROPIC_BASE_URL="{baseUrl}/v1"</p>
                  <p>export ANTHROPIC_API_KEY="您的 API 密钥"</p>
                  <p className="text-gray-400 mt-2"># 可选：通过 Header 强制指定特定渠道</p>
                  <p className="text-gray-400"># 在 IDE 或代理设置中使用 X-TokenPulse-Provider</p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="font-black text-sm uppercase text-[#B22222] flex items-center gap-2">
                  <Code className="w-5 h-5" /> Codex / Cursor / 常用 IDE
                </p>
                <div className="p-4 bg-gray-100 border-2 border-black font-mono text-xs space-y-2 leading-relaxed">
                  <p>接口地址 (Base URL): {baseUrl}/v1</p>
                  <p>API 密钥: 您的 API 密钥</p>
                  <p>模型名称: antigravity:gemini-2.0-flash</p>
                </div>
              </div>
              
              <div className="p-4 bg-[#FFD500] border-4 border-black font-black text-xs uppercase tracking-tight">
                💡 贴士：支持 "provider:model" 格式或使用 "X-TokenPulse-Provider" 请求头覆盖默认路由逻辑。
              </div>
            </div>
          </div>

          {/* API Basics & Examples */}
          <div className="space-y-8">
            <SectionTitle title={t("models.integration")} icon={<Terminal className="w-6 h-6" />} color="bg-[#DA0414]" />
            <div className="bg-white border-4 border-black b-shadow p-8 space-y-8">
              <div className="space-y-4">
                <h4 className="font-black uppercase text-[#DA0414] text-xl flex items-center gap-2">
                  <ChevronRight className="w-6 h-6" />
                  {t("models.endpoint_url")}
                </h4>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 p-4 bg-gray-100 font-mono text-sm border-2 border-black break-all">
                    {baseUrl}
                  </code>
                  <button 
                    onClick={() => handleCopy(baseUrl, 'endpoint')}
                    className="p-4 bg-black text-white border-2 border-black hover:bg-[#DA0414] transition-colors"
                  >
                    {copiedKey === 'endpoint' ? <CheckCircle2 className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-black uppercase text-[#DA0414] text-xl flex items-center gap-2">
                  <ChevronRight className="w-6 h-6" />
                  {t("models.auth_header")}
                </h4>
                <code className="block p-4 bg-black text-[#FFD500] font-mono text-sm border-2 border-black">
                  Authorization: Bearer YOUR_API_SECRET
                </code>
              </div>

              <div className="space-y-6 pt-6 border-t-4 border-black">
                <h4 className="font-black uppercase text-black text-2xl flex items-center gap-3">
                  <Code2 className="w-8 h-8" />
                  {t("models.example_code")}
                </h4>
                
                <CodeBlock title="cURL" code={codeExamples.curl} onCopy={() => handleCopy(codeExamples.curl, 'curl')} isCopied={copiedKey === 'curl'} />
                <CodeBlock title="Python" code={codeExamples.python} onCopy={() => handleCopy(codeExamples.python, 'python')} isCopied={copiedKey === 'python'} />
                <CodeBlock title="Node.js" code={codeExamples.js} onCopy={() => handleCopy(codeExamples.js, 'js')} isCopied={copiedKey === 'js'} />
                <CodeBlock title="TypeScript" code={codeExamples.ts} onCopy={() => handleCopy(codeExamples.ts, 'ts')} isCopied={copiedKey === 'ts'} />
                <CodeBlock title="Go" code={codeExamples.go} onCopy={() => handleCopy(codeExamples.go, 'go')} isCopied={copiedKey === 'go'} />
              </div>
            </div>
          </div>
        </div>
      )}
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
          {isCopied ? "成功" : "复制"}
        </button>
      </div>
      <pre className="p-4 font-mono text-[11px] leading-relaxed overflow-x-auto custom-scrollbar whitespace-pre text-black">
        {code}
      </pre>
    </div>
  );
}
