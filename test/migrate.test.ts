import { describe, expect, it } from "bun:test";
import { isRetryableMigrationError } from "../src/lib/migrate";

describe("migration retry classification", () => {
  it("应识别数据库启动期和连接抖动为可重试错误", () => {
    expect(
      isRetryableMigrationError(
        new Error("FATAL: the database system is starting up"),
      ),
    ).toBe(true);
    expect(
      isRetryableMigrationError(
        new Error("connection terminated unexpectedly"),
      ),
    ).toBe(true);
    expect(isRetryableMigrationError(new Error("Broken pipe"))).toBe(true);
  });

  it("不应将普通 schema/sql 错误误判为可重试", () => {
    expect(
      isRetryableMigrationError(
        new Error('relation "quota_policies" does not exist'),
      ),
    ).toBe(false);
    expect(
      isRetryableMigrationError(new Error("syntax error at or near \"foo\"")),
    ).toBe(false);
  });
});
