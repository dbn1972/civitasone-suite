import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const coaMock = vi.fn();
const requestsMock = vi.fn();
const settingsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getChartOfAccounts: () => coaMock(),
  getFinancePendingChangeRequests: () => requestsMock(),
  getFinanceSettings: () => settingsMock(),
}));
const rolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  getSessionUserId: () => "viewer-1",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import OpeningBalancesPage from "./page";

// The page renders the pending-approvals panel (a client component using next-intl).
const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const FY_ACTIVE = { code: "2026-27", label: "FY 2026-27", status: "active" };
const FY_CLOSED = { code: "2024-25", label: "FY 2024-25", status: "closed" };
const COA = {
  data: [
    { code: "1000", name: "Cash in hand", type: "asset", status: "active", currency: "INR", balanceDisplay: "0" },
    { code: "2000", name: "Payables", type: "liability", status: "active", currency: "INR", balanceDisplay: "0" },
  ],
  source: "api",
};
const ONE_BALANCE = {
  data: [
    { id: "ob1", accountCode: "1000", debitMinor: "500000", creditMinor: "0", narration: "Opening cash", enteredAt: "2026-04-01" },
  ],
  source: "api",
};

describe("OpeningBalancesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    coaMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["finance_admin"]);
    coaMock.mockResolvedValue(COA);
    requestsMock.mockReset();
    requestsMock.mockResolvedValue({ data: [], source: "api" });
    settingsMock.mockReset();
    settingsMock.mockResolvedValue({ data: { makerCheckerEnabled: true }, source: "api" });
  });

  it("prompts to choose a fiscal year when none is selected", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" });

    const ui = await OpeningBalancesPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose a fiscal year")).toBeInTheDocument();
  });

  it("renders opening balances for the selected fiscal year", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText(/1000/)).toBeInTheDocument();
  });

  it("renders an empty state when there are no opening balances for the fiscal year", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("No opening balances entered")).toBeInTheDocument();
  });

  // GAP-FINANCE-OPENING-BALANCES-02
  it("a failed fiscal-years read shows a retry state instead of an empty select", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" }).mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("We couldn't load fiscal years.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fiscal Year")).not.toBeInTheDocument();
  });

  it("a failed balances read shows retry, — cards, no empty-state copy and NO entry form", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("We couldn't load opening balances.")).toBeInTheDocument();
    expect(screen.queryByText("No opening balances entered")).not.toBeInTheDocument();
    expect(screen.queryByText(/Save Opening Balances/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBe(3);
  });

  // GAP-FINANCE-OPENING-BALANCES-03
  it("names the account beside its code in the saved-balances table", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("1000 — Cash in hand")).toBeInTheDocument();
  });

  it("offers the chart of accounts as suggestions in the entry form", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    const { container } = render(ui);

    expect(container.querySelectorAll("datalist option").length).toBe(2);
  });

  it("warns and falls back to free text when the chart of accounts fails to load", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);
    coaMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText(/chart of accounts could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText(/Save Opening Balances/)).toBeInTheDocument();
  });

  // GAP-FINANCE-OPENING-BALANCES-04
  it("shows the table but NOT the entry form to a read-only finance role", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("1000 — Cash in hand")).toBeInTheDocument();
    expect(screen.queryByText(/Save Opening Balances/)).not.toBeInTheDocument();
    expect(screen.getByText(/restricted to Finance Admins/)).toBeInTheDocument();
  });

  it("shows the entry form to finance_admin", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText(/Save Opening Balances/)).toBeInTheDocument();
  });

  // GAP-FINANCE-OPENING-BALANCES-06
  it("labels a closed fiscal year, warns and hides the entry form", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE, FY_CLOSED], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2024-25" } });
    render(ui);

    expect(screen.getByRole("option", { name: "FY 2024-25 (2024-25) — closed" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/closed/);
    expect(screen.queryByText(/Save Opening Balances/)).not.toBeInTheDocument();
  });

  it("leaves an active fiscal year unchanged (form shown, no warning)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE, FY_CLOSED], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByRole("option", { name: "FY 2026-27 (2026-27) — active" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/Save Opening Balances/)).toBeInTheDocument();
  });

  // GAP-FINANCE-OPENING-BALANCES-01
  it("lists opening-balance batches waiting for a second officer, with Approve / Reject for a different admin", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);
    requestsMock.mockResolvedValue({
      data: [{
        id: "r1", kind: "opening_balances_enter", subjectKey: "2026-27",
        payload: { entries: [{ debitMinor: "500000", creditMinor: "0" }, { debitMinor: "0", creditMinor: "500000" }] },
        reason: "Per audited TB 31-03", status: "pending", requestedBy: "someone-else", requestedAt: "2026-04-01T10:00:00.000Z",
        decidedBy: null, decidedAt: null, decisionNote: null, version: 1,
      }],
      source: "api",
    });
    render(await OpeningBalancesPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText(/Opening balances for: 2026-27/)).toBeInTheDocument();
    expect(screen.getByText(/2 entries, total debit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("a failed pending-approvals read shows a retry state, not 'nothing waiting'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [FY_ACTIVE], source: "api" }).mockResolvedValueOnce(ONE_BALANCE);
    requestsMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await OpeningBalancesPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.queryByText("No changes are waiting for approval.")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry|refresh/i }).length).toBeGreaterThan(0);
  });
});
