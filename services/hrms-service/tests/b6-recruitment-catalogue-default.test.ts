/** B6: the recruitment default is the catalogue recruitmentPolicy; the per-tenant override still wins. Pure. */
import { describe, expect, it } from "vitest";
import { editionFromTenant, requisitionRequired } from "../src/modules/recruitment/edition-policy.js";

describe("B6 recruitment default from the catalogue", () => {
  it("govt is requisition_first; section8 / commercial editions are direct", () => {
    for (const v of ["govt", "govt_dept"]) expect(requisitionRequired({ edition: editionFromTenant(v)!, requireRequisition: null })).toBe(true);
    for (const v of ["psu", "section8", "small_office", "private", "ngo", "cooperative"]) {
      expect(requisitionRequired({ edition: editionFromTenant(v)!, requireRequisition: null }), v).toBe(false);
    }
  });
  it("section8 lands inside the typed edition set", () => {
    expect(editionFromTenant("section8")).toBe("small_office");
    expect(editionFromTenant("psu")).toBe("psu");
    expect(editionFromTenant("nonsense")).toBeNull();
  });
  it("an explicit per-tenant requireRequisition override beats the catalogue default", () => {
    expect(requisitionRequired({ edition: "govt", requireRequisition: false })).toBe(false);
    expect(requisitionRequired({ edition: "small_office", requireRequisition: true })).toBe(true);
    expect(requisitionRequired({ edition: "psu", requireRequisition: true })).toBe(true);
  });
  it("no stored policy == direct (unchanged)", () => {
    expect(requisitionRequired(null)).toBe(false);
    expect(requisitionRequired(undefined)).toBe(false);
  });
});
