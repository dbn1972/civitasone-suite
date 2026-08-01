import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateOffCycleForm } from "./CreateOffCycleForm";

describe("CreateOffCycleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid period before opening the confirm dialog", () => {
    render(<CreateOffCycleForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));
    expect(screen.getByText("Period must be in YYYY-MM format, e.g. 2025-06.")).toBeInTheDocument();
  });

  it("creates an off-cycle run on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "o1", runType: "bonus", period: "2025-06", totalAmountMinor: 500000, itemCount: 1, status: "draft" } }),
        { status: 201 },
      ),
    );

    render(<CreateOffCycleForm />);
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));

    await waitFor(() => expect(screen.getByText("Create this off-cycle run?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create run"));

    await waitFor(() => {
      expect(screen.getByText(/Off-cycle run created for 2025-06/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));

    render(<CreateOffCycleForm />);
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));

    await waitFor(() => expect(screen.getByText("Create this off-cycle run?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create run"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 422/)).toBeInTheDocument();
    });
  });
});
