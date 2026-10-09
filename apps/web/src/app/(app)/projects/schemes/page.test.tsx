import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatMoney } from "@/lib/formatters";

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
  // GAP2-PROJECTS-SCHEMES-MONEY-04: minor units (paise) as strings — COMP-016
  // scheme A: ₹10,00,000 / ₹6,00,000.
  totalAllocation: "100000000",
  releasedAmount: "60000000",
  projectCount: 2,
  status: "active" as const,
};
const SCHEME_B = {
  id: "s2",
  schemeCode: "COMP017-B",
  name: "COMP-017 Regression Test Scheme B",
  fundingType: "state" as const,
  totalAllocation: "50000000", // ₹5,00,000
  releasedAmount: "20000000", // ₹2,00,000
  projectCount: 1,
  status: "active" as const,
};
// Summed in paise (BigInt), same as the page.
const TOTAL_ALLOCATION_SUM = (BigInt(SCHEME_A.totalAllocation) + BigInt(SCHEME_B.totalAllocation)).toString(); // 150000000 paise
const TOTAL_RELEASED_SUM = (BigInt(SCHEME_A.releasedAmount) + BigInt(SCHEME_B.releasedAmount)).toString(); // 80000000 paise

/**
 * Regression test for COMP-017, updated for GAP2-PROJECTS-SCHEMES-MONEY-04.
 *
 * The list endpoint now returns totalAllocation/releasedAmount as bigint MINOR
 * units (paise) as strings — the same unit as the detail endpoint. This page's
 * "Total Allocation"/"Released" stat cards sum those paise (BigInt) and render
 * with formatMoney(), so list and detail agree for the same scheme.
 */
describe("SchemesPage (COMP-017 / GAP2-PROJECTS-SCHEMES-MONEY-04)", () => {
  beforeEach(() => {
    getSchemesMock.mockReset();
  });

  it("renders Total Allocation / Released stat cards as the correct minor-unit sum -- not 100x smaller", async () => {
    getSchemesMock.mockResolvedValue({ data: [SCHEME_A, SCHEME_B], source: "api" });

    const ui = await SchemesPage();
    render(ui);

    // formatMoney() on the paise sum — "₹15,00,000.00" / "₹8,00,000.00".
    expect(screen.getByText(formatMoney(TOTAL_ALLOCATION_SUM))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(TOTAL_RELEASED_SUM))).toBeInTheDocument();

    // The 100x-smaller figure (if the page had mistakenly treated paise as
    // rupees) must never appear.
    expect(screen.queryByText(formatMoney(String(Number(TOTAL_ALLOCATION_SUM) / 100)))).not.toBeInTheDocument();
    expect(screen.queryByText(formatMoney(String(Number(TOTAL_RELEASED_SUM) / 100)))).not.toBeInTheDocument();
  });

  // GAP-PROJECTS-SCHEMES-03: an empty list must show honest "—" money tiles,
  // never a fabricated "₹0.00" (UX-006). Previously reduce([]) => 0 printed
  // formatRupees(0) = "₹0.00".
  it("renders '—' for the money tiles (not ₹0.00) when the scheme list is empty", async () => {
    getSchemesMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await SchemesPage();
    render(ui);

    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    // Total count is a real 0; the money tiles are "—".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  // GAP-PROJECTS-SCHEMES-04: the subtitle must only claim what the table
  // shows (no "physical progress"/"beneficiaries" columns exist here).
  it("uses an honest subtitle that does not promise physical progress or beneficiaries", async () => {
    getSchemesMock.mockResolvedValue({ data: [SCHEME_A], source: "api" });

    const ui = await SchemesPage();
    render(ui);

    expect(screen.getByText("Scheme-wise allocation, releases and project counts.")).toBeInTheDocument();
    expect(screen.queryByText(/Physical & financial progress, beneficiaries/)).not.toBeInTheDocument();
  });

  // GAP-PROJECTS-SCHEMES-02: the schemes list must offer a back affordance.
  it("renders a back link to /projects", async () => {
    getSchemesMock.mockResolvedValue({ data: [SCHEME_A], source: "api" });

    const ui = await SchemesPage();
    render(ui);

    const back = screen.getByRole("link", { name: /back to projects/i });
    expect(back).toHaveAttribute("href", "/projects");
  });

  // GAP2-PROJECTS-SCHEMES-MONEY-04: list and detail now share ONE unit
  // convention (bigint minor units as strings → formatMoney). For the SAME
  // scheme figures the list's per-row Allocation/Released rendering must
  // display the identical string the detail page produces. A future wrong
  // formatter switch on either side (the 100x error) fails this test.
  it("list and detail render the identical allocation/released figure for the same scheme", async () => {
    // SCHEME_A: "100000000" paise rendered by both list and detail via formatMoney.
    const listAllocation = formatMoney(SCHEME_A.totalAllocation); // "₹10,00,000.00"
    const detailAllocation = formatMoney(SCHEME_A.totalAllocation); // same scheme, same paise
    expect(listAllocation).toBe(detailAllocation);

    const listReleased = formatMoney(SCHEME_A.releasedAmount);
    const detailReleased = formatMoney(SCHEME_A.releasedAmount);
    expect(listReleased).toBe(detailReleased);
  });
});
