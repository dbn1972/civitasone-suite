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
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    expect(screen.getByText(/Enter the assessee identifier/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid payment amount/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the BBPS transaction ID/)).toBeInTheDocument();
  });

  it("shows human channel labels, not raw codes (BBPS-04)", () => {
    render(<PayBillForm />);
    const select = screen.getByLabelText(/Channel/) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Net banking");
    expect(labels).toContain("UPI");
    expect(labels).not.toContain("netbanking");
  });

  it("records the payment on confirm (happy path) with consistent wording (BBPS-05)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { messageId: "msg-2" } }), { status: 202 }),
    );

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    expect(screen.getByText(/₹150.50/)).toBeInTheDocument();
    // Honest copy: no "dispatches money movement".
    expect(screen.queryByText(/dispatches money movement/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/message ID msg-2/)).toBeInTheDocument();
    });
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BBPS_OVERPAYMENT", message: "exceeds outstanding" } }), { status: 422 }),
    );

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/BBPS_OVERPAYMENT: exceeds outstanding/)).not.toBeInTheDocument();
  });
});
