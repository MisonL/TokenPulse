import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as ReactModule from "react";
import { enterpriseAdminClient, type FeaturePayload } from "../lib/client";

type EffectTask = {
  effect: () => void | (() => void);
  deps?: unknown[];
};

type HookSlot =
  | {
      kind: "state";
      value: unknown;
      setter: (nextValue: unknown) => void;
    }
  | {
      kind: "ref";
      value: { current: unknown };
    }
  | {
      kind: "memo";
      value: unknown;
      deps?: unknown[];
    }
  | {
      kind: "effect";
      deps?: unknown[];
    };

const defaultFeaturePayload: FeaturePayload = {
  edition: "advanced",
  features: {
    enterprise: true,
    audit: true,
    observability: true,
  },
  enterpriseBackend: {
    configured: true,
    reachable: true,
    baseUrl: "http://enterprise.local",
  },
};

type ControlledState = {
  featurePayload: FeaturePayload | null;
  loading: boolean;
  enterpriseEnabled: boolean;
  adminAuthenticated: boolean;
  adminUsername: string;
  adminPassword: string;
  authSubmitting: boolean;
};

let controlledState: ControlledState = {
  featurePayload: defaultFeaturePayload,
  loading: false,
  enterpriseEnabled: true,
  adminAuthenticated: false,
  adminUsername: "admin",
  adminPassword: "secret",
  authSubmitting: false,
};

let controlledLocation = {
  pathname: "/enterprise",
  search: "",
  hash: "",
};

let hookCursor = 0;
let hookSlots: HookSlot[] = [];
let pendingEffects: EffectTask[] = [];
let stateUpdates: Array<{ slotIndex: number; prevValue: unknown; nextValue: unknown }> = [];

function depsEqual(prev?: unknown[], next?: unknown[]) {
  if (!prev || !next) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) return false;
  }
  return true;
}

function beginRender() {
  hookCursor = 0;
  pendingEffects = [];
}

const useStateMock = mock((initialValue: unknown) => {
  const slotIndex = hookCursor;
  hookCursor += 1;

  const existing = hookSlots[slotIndex];
  if (existing && existing.kind === "state") {
    return [existing.value, existing.setter];
  }

  const resolvedValue = typeof initialValue === "function"
    ? (initialValue as () => unknown)()
    : initialValue;

  const setter = (nextValue: unknown) => {
    const slot = hookSlots[slotIndex];
    if (!slot || slot.kind !== "state") return;
    const prevValue = slot.value;
    const resolvedNext = typeof nextValue === "function"
      ? (nextValue as (prev: unknown) => unknown)(prevValue)
      : nextValue;
    slot.value = resolvedNext;
    stateUpdates.push({ slotIndex, prevValue, nextValue: resolvedNext });
  };

  hookSlots[slotIndex] = {
    kind: "state",
    value: resolvedValue,
    setter,
  };

  return [resolvedValue, setter];
});

const useRefMock = mock((initialValue: unknown) => {
  const slotIndex = hookCursor;
  hookCursor += 1;

  const existing = hookSlots[slotIndex];
  if (existing && existing.kind === "ref") {
    return existing.value;
  }

  const refObject = { current: initialValue };
  hookSlots[slotIndex] = {
    kind: "ref",
    value: refObject,
  };
  return refObject;
});

const useMemoMock = mock((factory: () => unknown, deps?: unknown[]) => {
  const slotIndex = hookCursor;
  hookCursor += 1;

  const existing = hookSlots[slotIndex];
  if (existing && existing.kind === "memo") {
    if (deps && existing.deps && depsEqual(existing.deps, deps)) {
      return existing.value;
    }
  }

  const value = factory();
  hookSlots[slotIndex] = {
    kind: "memo",
    value,
    deps,
  };
  return value;
});

const useEffectMock = mock((effect: () => void | (() => void), deps?: unknown[]) => {
  const slotIndex = hookCursor;
  hookCursor += 1;

  const existing = hookSlots[slotIndex];
  if (existing && existing.kind === "effect") {
    if (deps && existing.deps && depsEqual(existing.deps, deps)) {
      return;
    }
  }

  hookSlots[slotIndex] = {
    kind: "effect",
    deps,
  };

  pendingEffects.push({ effect, deps });
});

function flushDeepLinkEffects() {
  const search = controlledLocation.search;
  for (const task of pendingEffects) {
    if (Array.isArray(task.deps) && task.deps.includes(search)) {
      task.effect();
    }
  }
}

function setControlledState<K extends keyof ControlledState>(
  key: K,
  nextValue: ControlledState[K] | ((prevValue: ControlledState[K]) => ControlledState[K]),
) {
  const prevValue = controlledState[key];
  controlledState = {
    ...controlledState,
    [key]: typeof nextValue === "function"
      ? (nextValue as (prev: ControlledState[K]) => ControlledState[K])(prevValue)
      : nextValue,
  };
}

