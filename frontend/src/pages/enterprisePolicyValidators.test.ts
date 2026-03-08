import { describe, expect, it } from "bun:test";
import {
  normalizePolicyScopeInput,
  parseOptionalNonNegativeInteger,
} from "./enterprisePolicyValidators";

describe("enterprisePolicyValidators", () => {
  it("应解析可选非负整数输入", () => {
    expect(parseOptionalNonNegativeInteger("   ", "RPM")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseOptionalNonNegativeInteger("0", "RPM")).toEqual({
      ok: true,
      value: 0,
    });
    expect(parseOptionalNonNegativeInteger("42", "TPM")).toEqual({
      ok: true,
      value: 42,
    });
  });

  it("应拒绝非法或过大的整数输入", () => {
    expect(parseOptionalNonNegativeInteger("-1", "RPM")).toEqual({
      ok: false,
      error: "RPM 必须是非负整数",
    });
    expect(parseOptionalNonNegativeInteger("1.5", "TPM")).toEqual({
      ok: false,
      error: "TPM 必须是非负整数",
    });
    expect(parseOptionalNonNegativeInteger("9007199254740992", "TPD")).toEqual({
      ok: false,
      error: "TPD 数值过大",
    });
  });

  it("应规范化 global 作用域输入", () => {
    expect(normalizePolicyScopeInput("global", "   ")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(normalizePolicyScopeInput("global", "tenant-a")).toEqual({
      ok: false,
      error: "scopeType=global 时 scopeValue 必须留空",
    });
  });

  it("应规范化非 global 作用域输入并保留既有大小写语义", () => {
    expect(normalizePolicyScopeInput("tenant", "   ")).toEqual({
      ok: false,
      error: "scopeType=tenant 时必须填写 scopeValue",
    });
    expect(normalizePolicyScopeInput("role", " Admin ")).toEqual({
      ok: true,
      value: "admin",
    });
    expect(normalizePolicyScopeInput("user", " User-001 ")).toEqual({
      ok: true,
      value: "User-001",
    });
  });
});
