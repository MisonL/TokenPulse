import { describe, expect, it } from "bun:test";
import providers from "../src/routes/providers";

describe("Providers 路由", () => {
  it("应返回能力图谱驱动的渠道列表字段", async () => {
    const response = await providers.fetch(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.count).toBe(payload.data.length);

    const claude = payload.data.find((item: any) => item.id === "claude");
    expect(claude).toBeTruthy();
    expect(Array.isArray(claude.flows)).toBe(true);
    expect(typeof claude.capabilities?.supportsChat).toBe("boolean");
    expect(typeof claude.capabilities?.supportsModelList).toBe("boolean");
  });
});
