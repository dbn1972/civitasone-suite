import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { WriteOffDecideForm } from "./WriteOffDecideForm";
import type { WriteOffRecord } from "./page";

const WRITE_OFF_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const WRITE_OFF: WriteOffRecord = {
  id: WRITE_OFF_ID,
  assesseeId: "22222222-2222-2222-2222-222222222222",
  amountMinor: "100000",
  reason: "Unrecoverable after legal proceedings",
  status: "pending",
  makerUserId: "maker-1",
  demandId: null,
  financialYear: null,
};

describe("WriteOffDecideForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("has distinct accessible names for approve and reject", () => {
    render(<WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={WRITE_OFF} />);
    expect(screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Reject write-off ${WRITE_OFF_ID.slice(0, 8)}` })).toBeInTheDocument();
  });

  it("disables Approve/Reject and never opens the confirm dialog when the write-off record could not be loaded (fail-closed)", () => {
    render(<WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={null} />);
    const approveBtn = screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` });
    const rejectBtn = screen.getByRole("button", { name: `Reject write-off ${WRITE_OFF_ID.slice(0, 8)}` });
    expect(approveBtn).toBeDisabled();
    expect(rejectBtn).toBeDisabled();

    fireEvent.click(approveBtn);
    expect(screen.queryByText("Approve this write-off?")).not.toBeInTheDocument();
  });

  it("shows the amount and reason in the confirm dialog so the checker never decides blind", async () => {
    render(<WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={WRITE_OFF} />);
    fireEvent.click(screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Approve this write-off?")).toBeInTheDocument());
    expect(screen.getByText(/₹1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Unrecoverable after legal proceedings/)).toBeInTheDocument();
  });

  it("approves a write-off on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: WRITE_OFF_ID, status: "accepted" }), { status: 202 }),
    );

    render(<WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={WRITE_OFF} />);
    fireEvent.click(screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Approve this write-off?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve write-off"));

    await waitFor(() => {
      expect(screen.getByText(/Decision submitted \(approve/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("requires a reason before the reject confirm button is enabled (audit parity)", async () => {
    render(<WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={WRITE_OFF} />);
    fireEvent.click(screen.getByRole("button", { name: `Reject write-off ${WRITE_OFF_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Reject this write-off?")).toBeInTheDocument());
    expect(screen.getByText("Reject write-off")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Amount looks wrong" } });
    expect(screen.getByText("Reject write-off")).toBeEnabled();
  });

  it("surfaces a clerk-safe error on a maker-checker violation, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "MAKER_CHECKER_VIOLATION", message: "Checker cannot be the same person as the maker (separation of duties)" } }),
        { status: 409 },
      ),
    );

    render(<WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={WRITE_OFF} />);
    fireEvent.click(screen.getByRole("button", { name: `Reject write-off ${WRITE_OFF_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Reject this write-off?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Not eligible" } });
    fireEvent.click(screen.getByText("Reject write-off"));

    await waitFor(() => {
      expect(screen.getByText(/This information was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/MAKER_CHECKER_VIOLATION|separation of duties/)).not.toBeInTheDocument();
  });

  it("disables Approve/Reject when the signed-in user is the maker, and never opens the dialog (DECIDE-01)", () => {
    render(
      <WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={WRITE_OFF} currentUserId="maker-1" />,
    );
    const approve = screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` });
    expect(approve).toBeDisabled();
    expect(screen.getByRole("button", { name: `Reject write-off ${WRITE_OFF_ID.slice(0, 8)}` })).toBeDisabled();
    expect(screen.getByText(/you raised this write-off/i)).toBeInTheDocument();
    fireEvent.click(approve);
    expect(screen.queryByText("Approve this write-off?")).not.toBeInTheDocument();
  });

  it("keeps Approve/Reject enabled for a different officer (DECIDE-01)", () => {
    render(
      <WriteOffDecideForm writeOffId={WRITE_OFF_ID} writeOff={WRITE_OFF} currentUserId="checker-9" />,
    );
    expect(screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` })).toBeEnabled();
  });

  it("hides Approve/Reject for an already-decided write-off and shows its status (DECIDE-03)", () => {
    render(
      <WriteOffDecideForm
        writeOffId={WRITE_OFF_ID}
        writeOff={{ ...WRITE_OFF, status: "approved" }}
        currentUserId="checker-9"
      />,
    );
    expect(screen.queryByRole("button", { name: /Approve write-off/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Already decided/)).toBeInTheDocument();
  });

  it("uses the assessee name in the confirm dialog, not an 8-char id (DECIDE-02)", async () => {
    render(
      <WriteOffDecideForm
        writeOffId={WRITE_OFF_ID}
        writeOff={WRITE_OFF}
        currentUserId="checker-9"
        assesseeName="Ravi Kumar"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` }));
    await waitFor(() => expect(screen.getByText("Approve this write-off?")).toBeInTheDocument());
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.queryByText(WRITE_OFF.assesseeId.slice(0, 8))).not.toBeInTheDocument();
  });
});
