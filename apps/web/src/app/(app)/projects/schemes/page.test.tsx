import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatMoney, formatRupees } from "@/lib/formatters";

const getSchemesMock = vi.fn();
// Mocked with the SAME relative specifier page.tsx itself imports (this
// test file is co-located with it), so the mock actually intercepts that
// import -- same convention as [id]/page.test.tsx (COMP-016).
vi.mock("../../../_data/loaders", () => ({
  getSchemes: (...args: unknown[]) => getSchemesMock(...args),
}));

import SchemesPage from "./page";

// Two schemes with deliberately distinct amounts, so the page's summed
// "Total Allocation"/"Released" stat cards land on a number that does not
// coincide with either individual row's own Allocation/Released cell --
// SCHEME_A's numbers reuse COMP-016 "Test Scheme A" (see
// services/project-service/tests/comp-016-scheme-detail.test.ts /
// SchemesTable.test.tsx); SCHEME_B is a second, distinct scheme so the sum
// is unambiguous.
const SCHEME_A = {
  id: "s1",
  schemeCode: "COMP017-A",
  name: "COMP-017 Regression Test Scheme A",
  fundingType: "central" as const,
  totalAllocation: 1000000, // minorToAmount(100000000n) -- COMP-016 scheme A: ₹10,00,000
  releasedAmount: 600000, // minorToAmount(60000000n) -- COMP-016 scheme A: ₹6,00,000
  projectCount: 2,
  status: "active" as const,
};
const SCHEME_B = {
  id: "s2",
  schemeCode: "COMP017-B",
  name: "COMP-017 Regression Test Scheme B",
  fundingType: "state" as const,
  totalAllocation: 500000, // ₹5,00,000
  releasedAmount: 200000, // ₹2,00,000
  projectCount: 1,
  status: "active" as const,
};
const TOTAL_ALLOCATION_SUM = SCHEME_A.totalAllocation + SCHEME_B.totalAllocation; // 1,500,000 rupees
const TOTAL_RELEASED_SUM = SCHEME_A.releasedAmount + SCHEME_B.releasedAmount; // 800,000 rupees

/**
 * Regression test for COMP-017.
 *
 * This page's "Total Allocation"/"Released" stat cards sum the same
 * already-rupee totalAllocation/releasedAmount fields SchemesTable.tsx
 * renders per row, and had the identical bug: formatMoney() called on an
 * already-converted rupee number, under-displaying the dashboard total by
 * 100x. Not called out by line number in the original COMP-017 gap-report
 * row (which only cited SchemesTable.tsx:28,34) -- found by reading the
 * rest of this page while investigating the fix.
 */
describe("SchemesPage (COMP-017)", () => {
  beforeEach(() => {
    getSchemesMock.mockReset();
  });

  it("renders Total Allocation / Released stat cards as the correct whole-rupee sum -- not 100x smaller", async () => {
    getSchemesMock.mockResolvedValue({ data: [SCHEME_A, SCHEME_B], source: "api" });

    const ui = await SchemesPage();
    render(ui);

    // formatRupees() is the correct formatter for this already-in-rupees
    // sum -- "₹15,00,000.00" / "₹8,00,000.00". Distinct from either row's
    // own Allocation/Released cell, so this uniquely identifies the stat
    // cards (SchemesTable's own per-row rendering is covered separately by
    // SchemesTable.test.tsx).
    expect(screen.getByText(formatRupees(TOTAL_ALLOCATION_SUM))).toBeInTheDocument();
    expect(screen.getByText(formatRupees(TOTAL_RELEASED_SUM))).toBeInTheDocument();

    // The pre-fix bug's exact output: formatMoney() called directly on the
    // rupee sum reads it as PAISE ("₹15,000.00" / "₹8,000.00" -- 100x
    // smaller). Must never appear once fixed.
    expect(screen.queryByText(formatMoney(TOTAL_ALLOCATION_SUM))).not.toBeInTheDocument();
    expect(screen.queryByText(formatMoney(TOTAL_RELEASED_SUM))).not.toBeInTheDocument();
  });
});
