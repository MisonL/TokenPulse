const MAX_STATE_LENGTH = 128;
const STATE_SAFE_PATTERN = /^[a-zA-Z0-9._-]+$/;

const PROVIDER_ALIAS_MAP: Record<string, string> = {
  anthropic: "claude",
  claude: "claude",
  google: "gemini",
  gemini: "gemini",
  openai: "codex",
  codex: "codex",
  iflow: "iflow",
  "i-flow": "iflow",
  antigravity: "antigravity",
  "anti-gravity": "antigravity",
  qwen: "qwen",
  kiro: "kiro",
  copilot: "copilot",
  aistudio: "aistudio",
  vertex: "vertex",
};

export function normalizeOAuthProvider(input?: string): string {
  const key = (input || "").trim().toLowerCase();
  if (!key) return "";
  return PROVIDER_ALIAS_MAP[key] || key;
}

export function validateOAuthState(state?: string): {
  ok: boolean;
  normalized: string;
  reason?: string;
} {
  const normalized = (state || "").trim();
  if (!normalized) {
    return { ok: false, normalized, reason: "state 为空" };
  }
  if (normalized.length > MAX_STATE_LENGTH) {
    return { ok: false, normalized, reason: "state 长度超限" };
  }
  if (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("..")
  ) {
    return { ok: false, normalized, reason: "state 包含非法路径字符" };
  }
  if (!STATE_SAFE_PATTERN.test(normalized)) {
    return { ok: false, normalized, reason: "state 包含非法字符" };
  }
  return { ok: true, normalized };
}

