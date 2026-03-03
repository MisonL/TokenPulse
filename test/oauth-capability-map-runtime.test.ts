import { describe, expect, it } from "bun:test";
import oauth from "../src/routes/oauth";

describe("OAuth 能力图谱运行时", () => {
  it("GET /providers 应返回带 flows 与能力字段的 provider 列表", async () => {
    const response = await oauth.fetch(new Request("http://localhost/providers"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    const claude = (payload.data || []).find((item: any) => item.id === "claude");
    expect(claude).toBeTruthy();
    expect(Array.isArray(claude.flows)).toBe(true);
    expect(claude.flows).toContain("auth_code");
    expect(typeof claude.supportsModelList).toBe("boolean");
    expect(typeof claude.supportsManualCallback).toBe("boolean");
  });

  it("未知 provider 调用 start 应返回 400", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/not-exists-provider/start", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("不支持的 provider");
  });

  it("旧的 /kiro/register 路由应不可用", async () => {
    const response = await oauth.fetch(
      new Request("http://localhost/kiro/register", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });
});
