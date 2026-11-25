import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const getRp = vi.hoisted(() => vi.fn());
const getIe = vi.hoisted(() => vi.fn());
const getBs = vi.hoisted(() => vi.fn());
vi.mock("./statementSet", async (orig) => ({
  ...(await orig<typeof import("./statementSet")>()),
  getReceiptsPayments: (...a: unknown[]) => getRp(...a),
  getIncomeExpenditure: (...a: unknown[]) => getIe(...a),
  getBalanceSheet: (...a: unknown[]) => getBs(...a),
}));
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));
vi.mock("../../_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("../../_components/PrintHeader", () => ({ PrintHeader: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import StatementSetPage from "./page";
import { mapBalanceSheet, mapIncomeExpenditure, mapReceiptsPayments, minorOrNull } from "./statementSet";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const RP = mapReceiptsPayments({
  fiscalYear: "2026-27",
  data: [{ bank_or_cash: "bank", total_receipts: "500000", total_payments: "200000", closing_balance: "300000" }],
});
const IE = mapIncomeExpenditure({
  fiscalYear: "2026-27", periodStart: "2026-04-01", periodEnd: "2027-03-31",
  income: [{ code: "4100", name: "Property Tax", classification: "income", balanceMinor: "900000" }],
  expenditure: [{ code: "5100", name: "Salaries", classification: "expense", balanceMinor: "400000" }],
  totalIncomeMinor: "900000", totalExpenditureMinor: "400000", surplusDeficitMinor: "500000", result: "surplus",
});
const BS = mapBalanceSheet({
  fiscalYear: "2026-27", asOf: "2027-03-31",
  assets: [{ code: "1100", name: "Bank", classification: "asset", balanceMinor: "1500000" }],
  liabilities: [{ code: "2100", name: "Creditors", classification: "liability", balanceMinor: "1000000" }],
  equity: [],
  surplusDeficitMinor: "500000",
  totals: {
    totalAssetsMinor: "1500000", totalLiabilitiesMinor: "1000000", totalEquityMinor: "0",
    accumulatedFundsMinor: "500000", totalLiabilitiesAndEquityMinor: "1500000",
  },
  balanceCheck: { balanced: true, differenceMinor: "0", equation: "x" },
});

const ok = (data: unknown) => ({ source: "api", data });

describe("StatementSetPage", () => {
  beforeEach(() => {
    getRp.mockReset(); getIe.mockReset(); getBs.mockReset();
    getRp.mockResolvedValue(ok(RP)); getIe.mockResolvedValue(ok(IE)); getBs.mockResolvedValue(ok(BS));
  });

  it("passes the chosen fiscal year to all three statements and renders each", async () => {
    render(await StatementSetPage({ searchParams: Promise.resolve({ fy: "2025-26" }) }));
    expect(getRp).toHaveBeenCalledWith("2025-26");
    expect(getIe).toHaveBeenCalledWith("2025-26");
    expect(getBs).toHaveBeenCalledWith("2025-26");
    expect(screen.getByRole("heading", { name: "Receipts & Payments Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Income & Expenditure Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Balance Sheet" })).toBeInTheDocument();
    expect(screen.getByText("Property Tax", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });

  it("ignores a malformed fy and falls back to the current year", async () => {
    render(await StatementSetPage({ searchParams: Promise.resolve({ fy: "x;drop" }) }));
    expect(getBs.mock.calls[0]![0]).toMatch(/^\d{4}-\d{2}$/);
  });

  it("one failed statement shows its own error and leaves the others", async () => {
    getBs.mockResolvedValue({ source: "error", data: null, status: 500 });
    render(await StatementSetPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Income & Expenditure Account" })).toBeInTheDocument();
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBe(1);
  });

  it("an unbalanced sheet is flagged, never shown as Balanced", async () => {
    getBs.mockResolvedValue(ok({ ...BS!, balanced: false, differenceMinor: "100" }));
    render(await StatementSetPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Unbalanced")).toBeInTheDocument();
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
  });
});

describe("statement mappers", () => {
  it("unreadable money is null, not zero", () => {
    expect(minorOrNull("12.5")).toBeNull();
    expect(minorOrNull(undefined)).toBeNull();
    expect(minorOrNull("-100")).toBe("-100");
    expect(minorOrNull(250)).toBe("250");
  });
  it("rejects a non-statement payload", () => {
    expect(mapBalanceSheet({})).toBeNull();
    expect(mapIncomeExpenditure(null)).toBeNull();
    expect(mapReceiptsPayments({ fiscalYear: "2026-27" })).toBeNull();
  });
});

describe("financeStatementSet i18n parity", () => {
  it("hi has exactly the en keys", () => {
    const en = Object.keys((enMessages as unknown as Record<string, Record<string, string>>).financeStatementSet).sort();
    const hi = Object.keys((hiMessages as unknown as Record<string, Record<string, string>>).financeStatementSet).sort();
    expect(hi).toEqual(en);
  });
});
