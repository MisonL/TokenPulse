import { LogOut, ShieldCheck } from "lucide-react";

interface EnterpriseConsoleHeaderProps {
  title?: string;
  subtitle?: string;
  onWriteTestAuditEvent: () => void;
  onLogout: () => void;
}

export function EnterpriseConsoleHeader({
  title = "企业管理中心",
  subtitle = "高级版能力编排与审计追踪",
  onWriteTestAuditEvent,
  onLogout,
}: EnterpriseConsoleHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b-8 border-black pb-6">
      <div className="flex items-center gap-4">
        <div className="bg-[#FFD500] p-4 border-4 border-black b-shadow">
          <ShieldCheck className="w-10 h-10 text-black" />
        </div>
        <div>
          <h2 className="text-5xl font-black uppercase tracking-tighter">{title}</h2>
          <p className="text-xs uppercase tracking-[0.2em] font-bold text-gray-500">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="b-btn bg-[#FFD500] hover:bg-[#ffe033]" onClick={onWriteTestAuditEvent}>
          写入测试审计事件
        </button>
        <button className="b-btn bg-white" onClick={onLogout}>
          <LogOut className="w-4 h-4" />
          退出管理员
        </button>
      </div>
    </header>
  );
}
