import { inArray } from "drizzle-orm";
import { db } from "../db";
import { settings } from "../db/schema";

const MODEL_ALIAS_KEY = "oauth_model_alias";
const EXCLUDED_MODELS_KEY = "oauth_excluded_models";
const CACHE_TTL_MS = 5_000;

interface GovernanceCache {
  expiresAt: number;
  aliasMap: Record<string, string>;
  excludedModels: Set<string>;
}

let governanceCache: GovernanceCache | null = null;

function normalizeKey(input?: string): string {
  return (input || "").trim().toLowerCase();
}

function safeParseJson(raw?: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeTargetModel(provider: string, target: string): string {
  const normalizedProvider = normalizeKey(provider);
  const normalizedTarget = target.trim();
  if (!normalizedProvider) return normalizedTarget;
  if (!normalizedTarget) return normalizedTarget;
  if (normalizedTarget.includes(":")) return normalizedTarget;
  return `${normalizedProvider}:${normalizedTarget}`;
}

export function parseAliasRules(input: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return result;
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      const normalizedKey = normalizeKey(key);
      const target = value.trim();
      if (normalizedKey && target) {
        result[normalizedKey] = target;
      }
      continue;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const provider = normalizeKey(key);
    for (const [alias, target] of Object.entries(value as Record<string, unknown>)) {
      if (typeof target !== "string") continue;
      const normalizedAliasKey = normalizeKey(`${provider}:${alias}`);
      const normalizedTarget = normalizeTargetModel(provider, target);
      if (normalizedAliasKey && normalizedTarget) {
        result[normalizedAliasKey] = normalizedTarget;
      }
    }
  }

  return result;
}

export function parseExcludedRules(input: unknown): Set<string> {
  const result = new Set<string>();

  const add = (value?: string) => {
    const normalized = normalizeKey(value);
    if (normalized) {
      result.add(normalized);
    }
  };

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") add(item);
    }
    return result;
  }

  if (!input || typeof input !== "object") {
    return result;
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "boolean") {
      if (value) add(key);
      continue;
    }

    if (Array.isArray(value)) {
      const provider = normalizeKey(key);
      for (const item of value) {
        if (typeof item !== "string") continue;
        const normalizedItem = item.trim();
        if (!normalizedItem) continue;
        add(normalizedItem.includes(":") ? normalizedItem : `${provider}:${normalizedItem}`);
      }
      continue;
    }

    if (typeof value === "string") {
      const normalized = normalizeKey(value);
      if (normalized === "true" || normalized === "1") {
        add(key);
      }
    }
  }

  return result;
}

function candidateKeys(model: string, providerHint?: string): string[] {
  const normalizedModel = normalizeKey(model);
  const normalizedProvider = normalizeKey(providerHint);
  if (!normalizedModel) return [];

  const keys = new Set<string>();
  keys.add(normalizedModel);

  if (normalizedModel.includes(":")) {
    const [, ...parts] = normalizedModel.split(":");
    const raw = parts.join(":");
    if (raw) {
      keys.add(raw);
      const [provider] = normalizedModel.split(":");
      if (provider && raw) {
        keys.add(`${provider}:${raw}`);
      }
      if (normalizedProvider) {
        keys.add(`${normalizedProvider}:${raw}`);
      }
    }
  } else if (normalizedProvider) {
    keys.add(`${normalizedProvider}:${normalizedModel}`);
  }

  return Array.from(keys);
}

export function resolveModelAliasByRules(
  model: string,
  aliasMap: Record<string, string>,
): string {
  const normalized = normalizeKey(model);
  if (!normalized) return model;
  return aliasMap[normalized] || model;
}

export function isModelExcludedByRules(
  model: string,
  excludedModels: Set<string>,
  providerHint?: string,
): boolean {
  if (!model) return false;
  const keys = candidateKeys(model, providerHint);
  return keys.some((key) => excludedModels.has(key));
}

async function loadGovernanceFromDb(): Promise<GovernanceCache> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(inArray(settings.key, [MODEL_ALIAS_KEY, EXCLUDED_MODELS_KEY]));
    const aliasRow = rows.find((item) => item.key === MODEL_ALIAS_KEY);
    const excludedRow = rows.find((item) => item.key === EXCLUDED_MODELS_KEY);

    const aliasMap = parseAliasRules(safeParseJson(aliasRow?.value));
    const excludedModels = parseExcludedRules(safeParseJson(excludedRow?.value));

    return {
      aliasMap,
      excludedModels,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
  } catch {
    return {
      aliasMap: {},
      excludedModels: new Set<string>(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
  }
}

async function getGovernanceCache(): Promise<GovernanceCache> {
  const now = Date.now();
  if (governanceCache && governanceCache.expiresAt > now) {
    return governanceCache;
  }
  governanceCache = await loadGovernanceFromDb();
  return governanceCache;
}

export function invalidateModelGovernanceCache() {
  governanceCache = null;
}

export async function resolveRequestedModel(
  model: string,
  providerHint?: string,
): Promise<{ resolvedModel: string; excluded: boolean }> {
  if (!model) {
    return { resolvedModel: model, excluded: false };
  }

  const governance = await getGovernanceCache();
  const resolvedModel = resolveModelAliasByRules(model, governance.aliasMap);
  const excluded =
    isModelExcludedByRules(model, governance.excludedModels, providerHint) ||
    isModelExcludedByRules(
      resolvedModel,
      governance.excludedModels,
      providerHint,
    );

  return {
    resolvedModel,
    excluded,
  };
}

export async function filterExcludedModels<
  T extends { id: string; provider?: string },
>(models: T[]): Promise<T[]> {
  if (!Array.isArray(models) || models.length === 0) return [];
  const governance = await getGovernanceCache();
  return models.filter(
    (model) =>
      !isModelExcludedByRules(model.id, governance.excludedModels, model.provider),
  );
}
