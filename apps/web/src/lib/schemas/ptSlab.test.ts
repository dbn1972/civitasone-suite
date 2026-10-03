import { describe, it, expect } from "vitest";
import { ptSlabInput, slabOverlaps, slabGaps, validatePtSlab } from "./ptSlab";
import { INDIAN_STATE_UT_CODES } from "@/lib/india/states";

const KA = [{ state_code: "KA", slab_from_minor: 0, slab_to_minor: 2_500_000 }];

describe("ptSlabInput (GAP-PAYROLL-STATUTORY-PT-04)", () => {
  it("accepts a real state code and an inclusive range", () => {
    expect(ptSlabInput.safeParse({ stateCode: "KA", fromMinor: 100, toMinor: 100, taxMinor: 0 }).success).toBe(true);
  });

  it("rejects an unknown state code such as ZZ", () => {
    const r = ptSlabInput.safeParse({ stateCode: "ZZ", fromMinor: 0, toMinor: 10, taxMinor: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects from 100 to 50 (To below From)", () => {
    const r = ptSlabInput.safeParse({ stateCode: "KA", fromMinor: 10_000, toMinor: 5_000, taxMinor: 0 });
    expect(r.success).toBe(false);
  });

  it("lists every state / UT exactly once", () => {
    expect(new Set(INDIAN_STATE_UT_CODES).size).toBe(INDIAN_STATE_UT_CODES.length);
    expect(INDIAN_STATE_UT_CODES).toContain("KA");
    expect(INDIAN_STATE_UT_CODES).toContain("MH");
  });
});

describe("overlap / gap checks", () => {
  it("slab 0-25000 then 20000-40000 overlaps", () => {
    expect(slabOverlaps({ stateCode: "KA", fromMinor: 2_000_000, toMinor: 4_000_000 }, KA)).toBe(true);
  });

  it("treats a slab starting one paisa above the existing upper bound as adjacent, not overlapping", () => {
    expect(slabOverlaps({ stateCode: "KA", fromMinor: 2_500_001, toMinor: 4_000_000 }, KA)).toBe(false);
  });

  it("an existing slab with the same From is the upsert target, not an overlap", () => {
    expect(slabOverlaps({ stateCode: "KA", fromMinor: 0, toMinor: 1_000_000 }, KA)).toBe(false);
  });

  it("other states never overlap", () => {
    expect(slabOverlaps({ stateCode: "MH", fromMinor: 0, toMinor: 4_000_000 }, KA)).toBe(false);
  });

  it("reports a gap left between the existing slab and a new, higher one", () => {
    const gaps = slabGaps({ stateCode: "KA", fromMinor: 3_000_000, toMinor: 4_000_000 }, KA);
    expect(gaps).toEqual([{ fromMinor: 2_500_001, toMinor: 2_999_999 }]);
  });

  it("reports no gap for an adjacent slab", () => {
    expect(slabGaps({ stateCode: "KA", fromMinor: 2_500_001, toMinor: 4_000_000 }, KA)).toEqual([]);
  });
});

describe("validatePtSlab", () => {
  it("names the field to focus for each blocking problem", () => {
    expect(validatePtSlab({ stateCode: "ZZ", fromMinor: 0, toMinor: 1, taxMinor: 0 }, [])).toEqual({ issue: "state", field: "stateCode" });
    expect(validatePtSlab({ stateCode: "KA", fromMinor: 9, toMinor: 1, taxMinor: 0 }, [])).toEqual({ issue: "range", field: "slabTo" });
    expect(validatePtSlab({ stateCode: "KA", fromMinor: 2_000_000, toMinor: 3_000_000, taxMinor: 0 }, KA)).toEqual({ issue: "overlap", field: "slabTo" });
    expect(validatePtSlab({ stateCode: "KA", fromMinor: 2_500_001, toMinor: 3_000_000, taxMinor: 20_000 }, KA)).toBeNull();
  });
});
