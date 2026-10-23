import { describe, it, expect } from "vitest";
import { ucRegisterHref, ucMatchesScheme, resolveSchemeRef } from "./ucScheme";

describe("ucScheme (GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05)", () => {
  it("links to the UC register filtered by the encoded scheme code", () => {
    expect(ucRegisterHref("PMAY-G")).toBe("/finance/expenditure/utilization-certificates?scheme=PMAY-G");
    expect(ucRegisterHref("Samagra Shiksha & Co")).toBe("/finance/expenditure/utilization-certificates?scheme=Samagra%20Shiksha%20%26%20Co");
  });

  it("matches older, name-only certificates by grant reference or grantee, case-insensitively", () => {
    expect(ucMatchesScheme({ grantRef: "Samagra Shiksha", grantee: "Dept" }, "samagra shiksha")).toBe(true);
    expect(ucMatchesScheme({ grantRef: null, grantee: " Samagra Shiksha " }, "Samagra Shiksha")).toBe(true);
    expect(ucMatchesScheme({ grantRef: "Other", grantee: "Dept" }, "Samagra Shiksha")).toBe(false);
  });

  it("applies no filter when the scheme is absent or blank", () => {
    expect(ucMatchesScheme({ grantRef: "x" }, undefined)).toBe(true);
    expect(ucMatchesScheme({ grantRef: "x" }, "  ")).toBe(true);
    expect(ucMatchesScheme({ grantRef: "x" }, { code: " " })).toBe(true);
  });

  // The picked scheme is stored as a code, so a typed grant reference no longer hides the certificate from its scheme.
  it("matches a certificate that stores a scheme code by that code alone, even with a different grant reference and grantee", () => {
    const uc = { schemeCode: "PMAY", grantRef: "SAN/2026/77", grantee: "Gram Panchayat Rampur" };
    expect(ucMatchesScheme(uc, { code: "pmay", name: "Housing Scheme" })).toBe(true);
    expect(ucMatchesScheme(uc, "PMAY")).toBe(true);
  });

  it("does not let a stored scheme code leak into another scheme through a name that happens to match", () => {
    // Same grant reference as scheme B's name, but the certificate is recorded against scheme A.
    const uc = { schemeCode: "A", grantRef: "Rural Jobs", grantee: "Rural Jobs" };
    expect(ucMatchesScheme(uc, { code: "B", name: "Rural Jobs" })).toBe(false);
    expect(ucMatchesScheme(uc, { code: "A", name: "Housing Scheme" })).toBe(true);
  });

  it("matches an older certificate on the scheme name or code when given a resolved scheme", () => {
    const legacy = { grantRef: "Housing Scheme", grantee: "Dept" };
    expect(ucMatchesScheme(legacy, { code: "PMAY", name: "Housing Scheme" })).toBe(true);
    expect(ucMatchesScheme({ grantRef: "PMAY", grantee: "Dept" }, { code: "PMAY", name: "Housing Scheme" })).toBe(true);
    expect(ucMatchesScheme(legacy, { code: "MGN", name: "Rural Jobs" })).toBe(false);
  });
});

describe("resolveSchemeRef", () => {
  const schemes = [
    { code: "PMAY", name: "Housing Scheme" },
    { code: "MGN", name: "Rural Jobs" },
    { code: "RJ2", name: "Rural Jobs" },
  ];
  it("resolves a code (case-insensitive) to the scheme's code and name", () => {
    expect(resolveSchemeRef("pmay", schemes)).toEqual({ code: "PMAY", name: "Housing Scheme" });
  });
  it("resolves an older name-based link when the name picks out exactly one scheme", () => {
    expect(resolveSchemeRef("Housing Scheme", schemes)).toEqual({ code: "PMAY", name: "Housing Scheme" });
  });
  it("does not guess between schemes that share a name", () => {
    expect(resolveSchemeRef("Rural Jobs", schemes)).toEqual({ code: "Rural Jobs", name: "Rural Jobs" });
  });
  it("uses the value as given when the schemes could not be loaded or it matches none", () => {
    expect(resolveSchemeRef("PMAY", null)).toEqual({ code: "PMAY", name: "PMAY" });
    expect(resolveSchemeRef("Unknown", schemes)).toEqual({ code: "Unknown", name: "Unknown" });
  });
});
