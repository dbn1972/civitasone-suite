import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import TaxConfigPage from "./page";

/** GAP-PAYROLL-TAX-CONFIG-03: surcharge tiers, new-regime cap, marginal relief, old-regime 87A. */
describe("TaxConfigPage surcharge reference", () => {
  it("lists all old-regime surcharge tiers incl. 37% above Rs 5 Cr, the new-regime cap and marginal relief", async () => {
    const ui = await TaxConfigPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText("₹50L – ₹1Cr")).toBeInTheDocument();
    expect(screen.getByText("₹1Cr – ₹2Cr")).toBeInTheDocument();
    expect(screen.getByText("₹2Cr – ₹5Cr")).toBeInTheDocument();
    expect(screen.getByText("Above ₹5Cr (old regime only)")).toBeInTheDocument();
    expect(screen.getByText("37%")).toBeInTheDocument();
    expect(screen.getByText(/capped at 25%/)).toBeInTheDocument();
    expect(screen.getByText(/Marginal relief applies/)).toBeInTheDocument();
    expect(screen.getByText(/Rebate u\/s 87A: up to ₹12,500/)).toBeInTheDocument();
  });

  it("shows the FY 2025-26 (AY 2026-27) new-regime slabs and the Rs 60,000 / Rs 12L 87A rebate (Finance Act 2025)", async () => {
    const ui = await TaxConfigPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText(/New Tax Regime — Default \(FY 2025-26, AY 2026-27\)/)).toBeInTheDocument();
    for (const row of ["Up to ₹4,00,000", "₹4,00,001 – ₹8,00,000", "₹8,00,001 – ₹12,00,000", "₹12,00,001 – ₹16,00,000", "₹16,00,001 – ₹20,00,000", "₹20,00,001 – ₹24,00,000", "Above ₹24,00,000"]) {
      expect(screen.getByText(row)).toBeInTheDocument();
    }
    expect(screen.queryByText("Above ₹15,00,000")).not.toBeInTheDocument();
    expect(screen.getByText(/up to ₹60,000 where taxable income is up to ₹12,00,000, with marginal relief/)).toBeInTheDocument();
  });
});
