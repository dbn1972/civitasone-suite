import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
const rolesMock = vi.fn(() => ["finance_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock(), getSessionUserId: () => "viewer-1" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import FinanceConfigPage from "./page";

// The bank table and policy panel are client components using next-intl.
const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const SETTINGS = { makerCheckerEnabled: true, blockFyActivationOpenPeriods: true, requireOpeningBalancesForActivation: false, fyCreateAsDraft: true, debtLoanLiabilityHeadId: null, debtInterestExpenseHeadId: null, debtBankHeadId: null, updatedAt: null };

const FY = { id: "f1", code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" };
const BANK = { id: "b1", bankName: "State Bank of India", branchName: "Sansad Marg", accountNoLast4: "1234", ifscPrefix: "SBINXXXXXXX", accountType: "current", purpose: null, status: "active" };

function respond(fy: unknown, bank: unknown, settings: unknown = { data: SETTINGS, source: "api" }) {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (String(url).includes("bank-accounts")) return bank;
    if (String(url).includes("finance/settings")) return settings;
    if (String(url).includes("change-requests")) return { data: [], source: "api" };
    if (String(url).includes("finance/accounts")) return { data: [{ id: "h-bank", code: "1100", name: "Bank", type: "asset", currency: "INR", balanceDisplay: "0", status: "active" }], source: "api" };
    return fy;
  });
}

describe("FinanceConfigPage (GAP-FINANCE-CONFIG-01/-02)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); rolesMock.mockReturnValue(["finance_admin"]); });

  it("never instructs the user to call the API; links to the real screens", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    const { container } = render(await FinanceConfigPage());
    expect(container.textContent).not.toMatch(/POST \/v1|Use the API|coming soon/i);
    expect(screen.getByRole("link", { name: "Manage fiscal years" })).toHaveAttribute("href", "/finance/fiscal-years");
    expect(screen.getByRole("link", { name: "Enter opening balances" })).toHaveAttribute("href", "/finance/opening-balances?fy=2026-27");
  });

  it("shows only the masked account number", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("•••• 1234")).toBeInTheDocument();
  });

  it("offers the add-bank form to finance_admin, not to other finance roles", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByRole("button", { name: "Add bank account" })).toBeInTheDocument();
  });

  it("an audit_officer (bank list 403) still sees fiscal years, and no add-bank form", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    respond({ data: [FY], source: "api" }, { data: [], source: "error", status: 403 });
    render(await FinanceConfigPage());
    expect(screen.getAllByText("2026-27").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add bank account" })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-CONFIG-03 (already implemented on main; pinned here)
  it("on a failed load the stat cards read a dash, not 'Not set' or 0", async () => {
    respond({ data: [], source: "error", status: 500 }, { data: [], source: "error", status: 500 });
    render(await FinanceConfigPage());
    expect(screen.getByText("Active FY").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Bank Accounts", { selector: ".lab" }).closest(".stat")).toHaveTextContent("—");
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });

  it("a successful load with no active year still says 'Not set'", async () => {
    respond({ data: [{ ...FY, status: "draft" }], source: "api" }, { data: [], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("Active FY").closest(".stat")).toHaveTextContent("Not set");
  });

  // GAP-FINANCE-CONFIG-04
  it("renders financial-year dates in the Indian format, not the raw ISO string", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("01 Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("31 Mar 2027")).toBeInTheDocument();
    expect(screen.queryByText("2026-04-01")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-CONFIG-06
  it("keeps the Opening Balances card visible without an active year, disabled with a hint", async () => {
    respond({ data: [{ ...FY, status: "draft" }], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("Opening Balances")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter opening balances" })).not.toBeInTheDocument();
    expect(screen.getByText(/Activate a financial year first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter opening balances" })).toBeDisabled();
  });

  // GAP-FINANCE-CONFIG-02: audited reveal
  it("a finance admin gets a Reveal control with a reason prompt; the full number appears only after the audited call, and hides again", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "b1", accountNo: "123456789012", ifsc: "SBIN0001234" }), { status: 200 }),
    );
    render(await FinanceConfigPage());
    expect(screen.queryByText("123456789012")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    const confirm = await screen.findByRole("button", { name: "Reveal number" });
    expect(confirm).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Why do you need the full number?"), { target: { value: "Quarterly confirmation with the bank" } });
    fireEvent.click(confirm);
    expect(await screen.findByTestId("revealed-account")).toHaveTextContent("123456789012");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/bank-accounts/b1/reveal");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Quarterly confirmation with the bank" });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("123456789012")).not.toBeInTheDocument();
    expect(screen.getByText("•••• 1234")).toBeInTheDocument();
  });

  it("a failed reveal shows a plain message and never the number", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INTERNAL" }), { status: 500 }));
    render(await FinanceConfigPage());
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText("Why do you need the full number?"), { target: { value: "Quarterly confirmation with the bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal number" }));
    await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeInTheDocument());
    expect(screen.queryByTestId("revealed-account")).not.toBeInTheDocument();
  });

  it("no Reveal control for a role that cannot read bank accounts at all", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("•••• 1234")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  // fp-finance-01: policy settings
  it("shows the policy settings to a finance admin only", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("Finance policy settings")).toBeInTheDocument();
    expect(screen.getByLabelText(/Second approver for ledger-shaping changes/)).toBeChecked();
    cleanup();
    rolesMock.mockReturnValue(["audit_officer"]);
    render(await FinanceConfigPage());
    expect(screen.queryByText("Finance policy settings")).not.toBeInTheDocument();
  });

  it("a failed settings read is its own error state, not default-looking switches", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" }, { data: null, source: "error", status: 500 });
    render(await FinanceConfigPage());
    expect(screen.getByText("Finance policy settings")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Second approver for ledger-shaping changes/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry|refresh/i }).length).toBeGreaterThan(0);
  });
});
