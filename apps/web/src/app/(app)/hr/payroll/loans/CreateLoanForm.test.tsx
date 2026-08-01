import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateLoanForm } from "./CreateLoanForm";

function fillFields() {
  fireEvent.change(screen.getByLabelText(/Loan No\./), { target: { value: "LN-99" } });
  fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
  fireEvent.change(screen.getByLabelText(/Principal/), { target: { value: "10000" } });
  fireEvent.change(screen.getByLabelText(/^EMI/), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText(/Tenure/), { target: { value: "12" } });
}

describe("CreateLoanForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires the mandatory fields before opening the confirm dialog", () => {
    render(<CreateLoanForm />);
    fireEvent.click(screen.getByText("Create Loan"));
    expect(screen.getByText(/are required/)).toBeInTheDocument();
  });

  it("creates a loan on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "loan-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<CreateLoanForm />);
    fillFields();
    fireEvent.click(screen.getByText("Create Loan"));

    await waitFor(() => expect(screen.getByText("Create this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create loan"));

    await waitFor(() => {
      expect(screen.getByText(/Loan LN-99 submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateLoanForm />);
    fillFields();
    fireEvent.click(screen.getByText("Create Loan"));

    await waitFor(() => expect(screen.getByText("Create this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create loan"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
