import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { OpeningBalanceForm } from "./OpeningBalanceForm";

describe("OpeningBalanceForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires at least one account with a debit or credit amount", () => {
    render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" />);
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    expect(screen.getByText("Enter at least one account with a debit or credit amount.")).toBeInTheDocument();
  });

  it("saves opening balances on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "entered", count: 1 }), { status: 201 }),
    );

    render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" />);
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Account code, row 2"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Credit amount, row 2"), { target: { value: "5000" } });

    fireEvent.click(screen.getByText(/Save Opening Balances/));
    await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / approving authority"), { target: { value: "Per audited TB 31-03, approved by FA&CAO" } });
    fireEvent.click(screen.getByText("Save opening balances"));

    await waitFor(() => {
      expect(screen.getByText(/saved for 2026-27/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" />);
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Account code, row 2"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Credit amount, row 2"), { target: { value: "5000" } });

    fireEvent.click(screen.getByText(/Save Opening Balances/));
    await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / approving authority"), { target: { value: "Per audited TB 31-03, approved by FA&CAO" } });
    fireEvent.click(screen.getByText("Save opening balances"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-OPENING-BALANCES-01 + exact paise
  it("keeps Save disabled until a reason is given; POSTs reason and exact paise strings", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted", count: 2 }), { status: 202 }));
    render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" />);
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "90071992547409.93" } });
    fireEvent.change(screen.getByLabelText("Account code, row 2"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Credit amount, row 2"), { target: { value: "90071992547409.93" } });
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
    const save = screen.getByRole("button", { name: "Save opening balances" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason / approving authority"), { target: { value: "Migration per audited TB" } });
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.reason).toBe("Migration per audited TB");
    expect(body.entries[0].debitMinor).toBe("9007199254740993");
    expect(body.entries[1].creditMinor).toBe("9007199254740993");
  });

  it("rejects an amount with more than 2 decimals instead of rounding it", () => {
    render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" />);
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "1.005" } });
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    expect(screen.getByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(screen.queryByText("Save these opening balances?")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-OPENING-BALANCES-05
  it("reads lakh-grouped '48,62,400' as ₹48,62,400.00, not ₹48.00", () => {
    render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" />);
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "48,62,400" } });
    fireEvent.change(screen.getByLabelText("Account code, row 2"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Credit amount, row 2"), { target: { value: "10" } });
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("₹48,62,400.00");
    expect(alert).not.toHaveTextContent("Total debits (₹48.00)");
  });

  it("rejects 12abc with an example amount instead of reading it as 12", () => {
    render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" />);
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "12abc" } });
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    expect(screen.getByRole("alert")).toHaveTextContent(/48,62,400\.00/);
  });

  // GAP-FINANCE-OPENING-BALANCES-03
  describe("chart-of-accounts validation", () => {
    const accounts = [
      { code: "1000", name: "Cash in hand", status: "active" as const },
      { code: "2000", name: "Payables", status: "active" as const },
    ];

    it("blocks the confirm dialog with an inline error for an unknown code", () => {
      render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" accounts={accounts} />);
      fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "9X99" } });
      fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "100" } });
      fireEvent.click(screen.getByText(/Save Opening Balances/));
      expect(screen.getByRole("alert")).toHaveTextContent(/9X99.*not in the chart of accounts/);
      expect(screen.getByLabelText("Account code, row 1")).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText("Save these opening balances?")).not.toBeInTheDocument();
    });

    it("submits only the code (not 'code - name') for a known account", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ status: "accepted", count: 2 }), { status: 202 }));
      render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" accounts={accounts} />);
      fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
      fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "5000" } });
      fireEvent.change(screen.getByLabelText("Account code, row 2"), { target: { value: "2000" } });
      fireEvent.change(screen.getByLabelText("Credit amount, row 2"), { target: { value: "5000" } });
      fireEvent.click(screen.getByText(/Save Opening Balances/));
      await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Reason / approving authority"), { target: { value: "Per audited TB 31-03" } });
      fireEvent.click(screen.getByRole("button", { name: "Save opening balances" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
      expect(body.entries.map((e: { accountCode: string }) => e.accountCode)).toEqual(["1000", "2000"]);
    });

    it("lists the accounts as datalist suggestions with their names", () => {
      const { container } = render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" accounts={accounts} />);
      const options = Array.from(container.querySelectorAll("datalist option"));
      expect(options.map((o) => o.getAttribute("value"))).toEqual(["1000", "2000"]);
      expect(options[0]?.textContent).toBe("Cash in hand");
    });

    it("does not validate codes when the chart is unavailable (warns instead)", () => {
      render(<OpeningBalanceForm secondApprover={false} fyCode="2026-27" accountsUnavailable />);
      expect(screen.getByText(/chart of accounts could not be loaded/i)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "ANY" } });
      fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "100" } });
      fireEvent.change(screen.getByLabelText("Account code, row 2"), { target: { value: "ANY2" } });
      fireEvent.change(screen.getByLabelText("Credit amount, row 2"), { target: { value: "100" } });
      fireEvent.click(screen.getByText(/Save Opening Balances/));
      expect(screen.getByText("Save these opening balances?")).toBeInTheDocument();
    });
  });

  // GAP-FINANCE-OPENING-BALANCES-01: second approver (default on)
  function fillBalanced() {
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Account code, row 2"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Credit amount, row 2"), { target: { value: "5000" } });
  }

  it("by default the batch is submitted for a different finance administrator to approve: the dialog says nothing is posted yet, and the success message says submitted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_approval", count: 2, id: "r1" }), { status: 202 }),
    );
    render(<OpeningBalanceForm fyCode="2026-27" />);
    fillBalanced();
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
    expect(screen.getByRole("alertdialog").textContent).toMatch(/Nothing is posted yet: a different finance administrator must approve/);
    fireEvent.change(screen.getByLabelText("Reason / approving authority"), { target: { value: "Per audited TB 31-03, approved by FA&CAO" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(await screen.findByText(/submitted\. They are posted to the ledger when a different finance administrator approves them/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/saved for 2026-27/)).not.toBeInTheDocument();
  });

  it("a second batch while one is pending is explained in plain words", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "CHANGE_REQUEST_PENDING", message: "a change for this item is already awaiting approval" }), { status: 409 }),
    );
    render(<OpeningBalanceForm fyCode="2026-27" />);
    fillBalanced();
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / approving authority"), { target: { value: "Per audited TB 31-03, approved by FA&CAO" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    const msg = await screen.findByText(/already waiting for approval/);
    expect(msg.textContent).not.toMatch(/CHANGE_REQUEST_PENDING/);
  });
});
