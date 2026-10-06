import { describe, it, expect } from "vitest";
import { deriveUtilizationTotals } from "./utilizationTotals";
import { formatCrore } from "@/lib/formatters";
import type { UtilizationRow } from "./UtilizationTable";

function row(project: string, allocatedMinor: string, releasedMinor: string, utilisedMinor: string): UtilizationRow {
  return { project, allocatedMinor, releasedMinor, utilisedMinor, utilisationPct: null, status: "active" };
}

describe("GAP-PROJECTS-UTILIZATION-02: tiles derived from rows (BigInt)", () => {
  it("sums allocated/released/utilised from the rows and computes unspent", () => {
    const rows = [
      // ₹34.5 Cr allocated, ₹21 Cr released, ₹18.55 Cr utilised
      row("A", "34500000000", "21000000000", "18550000000"),
      // ₹12.8 Cr allocated, ₹9.6 Cr released, ₹4.23 Cr utilised
      row("B", "12800000000", "9600000000", "4230000000"),
    ];
    const t = deriveUtilizationTotals(rows);
    expect(t.allocatedMinor).toBe(47300000000n); // 34.5 + 12.8 = 47.3 Cr
    expect(t.releasedMinor).toBe(30600000000n);
    expect(t.utilisedMinor).toBe(22780000000n); // 18.55 + 4.23 = 22.78 Cr
    // unspent is COMPUTED (allocated - utilised), never hand-typed
    expect(t.unspentMinor).toBe(47300000000n - 22780000000n);
  });

  it("Utilization % is the WEIGHTED sum(utilised)/sum(allocated), not the mean of row percentages", () => {
    // Row 1: 100% utilised of a tiny allocation; Row 2: 10% of a huge one.
    // Unweighted mean = 55%. Weighted (correct) = far lower.
    const rows = [
      row("tiny", "100", "100", "100"), // 100%
      row("huge", "1000000", "500000", "100000"), // 10%
    ];
    const t = deriveUtilizationTotals(rows);
    // utilised 100100 / allocated 1000100 = 10.009... -> 10.0 (one decimal)
    expect(t.utilisationPct).toBeCloseTo(10.0, 1);
    expect(t.utilisationPct).not.toBe(55); // never the unweighted mean
  });

  it("returns null Utilization % (not a fabricated 0) when there is no allocation", () => {
    const t = deriveUtilizationTotals([]);
    expect(t.allocatedMinor).toBe(0n);
    expect(t.utilisationPct).toBeNull();
  });
});

describe("GAP-PROJECTS-UTILIZATION-03: formatCrore", () => {
  it.each([
    ["345000000000", "₹345.00 Cr"],
    ["185000000000", "₹185.00 Cr"],
    ["3450000000", "₹3.45 Cr"],
    ["890000000", "₹0.89 Cr"],
  ])("formatCrore(%s) -> %s", (minor, expected) => {
    expect(formatCrore(minor)).toBe(expected);
  });

  it("renders '—' for missing/invalid, never a fabricated ₹0.00 Cr", () => {
    expect(formatCrore(null)).toBe("—");
    expect(formatCrore("")).toBe("—");
    expect(formatCrore("abc")).toBe("—");
  });
});
