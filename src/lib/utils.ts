
/**
 * 安全解析 JSON，失败时返回默认值
 */
export function safeJsonParse<T = any>(
  str: string | null | undefined, 
  defaultValue: T = {} as T
): T {
  if (!str) return defaultValue;
  try {
    const result = JSON.parse(str);
    return typeof result === 'object' && result !== null ? result : defaultValue;
  } catch {
    return defaultValue;
  }
}
