import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { FinanceSettingsPanel, changedFlags, relaxesControl } from "./FinanceSettingsPanel";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const SETTINGS = { makerCheckerEnabled: true, blockFyActivationOpenPeriods: true, requireOpeningBalancesForActivation: false, fyCreateAsDraft: true, debtLoanLiabilityHeadId: null, debtInterestExpenseHeadId: null, debtBankHeadId: null, updatedAt: null };
const HEADS = [
  { id: "h-loan", code: "8443", name: "Loans payable", type: "liability" },
  { id: "h-int", code: "3054", name: "Interest paid", type: "expense" },
  { id: "h-bank", code: "1100", name: "Bank", type: "asset" },
  { id: "h-cash", code: "1000", name: "Cash", type: "asset" },
];

describe("changedFlags", () => {
  it("lists only the flags that differ", () => {
    expect(changedFlags(SETTINGS, { ...SETTINGS })).toEqual({});
    expect(changedFlags(SETTINGS, { ...SETTINGS, makerCheckerEnabled: false, fyCreateAsDraft: true })).toEqual({ makerCheckerEnabled: false });
  });
});

describe("relaxesControl", () => {
  it("only switching a protective control from on to off relaxes it", () => {
    expect(relaxesControl(SETTINGS, { makerCheckerEnabled: false })).toBe(true);
    expect(relaxesControl(SETTINGS, { blockFyActivationOpenPeriods: false })).toBe(true);
    expect(relaxesControl(SETTINGS, { requireOpeningBalancesForActivation: true })).toBe(false);
    expect(relaxesControl(SETTINGS, { fyCreateAsDraft: false })).toBe(false);
    expect(relaxesControl({ ...SETTINGS, makerCheckerEnabled: false }, { makerCheckerEnabled: false })).toBe(false);
  });
});

describe("FinanceSettingsPanel", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("shows the four switches at their saved values; Save is disabled until something changes", () => {
    render(<FinanceSettingsPanel settings={SETTINGS} heads={HEADS} />);
    expect(screen.getByLabelText(/Second approver for ledger-shaping changes/)).toBeChecked();
    expect(screen.getByLabelText(/Block fiscal-year activation while periods are open/)).toBeChecked();
    expect(screen.getByLabelText(/Require opening balances before activating a year/)).not.toBeChecked();
    expect(screen.getByLabelText(/Create new fiscal years as drafts/)).toBeChecked();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });

  it("changing a switch needs a reason (10+ chars) and PUTs only the changed flag with it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    render(<FinanceSettingsPanel settings={SETTINGS} heads={HEADS} />);
    fireEvent.click(screen.getByLabelText(/Require opening balances before activating a year/));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const confirm = (await screen.findAllByRole("button", { name: "Save settings" })).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Rule agreed with the CFO" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ requireOpeningBalancesForActivation: true, reason: "Rule agreed with the CFO" });
    expect(await screen.findByText(/Settings saved/)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("turning the second-approver rule off is styled as a danger confirmation", async () => {
    render(<FinanceSettingsPanel settings={SETTINGS} heads={HEADS} />);
    fireEvent.click(screen.getByLabelText(/Second approver for ledger-shaping changes/));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(/switching a protective control OFF/)).toBeInTheDocument();
  });

  it("a failed save keeps the dialog open with a plain message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INTERNAL" }), { status: 500 }));
    render(<FinanceSettingsPanel settings={SETTINGS} heads={HEADS} />);
    fireEvent.click(screen.getByLabelText(/Create new fiscal years as drafts/));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    fireEvent.change(await screen.findByLabelText("Reason for this change"), { target: { value: "Rule agreed with the CFO" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Save settings" })).at(-1)!);
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("switching a control OFF says it is held for a different admin, and the saved message says submitted (the control stays on)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "pending_approval", id: "r1" }), { status: 202 }));
    render(<FinanceSettingsPanel settings={SETTINGS} heads={HEADS} />);
    fireEvent.click(screen.getByLabelText(/Second approver for ledger-shaping changes/));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(/held until a DIFFERENT finance administrator approves it/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Single officer office" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Save settings" })).at(-1)!);
    expect(await screen.findByText(/takes effect only when a different finance administrator approves it/)).toBeInTheDocument();
  });

  it("debt GL heads: each select offers only heads of the right type; all three are needed together; no defaults", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    render(<FinanceSettingsPanel settings={SETTINGS} heads={HEADS} />);
    const loan = screen.getByLabelText("Loan liability head (liability)") as HTMLSelectElement;
    const bank = screen.getByLabelText("Bank head (asset)") as HTMLSelectElement;
    expect(loan.value).toBe("");
    expect([...loan.options].map((o) => o.value)).toEqual(["", "h-loan"]);
    expect([...bank.options].map((o) => o.value)).toEqual(["", "h-bank", "h-cash"]);
    fireEvent.change(loan, { target: { value: "h-loan" } });
    expect(screen.getByText("Set all three heads together, or leave all three unset.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Interest expense head (expense)"), { target: { value: "h-int" } });
    fireEvent.change(bank, { target: { value: "h-bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    fireEvent.change(await screen.findByLabelText("Reason for this change"), { target: { value: "Configure debt heads" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Save settings" })).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({
      debtLoanLiabilityHeadId: "h-loan", debtInterestExpenseHeadId: "h-int", debtBankHeadId: "h-bank", reason: "Configure debt heads",
    });
  });

  it("a chart that failed to load disables the selects with a visible message", () => {
    render(<FinanceSettingsPanel settings={SETTINGS} heads={null} />);
    expect(screen.getByText(/chart of accounts could not be loaded/)).toBeInTheDocument();
    expect(screen.getByLabelText("Bank head (asset)")).toBeDisabled();
  });
});
