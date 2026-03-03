export interface ParsedOAuthCallback {
  code?: string;
  state?: string;
}

/**
 * 兼容 `code#state` 这类非常规回调格式。
 */
export function parseOAuthCallback(
  rawCode?: string,
  rawState?: string,
): ParsedOAuthCallback {
  if (!rawCode) {
    return { code: undefined, state: rawState };
  }

  const [codePart, fragmentState] = rawCode.split("#");
  return {
    code: codePart || rawCode,
    state: rawState || fragmentState || undefined,
  };
}

/**
 * 手动回调 URL 解析：支持 query + hash 两种 state 来源。
 */
export function parseManualCallbackUrl(url: URL): ParsedOAuthCallback {
  const queryCode = url.searchParams.get("code") || undefined;
  const queryState = url.searchParams.get("state") || undefined;

  const parsed = parseOAuthCallback(queryCode, queryState);
  if (parsed.state) return parsed;

  const hashState = url.hash?.replace(/^#/, "").trim();
  if (hashState) {
    return { ...parsed, state: hashState };
  }
  return parsed;
}
