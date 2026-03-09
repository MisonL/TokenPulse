import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { Input } from "../components/ui/input";
import { Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import {
  consumeLoginRedirect,
  getApiSecret,
  loginWithApiSecret,
  peekLoginRedirect,
  verifyStoredApiSecret,
} from "../lib/client";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  getStateRedirectTarget,
  type LoginRedirectState,
  resolveLoginEntryIntent,
  resolveLoginSuccessTarget,
} from "./login-redirect";

function getPendingLoginTarget(state: LoginRedirectState): string {
  return getStateRedirectTarget(state) || peekLoginRedirect();
}

function getLoginSuccessTarget(state: LoginRedirectState): string {
  return resolveLoginSuccessTarget(state, consumeLoginRedirect());
}

export function LoginPage() {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const loginState = location.state as LoginRedirectState;
  const pendingTarget = getPendingLoginTarget(loginState);
  const loginEntryIntent = resolveLoginEntryIntent(loginState, pendingTarget);
  const isEnterpriseEntry = loginEntryIntent === "enterprise";
  const pageTitle = isEnterpriseEntry ? "企业入口校验" : "安全校验";
  const pageDescription = isEnterpriseEntry
    ? "请输入接口密钥（API Secret）以进入企业管理台。"
    : "请输入接口密钥（API Secret）以访问网关。";
  const actionLabel = isEnterpriseEntry ? "进入企业管理台" : "解锁访问";
  const footerLabel = isEnterpriseEntry
    ? "TokenPulse 企业管理台 • 本地安全模式"
    : "TokenPulse AI 网关 • 本地安全模式";

  useEffect(() => {
    let cancelled = false;
    if (!getApiSecret()) {
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void verifyStoredApiSecret({
      redirectTarget: pendingTarget || undefined,
    })
      .then((verified) => {
        if (cancelled || !verified) {
          return;
        }
        navigate(getLoginSuccessTarget(loginState), { replace: true });
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, pendingTarget, loginState]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedSecret = secret.trim();
    if (!normalizedSecret) return;

    setLoading(true);
    try {
      await loginWithApiSecret(normalizedSecret);
      toast.success("接口密钥验证通过，已保存");
      navigate(getLoginSuccessTarget(loginState), { replace: true });
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
              {pageTitle}
            </h1>
          </div>
          <p className="text-gray-300 text-sm">
            {pageDescription}
          </p>
          {pendingTarget ? (
            <p className="mt-3 text-xs font-bold text-[#FFD500]">
              登录成功后将进入 <code className="font-mono text-white">{pendingTarget}</code>
            </p>
          ) : null}
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
                  {actionLabel}
                  <ArrowRight className="w-6 h-6" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t-2 border-dashed border-gray-200 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">
              {footerLabel}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
