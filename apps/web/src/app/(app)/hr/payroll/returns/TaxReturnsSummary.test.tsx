import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TaxReturnsSummary, type QuarterSummaryRow } from "./TaxReturnsSummary";

function baseRow(overrides: Partial<QuarterSummaryRow>): QuarterSummaryRow {
  return {
    quarter: "Q1",
    status: "filed",
    filingDate: "2026-07-15",
    challanRef: "CHLN-1",
    totalTdsDepositedMinor: 0,
    deducteeCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// UX-018: totalTdsDepositedMinor is guarded by `deducteeCount > 0` before the
// row is shown at all, but that doesn't guarantee totalTdsDepositedMinor
// itself is present — a partial API response could carry deductees without a
// computed total. A missing total must render "—", never a fabricated
// "₹0.00" that looks identical to a genuinely-zero deposit.
// ---------------------------------------------------------------------------
describe("TaxReturnsSummary — missing totalTdsDepositedMinor (UX-018)", () => {
  it("renders an em-dash when totalTdsDepositedMinor is missing despite deducteeCount > 0", () => {
    const quarters = [
      baseRow({
        quarter: "Q1",
        deducteeCount: 5,
        totalTdsDepositedMinor: undefined as unknown as number,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} />);

    expect(screen.getByText("TDS Deposited")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("renders an em-dash for a null totalTdsDepositedMinor too", () => {
    const quarters = [
      baseRow({
        quarter: "Q2",
        deducteeCount: 3,
        totalTdsDepositedMinor: null as unknown as number,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("still renders a genuine zero deposit as ₹0.00, distinct from missing data", () => {
    const quarters = [
      baseRow({
        quarter: "Q3",
        deducteeCount: 2,
        totalTdsDepositedMinor: 0,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} />);

    // Scoped to the Q3 row itself: the annual "Total TDS Deposited" summary
    // tile independently sums every quarter and would coincidentally also
    // show "₹0.00" here (a related but separate masking risk — see the
    // UX-022 row filed alongside this fix), so a page-wide getByText("₹0.00")
    // would be ambiguous.
    const q3Row = screen.getByText("Q3 — Oct to Dec").closest("div[style*='border']");
    expect(q3Row).not.toBeNull();
    expect(within(q3Row as HTMLElement).getByText("₹0.00")).toBeInTheDocument();
  });

  it("does not render the TDS Deposited figure at all when deducteeCount is 0 (unrelated existing gate)", () => {
    const quarters = [baseRow({ quarter: "Q4", deducteeCount: 0 })];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} />);

    expect(screen.queryByText("TDS Deposited")).not.toBeInTheDocument();
  });
});
