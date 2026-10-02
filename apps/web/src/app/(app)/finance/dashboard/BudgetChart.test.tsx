import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetChart } from "./BudgetChart";

// Issue #5 + the donut-vs-legend formatting bug shared one root cause:
// `expenditure` arrives from finance-service's dashboard summary in MINOR
// UNITS (paise). Before the fix, BudgetChart used that raw paise integer
// directly as chart `value`s, which the generic <Chart> component prints as
// raw, unformatted digits (bar labels, the donut's centre total) — so a
// real ₹5,000.00 expenditure (500000 paise, the live-verified figure) drew
// a chart whose own numbers summed to 500000, reading as a false "₹5,00,000"
// 100x too large, right next to a correctly-formatted "₹5,000.00" legend/
// stat tile for the exact same underlying quantity.
//
// Issue #15 (this file's other describe block below): fixing the 100x SCALE
// bug did not fix FORMATTING -- <Chart>'s bar/donut value labels still
// rendered plain digit strings (e.g. "1750") with no ₹ symbol or Indian
// digit grouping. Chart.tsx now accepts an optional `valueFormatter`
// (defaulting to the original raw-digit behavior for non-currency callers),
// and BudgetChart passes `formatRupees` so every number the chart shows,
// bar label or donut total, is both correctly-scaled AND currency-formatted.
describe("BudgetChart — Issue #5 (100x scale) + Issue #15 (currency formatting)", () => {
  // GAP-FINANCE-DASHBOARD-01: the old "Expenditure by Category" bars were
  // fabricated from fixed percentage shares of total spend. With no category
  // split from the API there must be NO bars and no invented category labels.
  it("renders no fabricated category bars when no category breakdown is available", () => {
    render(<BudgetChart utilisationPct={45} expenditure={1000000} />);
    expect(screen.queryByText("Salaries")).not.toBeInTheDocument();
    expect(screen.queryByText("Infra")).not.toBeInTheDocument();
    expect(screen.queryByText("Programs")).not.toBeInTheDocument();
    expect(screen.queryByText("Grants")).not.toBeInTheDocument();
    expect(screen.queryByText("Expenditure by Category")).not.toBeInTheDocument();
    expect(screen.getByText("Category breakdown not available")).toBeInTheDocument();
    // Fixed-share amounts of the Rs 10,000 spend (35% -> 3,500, 25% -> 2,500) must not appear.
    expect(screen.queryByText("₹3,500.00")).not.toBeInTheDocument();
    expect(screen.queryByText("₹2,500.00")).not.toBeInTheDocument();
  });

  it("donut centre total and legend value agree on the same, now-formatted magnitude (Issue #15)", () => {
    // Sanctioned total supplied: 5,000 spent of 10,000 -> exact remaining 5,000.
    render(<BudgetChart utilisationPct={50} expenditure={500000} sanctionedMinor="1000000" />);
    // The pre-#15 raw digits and the pre-#5 paise value must not appear.
    expect(screen.queryByText("5000")).not.toBeInTheDocument();
    expect(screen.queryByText("500000")).not.toBeInTheDocument();
    expect(screen.getByText(/^Utilized \(₹5,000\.00\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Remaining \(₹5,000\.00\)$/)).toBeInTheDocument();
  });

  // GAP-FINANCE-DASHBOARD-04
  it("pct=25, expenditure 25000000 paise gives Remaining ₹7,50,000.00 exactly (no float back-computation)", () => {
    render(<BudgetChart utilisationPct={25} expenditure={25000000} sanctionedMinor="100000000" />);
    expect(screen.getByText(/^Remaining \(₹7,50,000\.00\)$/)).toBeInTheDocument();
  });

  it("pct=120 renders 'Overspent by' and no 'Remaining ₹0.00' legend", () => {
    render(<BudgetChart utilisationPct={120} expenditure={120000} sanctionedMinor="100000" />);
    expect(screen.getByText(/Over budget estimate by ₹200\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/Remaining/)).not.toBeInTheDocument();
  });

  it("pct=null renders the no-budget message, not a ₹0.00 Remaining slice", () => {
    expect(() => render(<BudgetChart utilisationPct={null} expenditure={500000} />)).not.toThrow();
    expect(screen.getByText("No budget estimate")).toBeInTheDocument();
    expect(screen.getByText(/Expenditure recorded so far: ₹5,000\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/Remaining/)).not.toBeInTheDocument();
  });

  it("does not render Infinity when utilisationPct is 0 (pre-existing guard preserved)", () => {
    render(<BudgetChart utilisationPct={0} expenditure={500000} />);
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });

  // Regression (separately-flagged, out-of-scope bug found by independent
  // review of the Issue #15 PR above): utilisationPct=null + expenditure=0
  // is a real, reachable state -- a tenant/FY with no sanctioned budget on
  // record (UX-006, see the null-handling test above) AND nothing spent yet
  // (a normal state at the start of a financial year, per BudgetChart.tsx's
  // own comment on `expenditure`). That makes BOTH donut slices (`Utilized`,
  // `Remaining`) zero, so DonutChart's internal `total` is zero too, and
  // `value / total` is `0 / 0`.
  //
  // `not.toThrow()` alone -- the pre-existing version of this test -- does
  // NOT catch that: NaN doesn't throw, it renders silently as the literal
  // text "NaN" (in the arc's <title> tooltip) and as an invalid, blank arc
  // path (`d="M NaN NaN ..."`) instead of crashing. Confirmed by sabotage
  // check: reverting just Chart.tsx's `total === 0` guard while keeping
  // this test's stronger assertions makes it fail with the literal "NaN"
  // text found in the container; the old `not.toThrow()`-only version kept
  // passing throughout.
  it("handles zero expenditure with no budget without throwing or rendering NaN", () => {
    const { container } = render(<BudgetChart utilisationPct={null} expenditure={0} />);
    expect(container.innerHTML).not.toContain("NaN");
    expect(screen.getByText("No budget estimate")).toBeInTheDocument();
  });

  it("zero expenditure against a real budget draws a full-remaining donut with no NaN", () => {
    const { container } = render(<BudgetChart utilisationPct={0} expenditure={0} sanctionedMinor="100000" />);
    expect(container.innerHTML).not.toContain("NaN");
    expect(screen.getByText(/^Remaining \(₹1,000\.00\)$/)).toBeInTheDocument();
  });
});

describe("BudgetChart old-API fallback (D1)", () => {
  it("101% without sanctionedMinor says 'Over budget' with no rupee overspend figure", () => {
    render(<BudgetChart utilisationPct={101} expenditure={10100} />);
    expect(screen.getByText(/Over budget$/)).toBeInTheDocument();
    expect(screen.queryByText(/Over budget estimate by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Remaining/)).not.toBeInTheDocument();
  });
  it("100.4% without sanctionedMinor is over budget, not 'within, remaining 0'", () => {
    render(<BudgetChart utilisationPct={100.4} expenditure={10040} />);
    expect(screen.getByText(/Over budget$/)).toBeInTheDocument();
  });
  it("50% without sanctionedMinor shows Remaining as a dash, not an invented amount", () => {
    render(<BudgetChart utilisationPct={50} expenditure={10000} />);
    expect(screen.getByText(/^Remaining \(—\)$/)).toBeInTheDocument();
  });
});
