import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { t } from "../lib/i18n";

interface ThinkingBlockProps {
  text: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({ text, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(true);

  // 当流开始时自动展开
  useEffect(() => {
    if (isStreaming && !isOpen) {
      const t = setTimeout(() => setIsOpen(true), 0);
      return () => clearTimeout(t);
    }
  }, [isStreaming, isOpen]);

  if (!text && !isStreaming) return null;

  return (
    <div className="border-2 border-black overflow-hidden bg-white my-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#F2F2F2] hover:bg-[#FFD500] transition-colors text-[10px] font-black font-mono text-black uppercase tracking-tighter border-b-2 border-black cursor-pointer"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 stroke-[3px]" />
        ) : (
          <ChevronRight className="w-3 h-3 stroke-[3px]" />
        )}
        <Brain className="w-3 h-3 text-[#DA0414]" />
        {t("chat.thinking_process")}
        {isStreaming && (
          <span className="animate-pulse ml-2 text-[#DA0414]">●</span>
        )}
      </button>

      {isOpen && (
        <div className="p-3 text-[11px] font-mono text-black bg-white overflow-x-auto whitespace-pre-wrap leading-tight animate-in slide-in-from-top-1 duration-200 max-h-96 overflow-y-auto custom-scrollbar italic opacity-80">
          {text || (
            <span className="text-black/30">
              {t("chat.thinking_placeholder")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
