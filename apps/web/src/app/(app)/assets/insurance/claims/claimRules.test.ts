import { describe, it, expect } from "vitest";
import { canDecideClaims, checkSettlement, isDecidable } from "./claimRules";

// GAP-ASSETS-INSURANCE-CLAIMS-03 / DETAIL-02
describe("claimRules", () => {
  it("only pending or approved claims can be decided", () => {
    expect(isDecidable("pending")).toBe(true);
    expect(isDecidable("approved")).toBe(true);
    for (const s of ["settled", "rejected", "closed", "unknown"]) expect(isDecidable(s)).toBe(false);
  });

  it("only asset_admin / super_admin may decide (asset_manager may not)", () => {
    expect(canDecideClaims(["asset_admin"])).toBe(true);
    expect(canDecideClaims(["super_admin"])).toBe(true);
    expect(canDecideClaims(["asset_manager", "audit_officer"])).toBe(false);
    expect(canDecideClaims([])).toBe(false);
  });

  it("converts rupees to exact paise and caps at the claim amount", () => {
    expect(checkSettlement("7500.50", "800000")).toEqual({ ok: true, minor: "750050" });
    expect(checkSettlement("8000", "800000")).toEqual({ ok: true, minor: "800000" });
    const over = checkSettlement("8000.01", "800000");
    expect(over.ok).toBe(false);
  });

  it("rejects empty, zero, sub-paise and oversized input", () => {
    for (const bad of ["", "0", "abc", "1.005", "-5"]) expect(checkSettlement(bad, "800000").ok).toBe(false);
    expect(checkSettlement("99999999999999999", "99999999999999999999999").ok).toBe(false);
  });
});
