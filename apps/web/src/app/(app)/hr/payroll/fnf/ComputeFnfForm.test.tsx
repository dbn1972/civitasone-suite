import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ComputeFnfForm } from "./ComputeFnfForm";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Employee ID \(UUID\)/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
  fireEvent.change(screen.getByLabelText(/Separation Date/), { target: { value: "2026-07-31" } });
  fireEvent.change(screen.getByLabelText(/Completed Years/), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText(/Leave Balance/), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText(/FY Start Year/), { target: { value: "2026" } });
  fireEvent.change(screen.getByLabelText(/Last Drawn Wages/), { target: { value: "50000" } });
  fireEvent.change(screen.getByLabelText(/Avg Salary — Last 10 Months/), { target: { value: "50000" } });
  fireEvent.change(screen.getByLabelText(/Salary YTD/), { target: { value: "300000" } });
  fireEvent.change(screen.getByLabelText(/TDS YTD/), { target: { value: "20000" } });
}

describe("ComputeFnfForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires the mandatory fields before opening the confirm dialog", () => {
    render(<ComputeFnfForm />);
    fireEvent.click(screen.getByText("Compute Settlement"));
    expect(screen.getByText(/are all required/)).toBeInTheDocument();
  });

  it("computes a settlement on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { message: "fnf compute queued", employeeId: "e1" } }), { status: 202 }),
    );

    render(<ComputeFnfForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByText("Compute Settlement"));

    await waitFor(() => expect(screen.getByText("Compute this F&F settlement?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Compute settlement"));

    await waitFor(() => {
      expect(screen.getByText("fnf compute queued")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<ComputeFnfForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByText("Compute Settlement"));

    await waitFor(() => expect(screen.getByText("Compute this F&F settlement?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Compute settlement"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
