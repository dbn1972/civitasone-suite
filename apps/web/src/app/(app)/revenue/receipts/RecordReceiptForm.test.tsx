import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RecordReceiptForm } from "./RecordReceiptForm";
import type { DemandOption } from "./page";

const demands: DemandOption[] = [{ id: "d1", financialYear: "2025-2026", netMinor: "500000", status: "raised" }];

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Demand/), { target: { value: "d1" } });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "500.50" } });
  fireEvent.change(screen.getByLabelText(/^Reference/), { target: { value: "UTR123" } });
}

describe("RecordReceiptForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires demand, amount and reference before opening the confirm dialog", () => {
    render(<RecordReceiptForm assesseeId="a1" demands={demands} />);
    fireEvent.click(screen.getByText("Record Receipt"));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
  });

  it("records a receipt on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "receipt-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<RecordReceiptForm assesseeId="a1" demands={demands} />);
    fillValidForm();
    fireEvent.click(screen.getByText("Record Receipt"));

    await waitFor(() => expect(screen.getByText("Record this receipt?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record receipt"));

    await waitFor(() => {
      expect(screen.getByText(/Receipt submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RecordReceiptForm assesseeId="a1" demands={demands} />);
    fillValidForm();
    fireEvent.click(screen.getByText("Record Receipt"));

    await waitFor(() => expect(screen.getByText("Record this receipt?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record receipt"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
