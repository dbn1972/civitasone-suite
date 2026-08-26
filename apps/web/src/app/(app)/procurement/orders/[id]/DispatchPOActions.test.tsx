import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

  it("renders a workflow-inbox hint instead of the action when dispatch is not allowed", () => {
    render(<DispatchPOActions poId={PO_ID} canDispatch={false} />);
    expect(screen.getByText(/Approve via/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dispatch to vendor" })).not.toBeInTheDocument();
  });

  it("opens the confirm modal with focus trapped and Escape restoring focus to the trigger (Req 3.4)", async () => {
    render(<DispatchPOActions poId={PO_ID} canDispatch />);

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

  it("submits the dispatch request on confirm and shows an honest pending message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

    render(<DispatchPOActions poId={PO_ID} canDispatch />);
    fireEvent.click(screen.getByRole("button", { name: "Dispatch to vendor" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));

    // Regression test for an L3 defect: `/dispatch` is a 202-accepted async
    // command (services/procurement-service/src/modules/po/routes.ts uses
    // sendAccepted), so a 200/202 response here only means the request was
    // QUEUED, not that the vendor was actually notified. The old copy
    // ("PO dispatched to vendor.") asserted a completed fact the server had
    // not yet confirmed. This must never regress back to that wording.
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i);
    });
    expect(screen.queryByText("PO dispatched to vendor.")).not.toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
    // Still triggers a refresh so the real (server-confirmed) status can land.
    expect(refreshMock).toHaveBeenCalled();
  });
});
