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
    render(<OpeningBalanceForm fyCode="2026-27" />);
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    expect(screen.getByText("Enter at least one account with a debit or credit amount.")).toBeInTheDocument();
  });

  it("saves opening balances on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "entered", count: 1 }), { status: 201 }),
    );

    render(<OpeningBalanceForm fyCode="2026-27" />);
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

    render(<OpeningBalanceForm fyCode="2026-27" />);
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
    render(<OpeningBalanceForm fyCode="2026-27" />);
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
    render(<OpeningBalanceForm fyCode="2026-27" />);
    fireEvent.change(screen.getByLabelText("Account code, row 1"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Debit amount, row 1"), { target: { value: "1.005" } });
    fireEvent.click(screen.getByText(/Save Opening Balances/));
    expect(screen.getByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(screen.queryByText("Save these opening balances?")).not.toBeInTheDocument();
  });
});
