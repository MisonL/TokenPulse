import { describe, expect, it } from "bun:test";
import oauth from "../src/routes/oauth";
import {
  getProviderRuntimeAdapter,
  overrideProviderRuntimeAdapterForTest,
} from "../src/lib/oauth/runtime-adapters";

describe("OAuth runtime 路由诊断", () => {
  it("start 场景：能力存在但适配器缺失时应返回 409 诊断信息", async () => {
    const restore = overrideProviderRuntimeAdapterForTest("claude", null);
    try {
      const response = await oauth.fetch(
        new Request("http://localhost/claude/start", {
          method: "POST",
        }),
      );

      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.code).toBe("oauth_runtime_adapter_missing");
      expect(payload.stage).toBe("start");
      expect(payload.provider).toBe("claude");
      expect(payload.capability?.flows).toContain("auth_code");
    } finally {
      restore();
    }
  });

  it("poll 场景：device_code 已启用但轮询处理器缺失时应返回 409 诊断信息", async () => {
    const current = getProviderRuntimeAdapter("qwen");
    expect(current).toBeTruthy();

    const restore = overrideProviderRuntimeAdapterForTest("qwen", {
      ...current!,
      poll: undefined,
    });

    try {
      const response = await oauth.fetch(
        new Request("http://localhost/qwen/poll", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.code).toBe("oauth_runtime_poll_missing");
      expect(payload.stage).toBe("poll");
      expect(payload.provider).toBe("qwen");
      expect(payload.runtime?.hasPollHandler).toBe(false);
    } finally {
      restore();
    }
  });

  it("callback 场景：auth_code 已启用但回调入口缺失时应返回 409 诊断信息", async () => {
    const current = getProviderRuntimeAdapter("claude");
    expect(current).toBeTruthy();

    const restore = overrideProviderRuntimeAdapterForTest("claude", {
      ...current!,
      callbackRedirectPath: undefined,
    });

    try {
      const response = await oauth.fetch(
        new Request("http://localhost/claude/callback?code=dummy-code&state=dummy-state", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload.code).toBe("oauth_runtime_callback_missing");
      expect(payload.stage).toBe("callback");
      expect(payload.provider).toBe("claude");
      expect(payload.runtime?.hasCallbackRedirect).toBe(false);
    } finally {
      restore();
    }
  });
});
