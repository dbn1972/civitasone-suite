import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PaymentStatusLookup } from "./PaymentStatusLookup";

describe("PaymentStatusLookup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a reference before looking up", () => {
    render(<PaymentStatusLookup />);
    fireEvent.click(screen.getByText("Check Status"));
    expect(screen.getByText("Enter a payment reference to look up.")).toBeInTheDocument();
  });

  it("looks up a payment status (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { referenceId: "REF-1", pfmsTransactionId: "TXN-1", status: "completed", utrNumber: "UTR999" },
        }),
        { status: 200 },
      ),
    );

    render(<PaymentStatusLookup />);
    fireEvent.change(screen.getByLabelText(/Payment Reference/), { target: { value: "REF-1" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText("UTR999")).toBeInTheDocument();
    });
  });

  it("surfaces a server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    render(<PaymentStatusLookup />);
    fireEvent.change(screen.getByLabelText(/Payment Reference/), { target: { value: "REF-2" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 503/)).toBeInTheDocument();
    });
  });
});
