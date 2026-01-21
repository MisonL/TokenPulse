import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../lib/utils";

interface Option {
  id: string;
  name: string;
}

interface CustomSelectProps {
  id?: string;
  value: string;
  options: Option[];
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function CustomSelect({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
  placeholder = "Select...",
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.id === value);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggle = () => {
    if (!disabled) setIsOpen(!isOpen);
  };

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative min-w-[200px] font-mono", className)}
    >
      <button
        type="button"
        id={id}
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between bg-white border-4 border-black px-4 py-2 font-black text-sm text-black outline-none transition-all",
          "hover:shadow-[4px_4px_0_0_#FFD500] focus:shadow-[4px_4px_0_0_#FFD500]",
          isOpen && "shadow-[4px_4px_0_0_#FFD500]",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.name : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white border-4 border-black shadow-[8px_8px_0_0_#000000] max-h-64 overflow-y-auto custom-scrollbar">
          {options.length === 0 ? (
            <div className="p-3 text-gray-400 text-xs italic">No options</div>
          ) : (
            options.map((option) => (
              <div
                key={option.id}
                onClick={() => handleSelect(option.id)}
                className={cn(
                  "flex items-center justify-between p-3 text-sm font-black cursor-pointer border-b-2 border-black last:border-b-0",
                  "hover:bg-[#FFD500] transition-colors",
                  option.id === value && "bg-[#FFD500]"
                )}
              >
                <span className="truncate">{option.name}</span>
                {option.id === value && <Check className="w-4 h-4" />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
