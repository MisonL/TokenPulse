import { Terminal, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { client } from "../lib/client";

interface Log {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}



export function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchLogs = async () => {
    try {
      const res = await client.api.logs.$get({
        query: {
          page: page.toString(),
          pageSize: '20'
        }
      });
      if (res.ok) {
        const json = await res.json();
        setLogs(json.data);
        setTotalPages(json.meta.totalPages);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, refreshKey]);

  // 目前仅进行当前页面的客户端过滤
  const filteredLogs = logs.filter(
    (l) =>
      l.message.toLowerCase().includes(search.toLowerCase()) ||
      l.source.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b-8 border-black pb-6">
        <div className="flex items-center gap-6">
          <div className="bg-black text-white p-4 border-4 border-black b-shadow">
            <Terminal className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-5xl font-black uppercase text-black tracking-tighter">
              {t("logs.title")}
            </h2>
            <div className="h-2 bg-black w-24 mt-1" />
          </div>
        </div>
        <div className="flex gap-4">
          <div className="relative group">
            <label htmlFor="log-search" className="sr-only">
              {t("common.search_logs")}
            </label>
            <input
              id="log-search"
              name="log-search"
              type="text"
              placeholder={t("common.search_placeholder")}
              className="b-input w-72 h-14"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="b-btn b-btn-icon bg-white"
          >
            <RefreshCcw className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="bg-[#1A1A1A] border-4 border-black p-0 overflow-hidden b-shadow mb-12">
        <table className="w-full text-left font-mono text-sm border-collapse">
          <thead className="bg-[#1A1A1A] text-white border-b-4 border-black">
            <tr>
              <th className="p-6 font-black uppercase tracking-widest border-r-4 border-black/30 w-48">
                {t("logs.table_time")}
              </th>
              <th className="p-6 font-black uppercase tracking-widest border-r-4 border-black/30 w-32">
                {t("logs.table_level")}
              </th>
              <th className="p-6 font-black uppercase tracking-widest border-r-4 border-black/30 w-48">
                {t("logs.table_source")}
              </th>
              <th className="p-6 font-black uppercase tracking-widest">
                {t("logs.table_msg")}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {filteredLogs.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-12 text-center text-gray-400 font-bold uppercase tracking-widest italic"
                >
                  {t("dashboard.no_events")}
                </td>
              </tr>
            )}
            {filteredLogs.map((log) => (
              <tr
                key={log.id}
                className="hover:bg-yellow-50 transition-colors group border-b-2 border-dashed border-black/10 last:border-0"
              >
                <td className="p-4 border-r-4 border-black/10 whitespace-nowrap opacity-60 group-hover:opacity-100 font-mono text-xs font-bold bg-gray-50/50">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td className="p-4 border-r-4 border-black/10 font-black">
                  <div
                    className={cn(
                      "px-2 py-0.5 border-2 border-black inline-block text-[10px] uppercase",
                      log.level === "INFO"
                        ? "bg-[#005C9A] text-white"
                        : log.level === "WARN"
                        ? "bg-[#FFD500] text-black"
                        : "bg-[#DA0414] text-white"
                    )}
                  >
                    {log.level}
                  </div>
                </td>
                <td className="p-4 border-r-4 border-black/10 font-bold uppercase tracking-tighter text-[#005C9A]/80">
                  {log.source}
                </td>
                <td className="p-4 break-all font-medium text-black/80">{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 分页控制 */}
        <div className="p-6 border-t-8 border-black bg-[#F2F2F2] flex justify-between items-center">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="b-btn text-xs py-2 px-6 h-auto bg-white"
          >
            &larr; {t("common.prev")}
          </button>
          <span className="font-black text-xs uppercase tracking-widest bg-black text-white px-4 py-2 border-2 border-[#FFD500]">
            {t("common.page_info", {
              current: page.toString(),
              total: totalPages.toString(),
            })}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="b-btn text-xs py-2 px-6 h-auto bg-white"
          >
            {t("common.next")} &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
