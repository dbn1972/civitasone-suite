import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SchemesTable, type SchemeRow } from "./SchemesTable";
import { formatMoney } from "@/lib/formatters";

/**
 * Regression test for COMP-017.
 *
 * project-service's listSchemeSummaries() returns totalAllocation/
 * releasedAmount as whole-RUPEE numbers (its minorToAmount() helper) --
 * a deliberate, documented convention (SchemeSummarySchema in
 * packages/schemas/src/web.ts: `totalAllocation: z.number()`; the
 * "Deliberately NOT SchemeSummary & {...}" comment on SchemeDetail in
 * packages/types/src/index.ts). This table used to feed those numbers
 * straight into formatMoney(), which treats its argument as MINOR units
 * (paise) per its own docstring -- under-displaying every allocation/
 * released figure by exactly 100x.
 *
 * SCHEME_A_* below reuses services/project-service/tests/comp-016-scheme-
 * detail.test.ts's own "COMP-016 Test Scheme A" minor-unit amounts
 * (totalOutlayMinor 100000000 / releasedMinor 60000000) so this test can
 * assert, for that SAME scheme, that the list page's figures now equal
 * formatMoney() applied directly to its minor-unit amount -- i.e. exactly
 * what the (already-fixed, COMP-016) detail page shows. That is the DoD
 * on the COMP-017 gap-report row: list and detail must show the identical
 * number for the same scheme, not one 100x the other.
 */
const SCHEME_A_TOTAL_OUTLAY_MINOR = "100000000"; // COMP-016 scheme A: ₹10,00,000 exactly
const SCHEME_A_RELEASED_MINOR = "60000000"; // COMP-016 scheme A: ₹6,00,000 exactly

const ROW: SchemeRow = {
  id: "s1",
  schemeCode: "COMP017-A",
  name: "COMP-017 Regression Test Scheme",
  fundingType: "central",
  // Exactly what project-service's listSchemeSummaries() sends today for
  // COMP-016 scheme A: Number(minor)/100 -- already converted to whole
  // rupees, not minor units.
  totalAllocation: Number(SCHEME_A_TOTAL_OUTLAY_MINOR) / 100,
  releasedAmount: Number(SCHEME_A_RELEASED_MINOR) / 100,
  projectCount: 2,
  status: "active",
};

describe("SchemesTable (COMP-017)", () => {
  it("renders Allocation/Released matching formatMoney() on the same scheme's minor-unit amount -- not 100x smaller", () => {
    render(<SchemesTable rows={[ROW]} />);

    // What the (already-fixed) detail page shows for this exact scheme.
    const expectedAllocation = formatMoney(SCHEME_A_TOTAL_OUTLAY_MINOR); // "₹10,00,000.00"
    const expectedReleased = formatMoney(SCHEME_A_RELEASED_MINOR); // "₹6,00,000.00"

    expect(screen.getByText(expectedAllocation)).toBeInTheDocument();
    expect(screen.getByText(expectedReleased)).toBeInTheDocument();

    // The pre-fix bug's exact output: formatMoney() called directly on the
    // already-rupee totalAllocation/releasedAmount numbers reads them as
    // PAISE, under-displaying by 100x ("₹10,000.00"/"₹6,000.00" instead of
    // "₹10,00,000.00"/"₹6,00,000.00"). Must never appear once fixed.
    expect(screen.queryByText(formatMoney(ROW.totalAllocation as number))).not.toBeInTheDocument();
    expect(screen.queryByText(formatMoney(ROW.releasedAmount as number))).not.toBeInTheDocument();
  });
});
