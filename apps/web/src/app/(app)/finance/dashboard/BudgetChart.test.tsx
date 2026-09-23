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
  it("renders category bars already rupee-scaled AND currency-formatted, summing to the true expenditure", () => {
    // Live-verified figure: 500000 paise = real expenditure of ₹5,000.00.
    render(<BudgetChart utilisationPct={45} expenditure={500000} />);
    // 35/25/20/12/8% splits of ₹5,000 -> 1750/1250/1000/600/400 rupees,
    // rendered through formatRupees() (Issue #15) — NOT the pre-#5-fix
    // 175000/125000/100000/60000/40000 (raw, unconverted paise), and NOT
    // the post-#5/pre-#15 bare "1750" etc (correct scale, no ₹/grouping).
    expect(screen.getByText("₹1,750.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,250.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹600.00")).toBeInTheDocument();
    expect(screen.getByText("₹400.00")).toBeInTheDocument();
    // The old, 100x-inflated values (Issue #5's reported symptom) must be gone.
    expect(screen.queryByText("175000")).not.toBeInTheDocument();
    expect(screen.queryByText("125000")).not.toBeInTheDocument();
    expect(screen.queryByText("100000")).not.toBeInTheDocument();
    // The correctly-scaled-but-still-raw values (Issue #15's reported
    // symptom — what a reader actually saw after #5 alone) must be gone too.
    expect(screen.queryByText("1750")).not.toBeInTheDocument();
    expect(screen.queryByText("1250")).not.toBeInTheDocument();
    expect(screen.queryByText("1000")).not.toBeInTheDocument();
  });

  it("donut centre total and legend value agree on the same, now-formatted magnitude (Issue #15)", () => {
    // No sanctioned budget on record (Issue #7) -> remaining is 0, so the
    // donut's centre total is exactly `utilized`, unambiguously.
    render(<BudgetChart utilisationPct={null} expenditure={500000} />);
    // Two elements legitimately show "₹5,000.00" here: the donut's SVG
    // centre total AND the legend row's own value span for "Utilized"
    // (value === total, since remaining is 0) — both correctly rupee-scaled
    // AND currency-formatted (Issue #15), which is exactly the point of
    // this test, so assert both exist rather than picking one via
    // getByText (which requires a unique match).
    expect(screen.getAllByText("₹5,000.00")).toHaveLength(2); // formatted donut centre total + legend value, both in rupees
    // The pre-#15-fix raw (but correctly-scaled) value must be gone from
    // both of those spots.
    expect(screen.queryByText("5000")).not.toBeInTheDocument();
    // Anchored: the donut slice's <title> tooltip also contains this same
    // label text as a substring ("Utilized (₹5,000.00): ₹5,000.00 (100.0%)")
    // — an unanchored match would find both and fail as ambiguous.
    expect(screen.getByText(/^Utilized \(₹5,000\.00\)$/)).toBeInTheDocument(); // formatted legend, same quantity
    // The pre-#5-fix bug's signature number (the raw, unconverted paise
    // value) must not appear anywhere on the page.
    expect(screen.queryByText("500000")).not.toBeInTheDocument();
  });

  it("does not throw and shows zero remaining when utilisationPct is null (no sanctioned budget, UX-006)", () => {
    expect(() => render(<BudgetChart utilisationPct={null} expenditure={500000} />)).not.toThrow();
    // Anchored for the same reason as above: the donut slice's <title>
    // tooltip also contains this label text as a substring.
    expect(screen.getByText(/^Remaining \(₹0\.00\)$/)).toBeInTheDocument();
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
  it("handles zero expenditure without throwing, and without silently rendering NaN (both donut slices are zero: utilized=0, remaining=0)", () => {
    const { container } = render(<BudgetChart utilisationPct={null} expenditure={0} />);
    expect(container.innerHTML).not.toContain("NaN");
    // An honest empty state, not a broken/blank arc. Two elements
    // legitimately say "No data": the ring's <title> tooltip and the
    // visible centre <text> label (getAllByText, same convention as this
    // file's own "agree on the same... magnitude" test above).
    expect(screen.getAllByText("No data").length).toBeGreaterThanOrEqual(2);
  });
});
