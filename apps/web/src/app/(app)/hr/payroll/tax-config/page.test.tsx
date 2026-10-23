import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

// GAP2-PAYROLL-TAX-CONFIG-01 / -02: the Tax Configuration screen no longer
// renders hard-coded ₹-slab literals. It fetches the tenant's EFFECTIVE
// slab config for the selected FY and renders the fetched slabs/limits/
// surcharge bands through formatMoney, with an FY selector and an error
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
    // The seeded open-ended top slab (₹30,00,000) is rendered via formatMoney.
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

// ── GAP-PAYROLL-TAX-CONFIG-03: surcharge tiers for both regimes ──────────────
// Mirrors the platform seed (migration 0012): the OLD regime tops out at 37% above
// ₹5Cr while the NEW regime is capped at 25%.
const SEED_BANDS_NEW = [
  { above: 5000000, ratePct: 10 }, { above: 10000000, ratePct: 15 },
  { above: 20000000, ratePct: 25 }, { above: 50000000, ratePct: 25 },
];
const SEED_BANDS_OLD = [
  { above: 5000000, ratePct: 10 }, { above: 10000000, ratePct: 15 },
  { above: 20000000, ratePct: 25 }, { above: 50000000, ratePct: 37 },
];
const withBands = (newBands: unknown, oldBands: unknown) => ({
  ...SEEDED,
  new: SEEDED.new && { ...SEEDED.new, surchargeBands: newBands },
  old: SEEDED.old && { ...SEEDED.old, surchargeBands: oldBands },
});
const rowCells = (label: string) =>
  Array.from(screen.getByText(label).closest("tr")!.querySelectorAll("td")).map((td) => td.textContent);

describe("TaxConfigPage surcharge tiers (GAP-PAYROLL-TAX-CONFIG-03)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("shows all four configured tiers for both regimes, including the old regime's 37% above ₹5Cr next to the new regime's 25%", async () => {
    fetchJsonMock.mockResolvedValue({ data: withBands(SEED_BANDS_NEW, SEED_BANDS_OLD), source: "api" });
    renderPage(await TaxConfigPage({ searchParams: { fy: "2025-26" } }));
    expect(screen.getByRole("columnheader", { name: "New regime" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Old regime" })).toBeInTheDocument();
    expect(rowCells("Above ₹50,00,000.00")).toEqual(["Above ₹50,00,000.00", "10%", "10%"]);
    expect(rowCells("Above ₹1,00,00,000.00")).toEqual(["Above ₹1,00,00,000.00", "15%", "15%"]);
    expect(rowCells("Above ₹2,00,00,000.00")).toEqual(["Above ₹2,00,00,000.00", "25%", "25%"]);
    expect(rowCells("Above ₹5,00,00,000.00")).toEqual(["Above ₹5,00,00,000.00", "25%", "37%"]);
  });

  it("states the new regime's highest configured rate (the cap) from the fetched bands, not a hard-coded 25%", async () => {
    fetchJsonMock.mockResolvedValue({ data: withBands(SEED_BANDS_NEW, SEED_BANDS_OLD), source: "api" });
    renderPage(await TaxConfigPage({ searchParams: { fy: "2025-26" } }));
    expect(screen.getByText("New regime: the highest surcharge rate configured is 25%, so surcharge under the new regime never exceeds that rate.")).toBeInTheDocument();
  });

  it("the cap note follows a tenant override (30% top band) rather than a literal", async () => {
    fetchJsonMock.mockResolvedValue({ data: withBands([{ above: 5000000, ratePct: 10 }, { above: 10000000, ratePct: 30 }], SEED_BANDS_OLD), source: "api" });
    renderPage(await TaxConfigPage({ searchParams: { fy: "2025-26" } }));
    expect(screen.getByText(/the highest surcharge rate configured is 30%/)).toBeInTheDocument();
    expect(screen.queryByText(/is 25%/)).not.toBeInTheDocument();
  });

  it("notes that marginal relief applies at every surcharge threshold (the engine behaviour)", async () => {
    fetchJsonMock.mockResolvedValue({ data: withBands(SEED_BANDS_NEW, SEED_BANDS_OLD), source: "api" });
    renderPage(await TaxConfigPage({ searchParams: { fy: "2025-26" } }));
    expect(screen.getByText(/Marginal relief applies at every surcharge threshold: tax plus surcharge never exceeds the tax at the threshold plus the income above it\./)).toBeInTheDocument();
  });

  it("a threshold that only one regime has carries the other regime's rate in force there (not a blank or nil)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: withBands(
        [{ above: 5000000, ratePct: 10 }, { above: 10000000, ratePct: 15 }],
        [{ above: 5000000, ratePct: 10 }, { above: 20000000, ratePct: 25 }],
      ),
      source: "api",
    });
    renderPage(await TaxConfigPage({ searchParams: { fy: "2025-26" } }));
    expect(rowCells("Above ₹1,00,00,000.00")).toEqual(["Above ₹1,00,00,000.00", "15%", "10%"]);
    expect(rowCells("Above ₹2,00,00,000.00")).toEqual(["Above ₹2,00,00,000.00", "15%", "25%"]);
  });

  it("a regime with no configuration shows — in its column; the other regime's tiers still show", async () => {
    fetchJsonMock.mockResolvedValue({ data: { ...withBands(SEED_BANDS_NEW, SEED_BANDS_OLD), old: null }, source: "api" });
    renderPage(await TaxConfigPage({ searchParams: { fy: "2025-26" } }));
    expect(rowCells("Above ₹5,00,00,000.00")).toEqual(["Above ₹5,00,00,000.00", "25%", "—"]);
  });

  it("with nothing configured there is no tier table and no surcharge notes", async () => {
    fetchJsonMock.mockResolvedValue({ data: { fy: "2099-00", new: null, old: null }, source: "api" });
    renderPage(await TaxConfigPage({ searchParams: { fy: "2099-00" } }));
    expect(screen.queryByText(/Marginal relief applies/)).not.toBeInTheDocument();
    expect(screen.queryByText(/highest surcharge rate configured/)).not.toBeInTheDocument();
  });
});

