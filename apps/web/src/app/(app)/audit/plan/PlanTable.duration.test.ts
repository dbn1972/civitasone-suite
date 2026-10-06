import { describe, it, expect } from "vitest";
import { durationDays } from "./PlanTable";

describe("durationDays (GAP-AUDIT-PLAN-04)", () => {
  it("counts an inclusive span in whole days", () => {
    expect(durationDays("2026-10-01", "2026-10-12")).toBe(12);
  });

  it("is 1 day for a same-day engagement", () => {
    expect(durationDays("2026-10-01", "2026-10-01")).toBe(1);
  });

  it("returns null for a reversed or unparseable range so the cell falls back to the plain range", () => {
    expect(durationDays("2026-10-12", "2026-10-01")).toBeNull();
    expect(durationDays("", "2026-10-01")).toBeNull();
  });
});
