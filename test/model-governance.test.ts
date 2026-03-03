import { describe, expect, it } from "bun:test";
import {
  isModelExcludedByRules,
  parseAliasRules,
  parseExcludedRules,
  resolveModelAliasByRules,
} from "../src/lib/model-governance";

describe("模型治理规则", () => {
  it("应解析平铺与按提供商分组的别名规则", () => {
    const rules = parseAliasRules({
      "gpt-4o-mini": "codex:gpt-4o-mini",
      claude: {
        sonnet: "claude-3-7-sonnet-20250219",
      },
    });

    expect(rules["gpt-4o-mini"]).toBe("codex:gpt-4o-mini");
    expect(rules["claude:sonnet"]).toBe("claude:claude-3-7-sonnet-20250219");
  });

  it("应解析数组与对象格式的排除规则", () => {
    const excluded = parseExcludedRules({
      "codex:gpt-4.1": true,
      gemini: ["gemini-2.5-pro"],
      "antigravity:legacy": "1",
    });

    expect(excluded.has("codex:gpt-4.1")).toBe(true);
    expect(excluded.has("gemini:gemini-2.5-pro")).toBe(true);
    expect(excluded.has("antigravity:legacy")).toBe(true);
  });

  it("应按别名映射解析请求模型", () => {
    const aliasMap = {
      "codex-fast": "codex:gpt-4.1-mini",
    };
    const resolved = resolveModelAliasByRules("codex-fast", aliasMap);
    expect(resolved).toBe("codex:gpt-4.1-mini");
  });

  it("应同时匹配带命名空间与裸模型名的排除规则", () => {
    const excluded = new Set<string>(["claude:claude-3-7-sonnet-20250219"]);
    expect(
      isModelExcludedByRules(
        "claude-3-7-sonnet-20250219",
        excluded,
        "claude",
      ),
    ).toBe(true);
    expect(
      isModelExcludedByRules(
        "claude:claude-3-7-sonnet-20250219",
        excluded,
      ),
    ).toBe(true);
  });
});
