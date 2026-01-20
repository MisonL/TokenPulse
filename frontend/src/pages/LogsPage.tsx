import { Terminal, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";

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

  const fetchLogs = () => {
    // Note: Search would ideally be server-side, but for now we filter client side or just show raw logs via pagination
    // For this step we implement pagination. Search can be client side on the current page or require backend update.
    // Given user "Optimization" rule, let's keep it simple: Server pagination, Client filter (on view, or simple highlighter).
    // Actually, user asked for SEARCH. Let's add simple visual filter for now, or assume backend support later.
    // Current backend `logs.ts` doesn't support search param yet. I'll add visual filter on current page data + Search Bar placeholder.

    fetch(`/api/logs?page=${page}&pageSize=20`)
      .then((r) => r.json())
      .then((res) => {
        setLogs(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, refreshKey]);

  // Client-side filtering of current page for now
  const filteredLogs = logs.filter(
    (l) =>
      l.message.toLowerCase().includes(search.toLowerCase()) ||
      l.source.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b-4 border-black pb-4">
        <div className="flex items-center gap-4">
          <div className="bg-black text-white p-3">
            <Terminal className="w-8 h-8" />
          </div>
          <h2 className="text-4xl font-black uppercase text-black">
            {t("logs.title")}
          </h2>
        </div>
        <div className="flex gap-4">
          <div className="relative">
            <label htmlFor="log-search" className="sr-only">
              {t("common.search_logs")}
            </label>
            <input
              id="log-search"
              name="log-search"
              type="text"
              placeholder={t("common.search_placeholder")}
              className="border-2 border-black px-3 py-2 font-mono text-sm focus:bg-[#FFD500] focus:outline-none transition-colors"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="b-btn b-btn-primary p-2"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-white border-4 border-black p-0 overflow-hidden b-shadow">
        <table className="w-full text-left font-mono text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="p-4 uppercase tracking-wider border-r border-white/20">
                {t("logs.table_time")}
              </th>
              <th className="p-4 uppercase tracking-wider border-r border-white/20">
                {t("logs.table_level")}
              </th>
              <th className="p-4 uppercase tracking-wider border-r border-white/20">
                {t("logs.table_source")}
              </th>
              <th className="p-4 uppercase tracking-wider">
                {t("logs.table_msg")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-black">
            {filteredLogs.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-8 text-center text-gray-400 italic"
                >
                  {t("dashboard.no_events")}
                </td>
              </tr>
            )}
            {filteredLogs.map((log) => (
              <tr
                key={log.id}
                className="hover:bg-yellow-50 transition-colors group"
              >
                <td className="p-4 border-r-2 border-black whitespace-nowrap opacity-60 group-hover:opacity-100 font-mono text-xs">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td className="p-4 border-r-2 border-black font-bold">
                  <span
                    className={
                      log.level === "INFO"
                        ? "text-[#005C9A]"
                        : log.level === "WARN"
                          ? "text-[#e5b300]"
                          : "text-[#DA0414]"
                    }
                  >
                    {log.level}
                  </span>
                </td>
                <td className="p-4 border-r-2 border-black font-semibold">
                  {log.source}
                </td>
                <td className="p-4 break-all">{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination Controls */}
        <div className="p-4 border-t-4 border-black bg-gray-50 flex justify-between items-center">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="disabled:opacity-30 disabled:cursor-not-allowed font-bold hover:underline"
          >
            &larr; {t("common.prev")}
          </button>
          <span className="font-mono text-xs">
            {t("common.page_info", {
              current: page.toString(),
              total: totalPages.toString(),
            })}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="disabled:opacity-30 disabled:cursor-not-allowed font-bold hover:underline"
          >
            {t("common.next")} &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
