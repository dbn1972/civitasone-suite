import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { GenerateForm16Form } from "./GenerateForm16Form";

describe("GenerateForm16Form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("requires an Employee ID in single-employee mode before opening the confirm dialog", () => {
    render(<GenerateForm16Form defaultFy="2025-26" />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));
    expect(screen.getByText("Employee ID is required to generate a single Form-16.")).toBeInTheDocument();
  });

  it("rejects a malformed financial year", () => {
    render(<GenerateForm16Form defaultFy="2025-26" />);
    fireEvent.change(screen.getByLabelText(/Financial Year/), { target: { value: "bad-fy" } });
    fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: "emp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));
    expect(screen.getByText(/Financial year must be in format/)).toBeInTheDocument();
  });

  it("queues single-employee generation on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { jobId: "job-42", fy: "2025-26", message: "bulk Form 16 generation queued" } }),
        { status: 202 },
      ),
    );

    render(<GenerateForm16Form defaultFy="2025-26" />);
    fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));

    await waitFor(() => expect(screen.getByText("Generate this employee's Form-16?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(screen.getByText("job-42")).toBeInTheDocument();
    });
    expect(pushMock).toHaveBeenCalledWith("/hr/payroll/form16?fy=2025-26");
  });

  it("surfaces a server error on the confirm dialog when the bulk job is already in progress (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    render(<GenerateForm16Form defaultFy="2025-26" />);
    fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Form-16" }));

    await waitFor(() => expect(screen.getByText("Generate this employee's Form-16?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 409/)).toBeInTheDocument();
    });
  });
});
