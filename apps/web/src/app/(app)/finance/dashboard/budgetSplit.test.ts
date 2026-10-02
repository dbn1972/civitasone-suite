import { describe, it, expect } from "vitest";
import { computeBudgetSplit } from "./budgetSplit";

describe("computeBudgetSplit (GAP-FINANCE-DASHBOARD-04)", () => {
  it("exact remaining from sanctionedMinor (bigint, no percentage back-computation)", () => {
    expect(computeBudgetSplit({ utilisationPct: 25, expenditure: 25_000_000, sanctionedMinor: "100000000" })).toEqual({
      kind: "within", expenditureMinor: 25_000_000n, remainingMinor: 75_000_000n,
    });
  });
  it("overspent when expenditure exceeds the sanctioned total", () => {
    expect(computeBudgetSplit({ utilisationPct: 120, expenditure: 120_000, sanctionedMinor: "100000" })).toEqual({
      kind: "overspent", expenditureMinor: 120_000n, sanctionedMinor: 100_000n, overspentMinor: 20_000n,
    });
  });
  it("no budget when utilisation is unknown and no sanctioned total is supplied", () => {
    expect(computeBudgetSplit({ utilisationPct: null, expenditure: 500 }).kind).toBe("no-budget");
    expect(computeBudgetSplit({ utilisationPct: 10, expenditure: 500, sanctionedMinor: "0" }).kind).toBe("no-budget");
  });
  it("older API: never shows an exact rupee remaining/overspent derived from the rounded percentage (D1)", () => {
    expect(computeBudgetSplit({ utilisationPct: 25, expenditure: 25_000_000 })).toEqual({ kind: "within", expenditureMinor: 25_000_000n, remainingMinor: null });
    expect(computeBudgetSplit({ utilisationPct: 100, expenditure: 100 })).toEqual({ kind: "within", expenditureMinor: 100n, remainingMinor: null });
    expect(computeBudgetSplit({ utilisationPct: 0, expenditure: 100 })).toEqual({ kind: "within", expenditureMinor: 100n, remainingMinor: null });
  });
  it("older API: 100.4% and 101% are 'over budget' with no amount", () => {
    expect(computeBudgetSplit({ utilisationPct: 100.4, expenditure: 10_040 })).toEqual({ kind: "over-budget", expenditureMinor: 10_040n });
    expect(computeBudgetSplit({ utilisationPct: 101, expenditure: 10_100 })).toEqual({ kind: "over-budget", expenditureMinor: 10_100n });
  });
  it("does not lose precision on a very large sanctioned total", () => {
    const s = computeBudgetSplit({ utilisationPct: 50, expenditure: "9007199254740993", sanctionedMinor: "18014398509481986" });
    expect(s).toMatchObject({ kind: "within", remainingMinor: 9007199254740993n });
  });
});
