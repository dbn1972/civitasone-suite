import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP2-PAYROLL-TAX-CONFIG-01 / -02: the Tax Configuration screen no longer
// renders hard-coded ₹-slab literals. It fetches the tenant's EFFECTIVE
// slab config for the selected FY and renders the fetched slabs/limits/
// surcharge bands through formatRupees, with an FY selector and an error
// state. These tests mock the loader and assert the rendered rows equal the
// API payload — the previous literal-asserting tests were pinning the exact
// behaviour this HIGH item removes, so they are replaced here (SOLO: align a
// test to a deliberate contract change, citing the item).

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
// RefreshErrorState (shown in the error branch) is a client component that
// calls useRouter().refresh().
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import TaxConfigPage from "./page";

function renderPage(ui: React.ReactElement) {
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const SEEDED = {
  fy: "2025-26",
  new: {
    regime: "new",
    slabs: [
      { from: 0, to: 400000, ratePct: 0 },
      { from: 400000, to: 800000, ratePct: 5 },
      { from: 2000000, to: 3000000, ratePct: 25 },
      // A deliberately NON-default top-slab threshold (₹30,00,000), distinct
      // from the old hard-coded ₹24,00,000 literal.
      { from: 3000000, to: null, ratePct: 30 },
    ],
    stdDeduction: 75000,
    rebateIncomeCap: 1200000,
    rebateMax: 60000,
    surchargeBands: [
      { above: 5000000, ratePct: 10 },
      { above: 10000000, ratePct: 15 },
    ],
  },
  old: {
    regime: "old",
    slabs: [{ from: 0, to: 250000, ratePct: 0 }, { from: 250000, to: 500000, ratePct: 5 }],
    stdDeduction: 50000, rebateIncomeCap: 500000, rebateMax: 12500,
    surchargeBands: [{ above: 5000000, ratePct: 10 }],
  },
};

describe("TaxConfigPage (GAP2-PAYROLL-TAX-CONFIG-01)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("renders the FETCHED top-slab threshold (₹30,00,000), not the old hard-coded ₹24,00,000 literal", async () => {
    fetchJsonMock.mockResolvedValue({ data: SEEDED, source: "api" });
    const ui = await TaxConfigPage({ searchParams: { fy: "2025-26" } });
    renderPage(ui);
    // The seeded open-ended top slab (₹30,00,000) is rendered via formatRupees.
    expect(screen.getByText("Above ₹30,00,000.00")).toBeInTheDocument();
    // The previous hard-coded literal must NOT appear.
    expect(screen.queryByText("₹20,00,001 – ₹24,00,000")).not.toBeInTheDocument();
    expect(screen.queryByText(/Above ₹24,00,000/)).not.toBeInTheDocument();
  });

  it("requests the slab-config endpoint for the selected FY", async () => {
    fetchJsonMock.mockResolvedValue({ data: SEEDED, source: "api" });
    const ui = await TaxConfigPage({ searchParams: { fy: "2025-26" } });
    renderPage(ui);
    expect(fetchJsonMock).toHaveBeenCalled();
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("/api/v1/payroll/tax/slab-config?fy=2025-26");
  });

  it("renders the fetched surcharge bands and standard deduction", async () => {
    fetchJsonMock.mockResolvedValue({ data: SEEDED, source: "api" });
    const ui = await TaxConfigPage({ searchParams: { fy: "2025-26" } });
    renderPage(ui);
    expect(screen.getByText("Above ₹50,00,000.00")).toBeInTheDocument();
    expect(screen.getByText(/Standard deduction: ₹75,000\.00/)).toBeInTheDocument();
  });

  it("shows an error state when the loader reports an error", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });
    const ui = await TaxConfigPage({ searchParams: { fy: "2025-26" } });
    renderPage(ui);
    // No slab tables render on error.
    expect(screen.queryByText(/Above ₹/)).not.toBeInTheDocument();
    expect(screen.queryByText("Above ₹30,00,000.00")).not.toBeInTheDocument();
  });

  it("shows a 'not configured' message for a regime with no config", async () => {
    fetchJsonMock.mockResolvedValue({ data: { fy: "2099-00", new: null, old: null }, source: "api" });
    const ui = await TaxConfigPage({ searchParams: { fy: "2099-00" } });
    renderPage(ui);
    expect(screen.getAllByText(/No configuration on file/i).length).toBeGreaterThan(0);
  });
});
