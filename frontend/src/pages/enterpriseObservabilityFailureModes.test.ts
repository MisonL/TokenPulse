import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const enterprisePageSource = readFileSync(
  join(import.meta.dir, "EnterprisePage.tsx"),
  "utf8",
);

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

describe("EnterprisePage 可观测性局部失败语义", () => {
  it("应将 section error 限定到当前 section，而不是清空或覆盖其它区块", () => {
    const runSectionLoadBlock = sliceBetween(
      enterprisePageSource,
      "const runSectionLoad = async <T,>(",
      "const collectRejectedMessages = (",
    );
    const oauthAlertSectionErrorBlock = sliceBetween(
      enterprisePageSource,
      "const oauthAlertSectionError = [",
      "return (",
    );

    expect(runSectionLoadBlock).toContain("clearSectionError(section);");
    expect(runSectionLoadBlock).toContain("setSectionError(section, getErrorMessage(error, fallback));");
    expect(runSectionLoadBlock).not.toContain("setSectionErrors(EMPTY_ENTERPRISE_SECTION_ERRORS)");
    expect(oauthAlertSectionErrorBlock).toContain("sectionErrors.oauthAlertConfig");
    expect(oauthAlertSectionErrorBlock).toContain("sectionErrors.oauthAlertIncidents");
    expect(oauthAlertSectionErrorBlock).toContain("sectionErrors.oauthAlertDeliveries");
    expect(oauthAlertSectionErrorBlock).toContain("sectionErrors.oauthAlertRules");
    expect(oauthAlertSectionErrorBlock).toContain("sectionErrors.alertmanager");
  });

  it("OAuth Alert 与 Alertmanager 的 404/405 分支应切换 apiAvailable 降级，而不是伪装成成功空数据", () => {
    const oauthConfigBlock = sliceBetween(
      enterprisePageSource,
      "const loadOAuthAlertCenterConfig = async () =>",
      "const loadOAuthAlertIncidents = async (page = 1) =>",
    );
    const oauthIncidentsBlock = sliceBetween(
      enterprisePageSource,
      "const loadOAuthAlertIncidents = async (page = 1) =>",
      "const loadOAuthAlertDeliveries = async (page = 1) =>",
    );
    const oauthDeliveriesBlock = sliceBetween(
      enterprisePageSource,
      "const loadOAuthAlertDeliveries = async (page = 1) =>",
      "const loadAlertmanagerConfig = async () =>",
    );
    const alertmanagerConfigBlock = sliceBetween(
      enterprisePageSource,
      "const loadAlertmanagerConfig = async () =>",
      "const loadAlertmanagerSyncHistory = async (page = 1) =>",
    );
    const alertmanagerHistoryBlock = sliceBetween(
      enterprisePageSource,
      "const loadAlertmanagerSyncHistory = async (page = 1) =>",
      "const loadOAuthAlertRuleActiveVersion = async () =>",
    );

    expect(oauthConfigBlock).toContain("if (result.status === 404 || result.status === 405)");
    expect(oauthConfigBlock).toContain("setOAuthAlertCenterApiAvailable(false);");
    expect(oauthIncidentsBlock).toContain("if (result.status === 404 || result.status === 405)");
    expect(oauthIncidentsBlock).toContain("setOAuthAlertCenterApiAvailable(false);");
    expect(oauthDeliveriesBlock).toContain("if (result.status === 404 || result.status === 405)");
    expect(oauthDeliveriesBlock).toContain("setOAuthAlertCenterApiAvailable(false);");
    expect(alertmanagerConfigBlock).toContain("if (result.status === 404 || result.status === 405)");
    expect(alertmanagerConfigBlock).toContain("setAlertmanagerApiAvailable(false);");
    expect(alertmanagerHistoryBlock).toContain("if (result.status === 404 || result.status === 405)");
    expect(alertmanagerHistoryBlock).toContain("setAlertmanagerApiAvailable(false);");
  });

  it("Alertmanager 同步历史在通用失败分支不应误清空最近成功结果", () => {
    const alertmanagerHistoryBlock = sliceBetween(
      enterprisePageSource,
      "const loadAlertmanagerSyncHistory = async (page = 1) =>",
      "const loadOAuthAlertRuleActiveVersion = async () =>",
    );
    const invalidResponseBranch = sliceBetween(
      alertmanagerHistoryBlock,
      "if (!result.ok) {",
      "const normalized = normalizeAlertmanagerHistoryQueryResult(result.payload);",
    );
    const notFoundBranch = sliceBetween(
      alertmanagerHistoryBlock,
      "if (result.status === 404 || result.status === 405) {",
      "if (!result.ok) {",
    );

    expect(notFoundBranch).toContain("setAlertmanagerSyncHistory([]);");
    expect(notFoundBranch).toContain("setAlertmanagerLatestSync(null);");
    expect(notFoundBranch).toContain('setAlertmanagerHistoryPageInput("1");');
    expect(invalidResponseBranch).toContain('throw new Error(result.error || "加载 Alertmanager 同步历史失败");');
    expect(invalidResponseBranch).not.toContain("setAlertmanagerSyncHistory([]);");
    expect(invalidResponseBranch).not.toContain("setAlertmanagerLatestSync(null);");
    expect(invalidResponseBranch).not.toContain("setAlertmanagerHistoryPage(1);");
  });
});
