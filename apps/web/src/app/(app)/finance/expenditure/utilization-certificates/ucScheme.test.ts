import { describe, it, expect } from "vitest";
import { ucRegisterHref, ucMatchesScheme } from "./ucScheme";

describe("ucScheme (GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05)", () => {
  it("links to the UC register filtered by the encoded scheme name", () => {
    expect(ucRegisterHref("Samagra Shiksha & Co")).toBe("/finance/expenditure/utilization-certificates?scheme=Samagra%20Shiksha%20%26%20Co");
  });
  it("matches a UC by grant reference or grantee, case-insensitively", () => {
    expect(ucMatchesScheme({ grantRef: "Samagra Shiksha", grantee: "Dept" }, "samagra shiksha")).toBe(true);
    expect(ucMatchesScheme({ grantRef: null, grantee: " Samagra Shiksha " }, "Samagra Shiksha")).toBe(true);
    expect(ucMatchesScheme({ grantRef: "Other", grantee: "Dept" }, "Samagra Shiksha")).toBe(false);
  });
  it("applies no filter when the scheme is absent or blank", () => {
    expect(ucMatchesScheme({ grantRef: "x" }, undefined)).toBe(true);
    expect(ucMatchesScheme({ grantRef: "x" }, "  ")).toBe(true);
  });
});