// ── GAP-PAYROLL-TAX-CONFIG-04: a read-only reference, named and worded as one ─
describe("TaxConfigPage is an informational reference, not a configuration screen (GAP-PAYROLL-TAX-CONFIG-04)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("is titled a reference, says it is read-only, and offers nothing to edit or save", async () => {
    fetchJsonMock.mockResolvedValue({ data: withBands(SEED_BANDS_NEW, SEED_BANDS_OLD), source: "api" });
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>{await TaxConfigPage({ searchParams: { fy: "2025-26" } })}</NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Income Tax Reference");
    expect(screen.getByText(/This page is a read-only reference and does not change any rate or limit\./)).toBeInTheDocument();
    // the only control is the financial-year view form
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["View"]);
    expect(container.querySelectorAll("input, textarea").length).toBe(0);
    expect(container.textContent).not.toMatch(/\b(edit|save|update|modify|configure)\b/i);
  });

  it("the HR hub tile and the loading/error copy do not read as an editable configuration (en + hi)", () => {
    expect(enMessages.hr.taxConfig).toBe("Tax Reference");
    expect(enMessages.hr.taxConfigDesc).toMatch(/read-only/i);
    expect(enMessages.payrollTaxConfig.title).toBe("Income Tax Reference");
    expect(enMessages.payrollTaxConfig.loadingTitle).toBe("Tax Reference");
    expect(JSON.stringify([enMessages.hr.taxConfig, enMessages.hr.taxConfigDesc, enMessages.payrollTaxConfig.title, enMessages.payrollTaxConfig.loadingTitle, enMessages.payrollTaxConfig.loadingSubtitle]))
      .not.toMatch(/config/i);
    expect(hiMessages.hr.taxConfig).not.toMatch(/कॉन्फ़िग/);
    expect(hiMessages.payrollTaxConfig.title).not.toMatch(/कॉन्फ़िग/);
    expect(hiMessages.payrollTaxConfig.loadingTitle).not.toMatch(/कॉन्फ़िग/);
  });
});
