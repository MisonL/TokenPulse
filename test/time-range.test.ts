import { describe, expect, it } from "bun:test";
import {
  normalizeIsoDateTime,
  parseIsoDateTime,
  validateTimeRange,
} from "../src/lib/time-range";

describe("time-range 工具", () => {
  it("parseIsoDateTime 应正确解析带时区的 ISO 时间", () => {
    const value = "2026-03-04T10:00:00+08:00";
    const parsed = parseIsoDateTime(value);
    expect(parsed).not.toBeNull();
    expect(new Date(parsed!).toISOString()).toBe("2026-03-04T02:00:00.000Z");
  });

  it("normalizeIsoDateTime 应将输入归一化为 UTC ISO 字符串", () => {
    const value = "2026-03-04T10:00:00+08:00";
    expect(normalizeIsoDateTime(value)).toBe("2026-03-04T02:00:00.000Z");
  });

  it("validateTimeRange 应拒绝 from 晚于 to", () => {
    const result = validateTimeRange({
      from: "2026-03-05T00:00:00.000Z",
      to: "2026-03-04T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("from 不能晚于 to");
    }
  });

  it("validateTimeRange 应接受合法范围", () => {
    const result = validateTimeRange({
      from: "2026-03-04T00:00:00.000Z",
      to: "2026-03-05T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fromMs).not.toBeNull();
      expect(result.toMs).not.toBeNull();
      expect(result.fromMs! <= result.toMs!).toBe(true);
    }
  });
});
