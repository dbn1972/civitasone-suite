import { describe, it, expect } from "vitest";
import { misExportHref } from "./misExport";

describe("misExportHref (GAP-FINANCE-DASHBOARD-06)", () => {
  it("points at the finance-service MIS export through the BFF proxy, scoped to the FY", () => {
    expect(misExportHref("2026-27")).toBe("/api/proxy/v1/finance/dashboard/mis-export?fy=2026-27");
  });
  it("encodes the fiscal year", () => {
    expect(misExportHref("a&b")).toBe("/api/proxy/v1/finance/dashboard/mis-export?fy=a%26b");
  });
});
