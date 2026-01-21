import { logger } from "./logger";

export interface FetchWithRetryOptions extends RequestInit {
  retries?: number;
  initialDelay?: number;
  maxDelay?: number; // Cap the delay
  backoffFactor?: number;
}

/**
 * Enhanced fetch with exponential backoff retry logic.
 * Handles network errors and 429/5xx HTTP status codes.
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

      // Success for non-error status codes
      if (res.ok) {
        return res;
      }

      // Handle 429 (Too Many Requests) and 5xx (Server Errors)
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "Unknown error"); // Consume body to avoid leaks?
        
        // Re-construct body for throw (text() consumes it)
        // Actually, difficult to reconstruct exactly if needed later, but here we treat as error.
        
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      // 4xx errors (except 429) are client errors, do not retry usually.
      // E.g. 401 Unauthorized, 400 Bad Request
      return res; // Return as is for client to handle (e.g. throw or parse error)

    } catch (e: any) {
      lastError = e;
      
      // Don't retry if it's the last attempt
      if (i === retries) break;

      // Calculate delay with jitter
      const baseDelay = initialDelay * Math.pow(backoffFactor, i);
      const cappedDelay = Math.min(baseDelay, maxDelay);
      const jitter = Math.random() * 200; // 0-200ms jitter
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
