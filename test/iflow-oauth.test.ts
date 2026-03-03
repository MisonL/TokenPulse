import { describe, it, expect } from "bun:test";
import { generateIflowAuthUrl } from "../src/lib/auth/iflow";
import { config } from "../src/config";

describe("iFlow OAuth", () => {
  it("应基于配置生成授权链接并包含必要参数", () => {
    const url = generateIflowAuthUrl();
    const encodedRedirect = encodeURIComponent(
      `${config.baseUrl}/api/iflow/callback`,
    );

    expect(url).toContain("https://iflow.cn/oauth");
    expect(url).toContain(`client_id=${encodeURIComponent(config.iflow.clientId)}`);
    expect(url).toContain(`redirect=${encodedRedirect}`);
    expect(url).toContain("loginMethod=phone");
    expect(url).toContain("type=phone");
    expect(url).toContain("state=");
  });

  it("每次请求应生成不同的 state", () => {
    const url1 = new URL(generateIflowAuthUrl());
    const url2 = new URL(generateIflowAuthUrl());

    const state1 = url1.searchParams.get("state");
    const state2 = url2.searchParams.get("state");

    expect(state1).toBeDefined();
    expect(state2).toBeDefined();
    expect(state1).not.toBe(state2);
  });
});
