import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as ReactModule from "react";
import { EnterpriseAdminLoginSection } from "../components/enterprise/EnterpriseAdminLoginSection";
import { EnterpriseConsoleHeader } from "../components/enterprise/EnterpriseConsoleHeader";
import { EnterpriseFeatureFlagsSection } from "../components/enterprise/EnterpriseFeatureFlagsSection";

type ReactLikeElement = {
  type?: unknown;
  props?: {
    children?: unknown;
  };
};

const useEffectMock = mock(() => {});
const useMemoMock = mock((factory: () => unknown) => factory());
const useRefMock = mock((initialValue: unknown) => ({ current: initialValue }));
let stateCallIndex = 0;
let adminAuthenticatedState = false;

const useStateMock = mock((initialValue: unknown) => {
  stateCallIndex += 1;

  if (stateCallIndex === 1) {
    return [
      {
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
      },
      mock(() => {}),
    ];
  }

  if (stateCallIndex === 113) {
    return [false, mock(() => {})];
  }
  if (stateCallIndex === 114) {
    return [true, mock(() => {})];
  }
  if (stateCallIndex === 115) {
    return [adminAuthenticatedState, mock(() => {})];
  }
  if (stateCallIndex === 116) {
    return ["admin", mock(() => {})];
  }
  if (stateCallIndex === 117) {
    return ["secret", mock(() => {})];
  }
  if (stateCallIndex === 118) {
    return [false, mock(() => {})];
  }

  return [typeof initialValue === "function" ? initialValue() : initialValue, mock(() => {})];
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

describe("EnterprisePage 管理员会话页面态", () => {
  beforeEach(() => {
    stateCallIndex = 0;
    adminAuthenticatedState = false;
    useStateMock.mockClear();
    useEffectMock.mockClear();
    useMemoMock.mockClear();
    useRefMock.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  it("管理员未登录时应渲染 EnterpriseAdminLoginSection", async () => {
    adminAuthenticatedState = false;
    const { EnterprisePage } = await loadEnterprisePageModule();
    const tree = EnterprisePage();

    expect((tree as ReactLikeElement).type).toBe(EnterpriseAdminLoginSection);
  });

  it("管理员已登录时应渲染企业控制面头部与能力开关", async () => {
    adminAuthenticatedState = true;
    const { EnterprisePage } = await loadEnterprisePageModule();
    const tree = EnterprisePage();

    expect(findElement(tree, (element) => element.type === EnterpriseConsoleHeader)).toBeTruthy();
    expect(findElement(tree, (element) => element.type === EnterpriseFeatureFlagsSection)).toBeTruthy();
    expect(findElement(tree, (element) => element.type === EnterpriseAdminLoginSection)).toBeNull();
  });
});
