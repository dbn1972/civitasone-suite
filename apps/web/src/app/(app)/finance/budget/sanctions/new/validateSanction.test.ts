import { describe, it, expect } from "vitest";
import { validateSanction } from "./validateSanction";

const ok = { sanctionNo: "SAN/2026/014", purpose: "Repair of district road", headId: "h1", amount: "1250.50" };

describe("validateSanction", () => {
  it("returns exact paise when every field is valid", () => {
    expect(validateSanction(ok)).toEqual({ errors: {}, amountMinor: "125050" });
  });
  it("flags each invalid field and withholds amountMinor", () => {
    const r = validateSanction({ sanctionNo: " ", purpose: "ab", headId: "", amount: "1.005" });
    expect(Object.keys(r.errors).sort()).toEqual(["amount", "headId", "purpose", "sanctionNo"]);
    expect(r.amountMinor).toBeNull();
  });
  it("withholds amountMinor when only a non-amount field is invalid", () => {
    expect(validateSanction({ ...ok, headId: "" }).amountMinor).toBeNull();
  });
});
