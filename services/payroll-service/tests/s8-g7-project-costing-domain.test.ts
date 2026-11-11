/**
 * S8 G7 - project costing domain (pure): allocation sums, largest-remainder
 * apportionment, day-weighted splits, reclassification deltas, CSV safety.
 */
import { describe, it, expect } from "vitest";
import {
  FULL_BPS, apportion, daysInMonth, isValidSplitPct, peakAllocationBps, pctToBps, reclassDeltas, splitSlipCost,
  totalOf, type AllocationLine, type CostAmounts,
} from "../src/modules/project-costing/domain.js";
import { csvCell, toCsv } from "../src/modules/project-costing/csv.js";

const P1 = "11111111-0000-4000-8000-000000000001";
const P2 = "11111111-0000-4000-8000-000000000002";
const CC = "22222222-0000-4000-8000-000000000001";
const line = (id: string, projectId: string, pct: number, from: string, to: string | null = null): AllocationLine =>
  ({ id, targetType: "project", projectId, costCenterId: CC, bps: pctToBps(pct), from, to });
const amounts = (gross: bigint, pf = 0n, esi = 0n, nps = 0n, other = 0n): CostAmounts =>
  ({ gross, employerPf: pf, employerEsi: esi, employerNps: nps, otherEmployer: other });

describe("percent validation", () => {
  it("accepts (0,100] with at most 2 decimals only", () => {
    expect([50, 33.33, 100, 0.01].every(isValidSplitPct)).toBe(true);
    expect([0, -1, 100.01, 12.345, NaN, Infinity].some(isValidSplitPct)).toBe(false);
  });
});

describe("peakAllocationBps - an employee's lines must total 100% or less on every day", () => {
  it("sums overlapping lines and finds the busiest day, not the sum of everything", () => {
    const a = line("a", P1, 60, "2026-04-01", "2026-06-30");
    const b = line("b", P2, 50, "2026-07-01", null); // starts after a ends: no overlap
    expect(peakAllocationBps([a, b], "2026-04-01", null)).toBe(6000);
    const c = line("c", P2, 50, "2026-06-15", null); // overlaps a for 16 days -> 110%
    expect(peakAllocationBps([a, c], "2026-04-01", null)).toBe(11000);
  });
  it("is exactly 100% for 60+40 and for a hand-over on consecutive days", () => {
    expect(peakAllocationBps([line("a", P1, 60, "2026-04-01"), line("b", P2, 40, "2026-04-01")], "2026-04-01", null)).toBe(FULL_BPS);
    expect(peakAllocationBps([line("a", P1, 100, "2026-04-01", "2026-04-30"), line("b", P2, 100, "2026-05-01")], "2026-04-01", null)).toBe(FULL_BPS);
  });
  it("only looks at the candidate range", () => {
    const old = line("a", P1, 90, "2025-01-01", "2025-12-31");
    expect(peakAllocationBps([old], "2026-01-01", "2026-03-31")).toBe(0);
  });
});

describe("apportion (largest remainder)", () => {
  it("always adds up to the total, for 10,000 random splits", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 10_000; i++) {
      const n = 1 + Math.floor(rnd() * 5);
      const cuts = Array.from({ length: n }, () => Math.floor(rnd() * 1999));
      const used = cuts.reduce((s, x) => s + x, 0);
      const weights = [...cuts, FULL_BPS - used];
      const total = BigInt(Math.floor(rnd() * 5_000_000_00));
      const shares = apportion(total, weights, FULL_BPS);
      expect(shares.reduce((s, x) => s + x, 0n)).toBe(total);
      shares.forEach((s, k) => expect(s >= 0n && (weights[k] === 0 ? s === 0n : true)).toBe(true));
    }
  });
  it("gives the odd paisa to the largest remainder, ties to the earlier line", () => {
    expect(apportion(100n, [3333, 3333, 3334], FULL_BPS)).toEqual([33n, 33n, 34n]);
    expect(apportion(1n, [5000, 5000], FULL_BPS)).toEqual([1n, 0n]);
    expect(apportion(0n, [5000, 5000], FULL_BPS)).toEqual([0n, 0n]);
  });
  it("rejects a negative total", () => {
    expect(() => apportion(-1n, [10000], FULL_BPS)).toThrow();
  });
});

