import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { MonthOverMonthCards } from "./MonthOverMonthCards";

// GAP-PAYROLL-RUNS-01: props are exact integer PAISE digit strings now
// (Rs 6,00,000.00 gross = "60000000"), not rupee floats.
const BASE_PROPS = {
  currentGrossMinor: "60000000",
  currentNetMinor: "55000000",
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
    const { container } = renderCards({ ...BASE_PROPS, previousGrossMinor: "0" });

    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    // Dividing by a real zero base is still meaningless -- no delta line,
    // same as before this fix.
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("↓");
  });
});

// GAP-PAYROLL-RUNS-01: deltas and the net/gross ratio are computed on the
// integer paise (BigInt), rounded half-up to one decimal, never on rupee floats.
describe("MonthOverMonthCards — exact paise arithmetic", () => {
  it("shows the net-to-gross ratio and a downward delta to one decimal", () => {
    const { container } = renderCards({ ...BASE_PROPS, previousGrossMinor: "66666667" });
    // 55,000,000 / 60,000,000 = 91.666... -> 91.7%
    expect(container.textContent).toContain("91.7%");
    // (60,000,000 - 66,666,667) / 66,666,667 = -10.0000...% -> "↓ 10.0%"
    expect(container.textContent).toContain("↓ 10.0% vs August 2026");
    expect(screen.getByText("₹6,66,666.67")).toBeInTheDocument();
  });

  it("renders the net-of-gross summary with exact money", () => {
    const { container } = renderCards({ ...BASE_PROPS, previousGrossMinor: "50000000" });
    expect(container.textContent).toContain("₹5,50,000.00");
    expect(container.textContent).toContain("₹6,00,000.00");
  });

  it("does not blur amounts above 2^53 paise into a float ratio", () => {
    const { container } = renderCards({
      ...BASE_PROPS,
      currentGrossMinor: "9007199254740993",
      currentNetMinor: "9007199254740993",
      previousGrossMinor: "9007199254740992",
    });
    expect(container.textContent).toContain("100.0%");
    expect(container.textContent).toContain("₹9,00,71,99,25,47,409.93");
  });

  it('shows "—" for an unknown current gross and never divides by it', () => {
    const { container } = renderCards({ ...BASE_PROPS, currentGrossMinor: null, previousGrossMinor: "50000000" });
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("%");
  });
});
