import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AdjustmentCreateForm } from "./AdjustmentCreateForm";
import type { DemandOption } from "./page";

const demands: DemandOption[] = [
  { id: "d1", financialYear: "2025-2026", netMinor: "500000", status: "raised" },
  { id: "d2", financialYear: "2026-2027", netMinor: "600000", status: "raised" },
];

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^From Demand/), { target: { value: "d1" } });
  fireEvent.change(screen.getByLabelText(/^To Demand/), { target: { value: "d2" } });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "250.00" } });
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Reallocate excess payment" } });
}

describe("AdjustmentCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows an empty state when there are fewer than two demands", () => {
    render(<AdjustmentCreateForm assesseeId="a1" demands={[demands[0]]} />);
    expect(screen.getByText("Not enough demands")).toBeInTheDocument();
  });

  it("requires from/to demand, amount and reason before opening the confirm dialog", () => {
    render(<AdjustmentCreateForm assesseeId="a1" demands={demands} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise Adjustment" }));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Select the source demand.")).toBeInTheDocument();
  });

  it("rejects choosing the same demand for from and to", () => {
    render(<AdjustmentCreateForm assesseeId="a1" demands={demands} />);
    fireEvent.change(screen.getByLabelText(/^From Demand/), { target: { value: "d1" } });
    fireEvent.change(screen.getByLabelText(/^To Demand/), { target: { value: "d1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "250.00" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Adjustment" }));
    expect(screen.getByText("Destination demand must differ from the source demand.")).toBeInTheDocument();
  });

  it("applies an adjustment on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "adj-1", status: "accepted" }), { status: 202 }),
    );

    render(<AdjustmentCreateForm assesseeId="a1" demands={demands} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Adjustment" }));

    await waitFor(() => expect(screen.getByText("Apply this adjustment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Apply adjustment"));

    await waitFor(() => {
      expect(screen.getByText(/Adjustment applied/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<AdjustmentCreateForm assesseeId="a1" demands={demands} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Adjustment" }));

    await waitFor(() => expect(screen.getByText("Apply this adjustment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Apply adjustment"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
