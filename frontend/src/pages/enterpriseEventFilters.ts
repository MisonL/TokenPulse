export interface SessionEventFilterPatch {
  state?: string;
  provider?: string;
  flowType?: "" | "auth_code" | "device_code" | "manual_key" | "service_account";
  phase?:
    | ""
    | "pending"
    | "waiting_callback"
    | "waiting_device"
    | "exchanging"
    | "completed"
    | "error";
  status?: "" | "pending" | "completed" | "error";
  eventType?: "" | "register" | "set_phase" | "complete" | "mark_error";
  from?: string;
  to?: string;
}

export const normalizeBoundedPage = (page: number, totalPages = 1) =>
  Math.min(Math.max(1, Math.floor(page || 1)), Math.max(1, Math.floor(totalPages || 1)));

export const buildSessionEventStatePatch = (state: string): SessionEventFilterPatch => ({
  state: state.trim(),
});
