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

const FEATURE_PAYLOAD_STATE_INDEX = 1;
const LOADING_STATE_INDEX = 113;
const ENTERPRISE_ENABLED_STATE_INDEX = 114;
const ADMIN_AUTHENTICATED_STATE_INDEX = 115;
const ADMIN_USERNAME_STATE_INDEX = 116;
const ADMIN_PASSWORD_STATE_INDEX = 117;
const AUTH_SUBMITTING_STATE_INDEX = 118;

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

let stateCallIndex = 0;
let controlledState = {
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

function getControlledStateValue(index: number, initialValue: unknown) {
  switch (index) {
    case FEATURE_PAYLOAD_STATE_INDEX:
      return controlledState.featurePayload;
    case LOADING_STATE_INDEX:
      return controlledState.loading;
    case ENTERPRISE_ENABLED_STATE_INDEX:
      return controlledState.enterpriseEnabled;
    case ADMIN_AUTHENTICATED_STATE_INDEX:
      return controlledState.adminAuthenticated;
    case ADMIN_USERNAME_STATE_INDEX:
      return controlledState.adminUsername;
    case ADMIN_PASSWORD_STATE_INDEX:
      return controlledState.adminPassword;
    case AUTH_SUBMITTING_STATE_INDEX:
      return controlledState.authSubmitting;
    default:
      return typeof initialValue === "function" ? initialValue() : initialValue;
  }
}

function setControlledStateValue(index: number, nextValue: unknown) {
  switch (index) {
    case FEATURE_PAYLOAD_STATE_INDEX:
      controlledState.featurePayload = nextValue as FeaturePayload;
      return;
    case LOADING_STATE_INDEX:
      controlledState.loading = Boolean(nextValue);
      return;
    case ENTERPRISE_ENABLED_STATE_INDEX:
      controlledState.enterpriseEnabled = Boolean(nextValue);
      return;
    case ADMIN_AUTHENTICATED_STATE_INDEX:
      controlledState.adminAuthenticated = Boolean(nextValue);
      return;
    case ADMIN_USERNAME_STATE_INDEX:
      controlledState.adminUsername = String(nextValue);
      return;
    case ADMIN_PASSWORD_STATE_INDEX:
      controlledState.adminPassword = String(nextValue);
      return;
    case AUTH_SUBMITTING_STATE_INDEX:
      controlledState.authSubmitting = Boolean(nextValue);
      return;
    default:
      return;
  }
}

const useStateMock = mock((initialValue: unknown) => {
  stateCallIndex += 1;
  const currentIndex = stateCallIndex;
  const currentValue = getControlledStateValue(currentIndex, initialValue);
  const setter = mock((nextValue: unknown) => {
    const prevValue = getControlledStateValue(currentIndex, initialValue);
    const resolvedValue = typeof nextValue === "function"
      ? nextValue(prevValue)
      : nextValue;
    setControlledStateValue(currentIndex, resolvedValue);
  });
  return [currentValue, setter];
});

mock.module("react", () => ({
  ...ReactModule,
  useState: useStateMock,
  useEffect: useEffectMock,
  useMemo: useMemoMock,
  useRef: useRefMock,
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
  stateCallIndex = 0;
  const { EnterprisePage } = await loadEnterprisePageModule();
  return EnterprisePage();
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("EnterprisePage 管理员会话页面态", () => {
  beforeEach(() => {
    stateCallIndex = 0;
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
