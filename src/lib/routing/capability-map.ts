import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";

export const OAUTH_CAPABILITY_MAP_KEY = "oauth_capability_map";
const CACHE_TTL_MS = 10_000;

export type OAuthFlowType =
  | "auth_code"
  | "device_code"
  | "manual_key"
  | "service_account";

export interface ProviderCapability {
  provider: string;
  flows: OAuthFlowType[];
  supportsChat: boolean;
  supportsModelList: boolean;
  supportsStream: boolean;
  supportsManualCallback: boolean;
}

export type ProviderCapabilityMap = Record<string, ProviderCapability>;

const DEFAULT_CAPABILITY_MAP: ProviderCapabilityMap = {
  claude: {
    provider: "claude",
    flows: ["auth_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: true,
  },
  gemini: {
    provider: "gemini",
    flows: ["auth_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: true,
  },
  codex: {
    provider: "codex",
    flows: ["auth_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: true,
  },
  iflow: {
    provider: "iflow",
    flows: ["auth_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: true,
  },
  antigravity: {
    provider: "antigravity",
    flows: ["auth_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: true,
  },
  qwen: {
    provider: "qwen",
    flows: ["device_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: false,
  },
  kiro: {
    provider: "kiro",
    flows: ["device_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: false,
  },
  copilot: {
    provider: "copilot",
    flows: ["device_code"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: true,
  },
  aistudio: {
    provider: "aistudio",
    flows: ["manual_key"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: false,
  },
  vertex: {
    provider: "vertex",
    flows: ["service_account"],
    supportsChat: true,
    supportsModelList: true,
    supportsStream: true,
    supportsManualCallback: false,
  },
};

let cacheValue: ProviderCapabilityMap | null = null;
let cacheExpiresAt = 0;

function normalizeProviderId(input: string): string {
  return (input || "").trim().toLowerCase();
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function normalizeFlows(value: unknown, fallback: OAuthFlowType[]): OAuthFlowType[] {
  if (!Array.isArray(value)) return [...fallback];
  const accepted = new Set<OAuthFlowType>([
    "auth_code",
    "device_code",
    "manual_key",
    "service_account",
  ]);
  const normalized = value
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item): item is OAuthFlowType => accepted.has(item as OAuthFlowType));
  if (normalized.length === 0) return [...fallback];
  return Array.from(new Set(normalized));
}

function mergeCapability(
  provider: string,
  raw: unknown,
  fallback: ProviderCapability,
): ProviderCapability {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...fallback,
      provider,
    };
  }
  const payload = raw as Record<string, unknown>;
  return {
    provider,
    flows: normalizeFlows(payload.flows, fallback.flows),
    supportsChat: normalizeBoolean(payload.supportsChat, fallback.supportsChat),
    supportsModelList: normalizeBoolean(
      payload.supportsModelList,
      fallback.supportsModelList,
    ),
    supportsStream: normalizeBoolean(
      payload.supportsStream,
      fallback.supportsStream,
    ),
    supportsManualCallback: normalizeBoolean(
      payload.supportsManualCallback,
      fallback.supportsManualCallback,
    ),
  };
}

function mergeCapabilityMap(raw: unknown): ProviderCapabilityMap {
  const map = { ...DEFAULT_CAPABILITY_MAP };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return map;
  }

  const payload = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(payload)) {
    const provider = normalizeProviderId(key);
    if (!provider) continue;
    const fallback =
      map[provider] || {
        provider,
        flows: ["auth_code"],
        supportsChat: true,
        supportsModelList: true,
        supportsStream: true,
        supportsManualCallback: true,
      };
    map[provider] = mergeCapability(provider, value, fallback);
  }

  return map;
}

async function readCapabilityMapSetting(): Promise<ProviderCapabilityMap> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, OAUTH_CAPABILITY_MAP_KEY))
      .limit(1);
    const row = rows[0];
    if (!row) return { ...DEFAULT_CAPABILITY_MAP };
    const parsed = JSON.parse(row.value || "{}");
    return mergeCapabilityMap(parsed);
  } catch {
    return { ...DEFAULT_CAPABILITY_MAP };
  }
}

export async function getCapabilityMap(): Promise<ProviderCapabilityMap> {
  const now = Date.now();
  if (cacheValue && cacheExpiresAt > now) {
    return cacheValue;
  }
  cacheValue = await readCapabilityMapSetting();
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cacheValue;
}

export async function updateCapabilityMap(
  patch: unknown,
): Promise<ProviderCapabilityMap> {
  const current = await getCapabilityMap();
  const merged = mergeCapabilityMap({
    ...current,
    ...(patch && typeof patch === "object" && !Array.isArray(patch)
      ? (patch as Record<string, unknown>)
      : {}),
  });
  const nowIso = new Date().toISOString();
  await db
    .insert(settings)
    .values({
      key: OAUTH_CAPABILITY_MAP_KEY,
      value: JSON.stringify(merged),
      description: "Provider 能力图谱",
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: JSON.stringify(merged),
        updatedAt: nowIso,
      },
    });
  cacheValue = merged;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return merged;
}
