import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as ReactModule from "react";
import {
  getStateRedirectTarget,
  normalizeLoginRedirectTarget,
  resolveLoginSuccessTarget,
} from "./login-redirect";

const navigateMock = mock(() => {});
const loginWithApiSecretMock = mock(async () => {});
const consumeLoginRedirectMock = mock(() => "");
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

let locationState: unknown = null;
let stateQueue: Array<[unknown, ReturnType<typeof mock>]> = [];

const useStateMock = mock((initialValue: unknown) => {
  const next = stateQueue.shift();
  if (next) {
    return next as [unknown, ReturnType<typeof mock>];
  }
  return [initialValue, mock(() => {})];
});

mock.module("react", () => ({
  ...ReactModule,
  useState: useStateMock,
}));

mock.module("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ state: locationState }),
}));

mock.module("../lib/client", () => ({
  loginWithApiSecret: loginWithApiSecretMock,
  consumeLoginRedirect: consumeLoginRedirectMock,
}));

mock.module("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

type ReactLikeElement = {
  type?: unknown;
  props?: {
    children?: unknown;
    onSubmit?: (event: { preventDefault: () => void }) => Promise<void> | void;
    disabled?: boolean;
  };
};

async function loadLoginPageModule() {
  const cacheBust = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await import(`./LoginPage?login-page-test=${cacheBust}`);
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

describe("LoginPage 登录回跳与提交流程", () => {
  beforeEach(() => {
    locationState = null;
    stateQueue = [];
    navigateMock.mockReset();
    loginWithApiSecretMock.mockReset();
    consumeLoginRedirectMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    useStateMock.mockReset();
    useStateMock.mockImplementation((initialValue: unknown) => {
      const next = stateQueue.shift();
      if (next) {
        return next as [unknown, ReturnType<typeof mock>];
      }
      return [initialValue, mock(() => {})];
    });
  });

  afterEach(() => {
    locationState = null;
    stateQueue = [];
  });

  it("应规范化登录回跳地址并拒绝外部路径或 /login", async () => {
    expect(normalizeLoginRedirectTarget(" /enterprise?tab=oauth#incidents ")).toBe(
      "/enterprise?tab=oauth#incidents",
    );
    expect(normalizeLoginRedirectTarget("https://tokenpulse.test/enterprise")).toBe("");
    expect(normalizeLoginRedirectTarget("//tokenpulse.test/enterprise")).toBe("");
    expect(normalizeLoginRedirectTarget("/login")).toBe("");
    expect(
      getStateRedirectTarget({
        from: {
          pathname: "/enterprise",
          search: "?tab=alerts",
          hash: "#deliveries",
        },
      }),
    ).toBe("/enterprise?tab=alerts#deliveries");
    expect(
      resolveLoginSuccessTarget(
        {
          from: {
            pathname: "/login",
          },
        },
        "/settings?tab=api",
      ),
    ).toBe("/settings?tab=api");
    expect(resolveLoginSuccessTarget(null, "")).toBe("/");
  });

  it("初始空 secret 时提交按钮应为禁用态，且 submit 不应触发登录", async () => {
    const setSecretMock = mock(() => {});
    const setLoadingMock = mock(() => {});
    stateQueue = [
      ["   ", setSecretMock],
      [false, setLoadingMock],
    ];

    const { LoginPage } = await loadLoginPageModule();
    const tree = LoginPage();
    const button = findElement(tree, (element) => element.type === "button");
    const form = findElement(tree, (element) => element.type === "form");

    expect(button?.props?.disabled).toBe(true);

    let prevented = false;
    await form?.props?.onSubmit?.({
      preventDefault() {
        prevented = true;
      },
    });

    expect(prevented).toBe(true);
    expect(loginWithApiSecretMock).not.toHaveBeenCalled();
    expect(setLoadingMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("登录成功后应优先跳转到 location.state.from", async () => {
    const setSecretMock = mock(() => {});
    const setLoadingMock = mock(() => {});
    stateQueue = [
      ["  tokenpulse-secret  ", setSecretMock],
      [false, setLoadingMock],
    ];
    locationState = {
      from: {
        pathname: "/enterprise",
        search: "?tab=oauth",
        hash: "#incidents",
      },
    };
    loginWithApiSecretMock.mockResolvedValue(undefined);
    consumeLoginRedirectMock.mockReturnValue("/settings?tab=api");

    const { LoginPage } = await loadLoginPageModule();
    const tree = LoginPage();
    const form = findElement(tree, (element) => element.type === "form");

    await form?.props?.onSubmit?.({
      preventDefault() {},
    });

    expect(loginWithApiSecretMock).toHaveBeenCalledWith("tokenpulse-secret");
    expect(setLoadingMock).toHaveBeenNthCalledWith(1, true);
    expect(setLoadingMock).toHaveBeenNthCalledWith(2, false);
    expect(toastSuccessMock).toHaveBeenCalledWith("接口密钥验证通过，已保存");
    expect(navigateMock).toHaveBeenCalledWith("/enterprise?tab=oauth#incidents", {
      replace: true,
    });
  });

  it("当 state.from 无效时应回退到 session redirect", async () => {
    const setSecretMock = mock(() => {});
    const setLoadingMock = mock(() => {});
    stateQueue = [
      ["tokenpulse-secret", setSecretMock],
      [false, setLoadingMock],
    ];
    locationState = {
      from: {
        pathname: "/login",
      },
    };
    loginWithApiSecretMock.mockResolvedValue(undefined);
    consumeLoginRedirectMock.mockReturnValue("/settings?tab=api");

    const { LoginPage } = await loadLoginPageModule();
    const tree = LoginPage();
    const form = findElement(tree, (element) => element.type === "form");

    await form?.props?.onSubmit?.({
      preventDefault() {},
    });

    expect(navigateMock).toHaveBeenCalledWith("/settings?tab=api", {
      replace: true,
    });
  });

  it("登录失败时应提示错误并保持在当前页", async () => {
    const setSecretMock = mock(() => {});
    const setLoadingMock = mock(() => {});
    stateQueue = [
      ["tokenpulse-secret", setSecretMock],
      [false, setLoadingMock],
    ];
    loginWithApiSecretMock.mockRejectedValue("bad-secret");

    const { LoginPage } = await loadLoginPageModule();
    const tree = LoginPage();
    const form = findElement(tree, (element) => element.type === "form");

    await form?.props?.onSubmit?.({
      preventDefault() {},
    });

    expect(toastErrorMock).toHaveBeenCalledWith("接口密钥校验失败");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(setLoadingMock).toHaveBeenNthCalledWith(1, true);
    expect(setLoadingMock).toHaveBeenNthCalledWith(2, false);
  });
});
