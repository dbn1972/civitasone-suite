import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateCorrectionForm } from "./CreateCorrectionForm";

describe("CreateCorrectionForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee id before opening the confirm dialog", () => {
    render(<CreateCorrectionForm />);
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));
    expect(screen.getByText("Employee ID is required.")).toBeInTheDocument();
  });

  function fillValidForm() {
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Component/), { target: { value: "BASIC" } });
    fireEvent.change(screen.getByLabelText(/^Effective From/), { target: { value: "2025-04-01" } });
    fireEvent.change(screen.getByLabelText(/^Old Value/), { target: { value: "40000" } });
    fireEvent.change(screen.getByLabelText(/^New Value/), { target: { value: "45000" } });
  }

  it("records a correction on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "c1", employeeId: "e1", component: "BASIC", effectiveFrom: "2025-04-01", affectedPeriods: 3, arrearsMinor: 1500000, status: "pending" },
        }),
        { status: 201 },
      ),
    );

    render(<CreateCorrectionForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));

    await waitFor(() => expect(screen.getByText("Record this salary correction?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record correction"));

    await waitFor(() => {
      expect(screen.getByText(/Correction recorded for BASIC/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));

    render(<CreateCorrectionForm />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));

    await waitFor(() => expect(screen.getByText("Record this salary correction?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record correction"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 422/)).toBeInTheDocument();
    });
  });
});
