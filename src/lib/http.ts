import { logger } from "./logger";

export interface FetchWithRetryOptions extends RequestInit {
  retries?: number;
  initialDelay?: number;
  maxDelay?: number; // 延迟上限
  backoffFactor?: number;
}


export class HTTPError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
    public headers: Headers
  ) {
    super(`HTTP ${status}: ${statusText} - ${body.substring(0, 100)}`);
    this.name = "HTTPError";
  }
}

/**
 * 带有指数退避重试逻辑的增强版 fetch。
 * 处理网络错误以及 429/5xx HTTP 状态码。
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    ...fetchOptions
  } = options;

  let lastError: any;

  for (let i = 0; i < retries + 1; i++) {
    try {
      const res = await fetch(url, fetchOptions);

      // 非错误状态码直接成功
      if (res.ok) {
        return res;
      }

      // 处理 429 (Too Many Requests) 和 5xx (服务器错误)
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "Unknown error");
        // 抛出结构化错误以便重试逻辑或上层处理
        throw new HTTPError(res.status, res.statusText, text, res.headers);
      }

      // 4xx 错误（除了 429）是客户端错误，通常不重试。
      // 例如 401 Unauthorized, 400 Bad Request
      return res; // 原样返回供客户端处理（例如 throw 或解析错误）

    } catch (e: any) {
      lastError = e;
      
      // 如果是最后一次尝试则不重试
      if (i === retries) break;

      // 计算带抖动的延迟
      const baseDelay = initialDelay * Math.pow(backoffFactor, i);
      const cappedDelay = Math.min(baseDelay, maxDelay);
      const jitter = Math.random() * 200; // 0-200ms 抖动
      const delay = cappedDelay + jitter;

      logger.warn(
        `Fetch failed for ${url} (Attempt ${i + 1}/${retries + 1}). Retrying in ${Math.round(delay)}ms... Error: ${e.message}`,
        "Network"
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
