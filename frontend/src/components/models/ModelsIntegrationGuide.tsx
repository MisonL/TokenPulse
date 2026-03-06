import { useMemo } from "react";
import {
  Box,
  Terminal,
  Code,
  Code2,
  Copy,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { t } from "../../lib/i18n";

interface ModelsIntegrationGuideProps {
  copiedKey: string | null;
  gatewayV1BaseUrl: string;
  onCopy: (text: string, key: string) => void;
}

function createCodeExamples(gatewayV1BaseUrl: string) {
  return {
    curl: `curl ${gatewayV1BaseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_SECRET" \\
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${gatewayV1BaseUrl}",
    api_key="YOUR_API_SECRET"
)

response = client.chat.completions.create(
    model="claude-3-5-sonnet",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)`,
    js: `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${gatewayV1BaseUrl}',
  apiKey: 'YOUR_API_SECRET'
});

const response = await client.chat.completions.create({
  model: 'antigravity:claude-3-5-sonnet',
  messages: [{ role: 'user', content: 'Hello!' }],
});`,
    ts: `import OpenAI from 'openai';

const client: OpenAI = new OpenAI({
  baseURL: '${gatewayV1BaseUrl}',
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
    "log"
    "github.com/openai/openai-go"
    "github.com/openai/openai-go/option"
)

func main() {
    client := openai.NewClient(
        option.WithBaseURL("${gatewayV1BaseUrl}"),
        option.WithAPIKey("YOUR_API_SECRET"),
    )

    resp, err := client.Chat.Completions.New(context.TODO(), openai.ChatCompletionNewParams{
        Model: openai.F("antigravity:claude-3-5-sonnet"),
        Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
            openai.UserMessage("Hello!"),
        }),
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(resp.Choices[0].Message.Content)
}`,
  };
}

export function ModelsIntegrationGuide({
  copiedKey,
  gatewayV1BaseUrl,
  onCopy,
}: ModelsIntegrationGuideProps) {
  const codeExamples = useMemo(
    () => createCodeExamples(gatewayV1BaseUrl),
    [gatewayV1BaseUrl],
  );

  return (
    <div className="flex flex-col gap-10 animate-slide-in">
      <div className="space-y-8">
        <SectionTitle
          color="bg-[#005C9A]"
          icon={<Box className="w-6 h-6" />}
          title={t("models.tool_integration")}
        />
        <div className="border-4 border-black p-8 bg-white shadow-[8px_8px_0_0_#000000] space-y-8">
          <div className="space-y-4">
            <p className="font-black text-sm uppercase text-[#005C9A] flex items-center gap-2">
              <Terminal className="w-5 h-5" /> Claude Code (命令行工具)
            </p>
            <div className="p-4 bg-gray-100 border-2 border-black font-mono text-xs space-y-2 leading-relaxed">
              <p>{`export ANTHROPIC_BASE_URL="${gatewayV1BaseUrl}"`}</p>
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
              <p>接口地址 (Base URL): {gatewayV1BaseUrl}</p>
              <p>API 密钥: 您的 API 密钥</p>
              <p>模型名称: antigravity:gemini-2.0-flash</p>
            </div>
          </div>

          <div className="p-4 bg-[#FFD500] border-4 border-black font-black text-xs uppercase tracking-tight">
            💡 贴士：支持 "provider:model" 格式或使用 "X-TokenPulse-Provider" 请求头覆盖默认路由逻辑。
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <SectionTitle
          color="bg-[#DA0414]"
          icon={<Terminal className="w-6 h-6" />}
          title={t("models.integration")}
        />
        <div className="bg-white border-4 border-black b-shadow p-8 space-y-8">
          <div className="space-y-4">
            <h4 className="font-black uppercase text-[#DA0414] text-xl flex items-center gap-2">
              <ChevronRight className="w-6 h-6" />
              {t("models.endpoint_url")}
            </h4>
            <div className="flex gap-2 items-center">
              <code className="flex-1 p-4 bg-gray-100 font-mono text-sm border-2 border-black break-all">
                {gatewayV1BaseUrl}
              </code>
              <button
                onClick={() => onCopy(gatewayV1BaseUrl, "endpoint")}
                className="p-4 bg-black text-white border-2 border-black hover:bg-[#DA0414] transition-colors"
              >
                {copiedKey === "endpoint" ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <Copy className="w-6 h-6" />
                )}
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

            <CodeBlock
              title="cURL"
              code={codeExamples.curl}
              onCopy={() => onCopy(codeExamples.curl, "curl")}
              isCopied={copiedKey === "curl"}
            />
            <CodeBlock
              title="Python"
              code={codeExamples.python}
              onCopy={() => onCopy(codeExamples.python, "python")}
              isCopied={copiedKey === "python"}
            />
            <CodeBlock
              title="Node.js"
              code={codeExamples.js}
              onCopy={() => onCopy(codeExamples.js, "js")}
              isCopied={copiedKey === "js"}
            />
            <CodeBlock
              title="TypeScript"
              code={codeExamples.ts}
              onCopy={() => onCopy(codeExamples.ts, "ts")}
              isCopied={copiedKey === "ts"}
            />
            <CodeBlock
              title="Go"
              code={codeExamples.go}
              onCopy={() => onCopy(codeExamples.go, "go")}
              isCopied={copiedKey === "go"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  icon,
  color,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
}) {
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

function CodeBlock({
  title,
  code,
  onCopy,
  isCopied,
}: {
  title: string;
  code: string;
  onCopy: () => void;
  isCopied: boolean;
}) {
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
