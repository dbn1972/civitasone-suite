import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AmendGrnForm } from "./AmendGrnForm";

const ITEMS = [
  { id: "line-1", itemCode: "PAPER-A4", poItemRef: "poi-1", unit: "reams", orderedQty: 10, receivedQty: 8, acceptedQty: 8 },
];

describe("AmendGrnForm (GAP-PROCUREMENT-GRN-DETAIL-04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the Ordered column with the correct value while editing", () => {
    render(<AmendGrnForm grnId="g1" items={ITEMS} />);
    expect(screen.getByRole("columnheader", { name: "Ordered" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "PO item" })).toBeInTheDocument();
    // Ordered qty 10 is rendered as a read-only cell.
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("poi-1")).toBeInTheDocument();
  });

  it("blocks submit when received exceeds ordered", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<AmendGrnForm grnId="g1" items={ITEMS} />);
    const received = screen.getByLabelText("Received qty, PAPER-A4");
    fireEvent.change(received, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/cannot exceed ordered/i));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("warns (does not silently drop) about input lines without a saved id", () => {
    render(<AmendGrnForm grnId="g1" items={[...ITEMS, { itemCode: "NO-ID", poItemRef: "poi-2", unit: "nos", orderedQty: 5, receivedQty: 5, acceptedQty: 5 }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/NO-ID/);
  });
});
