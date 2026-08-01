import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SubmitPaymentForm } from "./SubmitPaymentForm";

describe("SubmitPaymentForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires the core fields before opening the confirm dialog", () => {
    render(<SubmitPaymentForm />);
    fireEvent.click(screen.getByText("Submit Payment"));
    expect(
      screen.getByText(/Reference ID, beneficiary code, amount \(numeric paise\), and purpose code are required/),
    ).toBeInTheDocument();
  });

  it("submits a payment on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { referenceId: "REF-1", pfmsTransactionId: "TXN-1", status: "accepted", timestamp: "2026-08-01T00:00:00Z" },
        }),
        { status: 201 },
      ),
    );

    render(<SubmitPaymentForm />);
    fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "REF-1" } });
    fireEvent.change(screen.getByLabelText(/Beneficiary Code/), { target: { value: "BEN-1" } });
    fireEvent.change(screen.getByLabelText(/Amount, in paise/), { target: { value: "150000" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR01" } });
    fireEvent.click(screen.getByText("Submit Payment"));

    await waitFor(() => expect(screen.getByText("Submit this payment to PFMS?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit payment"));

    await waitFor(() => {
      expect(screen.getByText(/Payment REF-1 submitted to PFMS/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    render(<SubmitPaymentForm />);
    fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "REF-2" } });
    fireEvent.change(screen.getByLabelText(/Beneficiary Code/), { target: { value: "BEN-2" } });
    fireEvent.change(screen.getByLabelText(/Amount, in paise/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR02" } });
    fireEvent.click(screen.getByText("Submit Payment"));

    await waitFor(() => expect(screen.getByText("Submit this payment to PFMS?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit payment"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 503/)).toBeInTheDocument();
    });
  });
});
