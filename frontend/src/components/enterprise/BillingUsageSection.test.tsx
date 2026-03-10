import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BillingUsageSection } from "./BillingUsageSection";

const noop = () => {};

describe("BillingUsageSection", () => {
  it("应在策略列渲染 scopeType/scopeValue/provider/modelPattern（用于排查）", () => {
    const html = renderToStaticMarkup(
      createElement(BillingUsageSection, {
        quotas: null,
        rows: [
          {
            id: 1,
            policyId: "policy-1",
            policyName: "Policy One",
            scopeType: "tenant",
            scopeValue: "tenant-abc",
            provider: "prov-xyz",
            modelPattern: "model-*",
            bucketType: "day",
            windowStart: 1700000000000,
            requestCount: 3,
            tokenCount: 10,
            estimatedTokenCount: 11,
            actualTokenCount: 9,
            reconciledDelta: -2,
          },
        ],
        page: 1,
        total: 1,
        totalPages: 1,
        policyIdFilter: "",
        bucketTypeFilter: "",
        providerFilter: "",
        modelFilter: "",
        tenantFilter: "",
        projectIdFilter: "",
        fromFilter: "",
        toFilter: "",
        setPolicyIdFilter: noop,
        setBucketTypeFilter: noop,
        setProviderFilter: noop,
        setModelFilter: noop,
        setTenantFilter: noop,
        setProjectIdFilter: noop,
        setFromFilter: noop,
        setToFilter: noop,
        formatWindowStart: (value: number) => String(value),
        onApplyFilters: noop,
        onExport: noop,
        onRetry: noop,
        onJumpToAuditByPolicy: noop,
        onPageChange: noop,
      }),
    );

    expect(html).toContain("scopeType=tenant");
    expect(html).toContain("scopeValue=tenant-abc");
    expect(html).toContain("provider=prov-xyz");
    expect(html).toContain("modelPattern=model-*");
  });
});

