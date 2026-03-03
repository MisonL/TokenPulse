import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { config } from "../src/config";

const originalFetch = globalThis.fetch;
const loggerMock = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

mock.module("../src/lib/logger", () => ({
  logger: loggerMock,
}));

const { RefreshHandlers } = await import("../src/lib/auth/refreshers");

describe("RefreshHandlers", () => {
  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("qwen 刷新成功时应返回新令牌并合并元数据", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request, options?: RequestInit) => {
      expect(String(url)).toBe("https://chat.qwen.ai/api/v1/oauth2/token");
      expect(options?.method).toBe("POST");
      const body = options?.body as URLSearchParams;
      const serialized = body.toString();
      expect(serialized).toContain("grant_type=refresh_token");
      expect(serialized).toContain("refresh_token=qwen-refresh-token");
      expect(serialized).toContain(
        `client_id=${encodeURIComponent(config.oauth.qwenClientId)}`,
      );

      return new Response(
        JSON.stringify({
          access_token: "qwen-new-access",
          refresh_token: "qwen-new-refresh",
          expires_in: 7200,
          resource_url: "https://chat.qwen.ai/resource/test",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await RefreshHandlers.qwen({
      email: "qwen-user",
      refreshToken: "qwen-refresh-token",
      metadata: JSON.stringify({ source: "old-meta" }),
    });

    expect(result).toEqual({
      access_token: "qwen-new-access",
      refresh_token: "qwen-new-refresh",
      expires_in: 7200,
      metadata: {
        source: "old-meta",
        resource_url: "https://chat.qwen.ai/resource/test",
      },
    });
  });

  it("qwen 刷新失败时应返回 null 并记录诊断日志", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await RefreshHandlers.qwen({
      email: "qwen-user",
      refreshToken: "qwen-refresh-token",
      metadata: "{}",
    });

    expect(result).toBeNull();
    expect(
      loggerMock.warn.mock.calls.some((call: any[]) =>
        String(call[0]).includes("Qwen 刷新失败（HTTP 401）"),
      ),
    ).toBe(true);
  });

  it("iflow Basic 模式成功时应直接返回刷新结果", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request, options?: RequestInit) => {
      expect(String(url)).toBe("https://iflow.cn/oauth/token");
      expect(options?.method).toBe("POST");
      const headers = new Headers(options?.headers);
      const expectedBasic = Buffer.from(
        `${config.iflow.clientId}:${config.iflow.clientSecret}`,
      ).toString("base64");
      expect(headers.get("Authorization")).toBe(`Basic ${expectedBasic}`);

      const body = options?.body as URLSearchParams;
      const serialized = body.toString();
      expect(serialized).toContain("grant_type=refresh_token");
      expect(serialized).toContain("refresh_token=iflow-refresh-token");

      return new Response(
        JSON.stringify({
          access_token: "iflow-access-basic",
          refresh_token: "iflow-refresh-basic",
          expires_in: 1800,
          scope: "chat profile",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await RefreshHandlers.iflow({
      email: "iflow-user",
      refreshToken: "iflow-refresh-token",
      metadata: JSON.stringify({ region: "cn" }),
    });

    expect(result).toEqual({
      access_token: "iflow-access-basic",
      refresh_token: "iflow-refresh-basic",
      expires_in: 1800,
      metadata: {
        region: "cn",
        scope: "chat profile",
      },
    });
  });

  it("iflow Basic 失败后应自动回退到 body 模式", async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      const hasBasic = Boolean(headers.get("Authorization"));
      if (hasBasic) {
        return new Response("unauthorized", { status: 401 });
      }

      const body = options?.body as URLSearchParams;
      const serialized = body.toString();
      expect(serialized).toContain(
        `client_id=${encodeURIComponent(config.iflow.clientId)}`,
      );
      expect(serialized).toContain(
        `client_secret=${encodeURIComponent(config.iflow.clientSecret)}`,
      );

      return new Response(
        JSON.stringify({
          access_token: "iflow-access-body",
          refresh_token: "iflow-refresh-body",
          expires_in: 2400,
          scope: "chat",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await RefreshHandlers.iflow({
      email: "iflow-user",
      refreshToken: "iflow-refresh-token",
      metadata: "{}",
    });

    const fetchMock = globalThis.fetch as any;
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(result).toEqual({
      access_token: "iflow-access-body",
      refresh_token: "iflow-refresh-body",
      expires_in: 2400,
      metadata: {
        scope: "chat",
      },
    });
    expect(
      loggerMock.warn.mock.calls.some((call: any[]) =>
        String(call[0]).includes("改用 body 模式重试"),
      ),
    ).toBe(true);
  });

  it("iflow 两种刷新模式都失败时应返回 null 并记录错误", async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      if (headers.get("Authorization")) {
        return new Response("bad basic", { status: 401 });
      }
      return new Response("bad body", { status: 400 });
    }) as typeof fetch;

    const result = await RefreshHandlers.iflow({
      email: "iflow-user",
      refreshToken: "iflow-refresh-token",
      metadata: "{}",
    });

    expect(result).toBeNull();
    expect(
      loggerMock.error.mock.calls.some((call: any[]) =>
        String(call[0]).includes("Basic 与 body 模式均未成功"),
      ),
    ).toBe(true);
  });
});
