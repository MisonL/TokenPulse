import { Activity, Server, Zap, Globe, LayoutDashboard } from "lucide-react";
import { cn } from "../lib/utils";
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";

// Type Definitions
interface Log {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

interface Stats {
  active_providers: number;
  total_requests: number;
  avg_latency_ms: number;
  uptime_percentage: number;
  traffic_history: number[];
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  providers?: {
    name: string;
    requests: number;
    tokens: number;
  }[];
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    active_providers: 0,
    total_requests: 0,
    avg_latency_ms: 0,
    uptime_percentage: 0,
    traffic_history: [],
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/stats");
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b-8 border-black pb-6 mb-8">
        <div className="flex items-center gap-6">
          <div className="bg-[#FFD500] text-black p-4 border-4 border-black b-shadow">
            <LayoutDashboard className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-5xl font-black uppercase text-black tracking-tighter">
              {t("dashboard.title")}
            </h2>
            <div className="h-2 bg-black w-24 mt-1" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="font-mono text-xs font-black bg-[#FFD500] px-3 py-1 border-2 border-black inline-block transform rotate-1 b-shadow-sm">
            {t("dashboard.live_monitor")}
          </p>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-gray-400">
            <Activity className="w-3 h-3 text-[#DA0414] animate-pulse" />
            LIVE AUDIT SYSTEM
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatWidget
          label={t("dashboard.active_providers")}
          value={stats.active_providers.toString()}
          icon={<Server className="w-8 h-8" />}
          color="bg-[#DA0414]"
          textColor="text-white"
        />
        <StatWidget
          label={t("dashboard.total_requests")}
          value={stats.total_requests.toLocaleString()}
          icon={<Activity className="w-8 h-8" />}
          color="bg-[#005C9A]"
          textColor="text-white"
        />
        <StatWidget
          label={t("dashboard.avg_latency")}
          value={`${stats.avg_latency_ms}ms`}
          icon={<Zap className="w-8 h-8" />}
          color="bg-white"
          textColor="text-black"
        />
        <StatWidget
          label={t("dashboard.uptime")}
          value={`${stats.uptime_percentage}%`}
          icon={<Globe className="w-8 h-8" />}
          color="bg-[#FFD500]"
          textColor="text-black"
        />
      </div>

      {/* Big Visual Blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-96">
        {/* Main Chart Area (Abstract) */}
        <div className="lg:col-span-2 bg-white border-4 border-black p-6 relative overflow-hidden group">
          <h3 className="text-2xl font-bold uppercase mb-4 z-10 relative">
            {t("dashboard.traffic_chart")}
          </h3>
          <div className="absolute bottom-0 left-0 right-0 h-48 flex items-end justify-between px-8 gap-2 opacity-80">
            {stats.traffic_history.map((h, i) => (
              <div
                key={i}
                className={cn(
                  "w-full transition-all duration-500 hover:opacity-80 border-2 border-black",
                  i % 3 === 0
                    ? "bg-[#DA0414]"
                    : i % 3 === 1
                      ? "bg-[#005C9A]"
                      : "bg-[#FFD500]",
                )}
                style={{
                  height: `${h > 0 ? (h / Math.max(...stats.traffic_history, 10)) * 100 : 5}%`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Status Logs Sidebar */}
        <div className="bg-[#1A1A1A] border-4 border-black p-6 text-white overflow-hidden flex flex-col">
          <h3 className="text-xl font-bold uppercase mb-6 text-[#FFD500] border-b border-white/20 pb-2">
            {t("dashboard.provider_usage")}
          </h3>
          <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-2">
            {stats.providers?.map((p, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-[10px] font-black uppercase">
                  <span>{p.name}</span>
                  <span className="text-[#FFD500]">{p.requests} REQS</span>
                </div>
                <div className="h-4 bg-white/10 border border-white/20 relative">
                    <div 
                        className="h-full bg-[#DA0414] border-r-2 border-black" 
                        style={{ width: `${Math.min(100, (p.tokens / Math.max(...(stats.providers?.map(p => p.tokens) || [1]), 1)) * 100)}%` }} 
                    />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status Logs Sidebar */}
        <RecentLogsWidget />
      </div>
    </div>
  );
}

function RecentLogsWidget() {
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();

    fetch("/api/logs?limit=5", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((res) => setLogs(res.data || []))
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.error(error);
        }
      });

    return () => {
      ctrl.abort();
    };
  }, []);

  return (
    <div className="bg-[#1A1A1A] border-4 border-black p-6 text-white overflow-hidden flex flex-col">
      <h3 className="text-xl font-bold uppercase mb-6 text-[#FFD500] border-b border-white/20 pb-2">
        {t("dashboard.recent_events")}
      </h3>
      <div className="space-y-4 font-mono text-xs flex-1">
        {logs.length === 0 && (
          <div className="text-gray-500 italic">{t("dashboard.no_events")}</div>
        )}
        {logs.map((log) => (
          <LogItem
            key={log.id}
            time={new Date(log.timestamp).toLocaleTimeString()}
            msg={log.message}
            type={
              log.level === "ERROR"
                ? "warning"
                : log.level === "WARN"
                  ? "warning"
                  : "info"
            }
          />
        ))}
      </div>
      <div className="mt-4 pt-4 border-t border-white/20 text-center">
        <button className="text-[#005C9A] bg-white px-4 py-2 font-bold uppercase text-xs hover:bg-[#DA0414] hover:text-white transition-colors w-full cursor-pointer">
          {t("dashboard.view_all")}
        </button>
      </div>
    </div>
  );
}

interface StatWidgetProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  textColor: string;
}

function StatWidget({ label, value, icon, color, textColor }: StatWidgetProps) {
  return (
    <div
      className={cn(
        "border-4 border-black p-6 flex flex-col justify-between h-44 transition-all hover:-translate-x-1 hover:-translate-y-1 b-shadow group",
        color,
        textColor,
      )}
    >
      <div className="flex justify-between items-start">
        <span className="font-black text-[10px] uppercase tracking-[0.2em] opacity-80">
          {label}
        </span>
        <div className="group-hover:scale-125 transition-transform duration-500">
          {icon}
        </div>
      </div>
      <div className="text-6xl font-black tracking-tighter leading-none">{value}</div>
      <div className="absolute top-0 right-0 w-8 h-8 opacity-10 border-r-4 border-t-4 border-current m-2" />
    </div>
  );
}

interface LogItemProps {
  time: string;
  msg: string;
  type: "success" | "warning" | "info";
}

function LogItem({ time, msg, type }: LogItemProps) {
  return (
    <div className="flex gap-3 border-l-2 border-white/10 pl-3 py-1">
      <span className="opacity-50">{time}</span>
      <span
        className={cn(
          "bg-clip-text text-transparent bg-linear-to-r font-bold",
          type === "success"
            ? "from-green-400 to-green-600"
            : type === "warning"
              ? "from-[#FFD500] to-orange-400"
              : "from-blue-400 to-blue-200",
        )}
      >
        {msg}
      </span>
    </div>
  );
}
