import { useState } from "react";
import { cn } from "../lib/utils";
import { Input } from "../components/ui/input";
import { Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { setApiSecret } from "../lib/client";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

export function LoginPage() {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;

    setLoading(true);
    // 乐观保存
    setApiSecret(secret.trim());
    
    // 模拟快速检查或仅重定向（仅限客户端检查）
    // 理想情况下我们会验证 /api/stats，但目前先信任 secret，
    // 让下一个 API 调用去验证它。
    
    setTimeout(() => {
        toast.success("API Secret Saved");
        const state = location.state as { from?: { pathname: string } } | null;
        const from = state?.from?.pathname || "/";
        navigate(from, { replace: true });
    }, 600);
  };

  return (
    <div className="min-h-screen w-full bg-[#f0f0f0] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 卡片头部 */}
        <div className="bg-black text-white p-6 border-4 border-black b-shadow mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-[#DA0414] rounded-full flex items-center justify-center border-2 border-white">
               <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-black uppercase tracking-widest">
              Security Check
            </h1>
          </div>
          <p className="text-gray-300 text-sm">
            Please enter your API Secret to access the Gateway.
          </p>
        </div>

        {/* 卡片主体 */}
        <div className="bg-white border-4 border-black p-8 b-shadow relative top-[-10px] left-[-10px]">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="secret" className="b-label">
                API Secret
              </label>
              <Input
                id="secret"
                type="password"
                placeholder="YOUR_SECURE_SECRET_HERE"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="w-full text-lg p-6 bg-yellow-50 focus-visible:bg-white"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || !secret}
              className={cn(
                "w-full flex items-center justify-center gap-2 p-4 text-white font-bold text-lg uppercase tracking-wide transition-all",
                "bg-[#005C9A] border-4 border-black b-shadow hover:translate-y-[-2px] hover:translate-x-[-2px] active:translate-y-[2px] active:translate-x-[2px]",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0"
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  Unlock Access
                  <ArrowRight className="w-6 h-6" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t-2 border-dashed border-gray-200 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">
              TokenPulse AI Gateway • Local Secured
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
