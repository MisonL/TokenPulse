/**
 * API Utility - Centralized fetch wrapper with Authorization header
 * 
 * Usage:
 *   import { api } from "../lib/api";
 *   const data = await api.get("/api/settings");
 *   await api.post("/api/settings", { key: "value" });
 */

import { toast } from "sonner";
import { t } from "./i18n";

const API_SECRET_KEY = "tokenpulse_api_secret";

/**
 * Get stored API secret from localStorage
 */
export function getApiSecret(): string {
  return localStorage.getItem(API_SECRET_KEY) || "";
}

/**
 * Set API secret to localStorage
 */
export function setApiSecret(secret: string): void {
  localStorage.setItem(API_SECRET_KEY, secret);
}

/**
 * Check if API secret is configured
 */
export function hasApiSecret(): boolean {
  return !!getApiSecret();
}

let lastToastTime = 0;
const TOAST_DEBOUNCE = 3000; // 3 seconds

function handleUnauthorized() {
  const now = Date.now();
  if (now - lastToastTime > TOAST_DEBOUNCE) {
    lastToastTime = now;
    toast.error(t("common.unauthorized"));
    
    // Redirect to settings after a short delay if not already there
    if (!window.location.hash.includes("/settings")) {
      setTimeout(() => {
        window.location.hash = "#/settings";
      }, 2000);
    }
  }
}

/**
 * Build headers with Authorization
 */
function buildHeaders(customHeaders?: HeadersInit): Headers {
  const headers = new Headers(customHeaders);
  
  const secret = getApiSecret();
  if (secret) {
    headers.set("Authorization", `Bearer ${secret}`);
  }
  
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  
  return headers;
}

/**
 * API client with automatic Authorization header
 */
export const api = {
  async request<T = unknown>(url: string, options: RequestInit): Promise<T> {
    const res = await fetch(url, options);
    
    if (res.status === 401) {
      handleUnauthorized();
    }
    
    if (!res.ok) {
      throw new Error(`API Error: ${res.status} ${res.statusText}`);
    }
    
    return res.json();
  },

  async get<T = unknown>(url: string, options?: RequestInit): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: "GET",
      headers: buildHeaders(options?.headers),
    });
  },

  async post<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: "POST",
      headers: buildHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async put<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: "PUT",
      headers: buildHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async delete<T = unknown>(url: string, options?: RequestInit): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: "DELETE",
      headers: buildHeaders(options?.headers),
    });
  },

  /**
   * Raw fetch with Authorization header (for streaming responses)
   */
  async raw(url: string, options?: RequestInit): Promise<Response> {
    const res = await fetch(url, {
      ...options,
      headers: buildHeaders(options?.headers),
    });

    if (res.status === 401) {
      handleUnauthorized();
    }

    return res;
  },
};

export default api;
