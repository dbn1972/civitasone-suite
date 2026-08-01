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

    fireEvent.click(screen.getByText(/Save Opening Balances/));
    await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
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

    fireEvent.click(screen.getByText(/Save Opening Balances/));
    await waitFor(() => expect(screen.getByText("Save these opening balances?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save opening balances"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
