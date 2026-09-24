import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MonthOverMonthCards } from "./MonthOverMonthCards";

const BASE_PROPS = {
  currentGross: 600000,
  currentNet: 550000,
  currentPeriod: "September 2026",
  previousPeriod: "August 2026",
};

/**
 * Regression coverage for the MEDIUM fix: `previousGross` used to be typed
 * (and treated) as a plain `number`, with the page-level caller conflating
 * "no prior run existed" and "the prior-run fetch failed" into the same
 * fabricated `0`. It is now `number | null` — null meaning "we don't know"
 * (fetch failed), distinct from a real 0 (no prior period, or a prior
 * period that genuinely had no run).
 */
describe("MonthOverMonthCards", () => {
  it("shows a real previous-gross figure and a MoM delta when the prior run is known", () => {
    const { container } = render(<MonthOverMonthCards {...BASE_PROPS} previousGross={500000} />);

    expect(screen.getByText("₹5,00,000.00")).toBeInTheDocument();
    expect(container.textContent).toContain("↑ 20.0% vs August 2026");
  });

  it('shows "—" and no delta when the prior-run fetch failed (previousGross: null)', () => {
    const { container } = render(<MonthOverMonthCards {...BASE_PROPS} previousGross={null} />);

    // formatRupees(null) -> "—", never a fabricated ₹0.00 standing in for
    // "we don't know".
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // No delta indicator at all -- computing a % change against an unknown
    // prior value would itself be fabricated.
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("↓");
    expect(container.textContent).not.toContain("vs August 2026");
  });

  it("shows a real ₹0.00 (not a dash) when there genuinely was no prior run, and still shows no delta", () => {
    const { container } = render(<MonthOverMonthCards {...BASE_PROPS} previousGross={0} />);

    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    // Dividing by a real zero base is still meaningless -- no delta line,
    // same as before this fix.
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("↓");
  });
});
