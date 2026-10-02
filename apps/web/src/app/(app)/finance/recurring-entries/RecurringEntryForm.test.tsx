import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RecurringEntryForm } from "./RecurringEntryForm";

const FUTURE = "2099-01-01";
const accounts = [
  { id: "acc-1", code: "1000", name: "Cash" },
  { id: "acc-2", code: "5000", name: "Office Expense" },
];

describe("RecurringEntryForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a name, amount, and next run date before opening the confirm dialog", () => {
    render(<RecurringEntryForm accounts={accounts} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Recurring Entry" }));
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
  });

  it("creates a recurring entry on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-entry-1", name: "Rent", is_active: true }), { status: 201 }),
    );

    render(<RecurringEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/^Next Run Date/), { target: { value: FUTURE } });

    fireEvent.click(screen.getByRole("button", { name: "Create Recurring Entry" }));

    await waitFor(() => expect(screen.getByText("Create this recurring entry?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create entry"));

    await waitFor(() => {
      expect(screen.getByText(/Recurring entry/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RecurringEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/^Next Run Date/), { target: { value: FUTURE } });

    fireEvent.click(screen.getByRole("button", { name: "Create Recurring Entry" }));
    await waitFor(() => expect(screen.getByText("Create this recurring entry?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create entry"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  function fillAndOpenConfirm(over: { amount?: string } = {}) {
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: over.amount ?? "1,20,000" } });
    fireEvent.change(screen.getByLabelText(/^Next Run Date/), { target: { value: FUTURE } });
    fireEvent.click(screen.getByRole("button", { name: "Create Recurring Entry" }));
  }

  // GAP-FINANCE-RECURRING-ENTRIES-05: lakh-formatted input is paise-exact, no parseFloat.
  it("posts amountMinor 12000000 for '1,20,000' and shows a rupee preview + the amount in the confirm dialog", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x", name: "Rent" }), { status: 202 }));
    render(<RecurringEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1,20,000" } });
    expect(screen.getByText("₹1,20,000.00")).toBeInTheDocument();
    fillAndOpenConfirm();
    await waitFor(() => expect(screen.getByText("Create this recurring entry?")).toBeInTheDocument());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("₹1,20,000.00");
    expect(dialog.textContent).toMatch(/Next run/);
    expect(dialog.textContent).toMatch(/No end date/);
    // no runner posts these journals, so the dialog must not claim automatic posting
    expect(dialog.textContent).toMatch(/records the schedule only/);
    expect(dialog.textContent).not.toMatch(/generated automatically/);
    fireEvent.click(screen.getByText("Create entry"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.amountMinor).toBe(12000000);
    expect(body.voucherType).toBe("journal");
  });

  it.each(["1.005", "12abc", "0", "-5", "abc"])("rejects amount %s with a specific message and no dialog", (bad) => {
    render(<RecurringEntryForm accounts={accounts} />);
    fillAndOpenConfirm({ amount: bad });
    expect(screen.getByText(/Enter a valid amount like 1,20,000\.50/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Amount/)).toHaveFocus();
    expect(screen.queryByText("Create this recurring entry?")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-RECURRING-ENTRIES-06
  it("rejects a next-run date in the past and focuses the field", () => {
    render(<RecurringEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/^Next Run Date/), { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Recurring Entry" }));
    expect(screen.getByText("Next run date cannot be in the past.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Next Run Date/)).toHaveFocus();
  });

  it("rejects an end date earlier than the next run", () => {
    render(<RecurringEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/^Next Run Date/), { target: { value: "2099-06-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2099-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Recurring Entry" }));
    expect(screen.getByText("End date cannot be before the next run date.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^End Date/)).toHaveFocus();
  });

  it("sets min on the date inputs", () => {
    render(<RecurringEntryForm accounts={accounts} />);
    expect(screen.getByLabelText(/^Next Run Date/)).toHaveAttribute("min");
    expect(screen.getByLabelText(/^End Date/)).toHaveAttribute("min");
  });

  // GAP-FINANCE-RECURRING-ENTRIES-04
  it("Voucher Type is a closed dropdown defaulting to Journal", () => {
    render(<RecurringEntryForm accounts={accounts} />);
    const select = screen.getByLabelText("Voucher Type") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("journal");
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Credit Note");
    // the cashbook CHECK rejects "transfer", so it is not offered
    expect(labels).not.toContain("Transfer");
  });

  // GAP-FINANCE-RECURRING-ENTRIES-03
  it("with no accounts shows guidance with a link to Chart of Accounts and disables Create", () => {
    render(<RecurringEntryForm accounts={[]} />);
    expect(screen.getByText(/No accounts defined/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chart of Accounts" })).toHaveAttribute("href", "/finance/chart-of-accounts");
    expect(screen.getByRole("button", { name: "Create Recurring Entry" })).toBeDisabled();
  });

  it("when the accounts fetch failed shows a retryable error and disables Create", () => {
    render(<RecurringEntryForm accounts={[]} accountsError />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/No accounts defined/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Recurring Entry" })).toBeDisabled();
  });
});
