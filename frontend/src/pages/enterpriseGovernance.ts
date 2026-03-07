import {
  ORG_DOMAIN_API_CONTRACT,
  ORG_DOMAIN_API_CONTRACT_PATHS,
} from "../lib/client";
import type { OAuthModelAliasPayload } from "../lib/client";

export interface OrgDomainAvailabilityState {
  apiAvailable: boolean;
  readOnlyFallback: boolean;
  reason: "ready" | "api_unavailable";
}

export { ORG_DOMAIN_API_CONTRACT, ORG_DOMAIN_API_CONTRACT_PATHS };

export interface OrgDomainPanelState {
  summaryText: string;
  readOnlyBanner: string;
  overviewFallbackHint: string;
  organizationWriteHint: string;
  projectWriteHint: string;
  memberBindingWriteHint: string;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function addExcludedModel(target: Set<string>, raw: string, providerHint = "") {
  const normalized = normalizeToken(raw);
  if (!normalized) return;
  if (normalized.includes(":") || !providerHint) {
    target.add(normalized);
    return;
  }
  target.add(`${normalizeToken(providerHint)}:${normalized}`);
}

export function normalizeModelAliasPayload(value: unknown): OAuthModelAliasPayload {
  const payload = toObject(value);
  const normalized: OAuthModelAliasPayload = {};

  for (const [key, entry] of Object.entries(payload)) {
    if (typeof entry === "string") {
      const target = entry.trim();
      if (target) {
        normalized[key] = target;
      }
      continue;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const providerEntries: Record<string, string> = {};
    for (const [alias, target] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof target !== "string" || !target.trim()) continue;
      providerEntries[alias] = target.trim();
    }
    if (Object.keys(providerEntries).length > 0) {
      normalized[key] = providerEntries;
    }
  }

  return normalized;
}

export function countModelAliasEntries(value: unknown): number {
  return Object.values(normalizeModelAliasPayload(value)).reduce((count, entry) => {
    if (typeof entry === "string") return count + 1;
    return count + Object.keys(entry).length;
  }, 0);
}

export function formatModelAliasEditorText(value: unknown): string {
  return JSON.stringify(normalizeModelAliasPayload(value), null, 2);
}

export function parseModelAliasEditorText(
  value: string,
): { ok: true; value: OAuthModelAliasPayload } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: true,
      value: {},
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: "模型别名规则必须是 JSON 对象",
      };
    }
    return {
      ok: true,
      value: normalizeModelAliasPayload(parsed),
    };
  } catch {
    return {
      ok: false,
      error: "模型别名规则 JSON 格式无效",
    };
  }
}

export function extractExcludedModels(value: unknown): string[] {
  const normalized = new Set<string>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        addExcludedModel(normalized, entry);
      }
    }
    return Array.from(normalized).sort();
  }

  const payload = toObject(value);
  for (const [key, entry] of Object.entries(payload)) {
    if (typeof entry === "boolean") {
      if (entry) {
        addExcludedModel(normalized, key);
      }
      continue;
    }

    if (typeof entry === "string") {
      const flag = normalizeToken(entry);
      if (flag === "true" || flag === "1") {
        addExcludedModel(normalized, key);
      }
      continue;
    }

    if (!Array.isArray(entry)) {
      continue;
    }

    for (const item of entry) {
      if (typeof item === "string") {
        addExcludedModel(normalized, item, key);
      }
    }
  }

  return Array.from(normalized).sort();
}

export function formatExcludedModelsEditorText(value: unknown): string {
  return extractExcludedModels(value).join("\n");
}

export function parseExcludedModelsEditorText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((entry) => normalizeToken(entry))
        .filter(Boolean),
    ),
  ).sort();
}

export function resolveOrgDomainAvailabilityState(options: {
  loadFailed: boolean;
}): OrgDomainAvailabilityState {
  if (options.loadFailed) {
    return {
      apiAvailable: false,
      readOnlyFallback: true,
      reason: "api_unavailable",
    };
  }

  return {
    apiAvailable: true,
    readOnlyFallback: false,
    reason: "ready",
  };
}

export function resolveOrgDomainPanelState(options: {
  apiAvailable: boolean;
  readOnlyFallback: boolean;
  overviewApiAvailable: boolean;
}): OrgDomainPanelState {
  const readOnly = !options.apiAvailable || options.readOnlyFallback;

  return {
    summaryText:
      "组织域固定使用 /api/org/organizations、/api/org/projects、/api/org/members、/api/org/member-project-bindings 四个真实接口；前端不再探测历史兼容路径。",
    readOnlyBanner: readOnly
      ? "组织域基础接口不可用，面板已切换为只读降级。当前仅展示最近一次成功加载结果与本地概览，组织/项目创建删除、成员组织调整、项目绑定增删已全部禁用。请恢复 /api/org/* 后点击“刷新组织域”重试。"
      : "",
    overviewFallbackHint: !options.overviewApiAvailable
      ? "当前后端未提供 /api/org/overview，已降级为前端本地统计。"
      : "",
    organizationWriteHint: readOnly ? "只读降级中：组织创建与删除已禁用。" : "",
    projectWriteHint: readOnly ? "只读降级中：项目创建与删除已禁用。" : "",
    memberBindingWriteHint: readOnly
      ? "只读降级中：成员组织调整与项目绑定增删已禁用。"
      : "",
  };
}
