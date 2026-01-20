import { Outlet, NavLink } from "react-router-dom";
import { LayoutDashboard, Key, FileText, Settings, Play } from "lucide-react";
import { cn } from "../lib/utils";
import { t } from "../lib/i18n";

export function BauhausLayout() {
  return (
    <div className="flex min-h-screen bg-[#F2F2F2]">
      {/* Sidebar */}
      <aside className="w-64 bg-[#1A1A1A] text-white flex flex-col border-r-4 border-black fixed h-screen z-50">
        <div className="p-8 border-b-2 border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center overflow-hidden">
              <img
                src="/icon.png?v=6"
                alt={t("layout.logo_alt")}
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter uppercase leading-none">
                {t("layout.title")}
              </h1>
              <p className="text-[10px] tracking-[0.2em] text-[#FFD500] font-bold uppercase">
                {t("layout.subtitle")}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-6 space-y-4">
          <NavItem
            to="/"
            icon={<LayoutDashboard />}
            label={t("layout.dashboard")}
          />
          <NavItem to="/chat" icon={<Play />} label={t("chat.title")} />
          <NavItem
            to="/credentials"
            icon={<Key />}
            label={t("layout.credentials")}
          />
          <NavItem to="/logs" icon={<FileText />} label={t("layout.logs")} />
          <div className="h-px bg-white/10 my-4" />
          <NavItem
            to="/settings"
            icon={<Settings />}
            label={t("layout.settings")}
          />
        </nav>

        <div className="p-6 border-t border-white/10">
          <div className="bg-[#005C9A] p-4 border-2 border-white text-xs font-mono">
            <p className="text-white/70">{t("layout.status_label")}</p>
            <p className="text-[#FFD500] font-bold">
              ● {t("common.operational")}
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 p-12 overflow-auto">
        <div className="max-w-6xl mx-auto animate-slide-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-4 px-4 py-3 font-bold uppercase tracking-wider transition-all border-2 border-transparent hover:bg-white hover:text-black hover:translate-x-1 group",
          isActive
            ? "bg-[#FFD500] text-black border-black b-shadow"
            : "text-white/80",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "group-hover:scale-110 transition-transform",
              isActive ? "scale-110" : "",
            )}
          >
            {icon}
          </span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}
