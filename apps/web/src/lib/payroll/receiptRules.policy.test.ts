import { describe, it, expect } from "vitest";
import { receiptNeed, receiptPolicyFromApi, receiptRequired } from "./receiptRules";

describe("receipt policy on the web (mirrors payroll-service)", () => {
  it("default parity: no policy => medical / LTA / travel need a receipt, others do not, at any amount", () => {
    for (const c of ["medical", "lta", "travel"]) {
      expect(receiptNeed(null, c, 1).required).toBe(true);
      expect(receiptNeed(null, c, 0).required).toBe(true);
      expect(receiptRequired(c)).toBe(true);
    }
    for (const c of ["food", "telephone", "internet", "fuel", "other"]) {
      expect(receiptNeed(null, c, 99_999_999).required).toBe(false);
      expect(receiptRequired(c)).toBe(false);
    }
    expect(receiptNeed(null, "medical", 100).selfDeclarationAllowed).toBe(false);
  });

  it("above_amount edge and self-declaration limit", () => {
    const p = { categories: { fuel: { mode: "above_amount" as const, thresholdMinor: 100_000, selfDeclarationUpToMinor: 300_000 } } };
    expect(receiptNeed(p, "fuel", 100_000).required).toBe(false);
    expect(receiptNeed(p, "fuel", 100_001)).toMatchObject({ required: true, selfDeclarationAllowed: true });
    expect(receiptNeed(p, "fuel", 300_000).selfDeclarationAllowed).toBe(true);
    expect(receiptNeed(p, "fuel", 300_001)).toMatchObject({ required: true, selfDeclarationAllowed: false });
  });

  it("parses the API payload and rejects anything else (falls back to default)", () => {
    const ok = receiptPolicyFromApi({ isDefault: false, categories: { food: { mode: "always", thresholdMinor: null, selfDeclarationUpToMinor: 50_000 } } });
    expect(ok?.categories.food).toMatchObject({ mode: "always", selfDeclarationUpToMinor: 50_000 });
    expect(receiptPolicyFromApi(null)).toBeNull();
    expect(receiptPolicyFromApi([{ id: "r1" }])).toBeNull();
    expect(receiptPolicyFromApi({ categories: { food: { mode: "bogus" } } })).toBeNull();
  });
});
