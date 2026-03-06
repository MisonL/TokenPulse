import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelsIntegrationGuide } from "./ModelsIntegrationGuide";
import { t } from "../../lib/i18n";

describe("ModelsIntegrationGuide smoke", () => {
  it("应渲染工具集成标题与关键接入示例，且不回退为原始 i18n key", () => {
    expect(t("models.tool_integration")).toBe("工具集成");

    const gatewayV1BaseUrl = "https://gateway.tokenpulse.test/v1";
    const html = renderToStaticMarkup(
      createElement(ModelsIntegrationGuide, {
        copiedKey: null,
        gatewayV1BaseUrl,
        onCopy: () => {},
      }),
    );

    expect(html).toContain("工具集成");
    expect(html).not.toContain("models.tool_integration");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Codex / Cursor / 常用 IDE");
    expect(html).toContain("Authorization: Bearer YOUR_API_SECRET");
    expect(html).toContain(gatewayV1BaseUrl);
    expect(html).toContain("TypeScript");
    expect(html).toContain("Go");
  });
});