describe("splitSlipCost", () => {
  const M = "2026-09"; // 30 days
  it("lines add up to the slip, per component, to the paisa", () => {
    const s = amounts(10_000_01n, 1_200_01n, 33n, 77n, 5n);
    const out = splitSlipCost(s, [line("a", P1, 33.33, "2026-01-01"), line("b", P2, 33.33, "2026-01-01")], M);
    for (const k of ["gross", "employerPf", "employerEsi", "employerNps", "otherEmployer"] as const) {
      expect(out.reduce((t, l) => t + l[k], 0n)).toBe(s[k]);
    }
    expect(out.map((l) => l.targetType)).toEqual(["project", "project", "unallocated"]);
    expect(out[2]!.splitBps).toBe(3334); // the unallocated remainder is explicit
  });
  it("no allocation = everything unallocated; 100% allocated = no unallocated line", () => {
    expect(splitSlipCost(amounts(500n), [], M).map((l) => [l.targetType, l.gross])).toEqual([["unallocated", 500n]]);
    const full = splitSlipCost(amounts(500n), [line("a", P1, 60, "2026-01-01"), line("b", P2, 40, "2026-01-01")], M);
    expect(full.some((l) => l.targetType === "unallocated")).toBe(false);
    expect(full.map((l) => l.gross)).toEqual([300n, 200n]);
  });
  it("prorates a mid-month change by calendar days (owner decision 3)", () => {
    // P1 100% for the first 10 days of a 30 day month, P2 100% for the last 20.
    const out = splitSlipCost(amounts(30_000n), [line("a", P1, 100, "2026-01-01", "2026-09-10"), line("b", P2, 100, "2026-09-11")], M);
    expect(out.find((l) => l.projectId === P1)!.gross).toBe(10_000n);
    expect(out.find((l) => l.projectId === P2)!.gross).toBe(20_000n);
    expect(out.some((l) => l.targetType === "unallocated")).toBe(false);
  });
  it("merges two lines to the same target into one line, deterministic order", () => {
    const out = splitSlipCost(amounts(1000n), [line("z", P2, 30, "2026-01-01"), line("y", P1, 20, "2026-01-01"), line("x", P1, 30, "2026-01-01")], M);
    expect(out.map((l) => l.lineKey)).toEqual([`project:${P1}:${CC}`, `project:${P2}:${CC}`, "unallocated"]);
    expect(out[0]!.gross).toBe(500n);
  });
  it("refuses lines that exceed 100% on a day", () => {
    expect(() => splitSlipCost(amounts(1000n), [line("a", P1, 70, "2026-01-01"), line("b", P2, 70, "2026-01-01")], M)).toThrow(/exceed 100%/);
  });
  it("handles February and leap years", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2027-02")).toBe(28);
  });
});

describe("reclassDeltas", () => {
  const M = "2026-08";
  it("a back-dated 100% P1 -> 50/50 change yields deltas that net to zero and equal the new split", () => {
    const slip = amounts(1_000_00n, 120_00n);
    const before = splitSlipCost(slip, [line("a", P1, 100, "2026-01-01")], M);
    const booked = new Map(before.map((l) => [l.lineKey, { identity: l, amounts: l }]));
    const after = splitSlipCost(slip, [line("a", P1, 50, "2026-01-01"), line("b", P2, 50, "2026-01-01")], M);
    const d = reclassDeltas(booked, after);
    for (const k of ["gross", "employerPf"] as const) expect(d.reduce((t, x) => t + x.delta[k], 0n)).toBe(0n);
    expect(d.find((x) => x.identity.projectId === P1)!.delta.gross).toBe(-500_00n);
    expect(d.find((x) => x.identity.projectId === P2)!.delta.gross).toBe(500_00n);
    expect(d.reduce((t, x) => t + totalOf(x.delta), 0n)).toBe(0n);
  });
  it("is empty when nothing changed (idempotent)", () => {
    const slip = amounts(777n);
    const al = [line("a", P1, 40, "2026-01-01")];
    const cur = splitSlipCost(slip, al, M);
    expect(reclassDeltas(new Map(cur.map((l) => [l.lineKey, { identity: l, amounts: l }])), splitSlipCost(slip, al, M))).toEqual([]);
  });
  it("a booked target that is no longer expected is reversed using its stored identity", () => {
    const slip = amounts(100n);
    const before = splitSlipCost(slip, [line("a", P1, 100, "2026-01-01")], M);
    const d = reclassDeltas(new Map(before.map((l) => [l.lineKey, { identity: l, amounts: l }])), splitSlipCost(slip, [], M));
    expect(d.find((x) => x.identity.projectId === P1)!.delta.gross).toBe(-100n);
    expect(d.find((x) => x.identity.targetType === "unallocated")!.delta.gross).toBe(100n);
  });
});

describe("csv", () => {
  it("neutralises spreadsheet formulas, keeps negative numbers, quotes commas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-500")).toBe("-500");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(toCsv(["a", "b"], [["1", null]])).toBe("a,b\r\n1,\r\n");
  });
});
