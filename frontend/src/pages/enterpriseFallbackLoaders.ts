import { toast } from "sonner";
import {
  enterpriseAdminClient,
  type ClaudeFallbackQueryResult,
  type ClaudeFallbackSummary,
  type ClaudeFallbackTimeseriesPoint,
  type ClaudeFallbackTimeseriesQuery,
  type ClaudeFallbackTimeseriesResult,
} from "../lib/client";
import { normalizeDateTimeParam } from "./enterprisePageUtils";

type RunSectionLoad = <T>(
  section: "fallback",
  action: () => Promise<T>,
  fallback: string,
) => Promise<T>;

interface ClaudeFallbackFilters {
  mode: "" | "api_key" | "bridge";
  phase: "" | "attempt" | "success" | "failure" | "skipped";
  reason:
    | ""
    | "api_key_bearer_rejected"
    | "bridge_status_code"
    | "bridge_cloudflare_signal"
    | "bridge_circuit_open"
    | "bridge_http_error"
    | "bridge_exception"
    | "unknown";
  traceId: string;
  from: string;
  to: string;
  step: "5m" | "15m" | "1h" | "6h" | "1d";
}

interface ClaudeFallbackStateBindings {
  setEvents: (value: ClaudeFallbackQueryResult | null) => void;
  setSummary: (value: ClaudeFallbackSummary | null) => void;
  setTimeseries: (value: ClaudeFallbackTimeseriesPoint[]) => void;
}

export interface EnterpriseFallbackLoadersOptions {
  filters: ClaudeFallbackFilters;
  state: ClaudeFallbackStateBindings;
  runSectionLoad: RunSectionLoad;
}

const buildFallbackBaseQuery = (filters: ClaudeFallbackFilters) => {
  const fromParam = normalizeDateTimeParam(filters.from);
  const toParam = normalizeDateTimeParam(filters.to);

  return {
    mode: filters.mode || undefined,
    phase: filters.phase || undefined,
    reason: filters.reason || undefined,
    traceId: filters.traceId || undefined,
    from: fromParam,
    to: toParam,
  };
};

export function createEnterpriseFallbackLoaders({
  filters,
  state,
  runSectionLoad,
}: EnterpriseFallbackLoadersOptions) {
  const loadFallbackEvents = async (page = 1) =>
    runSectionLoad("fallback", async () => {
      const result = await enterpriseAdminClient.listClaudeFallbackEventsResult({
        ...buildFallbackBaseQuery(filters),
        page,
        pageSize: 10,
      });
      if (!result.ok) throw new Error(result.error || "加载 Claude 回退事件失败");
      state.setEvents(result.data as ClaudeFallbackQueryResult);
    }, "加载 Claude 回退事件失败");

  const loadFallbackSummary = async () =>
    runSectionLoad("fallback", async () => {
      const result = await enterpriseAdminClient.getClaudeFallbackSummaryResult(
        buildFallbackBaseQuery(filters),
      );
      if (!result.ok) throw new Error(result.error || "加载 Claude 回退聚合失败");
      state.setSummary((result.data || null) as ClaudeFallbackSummary | null);
    }, "加载 Claude 回退聚合失败");

  const loadFallbackTimeseries = async () =>
    runSectionLoad("fallback", async () => {
      const result = await enterpriseAdminClient.getClaudeFallbackTimeseriesResult({
        ...(buildFallbackBaseQuery(filters) as Omit<ClaudeFallbackTimeseriesQuery, "step">),
        step: filters.step,
      });
      if (!result.ok) throw new Error(result.error || "加载 Claude 回退趋势失败");
      const json = result.data as ClaudeFallbackTimeseriesResult;
      state.setTimeseries(json.data || []);
    }, "加载 Claude 回退趋势失败");

  const loadFallbackTimeseriesSafely = async () => {
    try {
      await loadFallbackTimeseries();
    } catch {
      state.setTimeseries([]);
      toast.error("Claude 回退趋势加载失败");
    }
  };

  const loadFallbackTimeseriesForBootstrap = async () => {
    try {
      await loadFallbackTimeseries();
    } catch (error) {
      state.setTimeseries([]);
      toast.error("Claude 回退趋势加载失败");
      throw error;
    }
  };

  const applyFallbackFilters = async (page = 1) => {
    try {
      await loadFallbackEvents(page);
      await loadFallbackSummary();
    } catch {
      toast.error("Claude 回退事件加载失败");
      return;
    }
    await loadFallbackTimeseriesSafely();
  };

  return {
    loadFallbackEvents,
    loadFallbackSummary,
    loadFallbackTimeseries,
    loadFallbackTimeseriesSafely,
    loadFallbackTimeseriesForBootstrap,
    applyFallbackFilters,
  };
}
