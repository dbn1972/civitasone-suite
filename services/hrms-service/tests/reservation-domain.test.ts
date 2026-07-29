import { describe, it, expect } from "vitest";
import {
  normalizeCategory, validateRoster, validateLocationRosters, unmappedCategories,
  allocateShortlist, allocateByLocation, type Candidate,
} from "../src/modules/recruitment/reservation-domain.js";

const C = (applicationId: string, category: string, score: number, location?: string): Candidate => ({ applicationId, category, score, location });

describe("normalizeCategory (fail closed)", () => {
  it("maps known general/reserved variants incl. OBC synonyms", () => {
    expect(normalizeCategory("GEN")).toBe("UR");
    expect(normalizeCategory("general")).toBe("UR");
    expect(normalizeCategory("obc")).toBe("OBC");
    expect(normalizeCategory("OBC-NCL")).toBe("OBC");
    expect(normalizeCategory("SEBC")).toBe("OBC");
  });
  it("returns null for unrecognised or blank categories (never silently UR)", () => {
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory("weird")).toBeNull();
    expect(normalizeCategory("OBC-CL")).toBeNull(); // creamy layer is NOT reservation-eligible here
  });
});

describe("unmappedCategories", () => {
  it("lists candidates whose category does not map", () => {
    expect(unmappedCategories([C("a", "OBC", 1), C("b", "XYZ", 1)])).toEqual([{ applicationId: "b", category: "XYZ" }]);
  });
});

describe("validateRoster", () => {
  it("requires category vacancies to sum to the total", () => {
    expect(validateRoster({ UR: 2, SC: 1, OBC: 1 }, 4)).toEqual([]);
    expect(validateRoster({ UR: 2, SC: 1 }, 4).length).toBeGreaterThan(0);
    expect(validateRoster({ UR: -1, SC: 5 }, 4).length).toBeGreaterThan(0);
  });
});

describe("allocateShortlist — meritorious reserved rule", () => {
  it("counts a top-scoring reserved candidate against UR, freeing their reserved slot", () => {
    const candidates = [
      C("A", "OBC", 90), // top scorer, reserved -> should go against UR (meritorious)
      C("B", "GEN", 85),
      C("C", "SC", 80),
      C("D", "OBC", 75),
      C("E", "GEN", 70),
      C("F", "SC", 65),
    ];
    const r = allocateShortlist(candidates, { UR: 2, SC: 1, OBC: 1 });
    const byApp = Object.fromEntries(r.selected.map((s) => [s.applicationId, s.allocatedAgainst]));
    expect(byApp).toEqual({ A: "UR", B: "UR", C: "SC", D: "OBC" }); // A(OBC) counted vs UR; D fills OBC
    expect(r.filled).toMatchObject({ UR: 2, SC: 1, OBC: 1 });
    // waitlist: E (UR) and F (SC), ranked within their own category
    expect(r.waitlist).toEqual([
      { applicationId: "E", category: "UR", rank: 1 },
      { applicationId: "F", category: "SC", rank: 1 },
    ]);
  });

  it("a GEN candidate can only occupy UR, never a reserved slot", () => {
    const r = allocateShortlist([C("A", "GEN", 90), C("B", "SC", 50)], { UR: 0, SC: 1 });
    // UR has 0 slots; GEN candidate A cannot take the SC slot -> A waitlisted, B selected
    expect(r.selected.map((s) => s.applicationId)).toEqual(["B"]);
    expect(r.selected[0]).toMatchObject({ allocatedAgainst: "SC" });
    expect(r.waitlist.find((w) => w.applicationId === "A")).toMatchObject({ category: "UR" });
  });

  it("breaks score ties deterministically by applicationId", () => {
    const r = allocateShortlist([C("b", "GEN", 80), C("a", "GEN", 80)], { UR: 1 });
    expect(r.selected[0]!.applicationId).toBe("a"); // tie -> lower applicationId first
  });

  it("partially fills when there are fewer candidates than slots", () => {
    const r = allocateShortlist([C("A", "SC", 70)], { UR: 2, SC: 2 });
    expect(r.filled).toMatchObject({ UR: 1, SC: 0 }); // A taken by UR (open merit); no SC left
    expect(r.waitlist).toEqual([]);
  });

  it("excludes an unmapped-category candidate from selection AND waitlist (fail closed)", () => {
    const r = allocateShortlist([C("A", "GEN", 90), C("B", "XYZ", 95)], { UR: 2 });
    // B has the top score but an unrecognised category -> not selected, not waitlisted, reported
    expect(r.selected.map((s) => s.applicationId)).toEqual(["A"]);
    expect(r.waitlist).toEqual([]);
    expect(r.unmapped).toEqual(["B"]);
  });
});

describe("validateLocationRosters", () => {
  it("accepts location rosters that reconcile with the category vacancies", () => {
    expect(validateLocationRosters({ north: { UR: 1, SC: 1 }, south: { UR: 1 } }, { UR: 2, SC: 1 })).toEqual([]);
  });
  it("rejects location rosters that over-allocate a reserved category beyond the approved total", () => {
    // approved SC:1 but locations sum SC:2 -> must be rejected (over-allocation)
    const errs = validateLocationRosters({ north: { UR: 1, SC: 1 }, south: { UR: 1, SC: 1 } }, { UR: 2, SC: 1 });
    expect(errs.some((m) => /SC sum to 2 but the approved roster has 1/.test(m))).toBe(true);
  });
});

describe("allocateByLocation", () => {
  it("allocates each location against its own roster and lists un-rostered candidates", () => {
    const candidates = [
      C("A", "GEN", 90, "north"), C("B", "SC", 80, "north"),
      C("D", "GEN", 88, "south"),
      C("Z", "GEN", 70, "east"), // east has no roster
    ];
    const { byLocation, unlocated } = allocateByLocation(candidates, {
      north: { UR: 1, SC: 1 },
      south: { UR: 1 },
    });
    expect(byLocation.north!.selected.map((s) => s.applicationId).sort()).toEqual(["A", "B"]);
    expect(byLocation.south!.selected.map((s) => s.applicationId)).toEqual(["D"]);
    expect(unlocated).toEqual(["Z"]);
  });
});
