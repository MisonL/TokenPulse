import { hc } from "hono/client";
import type { AppType } from "../../../src/index";

const BASE_URL = "/";
const API_SECRET_KEY = "tokenpulse_api_secret";

/**
 * 从 localStorage 获取存储的 API Secret
 */
export function getApiSecret(): string {
  return localStorage.getItem(API_SECRET_KEY) || "";
}

/**
 * 设置 API Secret 到 localStorage
 */
export function setApiSecret(secret: string): void {
  localStorage.setItem(API_SECRET_KEY, secret);
}

// 2. 创建带有自定义 fetch 的类型化客户端以注入 Authorization 标头
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
      // 如果 401，清除 secret 并重定向到登录页
      localStorage.removeItem(API_SECRET_KEY);
      window.location.href = "/login";
    }

    return resp;
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export type ClientType = typeof client;
