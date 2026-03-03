import { describe, expect, it } from "bun:test";
import credentials from "../src/routes/credentials";

describe("凭据状态路由", () => {
  it("应返回能力图谱驱动的状态结构", async () => {
    const response = await credentials.fetch(new Request("http://localhost/status"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(typeof payload.claude).toBe("boolean");
    expect(typeof payload.gemini).toBe("boolean");
    expect(typeof payload.counts).toBe("object");
  });
});
