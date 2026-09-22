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
describe("BudgetChart — Issue #5: chart values match the stat tile, not 100x it", () => {
  it("renders category bars already rupee-scaled, summing to the true expenditure", () => {
    // Live-verified figure: 500000 paise = real expenditure of ₹5,000.00.
    render(<BudgetChart utilisationPct={45} expenditure={500000} />);
    // 35/25/20/12/8% splits of ₹5,000 -> 1750/1250/1000/600/400 — NOT the
    // pre-fix 175000/125000/100000/60000/40000 (the raw, unconverted paise
    // integer split the same way).
    expect(screen.getByText("1750")).toBeInTheDocument();
    expect(screen.getByText("1250")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("600")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    // The old, 100x-inflated values (this bug's reported symptom) must be gone.
    expect(screen.queryByText("175000")).not.toBeInTheDocument();
    expect(screen.queryByText("125000")).not.toBeInTheDocument();
    expect(screen.queryByText("100000")).not.toBeInTheDocument();
  });

  it("donut centre total (raw) and legend (formatted) agree on the same magnitude", () => {
    // No sanctioned budget on record (Issue #7) -> remaining is 0, so the
    // donut's raw centre total is exactly `utilized`, unambiguously.
    render(<BudgetChart utilisationPct={null} expenditure={500000} />);
    // Two elements legitimately show "5000" here: the donut's raw SVG centre
    // total AND the legend row's own value span for "Utilized" (value ===
    // total, since remaining is 0) — both correctly rupee-scaled, which is
    // exactly the point of this test, so assert both exist rather than
    // picking one via getByText (which requires a unique match).
    expect(screen.getAllByText("5000")).toHaveLength(2); // raw donut centre total + legend value, both in rupees
    // Anchored: the donut slice's <title> tooltip also contains this same
    // label text as a substring ("Utilized (₹5,000.00): 5000 (100.0%)") —
    // an unanchored match would find both and fail as ambiguous.
    expect(screen.getByText(/^Utilized \(₹5,000\.00\)$/)).toBeInTheDocument(); // formatted legend, same quantity
    // The pre-fix bug's signature number (the raw, unconverted paise value)
    // must not appear anywhere on the page.
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

  it("handles zero expenditure without throwing", () => {
    expect(() => render(<BudgetChart utilisationPct={null} expenditure={0} />)).not.toThrow();
  });
});