mock.module("react", () => ({
  ...ReactModule,
  useState: useStateMock,
  useEffect: useEffectMock,
  useMemo: useMemoMock,
  useRef: useRefMock,
}));

mock.module("react-router-dom", () => ({
  useLocation: () => controlledLocation,
}));

mock.module("./EnterprisePage.hooks", () => ({
  useEnterpriseFeatureGateState: () => ({
    featurePayload: controlledState.featurePayload,
    setFeaturePayload: (nextValue: FeaturePayload | null) => {
      setControlledState("featurePayload", nextValue);
    },
    loading: controlledState.loading,
    setLoading: (nextValue: boolean) => {
      setControlledState("loading", Boolean(nextValue));
    },
    enterpriseEnabled: controlledState.enterpriseEnabled,
    setEnterpriseEnabled: (nextValue: boolean) => {
      setControlledState("enterpriseEnabled", Boolean(nextValue));
    },
  }),
  useEnterpriseAdminSessionState: () => ({
    adminAuthenticated: controlledState.adminAuthenticated,
    setAdminAuthenticated: (nextValue: boolean) => {
      setControlledState("adminAuthenticated", Boolean(nextValue));
    },
    adminUsername: controlledState.adminUsername,
    setAdminUsername: (nextValue: string) => {
      setControlledState("adminUsername", String(nextValue));
    },
    adminPassword: controlledState.adminPassword,
    setAdminPassword: (nextValue: string) => {
      setControlledState("adminPassword", String(nextValue));
    },
    authSubmitting: controlledState.authSubmitting,
    setAuthSubmitting: (nextValue: boolean) => {
      setControlledState("authSubmitting", Boolean(nextValue));
    },
  }),
}));

const originalGetAgentLedgerTraceResult = enterpriseAdminClient.getAgentLedgerTraceResult;

async function loadEnterprisePageModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`./EnterprisePage?enterprise-deeplink-test=${cacheBust}`);
}

describe("EnterprisePage 深链参数", () => {
  beforeEach(() => {
    controlledState = {
      featurePayload: defaultFeaturePayload,
      loading: false,
      enterpriseEnabled: true,
      adminAuthenticated: false,
      adminUsername: "admin",
      adminPassword: "secret",
      authSubmitting: false,
    };
    controlledLocation = {
      pathname: "/enterprise",
      search: "",
      hash: "",
    };
    hookCursor = 0;
    hookSlots = [];
    pendingEffects = [];
    stateUpdates = [];
    useStateMock.mockClear();
    useEffectMock.mockClear();
    useMemoMock.mockClear();
    useRefMock.mockClear();
  });

  afterAll(() => {
    enterpriseAdminClient.getAgentLedgerTraceResult = originalGetAgentLedgerTraceResult;
    mock.restore();
  });

  it("traceId 深链应自动触发联查且同一个 search 仅触发一次", async () => {
    const traceResultMock = mock(async (traceId: string) => ({
      ok: true,
      status: 200,
      data: {},
      payload: {
        data: {
          summary: {
            traceId,
            currentState: "delivered",
          },
        },
      },
      response: new Response(null, { status: 200 }),
    }));
    enterpriseAdminClient.getAgentLedgerTraceResult =
      traceResultMock as unknown as typeof enterpriseAdminClient.getAgentLedgerTraceResult;

    controlledLocation.search = "?tenantId=tenant-a&projectId=project-b&traceId=trace-123";
    const { EnterprisePage } = await loadEnterprisePageModule();

    beginRender();
    EnterprisePage();
    flushDeepLinkEffects();
    expect(traceResultMock).toHaveBeenCalledTimes(0);

    controlledState.adminAuthenticated = true;
    beginRender();
    EnterprisePage();
    flushDeepLinkEffects();
    expect(traceResultMock).toHaveBeenCalledTimes(1);
    expect(traceResultMock).toHaveBeenCalledWith("trace-123");
    const traceUpdateCount = stateUpdates.filter(
      (item) => item.nextValue === "trace-123",
    ).length;
    expect(traceUpdateCount).toBeGreaterThanOrEqual(2);

    controlledState.enterpriseEnabled = false;
    beginRender();
    EnterprisePage();
    flushDeepLinkEffects();

    controlledState.enterpriseEnabled = true;
    beginRender();
    EnterprisePage();
    flushDeepLinkEffects();

    expect(traceResultMock).toHaveBeenCalledTimes(1);
    expect(
      stateUpdates.filter((item) => item.nextValue === "trace-123").length,
    ).toBe(traceUpdateCount);
  });
});
