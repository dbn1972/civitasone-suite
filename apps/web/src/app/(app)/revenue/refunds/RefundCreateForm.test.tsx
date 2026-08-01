import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RefundCreateForm } from "./RefundCreateForm";
import type { ReceiptRow } from "./page";

const receipts: ReceiptRow[] = [
  {
    id: "r1",
    receiptNo: "RCPT-001",
    demandId: "d1",
    amountMinor: "500050",
    channel: "online",
    reference: "UTR123",
    status: "reconciled",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
];

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Receipt/), { target: { value: "r1" } });
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Overpayment refund" } });
}

describe("RefundCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows an empty state when there are no receipts to refund", () => {
    render(<RefundCreateForm assesseeId="a1" receipts={[]} />);
    expect(screen.getByText("No receipts on record")).toBeInTheDocument();
  });

  it("requires receipt and reason before opening the confirm dialog", () => {
    render(<RefundCreateForm assesseeId="a1" receipts={receipts} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise Refund" }));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Select a receipt to refund.")).toBeInTheDocument();
    expect(screen.getByText("Reason is required.")).toBeInTheDocument();
  });

  it("raises a refund on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "refund-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<RefundCreateForm assesseeId="a1" receipts={receipts} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Refund" }));

    await waitFor(() => expect(screen.getByText("Raise this refund?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise refund"));

    await waitFor(() => {
      expect(screen.getByText(/Refund raised/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RefundCreateForm assesseeId="a1" receipts={receipts} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Refund" }));

    await waitFor(() => expect(screen.getByText("Raise this refund?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise refund"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
