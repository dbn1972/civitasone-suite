import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PayBillForm } from "./PayBillForm";

function fillForm() {
  fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-001" } });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "150.50" } });
  fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9001" } });
}

describe("PayBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires all fields before opening the confirm dialog", () => {
    render(<PayBillForm />);
    fireEvent.click(screen.getByRole("button", { name: "Pay Bill" }));
    expect(screen.getByText(/Enter the assessee identifier/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid payment amount/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the BBPS transaction ID/)).toBeInTheDocument();
  });

  it("pays the bill on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { messageId: "msg-2" } }), { status: 202 }),
    );

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay Bill" }));

    await waitFor(() => expect(screen.getByText("Submit this BBPS payment?")).toBeInTheDocument());
    expect(screen.getByText(/₹150.50/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Pay bill"));

    await waitFor(() => {
      expect(screen.getByText(/message ID msg-2/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BBPS_OVERPAYMENT", message: "exceeds outstanding" } }), { status: 422 }),
    );

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay Bill" }));

    await waitFor(() => expect(screen.getByText("Submit this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Pay bill"));

    await waitFor(() => {
      expect(screen.getByText(/BBPS_OVERPAYMENT: exceeds outstanding/)).toBeInTheDocument();
    });
  });
});
