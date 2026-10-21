import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { MonthOverMonthCards } from "./MonthOverMonthCards";

// GAP-PAYROLL-HOME-01: every amount is an integer-paise string.
const BASE_PROPS = {
  currentGrossMinor: "60000000", // Rs 6,00,000.00
  currentNetMinor: "55000000", // Rs 5,50,000.00
  currentPeriod: "September 2026",
  previousPeriod: "August 2026",
};

// UX-017: MonthOverMonthCards now reads its copy through next-intl
// (useTranslations("monthOverMonthCards")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderCards(props: React.ComponentProps<typeof MonthOverMonthCards>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MonthOverMonthCards {...props} />
    </NextIntlClientProvider>,
  );
}

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
    const { container } = renderCards({ ...BASE_PROPS, previousGrossMinor: "50000000" });

    expect(screen.getByText("₹5,00,000.00")).toBeInTheDocument();
    expect(container.textContent).toContain("↑ 20.0% vs August 2026");
  });

  it('shows "—" and no delta when the prior-run fetch failed (previousGross: null)', () => {
    const { container } = renderCards({ ...BASE_PROPS, previousGrossMinor: null });

    // formatMoney(null) -> "—", never a fabricated ₹0.00 standing in for
    // "we don't know".
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // No delta indicator at all -- computing a % change against an unknown
    // prior value would itself be fabricated.
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("↓");
    expect(container.textContent).not.toContain("vs August 2026");
  });

  // GAP-PAYROLL-HOME-01: percentages are integer-rounded (half away from zero) from
  // paise, not float arithmetic, and every amount is rendered from paise with formatMoney.
  it("computes the change and the net-to-gross ratio exactly from paise", () => {
    const { container } = renderCards({ ...BASE_PROPS, previousGrossMinor: "62500000" });
    // 6,00,000.00 vs 6,25,000.00 -> -4.0%; net 5,50,000.00 of 6,00,000.00 -> 91.7%
    expect(container.textContent).toContain("↓ 4.0% vs August 2026");
    expect(container.textContent).toContain("91.7%");
    expect(container.textContent).toContain("Net ₹5,50,000.00 of Gross ₹6,00,000.00");
  });

  it("rounds an exact half-tenth of a percent away from zero: +0.05% shows 0.1%", () => {
    // previous Rs 2,00,000.00 (20000000 paise), current Rs 2,00,100.00 (20010000 paise):
    // the change is exactly +0.05%, i.e. half a tenth of a percent -> rounds up to 0.1.
    const { container } = renderCards({ ...BASE_PROPS, currentGrossMinor: "20010000", currentNetMinor: "10005000", previousGrossMinor: "20000000" });
    expect(container.textContent).toContain("↑ 0.1% vs August 2026");
    expect(container.textContent).toContain("50.0%");
  });

  it('shows "—" for the ratio when the current gross is unknown or zero', () => {
    const { container } = renderCards({ ...BASE_PROPS, currentGrossMinor: null, previousGrossMinor: "50000000" });
    expect(container.textContent).not.toMatch(/%\s*$/);
    expect(container.textContent).not.toContain("↑");
  });

  it("shows a real ₹0.00 (not a dash) when there genuinely was no prior run, and still shows no delta", () => {
    const { container } = renderCards({ ...BASE_PROPS, previousGrossMinor: "0" });

    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    // Dividing by a real zero base is still meaningless -- no delta line,
    // same as before this fix.
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("↓");
  });
});
