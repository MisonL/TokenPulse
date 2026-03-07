import { useState } from "react";
import { cn } from "../lib/utils";
import { Input } from "../components/ui/input";
import { Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { consumeLoginRedirect, loginWithApiSecret } from "../lib/client";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { type LoginRedirectState, resolveLoginSuccessTarget } from "./login-redirect";

export function LoginPage() {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedSecret = secret.trim();
    if (!normalizedSecret) return;

    setLoading(true);
    try {
      await loginWithApiSecret(normalizedSecret);
      toast.success("接口密钥验证通过，已保存");
      const state = location.state as LoginRedirectState;
      const storedRedirect = consumeLoginRedirect();
      const from = resolveLoginSuccessTarget(state, storedRedirect);
      navigate(from, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "接口密钥校验失败";
      toast.error(message);
    } finally {
      setLoading(false);
    }
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
              安全校验
            </h1>
          </div>
          <p className="text-gray-300 text-sm">
            请输入接口密钥（API Secret）以访问网关。
          </p>
        </div>

        {/* 卡片主体 */}
        <div className="bg-white border-4 border-black p-8 b-shadow relative top-[-10px] left-[-10px]">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="secret" className="b-label">
                接口密钥（API Secret）
              </label>
              <Input
                id="secret"
                type="password"
                placeholder="请输入你的接口密钥"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="w-full text-lg p-6 bg-yellow-50 focus-visible:bg-white"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || !secret.trim()}
              className={cn(
                "w-full flex items-center justify-center gap-2 p-4 text-white font-bold text-lg uppercase tracking-wide transition-all",
                "bg-[#005C9A] border-4 border-black b-shadow hover:translate-y-[-2px] hover:translate-x-[-2px] active:translate-y-[2px] active:translate-x-[2px]",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0"
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  验证中...
                </>
              ) : (
                <>
                  解锁访问
                  <ArrowRight className="w-6 h-6" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t-2 border-dashed border-gray-200 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">
              TokenPulse AI 网关 • 本地安全模式
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
