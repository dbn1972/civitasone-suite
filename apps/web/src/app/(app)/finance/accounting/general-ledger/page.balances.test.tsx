import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const getPage = vi.hoisted(() => vi.fn());
const getAccounts = vi.hoisted(() => vi.fn());
const getBalances = vi.hoisted(() => vi.fn());
vi.mock("../../../../_data/loaders", () => ({
  getFinanceGLPage: (...a: unknown[]) => getPage(...a),
  getChartOfAccounts: (...a: unknown[]) => getAccounts(...a),
}));
vi.mock("./ledgerBalancesLoader", () => ({ getLedgerBalances: (...a: unknown[]) => getBalances(...a) }));
vi.mock("./GLTable", () => ({ GLTable: () => <div>gl-table</div> }));
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));
vi.mock("../../_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("../../_components/PrintHeader", () => ({ PrintHeader: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import GeneralLedgerPage from "./page";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const OK = { source: "api", data: { entries: [], pagination: { limit: 25, offset: 0, total: 0, hasMore: false }, totals: null } };
const DEPOSIT = {
  fiscalYear: "2026-27",
  head: { id: "u-1", code: "8443", name: "Civil Deposits", nature: "liability", carryForward: true },
  openingMinor: "-500000", closingMinor: "-650000",
  periods: [
    { period: "2026-04", openingMinor: "-500000", debitMinor: "100000", creditMinor: "250000", closingMinor: "-650000" },
    { period: "2026-05", openingMinor: "-650000", debitMinor: "0", creditMinor: "0", closingMinor: "-650000" },
  ],
};
const EXPENSE = {
  ...DEPOSIT,
  head: { id: "u-2", code: "2202", name: "General Education", nature: "expense", carryForward: false },
  openingMinor: "0", closingMinor: "300000",
  periods: [{ period: "2026-04", openingMinor: "0", debitMinor: "300000", creditMinor: "0", closingMinor: "300000" }],
};

describe("GeneralLedgerPage -- one head opening / closing (fx-p3)", () => {
  beforeEach(() => {
    getPage.mockReset(); getPage.mockResolvedValue(OK);
    getAccounts.mockReset(); getAccounts.mockResolvedValue({ source: "api", data: [
      { id: "u-1", code: "8443", name: "Civil Deposits", type: "liability", currency: "INR", balanceDisplay: "0", status: "active" },
      { id: "u-2", code: "2202", name: "General Education", type: "expense", currency: "INR", balanceDisplay: "0", status: "active" },
    ] });
    getBalances.mockReset();
  });

  it("without a head, offers a labelled head picker and does not fetch balances", async () => {
    render(await GeneralLedgerPage({ searchParams: Promise.resolve({ fy: "2026-27" }) }));
    const picker = screen.getByLabelText("Opening and closing balances for one head") as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.value)).toEqual(["", "8443", "2202"]);
    expect(getBalances).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show balances" })).toBeInTheDocument();
  });

  it("with a head, fetches that head for the FY and shows Opening / Debit / Credit / Closing with Dr/Cr", async () => {
    getBalances.mockResolvedValue({ source: "api", data: DEPOSIT });
    render(await GeneralLedgerPage({ searchParams: Promise.resolve({ fy: "2026-27", head: "8443" }) }));
    expect(getBalances).toHaveBeenCalledWith("8443", "2026-27");
    const table = screen.getByRole("table");
    expect(table.querySelector("caption")?.textContent).toMatch(/8443 · Civil Deposits for FY 2026-27/);
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual(["Month", "Opening", "Debit", "Credit", "Closing"]);
    const april = screen.getByText("2026-04").closest("tr")!;
    expect(Array.from(april.querySelectorAll("td")).map((c) => c.textContent)).toEqual(["2026-04", "₹5,000.00 Cr", "₹1,000.00", "₹2,500.00", "₹6,500.00 Cr"]);
    expect(screen.getByText("Opening balance ₹5,000.00 Cr · Closing balance ₹6,500.00 Cr")).toBeInTheDocument();
    expect(screen.queryByText(/starts the year at zero/)).not.toBeInTheDocument();
    expect((screen.getByLabelText("Opening and closing balances for one head") as HTMLSelectElement).value).toBe("8443");
  });

  it("a revenue / expenditure head gets the starts-the-year-at-zero note", async () => {
    getBalances.mockResolvedValue({ source: "api", data: EXPENSE });
    render(await GeneralLedgerPage({ searchParams: Promise.resolve({ fy: "2026-27", head: "2202" }) }));
    expect(screen.getByRole("note")).toHaveTextContent("starts the year at zero");
    const april = screen.getByText("2026-04").closest("tr")!;
    expect(april.querySelectorAll("td")[4]!.textContent).toBe("₹3,000.00 Dr");
  });

  it("a failed balances load is an error state and the ledger itself still renders", async () => {
    getBalances.mockResolvedValue({ source: "error", status: 503, data: null });
    render(await GeneralLedgerPage({ searchParams: Promise.resolve({ fy: "2026-27", head: "8443" }) }));
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.getByText("gl-table")).toBeInTheDocument();
  });

  it("a junk ?head= is ignored", async () => {
    render(await GeneralLedgerPage({ searchParams: Promise.resolve({ head: "../../etc" }) }));
    expect(getBalances).not.toHaveBeenCalled();
  });

  it("every label has a Hindi translation", () => {
    const en = (enMessages as unknown as Record<string, Record<string, string>>).financeLedgerBalances!;
    const hi = (hiMessages as unknown as Record<string, Record<string, string>>).financeLedgerBalances!;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
  });
});
