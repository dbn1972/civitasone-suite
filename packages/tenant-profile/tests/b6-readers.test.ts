import { describe, expect, it } from "vitest";
import { defaultPensionSchemeFor, manifestKeyFor, recruitmentPolicyForEdition, suggestedDeductorCategory } from "../src/index.js";

describe("B6 catalogue readers", () => {
  it("recruitment default: govt requisition_first, every other known edition direct, unknown null", () => {
    for (const e of ["govt", "govt_dept", " GOVT "]) expect(recruitmentPolicyForEdition(e)).toBe("requisition_first");
    for (const e of ["psu", "private", "ngo", "section8", "cooperative", "small_office"]) expect(recruitmentPolicyForEdition(e)).toBe("direct");
    for (const e of ["", "   ", "government", "govt2", "govt_small_office", undefined, null]) expect(recruitmentPolicyForEdition(e)).toBeNull();
  });
  it("manifestKey: small_office is msme, section8/psu/govt are default, stored profile wins, unknown is default", () => {
    expect(manifestKeyFor(null, "small_office")).toBe("msme");
    expect(manifestKeyFor("small_office", "small_office")).toBe("msme");
    for (const e of ["govt", "govt_dept", "psu", "section8", "ngo"]) expect(manifestKeyFor(null, e)).toBe("default");
    expect(manifestKeyFor("section8", "section8")).toBe("default");
    expect(manifestKeyFor(null, "nonsense")).toBe("default");
    expect(manifestKeyFor(undefined, undefined)).toBe("default");
  });
  it("pension default from the statutory pack: govt NPS, others EPF", () => {
    expect(defaultPensionSchemeFor("govt_in")).toBe("NPS");
    expect(defaultPensionSchemeFor("commercial_in")).toBe("EPF");
    expect(defaultPensionSchemeFor("nonprofit_in")).toBe("EPF");
  });
  it("deductor category is a govt-only suggestion", () => {
    expect(suggestedDeductorCategory("govt_dept")).toBe("government");
    expect(suggestedDeductorCategory("govt_small_office")).toBe("government");
    expect(suggestedDeductorCategory("section8")).toBeNull();
    expect(suggestedDeductorCategory(undefined)).toBeNull();
  });
});
