import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { DispatchPOActions } from "./DispatchPOActions";

const PO_ID = "11111111-1111-1111-1111-111111111111";

describe("DispatchPOActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // GAP-PROCUREMENT-ORDERS-DETAIL-03 / DETAIL-04: the non-dispatchable hint is
  // status-aware and never says "Approve via workflow inbox" for the wrong
  // status.
  it("shows an 'awaiting approval' hint for a pending PO (not a 'workflow inbox' line)", () => {
    render(<DispatchPOActions poId={PO_ID} status="pending" />);
    expect(screen.getByText(/Awaiting approval/)).toBeInTheDocument();
    expect(screen.queryByText(/workflow inbox/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dispatch to vendor" })).not.toBeInTheDocument();
  });

  it("shows 'submit for approval first' for a draft PO", () => {
    render(<DispatchPOActions poId={PO_ID} status="draft" />);
    expect(screen.getByText(/Submit this PO for approval first/)).toBeInTheDocument();
  });

  it("renders NO 'Approve via workflow inbox' text for a cancelled PO", () => {
    const { container } = render(<DispatchPOActions poId={PO_ID} status="cancelled" />);
    expect(container.textContent ?? "").not.toMatch(/workflow inbox/i);
  });

  it("hides the dispatch control for a read-only role even on an approved PO", () => {
    render(<DispatchPOActions poId={PO_ID} status="approved" canDispatchRole={false} />);
    expect(screen.getByText(/restricted to procurement officers/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dispatch to vendor" })).not.toBeInTheDocument();
  });

  it("offers the dispatch action for an approved PO with a write role", () => {
    render(<DispatchPOActions poId={PO_ID} status="approved" canDispatchRole />);
    expect(screen.getByRole("button", { name: "Dispatch to vendor" })).toBeInTheDocument();
  });

  it("submits structured dispatch metadata and shows an honest pending message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));

    render(<DispatchPOActions poId={PO_ID} status="approved" canDispatchRole />);
    fireEvent.click(screen.getByRole("button", { name: "Dispatch to vendor" }));

    const dialog = await screen.findByRole("alertdialog");
    // Fill the expected-delivery date.
    const dateInput = within(dialog).getByLabelText("Expected delivery date") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-07-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i);
    });
    // Must not claim a completed fact the server hasn't confirmed.
    expect(screen.queryByText("PO dispatched to vendor.")).not.toBeInTheDocument();

    // The POST body carried the structured mode + expectedDelivery.
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.mode).toBe("portal");
    expect(body.expectedDelivery).toBe("2026-07-01");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("opens the confirm modal with focus trapped and Escape restoring focus to the trigger (Req 3.4)", async () => {
    render(<DispatchPOActions poId={PO_ID} status="approved" canDispatchRole />);

    const trigger = screen.getByRole("button", { name: "Dispatch to vendor" });
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);

    const dialog = await screen.findByRole("alertdialog", { name: "Dispatch this PO to the vendor?" });
    expect(dialog).toBeInTheDocument();
    // Focus moves into the dialog on open (first focusable element), trapping it inside.
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    // Escape closes the dialog and returns focus to the trigger button.
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });
});
