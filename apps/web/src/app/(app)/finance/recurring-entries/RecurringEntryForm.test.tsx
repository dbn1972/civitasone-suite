import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RecurringEntryForm } from "./RecurringEntryForm";

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
    fireEvent.click(screen.getByText("Create Recurring Entry"));
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
  });

  it("creates a recurring entry on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-entry-1", name: "Rent", is_active: true }), { status: 201 }),
    );

    render(<RecurringEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/^Next Run Date/), { target: { value: "2026-09-01" } });

    fireEvent.click(screen.getByText("Create Recurring Entry"));

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
    fireEvent.change(screen.getByLabelText(/^Next Run Date/), { target: { value: "2026-09-01" } });

    fireEvent.click(screen.getByText("Create Recurring Entry"));
    await waitFor(() => expect(screen.getByText("Create this recurring entry?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create entry"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
