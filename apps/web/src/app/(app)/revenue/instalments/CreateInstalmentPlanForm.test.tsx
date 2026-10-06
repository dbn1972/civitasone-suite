import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateInstalmentPlanForm } from "./CreateInstalmentPlanForm";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Number of Instalments/), { target: { value: "6" } });
  fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
}

describe("CreateInstalmentPlanForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid instalment count before opening the confirm dialog", () => {
    render(<CreateInstalmentPlanForm assesseeId="a1" outstandingMinor="1200000" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Instalment Plan" }));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
  });

  it("blocks a plan when the assessee has no outstanding arrears (GAP-REVENUE-INSTALMENTS-01)", () => {
    render(<CreateInstalmentPlanForm assesseeId="a1" outstandingMinor="0" />);
    const btn = screen.getByRole("button", { name: "Create Instalment Plan" });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/No outstanding arrears to put on a plan/)).toBeInTheDocument();
  });

  it("blocks a plan when arrears could not be loaded (GAP-REVENUE-INSTALMENTS-01)", () => {
    render(<CreateInstalmentPlanForm assesseeId="a1" outstandingMinor="1200000" demandsFailed />);
    expect(screen.getByRole("button", { name: "Create Instalment Plan" })).toBeDisabled();
  });

  it("shows the arrears total and per-instalment amount in the confirm dialog (GAP-REVENUE-INSTALMENTS-01)", async () => {
    render(
      <CreateInstalmentPlanForm
        assesseeId="a1"
        assesseeLabel="Ravi Kumar (P-001)"
        outstandingMinor="10000000"
      />,
    );
    fillValidForm(); // 6 instalments
    fireEvent.change(screen.getByLabelText(/^Number of Instalments/), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Instalment Plan" }));

    await waitFor(() => expect(screen.getByText("Create this instalment plan?")).toBeInTheDocument());
    // ₹1,00,000.00 arrears / 4 = ₹25,000.00 each. (Total shows in both the
    // summary line and the dialog, so allow more than one.)
    expect(screen.getAllByText(/₹1,00,000\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/₹25,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Ravi Kumar \(P-001\)/)).toBeInTheDocument();
  });

  it("creates a plan on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "plan-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<CreateInstalmentPlanForm assesseeId="a1" outstandingMinor="1200000" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Instalment Plan" }));

    await waitFor(() => expect(screen.getByText("Create this instalment plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create plan"));

    await waitFor(() => {
      expect(screen.getByText(/Instalment plan submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateInstalmentPlanForm assesseeId="a1" outstandingMinor="1200000" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Instalment Plan" }));

    await waitFor(() => expect(screen.getByText("Create this instalment plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create plan"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });
});
