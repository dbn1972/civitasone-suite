import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SchemesTable, type SchemeRow } from "./SchemesTable";
import { formatMoney } from "@/lib/formatters";

/**
 * Regression test for COMP-017, updated for GAP2-PROJECTS-SCHEMES-MONEY-04.
 *
 * project-service's listSchemeSummaries() now returns totalAllocation/
 * releasedAmount as bigint MINOR units (paise) as a STRING — the SAME unit
 * convention the scheme DETAIL endpoint uses (getSchemeDetail's *Minor
 * fields), standardised by GAP2-PROJECTS-SCHEMES-MONEY-04 to remove the
 * standing 100x hazard between the two sibling endpoints. This table renders
 * them with formatMoney() (paise) directly.
 *
 * SCHEME_A_* below reuses services/project-service/tests/comp-016-scheme-
 * detail.test.ts's own "COMP-016 Test Scheme A" minor-unit amounts
 * (totalOutlayMinor 100000000 / releasedMinor 60000000) so this test asserts,
 * for that SAME scheme, that the list page's figures equal formatMoney()
 * applied to its minor-unit amount — i.e. exactly what the detail page shows.
 * List and detail must show the identical number for the same scheme.
 */
const SCHEME_A_TOTAL_OUTLAY_MINOR = "100000000"; // COMP-016 scheme A: ₹10,00,000 exactly
const SCHEME_A_RELEASED_MINOR = "60000000"; // COMP-016 scheme A: ₹6,00,000 exactly

const ROW: SchemeRow = {
  id: "s1",
  schemeCode: "COMP017-A",
  name: "COMP-017 Regression Test Scheme",
  fundingType: "central",
  // GAP2-PROJECTS-SCHEMES-MONEY-04: exactly what listSchemeSummaries() now
  // sends — bigint minor units (paise) as a string, same as the detail endpoint.
  totalAllocation: SCHEME_A_TOTAL_OUTLAY_MINOR,
  releasedAmount: SCHEME_A_RELEASED_MINOR,
  projectCount: 2,
  status: "active",
};

describe("SchemesTable (COMP-017 / GAP2-PROJECTS-SCHEMES-MONEY-04)", () => {
  it("renders Allocation/Released matching formatMoney() on the same scheme's minor-unit amount -- not 100x smaller", () => {
    render(<SchemesTable rows={[ROW]} />);

    // What the detail page shows for this exact scheme.
    const expectedAllocation = formatMoney(SCHEME_A_TOTAL_OUTLAY_MINOR); // "₹10,00,000.00"
    const expectedReleased = formatMoney(SCHEME_A_RELEASED_MINOR); // "₹6,00,000.00"

    expect(screen.getByText(expectedAllocation)).toBeInTheDocument();
    expect(screen.getByText(expectedReleased)).toBeInTheDocument();

    // The pre-standardisation bug would under-display by 100x if the list had
    // sent whole rupees into formatMoney(); with minor-unit strings end to end
    // that 100x-smaller figure must never appear.
    expect(screen.queryByText(formatMoney(String(Number(SCHEME_A_TOTAL_OUTLAY_MINOR) / 100)))).not.toBeInTheDocument();
    expect(screen.queryByText(formatMoney(String(Number(SCHEME_A_RELEASED_MINOR) / 100)))).not.toBeInTheDocument();
  });
});
