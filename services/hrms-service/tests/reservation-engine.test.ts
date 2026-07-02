/**
 * Coverage tests for reservation/engine.ts (2.32% → target: 100%).
 * Pure roster computation — no DB or I/O.
 */
import { describe, it, expect } from "vitest";
import { computeRoster, generateRosterPoints, type RosterDef, type FilledByCategory } from "../src/modules/reservation/engine.js";

const STANDARD_ROSTER: RosterDef = {
  rosterSize: 100,
  pctSc: 15,
  pctSt: 7,
  pctObc: 27,
  pctEws: 10,
  pctPwd: 4,
  cf: { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 },
};

const EMPTY_FILLED: FilledByCategory = { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 };

describe("reservation/engine — computeRoster()", () => {
  it("computes correct entitlements for standard roster", () => {
    const r = computeRoster(STANDARD_ROSTER, EMPTY_FILLED);
    const sc = r.categories.find((c) => c.category === "SC")!;
    const st = r.categories.find((c) => c.category === "ST")!;
    const obc = r.categories.find((c) => c.category === "OBC")!;
    const ews = r.categories.find((c) => c.category === "EWS")!;
    const ur = r.categories.find((c) => c.category === "UR")!;

    expect(sc.entitlement).toBe(15);
    expect(st.entitlement).toBe(7);
    expect(obc.entitlement).toBe(27);
    expect(ews.entitlement).toBe(10);
    expect(ur.entitlement).toBe(41); // 100 - 15 - 7 - 27 - 10
  });

  it("vacancy equals entitlement when nothing is filled", () => {
    const r = computeRoster(STANDARD_ROSTER, EMPTY_FILLED);
    for (const c of r.categories) {
      expect(c.vacancy).toBe(c.entitlement);
    }
  });

  it("vacancy is zero when all positions are filled", () => {
    const filled = { SC: 15, ST: 7, OBC: 27, EWS: 10, UR: 41 };
    const r = computeRoster(STANDARD_ROSTER, filled);
    for (const c of r.categories) {
      expect(c.vacancy).toBe(0);
    }
  });

  it("handles carry-forward correctly", () => {
    const def: RosterDef = { ...STANDARD_ROSTER, cf: { SC: 3, ST: 2, OBC: 0, EWS: 0, UR: 0 } };
    const r = computeRoster(def, EMPTY_FILLED);
    const sc = r.categories.find((c) => c.category === "SC")!;
    const st = r.categories.find((c) => c.category === "ST")!;
    expect(sc.entitlement).toBe(18); // 15 + 3
    expect(st.entitlement).toBe(9); // 7 + 2
    expect(sc.carryForward).toBe(3);
  });

  it("PwD is reported as horizontal reservation", () => {
    const r = computeRoster(STANDARD_ROSTER, EMPTY_FILLED);
    expect(r.pwd.entitlement).toBe(4);
    expect(r.pwd.note).toContain("horizontal");
  });

  it("totals sum correctly", () => {
    const r = computeRoster(STANDARD_ROSTER, EMPTY_FILLED);
    const sumEnt = r.categories.reduce((a, c) => a + c.entitlement, 0);
    expect(r.totals.entitlement).toBe(sumEnt);
    expect(r.totals.entitlement).toBe(100);
  });

  it("partial fill reduces vacancy", () => {
    const filled = { SC: 5, ST: 3, OBC: 10, EWS: 4, UR: 20 };
    const r = computeRoster(STANDARD_ROSTER, filled);
    expect(r.categories.find((c) => c.category === "SC")!.vacancy).toBe(10);
    expect(r.categories.find((c) => c.category === "OBC")!.vacancy).toBe(17);
  });
});

describe("reservation/engine — generateRosterPoints()", () => {
  it("generates exactly rosterSize points", () => {
    const points = generateRosterPoints(STANDARD_ROSTER);
    expect(points.length).toBe(100);
  });

  it("correct category counts match floor(pct * size / 100)", () => {
    const points = generateRosterPoints(STANDARD_ROSTER);
    const counts = { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 };
    for (const p of points) counts[p.category]++;
    expect(counts.SC).toBe(15);
    expect(counts.ST).toBe(7);
    expect(counts.OBC).toBe(27);
    expect(counts.EWS).toBe(10);
    expect(counts.UR).toBe(41);
  });

  it("throws when percentages exceed 100%", () => {
    expect(() => generateRosterPoints({
      rosterSize: 100, pctSc: 40, pctSt: 30, pctObc: 25, pctEws: 10,
    })).toThrow(/sum to 105%/);
  });

  it("works with small roster (10 points)", () => {
    const points = generateRosterPoints({ rosterSize: 10, pctSc: 15, pctSt: 7, pctObc: 27, pctEws: 10 });
    expect(points.length).toBe(10);
    const counts = { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 };
    for (const p of points) counts[p.category]++;
    // floor(1.5)=1 SC, floor(0.7)=0 ST, floor(2.7)=2 OBC, floor(1.0)=1 EWS
    expect(counts.SC).toBe(1);
    expect(counts.ST).toBe(0);
    expect(counts.OBC).toBe(2);
    expect(counts.EWS).toBe(1);
    expect(counts.UR).toBe(6);
  });

  it("every point has a unique point number 1..size", () => {
    const points = generateRosterPoints(STANDARD_ROSTER);
    const nums = points.map((p) => p.point);
    expect(nums).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});
