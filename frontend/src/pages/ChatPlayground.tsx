import { useState, useRef, useEffect } from "react";
import { Send, Trash2, Cpu, Zap, Activity } from "lucide-react";
import { ThinkingBlock } from "../components/ThinkingBlock";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
}

const MODELS = [
  {
    id: "gemini-2.0-flash-thinking-exp-1219",
    name: "Gemini 2.0 Flash Thinking 1219",
  },
  { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash Exp" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
];

export function ChatPlayground() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(MODELS[0].id);
  const [tokens, setTokens] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  // Thinking Configuration
  const [thinkMode, setThinkMode] = useState<"none" | "auto" | "budget" | "level">("auto");
  const [thinkBudget, setThinkBudget] = useState(4096);
  const [thinkLevel, setThinkLevel] = useState("medium");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Token Counting Debounce
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!input.trim()) {
        setTokens(null);
        return;
      }
      let effectiveModel = model;
      if (thinkMode === "budget") {
        effectiveModel += `-thinking-budget-${thinkBudget}`;
      } else if (thinkMode === "level") {
        effectiveModel += `-thinking-level-${thinkLevel}`;
      } else if (thinkMode === "none") {
        effectiveModel += `-thinking-mode-none`;
      }

      try {
        const res = await fetch("/api/antigravity/v1internal:countTokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: effectiveModel,
            messages: [...messages, { role: "user", content: input }],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setTokens(data.totalTokens);
        }
      } catch {
        // ignore
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [input, messages, model, thinkMode, thinkBudget, thinkLevel]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setLatency(null);

    const startTime = Date.now();

    // Generate effective model name with thinking suffix
    let effectiveModel = model;
    if (thinkMode === "budget") {
      effectiveModel += `-thinking-budget-${thinkBudget}`;
    } else if (thinkMode === "level") {
      effectiveModel += `-thinking-level-${thinkLevel}`;
    } else if (thinkMode === "none") {
      effectiveModel += `-thinking-mode-none`;
    }

    try {
      const res = await fetch("/api/antigravity/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: effectiveModel,
          messages: [...messages, userMsg],
          stream: true,
        }),
      });

      if (!res.ok) throw new Error("Request failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", thinking: "" },
      ]);

      if (reader) {
        let firstChunk = true;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.replace("data: ", "").trim();
              if (jsonStr === "[DONE]") break;
              try {
                const data = JSON.parse(jsonStr);
                const delta = data.choices[0].delta;

                if (firstChunk) {
                  setLatency(Date.now() - startTime);
                  firstChunk = false;
                }

                  setMessages((prev) => {
                    const last = { ...prev[prev.length - 1] };
                    if (delta.content) last.content += delta.content;
                    if (delta.thinking)
                      last.thinking = (last.thinking || "") + delta.thinking;
                    if (delta.tool_calls)
                      last.tool_calls = [...(last.tool_calls || []), ...delta.tool_calls];
                    return [...prev.slice(0, -1), last];
                  });
              } catch {
                // ignore
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-6">
      <div className="flex items-center justify-between border-b-4 border-black pb-4 bg-[#F2F2F2]">
        <div className="flex items-center gap-4">
          <h2 className="text-4xl font-black uppercase text-black">
            {t("chat.title")}
          </h2>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-white border-2 border-black px-3 py-1 font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#FFD500]"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-4 text-xs font-mono font-bold">
          {tokens !== null && (
            <div className="bg-[#005C9A] text-white px-3 py-1 border-2 border-black flex items-center gap-2">
              <Cpu className="w-4 h-4" /> {tokens} Tokens
            </div>
          )}
          {latency !== null && (
            <div className="bg-[#DA0414] text-white px-3 py-1 border-2 border-black flex items-center gap-2">
              <Zap className="w-4 h-4" /> {latency}ms
            </div>
          )}
          <button
            onClick={() => setMessages([])}
            className="bg-white text-black px-3 py-1 border-2 border-black hover:bg-black hover:text-white transition-colors flex items-center gap-2 uppercase"
          >
            <Trash2 className="w-4 h-4" /> {t("chat.clear")}
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white border-4 border-black p-4 b-shadow">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-gray-500 block">
            {t("chat.thinking_mode")}
          </label>
          <select
            value={thinkMode}
            onChange={(e) => setThinkMode(e.target.value as any)}
            className="w-full bg-[#F2F2F2] border-2 border-black px-3 py-2 font-mono text-xs font-bold focus:outline-none"
          >
            <option value="none">{t("chat.mode_none")}</option>
            <option value="auto">{t("chat.mode_auto")}</option>
            <option value="budget">{t("chat.mode_budget")}</option>
            <option value="level">{t("chat.mode_level")}</option>
          </select>
        </div>

        {thinkMode === "budget" && (
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-gray-500 block">
              {t("chat.thinking_budget")}
            </label>
            <input
              type="number"
              value={thinkBudget}
              onChange={(e) => setThinkBudget(Number(e.target.value))}
              className="w-full bg-[#F2F2F2] border-2 border-black px-3 py-2 font-mono text-xs font-bold focus:outline-none"
              step={1024}
              min={1024}
            />
          </div>
        )}

        {thinkMode === "level" && (
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-gray-500 block">
              {t("chat.thinking_level")}
            </label>
            <select
              value={thinkLevel}
              onChange={(e) => setThinkLevel(e.target.value)}
              className="w-full bg-[#F2F2F2] border-2 border-black px-3 py-2 font-mono text-xs font-bold focus:outline-none"
            >
              <option value="minimal">{t("chat.level_minimal")}</option>
              <option value="low">{t("chat.level_low")}</option>
              <option value="medium">{t("chat.level_medium")}</option>
              <option value="high">{t("chat.level_high")}</option>
              <option value="xhigh">{t("chat.level_xhigh")}</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar bg-white p-6 border-4 border-black relative">
        {messages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
            <div className="text-9xl font-black uppercase tracking-tighter text-center">
              CHAT
              <br />
              AREA
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex flex-col gap-2 max-w-4xl",
              m.role === "user" ? "ml-auto items-end" : "mr-auto items-start",
            )}
          >
            <div
              className={cn(
                "text-xs font-bold uppercase tracking-wider mb-1 px-1",
                m.role === "user" ? "text-[#005C9A]" : "text-[#DA0414]",
              )}
            >
              {m.role === "assistant" ? "Model" : "You"}
            </div>

            {/* Thinking Block */}
            {m.thinking && (
              <div className="w-full max-w-3xl">
                <ThinkingBlock
                  text={m.thinking}
                  isStreaming={loading && i === messages.length - 1}
                />
              </div>
            )}

            {/* Content Block */}
            {m.content && (
              <div
                className={cn(
                  "p-4 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-sm font-mono leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-[#FFD500] text-black"
                    : "bg-white text-black",
                )}
              >
                {m.content}
              </div>
            )}

            {/* Tool Calls */}
            {m.tool_calls?.map((tc, idx) => (
              <div
                key={idx}
                className="w-full max-w-sm p-3 bg-[#005C9A] text-white border-2 border-black font-mono text-[10px] uppercase font-black flex items-center gap-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                <div className="w-2 h-2 bg-white animate-pulse" />
                {t("chat.tool_use", { name: tc.function.name })}
              </div>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={t("chat.input_placeholder")}
          className="w-full h-32 p-4 pr-16 bg-white border-4 border-black font-mono focus:outline-none focus:ring-4 focus:ring-[#FFD500]/50 resize-none text-lg"
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="absolute bottom-4 right-4 bg-black text-white p-3 hover:bg-[#DA0414] disabled:opacity-50 disabled:hover:bg-black transition-colors"
        >
          {loading ? (
            <Activity className="w-6 h-6 animate-spin" />
          ) : (
            <Send className="w-6 h-6" />
          )}
        </button>
      </div>
    </div>
  );
}
