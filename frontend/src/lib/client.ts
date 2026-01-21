import { hc } from "hono/client";
import type { AppType } from "../../../src/index";

const BASE_URL = "/";
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

// 2. Create typed client with custom fetch to inject Authorization header
export const client = hc<AppType>(BASE_URL, {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getApiSecret();
    const headers = new Headers(init?.headers);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const resp = await fetch(input, {
      ...init,
      headers,
    });

    if (resp.status === 401) {
      // Optional: Trigger global auth handler (like in api.ts)
      // window.location.hash = "#/settings";
    }

    return resp;
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export type ClientType = typeof client;
