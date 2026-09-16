import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PaymentStatusLookup } from "./PaymentStatusLookup";

// UX-017: PaymentStatusLookup now reads its copy through next-intl
// (useTranslations), so it needs a real provider in the tree -- same
// pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderLookup() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PaymentStatusLookup />
    </NextIntlClientProvider>,
  );
}

describe("PaymentStatusLookup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a reference before looking up", () => {
    renderLookup();
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

    renderLookup();
    fireEvent.change(screen.getByLabelText(/Payment Reference/), { target: { value: "REF-1" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText("UTR999")).toBeInTheDocument();
    });
  });

  it("surfaces a server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    renderLookup();
    fireEvent.change(screen.getByLabelText(/Payment Reference/), { target: { value: "REF-2" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
