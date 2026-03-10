import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { createElement } from "react";
import * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnterpriseAdminLoginSection } from "../components/enterprise/EnterpriseAdminLoginSection";
import { EnterpriseAvailabilityState } from "../components/enterprise/EnterpriseAvailabilityState";
import { EnterpriseConsoleHeader } from "../components/enterprise/EnterpriseConsoleHeader";
import { EnterpriseFeatureFlagsSection } from "../components/enterprise/EnterpriseFeatureFlagsSection";
import { enterpriseAdminClient, type FeaturePayload } from "../lib/client";
import { toast } from "sonner";

type ReactLikeElement = {
  type?: unknown;
  props?: {
    children?: unknown;
    onLogout?: () => void;
  };
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

const useEffectMock = mock(() => {});
const useMemoMock = mock((factory: () => unknown) => factory());
const useRefMock = mock((initialValue: unknown) => ({ current: initialValue }));
const logoutResultMock = mock(async () => ({
  ok: true,
  status: 200,
  data: {},
  payload: {},
  response: new Response(null, { status: 200 }),
}));
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

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

const originalLogoutResult = enterpriseAdminClient.logoutResult;
const originalToastSuccess = toast.success;
const originalToastError = toast.error;

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

const useStateMock = mock((initialValue: unknown) => {
  const resolvedValue = typeof initialValue === "function" ? initialValue() : initialValue;
  return [resolvedValue, mock(() => {})];
});

mock.module("react", () => ({
  ...ReactModule,
  useState: useStateMock,
  useEffect: useEffectMock,
  useMemo: useMemoMock,
  useRef: useRefMock,
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

async function loadEnterprisePageModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`./EnterprisePage?enterprise-admin-session-test=${cacheBust}`);
}

function findElement(
  node: unknown,
  predicate: (element: ReactLikeElement) => boolean,
): ReactLikeElement | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findElement(item, predicate);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;

  const element = node as ReactLikeElement;
  if (predicate(element)) return element;
  return findElement(element.props?.children, predicate);
}

async function renderEnterprisePage() {
  const { EnterprisePage } = await loadEnterprisePageModule();
  return EnterprisePage();
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("EnterprisePage 管理员会话页面态", () => {
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
    useStateMock.mockClear();
    useEffectMock.mockClear();
    useMemoMock.mockClear();
    useRefMock.mockClear();
    logoutResultMock.mockReset();
    logoutResultMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {},
      payload: {},
      response: new Response(null, { status: 200 }),
    });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    enterpriseAdminClient.logoutResult =
      logoutResultMock as unknown as typeof enterpriseAdminClient.logoutResult;
    toast.success = toastSuccessMock as unknown as typeof toast.success;
    toast.error = toastErrorMock as unknown as typeof toast.error;
  });

  afterAll(() => {
    enterpriseAdminClient.logoutResult = originalLogoutResult;
    toast.success = originalToastSuccess;
    toast.error = originalToastError;
    mock.restore();
  });

  it("标准版时应渲染标准版提示页", async () => {
    controlledState.featurePayload = {
      edition: "standard",
      features: {
        enterprise: false,
        audit: false,
        observability: false,
      },
      enterpriseBackend: {
        configured: false,
        reachable: false,
      },
    };
    const tree = await renderEnterprisePage();
    const html = renderToStaticMarkup(tree as ReturnType<typeof createElement>);

    expect((tree as ReactLikeElement).type).toBe(EnterpriseAvailabilityState);
    expect(html).toContain("当前为标准版");
    expect(html).toContain("ENABLE_ADVANCED=true");
    expect(findElement(tree, (element) => element.type === EnterpriseAdminLoginSection)).toBeNull();
  });

  it("高级版但 enterprise backend 不可达时应渲染不可达提示页", async () => {
    controlledState.featurePayload = {
      edition: "advanced",
      features: {
        enterprise: true,
        audit: true,
        observability: true,
      },
      enterpriseBackend: {
        configured: true,
        reachable: false,
        baseUrl: "http://enterprise.unreachable.local",
        error: "connect ECONNREFUSED",
      },
    };
    const tree = await renderEnterprisePage();
    const html = renderToStaticMarkup(tree as ReturnType<typeof createElement>);

    expect((tree as ReactLikeElement).type).toBe(EnterpriseAvailabilityState);
    expect(html).toContain("企业后端不可用");
    expect(html).toContain("configured=<code>true</code>");
    expect(html).toContain("reachable=<code>false</code>");
    expect(html).toContain("http://enterprise.unreachable.local");
    expect(findElement(tree, (element) => element.type === EnterpriseAdminLoginSection)).toBeNull();
  });

  it("管理员未认证时应渲染 EnterpriseAdminLoginSection", async () => {
    controlledState.adminAuthenticated = false;
    const tree = await renderEnterprisePage();

    expect((tree as ReactLikeElement).type).toBe(EnterpriseAdminLoginSection);
  });

  it("管理员已登录时应渲染企业控制面头部与能力开关", async () => {
    controlledState.adminAuthenticated = true;
    const tree = await renderEnterprisePage();

    expect(findElement(tree, (element) => element.type === EnterpriseConsoleHeader)).toBeTruthy();
    expect(findElement(tree, (element) => element.type === EnterpriseFeatureFlagsSection)).toBeTruthy();
    expect(findElement(tree, (element) => element.type === EnterpriseAdminLoginSection)).toBeNull();
  });

  it("管理员退出后应返回 EnterpriseAdminLoginSection 二次认证态", async () => {
    controlledState.adminAuthenticated = true;
    const tree = await renderEnterprisePage();
    const header = findElement(tree, (element) => element.type === EnterpriseConsoleHeader);

    expect(header).toBeTruthy();
    header?.props?.onLogout?.();
    await flushAsyncWork();

    const nextTree = await renderEnterprisePage();
    expect(logoutResultMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith("已退出管理员会话");
    expect((nextTree as ReactLikeElement).type).toBe(EnterpriseAdminLoginSection);
  });
});
