import { ShieldCheck } from "lucide-react";
import type { KeyboardEvent } from "react";

interface EnterpriseAdminLoginSectionProps {
  sectionId?: string;
  username: string;
  password: string;
  submitting: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function EnterpriseAdminLoginSection({
  sectionId = "enterprise-admin-login-section",
  username,
  password,
  submitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: EnterpriseAdminLoginSectionProps) {
  const handlePasswordKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      onSubmit();
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4 border-b-8 border-black pb-6">
        <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
          <ShieldCheck className="w-10 h-10 text-black" />
        </div>
        <h2 className="text-5xl font-black uppercase tracking-tighter">企业管理中心</h2>
      </header>
      <section
        id={sectionId}
        className="bg-white border-4 border-black p-8 b-shadow space-y-4 max-w-xl"
      >
        <p className="text-2xl font-black">管理员登录</p>
        <p className="text-xs font-bold text-gray-500">
          当前后端已启用企业管理员会话，请先登录后再访问 RBAC、审计与配额能力。
        </p>
        <div className="space-y-3">
          <input
            className="b-input h-11 w-full"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="管理员用户名"
          />
          <input
            type="password"
            className="b-input h-11 w-full"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="管理员密码"
            onKeyDown={handlePasswordKeyDown}
          />
        </div>
        <button
          className="b-btn bg-[#FFD500] hover:bg-[#ffe033]"
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting ? "登录中..." : "登录管理员会话"}
        </button>
      </section>
    </div>
  );
}
