import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateReimbursementForm } from "./CreateReimbursementForm";

describe("CreateReimbursementForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee id before opening the confirm dialog", () => {
    render(<CreateReimbursementForm />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    expect(screen.getByText("Employee ID is required.")).toBeInTheDocument();
  });

  it("creates a reimbursement claim on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "r1", category: "medical", amount_minor: 250000, status: "submitted" } }),
        { status: 201 },
      ),
    );

    render(<CreateReimbursementForm />);
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));

    await waitFor(() => expect(screen.getByText("Submit this reimbursement claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit claim"));

    await waitFor(() => {
      expect(screen.getByText(/Reimbursement claim of .* submitted\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    render(<CreateReimbursementForm />);
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));

    await waitFor(() => expect(screen.getByText("Submit this reimbursement claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit claim"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 400/)).toBeInTheDocument();
    });
  });
});
