import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as ReactModule from "react";

type FeaturePayloadLike = {
  features?: {
    enterprise?: boolean;
  };
};

const loadFeaturePayloadMock = mock(async (): Promise<FeaturePayloadLike | null> => null);
const isEnterpriseFeatureEnabledMock = mock(
  (payload: FeaturePayloadLike | null | undefined) => payload?.features?.enterprise === true,
);

let stateQueue: Array<[unknown, ReturnType<typeof mock>]> = [];
let effectQueue: Array<() => unknown> = [];

const useStateMock = mock((initialValue: unknown) => {
  const next = stateQueue.shift();
  if (next) {
    return next as [unknown, ReturnType<typeof mock>];
  }
  return [typeof initialValue === "function" ? initialValue() : initialValue, mock(() => {})];
});

const useEffectMock = mock((effect: () => unknown) => {
  effectQueue.push(effect);
});

mock.module("react", () => ({
  ...ReactModule,
  useState: useStateMock,
  useEffect: useEffectMock,
}));

mock.module("react-router-dom", () => ({
  Outlet: () => null,
  NavLink: ({ children, ...props }: { children?: unknown; [key: string]: unknown }) => ({
    type: "NavLink",
    props: {
      ...props,
      children,
    },
  }),
}));

mock.module("../lib/client", () => ({
  loadFeaturePayload: loadFeaturePayloadMock,
  isEnterpriseFeatureEnabled: isEnterpriseFeatureEnabledMock,
}));

mock.module("../lib/i18n", () => ({
  t: (key: string) => key,
}));

mock.module("../lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" "),
}));

mock.module("lucide-react", () => ({
  LayoutDashboard: () => null,
  Key: () => null,
  FileText: () => null,
  Settings: () => null,
  Play: () => null,
  Box: () => null,
  ShieldCheck: () => null,
}));

type ReactLikeElement = {
  type?: unknown;
  props?: {
    children?: unknown;
    to?: string;
  };
};

async function loadBauhausLayoutModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`./BauhausLayout?bauhaus-layout-test=${cacheBust}`);
}

async function runEffects() {
  const pending = [...effectQueue];
  effectQueue = [];
  for (const effect of pending) {
    effect();
  }
  await Promise.resolve();
  await Promise.resolve();
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

describe("BauhausLayout 企业入口 feature gate", () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    stateQueue = [];
    effectQueue = [];
    loadFeaturePayloadMock.mockReset();
    isEnterpriseFeatureEnabledMock.mockReset();
    useStateMock.mockReset();
    useEffectMock.mockReset();

    loadFeaturePayloadMock.mockResolvedValue(null);
    isEnterpriseFeatureEnabledMock.mockImplementation(
      (payload: FeaturePayloadLike | null | undefined) => payload?.features?.enterprise === true,
    );

    useStateMock.mockImplementation((initialValue: unknown) => {
      const next = stateQueue.shift();
      if (next) {
        return next as [unknown, ReturnType<typeof mock>];
      }
      return [typeof initialValue === "function" ? initialValue() : initialValue, mock(() => {})];
    });
    useEffectMock.mockImplementation((effect: () => unknown) => {
      effectQueue.push(effect);
    });
  });

  afterEach(() => {
    stateQueue = [];
    effectQueue = [];
  });

  it("feature 开启时应显示 enterprise 菜单", async () => {
    const setEnterpriseEnabledMock = mock(() => {});
    const featurePayload = {
      features: {
        enterprise: true,
      },
    };
    stateQueue = [[false, setEnterpriseEnabledMock]];
    loadFeaturePayloadMock.mockResolvedValue(featurePayload);

    const { BauhausLayout } = await loadBauhausLayoutModule();
    const initialTree = BauhausLayout();
    expect(findElement(initialTree, (element) => element.props?.to === "/enterprise")).toBeNull();

    await runEffects();

    expect(loadFeaturePayloadMock).toHaveBeenCalledTimes(1);
    expect(isEnterpriseFeatureEnabledMock).toHaveBeenCalledWith(featurePayload);
    expect(setEnterpriseEnabledMock).toHaveBeenCalledWith(true);

    stateQueue = [[true, mock(() => {})]];
    const nextTree = BauhausLayout();
    expect(findElement(nextTree, (element) => element.props?.to === "/enterprise")).not.toBeNull();
  });

  it("feature 关闭时应隐藏 enterprise 菜单", async () => {
    const setEnterpriseEnabledMock = mock(() => {});
    const featurePayload = {
      features: {
        enterprise: false,
      },
    };
    stateQueue = [[false, setEnterpriseEnabledMock]];
    loadFeaturePayloadMock.mockResolvedValue(featurePayload);

    const { BauhausLayout } = await loadBauhausLayoutModule();
    BauhausLayout();
    await runEffects();

    expect(loadFeaturePayloadMock).toHaveBeenCalledTimes(1);
    expect(isEnterpriseFeatureEnabledMock).toHaveBeenCalledWith(featurePayload);
    expect(setEnterpriseEnabledMock).toHaveBeenCalledWith(false);

    stateQueue = [[false, mock(() => {})]];
    const tree = BauhausLayout();
    expect(findElement(tree, (element) => element.props?.to === "/enterprise")).toBeNull();
  });

  it("features 接口失败时应只做关闭降级，不显示 enterprise 菜单", async () => {
    const setEnterpriseEnabledMock = mock(() => {});
    stateQueue = [[false, setEnterpriseEnabledMock]];
    loadFeaturePayloadMock.mockRejectedValue(new Error("features unavailable"));

    const { BauhausLayout } = await loadBauhausLayoutModule();
    BauhausLayout();
    await runEffects();

    expect(loadFeaturePayloadMock).toHaveBeenCalledTimes(1);
    expect(isEnterpriseFeatureEnabledMock).not.toHaveBeenCalled();
    expect(setEnterpriseEnabledMock).toHaveBeenCalledWith(false);

    stateQueue = [[false, mock(() => {})]];
    const tree = BauhausLayout();
    expect(findElement(tree, (element) => element.props?.to === "/enterprise")).toBeNull();
  });
});
