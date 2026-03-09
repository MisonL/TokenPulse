import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as ReactModule from "react";

const getApiSecretMock = mock(() => "");
const rememberLoginRedirectMock = mock(() => {});
const verifyStoredApiSecretMock = mock(async () => false);
const useNavigateMock = mock(() => {});
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

type RouterModule = typeof import("react-router-dom");
const routerOriginal = (await import(
  `react-router-dom?app-test-router=${Date.now()}-${Math.random().toString(16).slice(2)}`
)) as RouterModule;

type ClientModule = typeof import("./lib/client");
const clientOriginal = (await import(
  `./lib/client?app-test-client=${Date.now()}-${Math.random().toString(16).slice(2)}`
)) as ClientModule;

type SonnerModule = typeof import("sonner");
const sonnerOriginal = (await import(
  `sonner?app-test-sonner=${Date.now()}-${Math.random().toString(16).slice(2)}`
)) as SonnerModule;

let locationValue = {
  pathname: "/",
  search: "",
  hash: "",
};
let effectQueue: Array<() => unknown> = [];
let stateQueue: Array<[unknown, ReturnType<typeof mock>]> = [];

const navigateComponent = function Navigate() {
  return null;
};

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
  ...routerOriginal,
  BrowserRouter: ({ children }: { children: unknown }) => children,
  Routes: ({ children }: { children: unknown }) => children,
  Route: ({ element }: { element: unknown }) => element,
  Navigate: navigateComponent,
  useNavigate: () => useNavigateMock,
  useLocation: () => locationValue,
}));

mock.module("./lib/client", () => ({
  ...clientOriginal,
  getApiSecret: getApiSecretMock,
  rememberLoginRedirect: rememberLoginRedirectMock,
  verifyStoredApiSecret: verifyStoredApiSecretMock,
}));

mock.module("./layouts/BauhausLayout", () => ({
  BauhausLayout: () => null,
}));

mock.module("./pages/Dashboard", () => ({
  Dashboard: () => null,
}));

mock.module("./pages/LoginPage", () => ({
  LoginPage: () => null,
}));

mock.module("sonner", () => ({
  ...sonnerOriginal,
  Toaster: () => null,
  toast: {
    ...sonnerOriginal.toast,
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

async function loadAppModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`./App?app-test=${cacheBust}`);
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

describe("RequireAuth 登录态预检门禁", () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    locationValue = {
      pathname: "/",
      search: "",
      hash: "",
    };
    effectQueue = [];
    stateQueue = [];
    getApiSecretMock.mockReset();
    rememberLoginRedirectMock.mockReset();
    verifyStoredApiSecretMock.mockReset();
    useNavigateMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    useStateMock.mockReset();
    useEffectMock.mockReset();
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
    getApiSecretMock.mockReturnValue("");
    verifyStoredApiSecretMock.mockResolvedValue(false);
  });

  afterEach(() => {
    effectQueue = [];
    stateQueue = [];
  });

  it("本地无 secret 时应直接跳转到 /login", async () => {
    locationValue = {
      pathname: "/enterprise",
      search: "?tab=oauth",
      hash: "#incidents",
    };

    const { RequireAuth } = await loadAppModule();
    const tree = RequireAuth({
      children: ReactModule.createElement("div", null, "secure"),
    }) as {
      type: unknown;
      props: Record<string, unknown>;
    };

    expect(tree.type).toBe(navigateComponent);
    expect(tree.props.to).toBe("/login");
    expect(tree.props.replace).toBe(true);
    expect(rememberLoginRedirectMock).toHaveBeenCalledWith("/enterprise?tab=oauth#incidents");
    expect(tree.props.state).toEqual({
      from: locationValue,
      intent: "enterprise",
    });
    await runEffects();
    expect(verifyStoredApiSecretMock).not.toHaveBeenCalled();
  });

  it("本地已有 secret 时应先进入校验态，成功后放行页面", async () => {
    locationValue = {
      pathname: "/enterprise",
      search: "?tab=oauth",
      hash: "#incidents",
    };
    const setStatusMock = mock(() => {});
    stateQueue = [
      [
        {
          checkedTarget: "",
          verifiedSecret: "",
          status: "checking",
        },
        setStatusMock,
      ],
    ];
    getApiSecretMock.mockReturnValue("tokenpulse-secret");
    verifyStoredApiSecretMock.mockResolvedValue(true);

    const { RequireAuth, RouteLoadingFallback } = await loadAppModule();
    const securePage = ReactModule.createElement("div", null, "secure");
    const tree = RequireAuth({
      children: securePage,
    }) as {
      type: unknown;
      props: Record<string, unknown>;
    };

    expect(tree.type).toBe(RouteLoadingFallback);
    expect(tree.props.message).toBe("登录态校验中...");

    await runEffects();

    expect(verifyStoredApiSecretMock).toHaveBeenCalledWith({
      redirectTarget: "/enterprise?tab=oauth#incidents",
    });
    expect(setStatusMock).toHaveBeenCalledWith({
      checkedTarget: "/enterprise?tab=oauth#incidents",
      verifiedSecret: "tokenpulse-secret",
      status: "authenticated",
    });

    stateQueue = [
      [
        {
          checkedTarget: "/enterprise?tab=oauth#incidents",
          verifiedSecret: "tokenpulse-secret",
          status: "authenticated",
        },
        mock(() => {}),
      ],
    ];
    const nextTree = RequireAuth({
      children: securePage,
    });
    expect(nextTree).toBe(securePage);
  });

  it("预检失败时应回到 /login 并保留当前路由作为登录回跳", async () => {
    locationValue = {
      pathname: "/settings",
      search: "?tab=api",
      hash: "#secrets",
    };
    const setStatusMock = mock(() => {});
    stateQueue = [
      [
        {
          checkedTarget: "",
          verifiedSecret: "",
          status: "checking",
        },
        setStatusMock,
      ],
    ];
    getApiSecretMock.mockReturnValue("stale-secret");
    verifyStoredApiSecretMock.mockResolvedValue(false);

    const { RequireAuth } = await loadAppModule();
    RequireAuth({
      children: ReactModule.createElement("div", null, "secure"),
    });
    await runEffects();

    expect(verifyStoredApiSecretMock).toHaveBeenCalledWith({
      redirectTarget: "/settings?tab=api#secrets",
    });
    expect(setStatusMock).toHaveBeenCalledWith({
      checkedTarget: "/settings?tab=api#secrets",
      verifiedSecret: "",
      status: "unauthenticated",
    });

    getApiSecretMock.mockReturnValue("");
    stateQueue = [
      [
        {
          checkedTarget: "/settings?tab=api#secrets",
          verifiedSecret: "",
          status: "unauthenticated",
        },
        mock(() => {}),
      ],
    ];
    const tree = RequireAuth({
      children: ReactModule.createElement("div", null, "secure"),
    }) as {
      type: unknown;
      props: Record<string, unknown>;
    };

    expect(tree.type).toBe(navigateComponent);
    expect(tree.props.to).toBe("/login");
    expect(tree.props.state).toEqual({
      from: locationValue,
      intent: "app",
    });
    expect(rememberLoginRedirectMock).toHaveBeenCalledWith("/settings?tab=api#secrets");
  });
});
