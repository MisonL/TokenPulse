import { useState, useRef, useEffect } from "react";
import { Send, Trash2, Cpu, Zap, Activity, Play } from "lucide-react";
import { ThinkingBlock } from "../components/ThinkingBlock";
import { CustomSelect } from "../components/CustomSelect";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { client } from "../lib/client";

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

interface Model {
  id: string;
  name: string;
  provider: string;
}

export function ChatPlayground() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("");
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [tokens, setTokens] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  // Fetch Models
  useEffect(() => {
    client.api.models.$get()
      .then(async (res: Response) => {
        if (res.ok) {
           const data = await res.json();
           if (data.data && Array.isArray(data.data)) {
             setAvailableModels(data.data);
             if (data.data.length > 0) {
                // Preserve existing selection if valid, otherwise default to first
                setModel((prev) => {
                  const exists = data.data.find((m: Model) => m.id === prev);
                  return exists ? prev : data.data[0].id;
                });
             }
           }
        }
      })
      .catch((err: unknown) => {
        console.error("Failed to fetch models:", err);
        // Fallback for offline/error
        const fallback = [{ id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash (Fallback)", provider: "google" }];
        setAvailableModels(fallback);
        setModel(fallback[0].id);
      });
  }, []);

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
        effectiveModel += "-thinking-budget-" + thinkBudget;
      } else if (thinkMode === "level") {
        effectiveModel += "-thinking-level-" + thinkLevel;
      } else if (thinkMode === "none") {
        effectiveModel += "-thinking-mode-none";
      }

      try {
        const res = await client.api.antigravity["v1internal:countTokens"].$post({
             json: {
               model: effectiveModel,
               prompt: input,
             }
        });
        if (res.ok) {
           const json = await res.json();
           setTokens(json.totalTokens);
        } else {
           setTokens(null);
        }
      } catch (err) {
        console.warn("Token counting failed:", err);
        setTokens(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [input, model, thinkMode, thinkBudget, thinkLevel]);

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
      effectiveModel += "-thinking-budget-" + thinkBudget;
    } else if (thinkMode === "level") {
      effectiveModel += "-thinking-level-" + thinkLevel;
    } else if (thinkMode === "none") {
      effectiveModel += "-thinking-mode-none";
    }

    try {
      const res = await client.api.antigravity.v1.chat.completions.$post({
        json: {
          model: effectiveModel,
          messages: [...messages, userMsg],
          stream: true,
        }
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
      <div className="flex items-center justify-between border-b-8 border-black pb-6 bg-[#F2F2F2]">
        <div className="flex items-center gap-6">
          <div className="bg-[#DA0414] text-white p-4 border-4 border-black b-shadow">
            <Play className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-5xl font-black uppercase text-black tracking-tighter">
              {t("chat.title")}
            </h2>
            <div className="h-2 bg-black w-24 mt-1" />
          </div>
          <CustomSelect
            id="model-select"
            value={model}
            onChange={(val) => setModel(val)}
            options={availableModels}
            disabled={availableModels.length === 0}
            className="ml-4 min-w-[300px]"
            placeholder={availableModels.length === 0 ? "Loading..." : t("chat.model_select")}
          />
        </div>
        <div className="flex gap-4 text-xs font-black uppercase tracking-tighter">
          {tokens !== null && (
            <div className="bg-[#005C9A] text-white px-4 py-2 border-4 border-black b-shadow-sm flex items-center gap-2">
              <Cpu className="w-4 h-4" /> {tokens} TOKENS
            </div>
          )}
          {latency !== null && (
            <div className="bg-[#DA0414] text-white px-4 py-2 border-4 border-black b-shadow-sm flex items-center gap-2">
              <Zap className="w-4 h-4" /> {latency}MS
            </div>
          )}
          <button
            onClick={() => setMessages([])}
            className="b-btn text-xs py-2 px-4 h-auto shadow-none hover:shadow-none translate-x-0 bg-white"
          >
            <Trash2 className="w-4 h-4" /> {t("chat.clear")}
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white border-4 border-black p-4 b-shadow">
        <div className="space-y-2">
          <label htmlFor="thinking-mode" className="text-[10px] font-black uppercase text-gray-500 block">
            {t("chat.thinking_mode")}
          </label>
          <CustomSelect
            id="thinking-mode"
            value={thinkMode}
            onChange={(val) => setThinkMode(val as "none" | "auto" | "budget" | "level")}
            options={[
              { id: "none", name: t("chat.mode_none") },
              { id: "auto", name: t("chat.mode_auto") },
              { id: "budget", name: t("chat.mode_budget") },
              { id: "level", name: t("chat.mode_level") },
            ]}
            className="w-full"
          />
        </div>

        {thinkMode === "budget" && (
          <div className="space-y-2">
            <label htmlFor="thinking-budget" className="text-[10px] font-black uppercase text-gray-500 block">
              {t("chat.thinking_budget")}
            </label>
            <input
              id="thinking-budget"
              name="thinking-budget"
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
            <label htmlFor="thinking-level" className="text-[10px] font-black uppercase text-gray-500 block">
              {t("chat.thinking_level")}
            </label>
            <CustomSelect
              id="thinking-level"
              value={thinkLevel}
              onChange={(val) => setThinkLevel(val)}
              options={[
                { id: "minimal", name: t("chat.level_minimal") },
                { id: "low", name: t("chat.level_low") },
                { id: "medium", name: t("chat.level_medium") },
                { id: "high", name: t("chat.level_high") },
                { id: "xhigh", name: t("chat.level_xhigh") },
              ]}
              className="w-full"
            />
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

      <div className="relative group">
          <label htmlFor="chat-input" className="sr-only">
            {t("chat.input_placeholder")}
          </label>
          <textarea
            id="chat-input"
            name="chat-input"
            aria-label={t("chat.input_placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={t("chat.input_placeholder")}
          className="w-full h-36 p-6 pr-20 bg-white border-8 border-black font-mono focus:outline-none focus:shadow-[12px_12px_0_0_rgba(255,213,0,0.5)] transition-all resize-none text-xl font-bold placeholder:text-gray-300 b-shadow"
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="absolute bottom-6 right-6 bg-black text-white p-4 hover:bg-[#DA0414] disabled:opacity-30 disabled:hover:bg-black transition-all b-shadow-sm active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          {loading ? (
            <Activity className="w-8 h-8 animate-spin" />
          ) : (
            <Send className="w-8 h-8" />
          )}
        </button>
      </div>
    </div>
  );
}
