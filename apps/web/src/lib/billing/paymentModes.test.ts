import { describe, it, expect } from "vitest";
import { paymentModesForEdition } from "./paymentModes";

describe("paymentModesForEdition (owner decision #26)", () => {
  it.each(["govt", "govt_dept"])("government edition %s: PO/GeM, treasury e-challan and online", (e) => {
    expect(paymentModesForEdition(e)).toEqual(["po_gem", "treasury_challan", "online"]);
  });
  it.each(["small_office", "psu", "private", "ngo", "section8", "cooperative", "", undefined, null])("edition %s: online only", (e) => {
    expect(paymentModesForEdition(e as string | null | undefined)).toEqual(["online"]);
  });
});
