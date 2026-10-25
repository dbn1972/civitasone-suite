/**
 * CLOS3-S1-11 -- pure planner for the effective-dated rate-slab replace.
 * Effective windows are half-open [from, to): closing at the new effectiveFrom
 * leaves no gap and no overlap.
 */
import { describe, it, expect } from "vitest";
import { planSlabReplace, DomainError, type ExistingSlab } from "../src/modules/rate-engine/domain.js";

const live = (over: Partial<ExistingSlab> & { id: string }): ExistingSlab => ({
  slabType: "flat", bandFrom: null, bandTo: null, rateValue: 100n,
  effectiveFrom: "2026-04-01", effectiveTo: null, isActive: true, ...over,
});

describe("planSlabReplace", () => {
  it("identical live set is a no-op (the autosave re-send must not duplicate)", () => {
    const plan = planSlabReplace([live({ id: "a" })], [{ slabType: "flat", rateValue: "100" }], "2026-10-25");
    expect(plan).toEqual({ noop: true, retire: [], insert: [] });
  });

  it("changed rate end-dates the old slab at effectiveFrom and inserts the new one", () => {
    const plan = planSlabReplace([live({ id: "a" })], [{ slabType: "flat", rateValue: "150" }], "2026-10-25");
    expect(plan.noop).toBe(false);
    expect(plan.retire).toEqual([{ id: "a", mode: "close" }]);
    expect(plan.insert).toHaveLength(1);
  });

  it("a slab that starts on/after effectiveFrom is deactivated, not end-dated before its start", () => {
    const plan = planSlabReplace([live({ id: "a", effectiveFrom: "2026-10-25" })], [{ slabType: "flat", rateValue: "150" }], "2026-10-25");
    expect(plan.retire).toEqual([{ id: "a", mode: "deactivate" }]);
  });

  it("already retired / inactive slabs are left alone", () => {
    const old = live({ id: "old", effectiveTo: "2026-04-01" });
    const dead = live({ id: "dead", isActive: false });
    const plan = planSlabReplace([old, dead], [{ slabType: "flat", rateValue: "100" }], "2026-10-25");
    expect(plan.retire).toEqual([]);
    expect(plan.insert).toHaveLength(1);
  });

  it("rejects a requested set that overlaps itself before any write (SLAB_OVERLAP)", () => {
    expect(() => planSlabReplace([], [
      { slabType: "band", bandFrom: "0", bandTo: "1000", rateValue: "10" },
      { slabType: "band", bandFrom: "500", bandTo: "2000", rateValue: "20" },
    ], "2026-10-25")).toThrow(DomainError);
  });

  it("accepts adjacent bands and compares bigint values exactly (no float rounding)", () => {
    const plan = planSlabReplace([], [
      { slabType: "band", bandFrom: "0", bandTo: "9007199254740993", rateValue: "10" },
      { slabType: "band", bandFrom: "9007199254740993", rateValue: "20" },
    ], "2026-10-25");
    expect(plan.insert).toHaveLength(2);
    const same = planSlabReplace(
      [live({ id: "a", slabType: "flat", rateValue: 9007199254740993n })],
      [{ slabType: "flat", rateValue: "9007199254740993" }],
      "2026-10-25",
    );
    expect(same.noop).toBe(true);
  });
});
