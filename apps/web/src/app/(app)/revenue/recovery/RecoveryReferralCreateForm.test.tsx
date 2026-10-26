import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RecoveryReferralCreateForm } from "./RecoveryReferralCreateForm";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Repeated default despite notices" } });
}

describe("RecoveryReferralCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a reason before opening the confirm dialog", () => {
    render(<RecoveryReferralCreateForm assesseeId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "Refer for Recovery" }));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Reason is required.")).toBeInTheDocument();
  });

  it("records a recovery referral on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "ref-1", status: "accepted" }), { status: 202 }),
    );

    render(<RecoveryReferralCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Refer for Recovery" }));

    await waitFor(() => expect(screen.getByText("Refer this assessee for recovery?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Refer for recovery"));

    await waitFor(() => {
      // Owner decision #4: copy no longer claims the referral took effect — it is sent for approval.
      expect(screen.getByText(/Recovery referral raised/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RecoveryReferralCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Refer for Recovery" }));

    await waitFor(() => expect(screen.getByText("Refer this assessee for recovery?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Refer for recovery"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });

  // Owner decision #4 (2026-10-26): amount, age and notices are shown before a coercive referral;
  // it is allowed only after a served notice's period has lapsed, and needs a second officer.
  const READY = {
    outstandingMinor: "500000",
    eligible: true,
    notices: [{ id: "n1", noticeNo: "DN-2026-0007", servedOn: "2026-08-01", noticePeriodDays: 30, lapsesOn: "2026-08-31", lapsed: true }],
  };

  it("shows the outstanding amount and the served notices with their lapse status (owner decision #4)", () => {
    render(<RecoveryReferralCreateForm assesseeId="a1" readiness={READY} />);
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
    const notices = screen.getByLabelText("Demand notices served");
    expect(notices).toHaveTextContent("DN-2026-0007");
    expect(notices).toHaveTextContent(/period lapsed/i);
    expect(screen.getByRole("button", { name: "Refer for Recovery" })).toBeEnabled();
  });

  it("blocks the referral and explains why when no notice has been served or its period has not lapsed", () => {
    const { rerender } = render(<RecoveryReferralCreateForm assesseeId="a1" readiness={{ outstandingMinor: "500000", eligible: false, notices: [] }} />);
    expect(screen.getByRole("button", { name: "Refer for Recovery" })).toBeDisabled();
    expect(screen.getByText(/No demand notice has been served/)).toBeInTheDocument();
    rerender(
      <RecoveryReferralCreateForm
        assesseeId="a1"
        readiness={{ outstandingMinor: "500000", eligible: false, notices: [{ ...READY.notices[0]!, lapsed: false, lapsesOn: "2099-01-31" }] }}
      />,
    );
    expect(screen.getByRole("button", { name: "Refer for Recovery" })).toBeDisabled();
    expect(screen.getByText(/notice period has not lapsed/i)).toBeInTheDocument();
  });

  it("fails closed when eligibility could not be loaded (readiness = null)", () => {
    render(<RecoveryReferralCreateForm assesseeId="a1" readiness={null} />);
    expect(screen.getByRole("button", { name: "Refer for Recovery" })).toBeDisabled();
    expect(screen.getByText(/couldn't check/i)).toBeInTheDocument();
  });

  it("tells the officer the referral goes to a second officer and does not take effect until approved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "ref-1" }), { status: 202 }));
    render(<RecoveryReferralCreateForm assesseeId="a1" readiness={READY} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Refer for Recovery" }));
    await waitFor(() => expect(screen.getByText("Refer this assessee for recovery?")).toBeInTheDocument());
    expect(document.querySelector("[role=alertdialog]")?.textContent).toMatch(/different officer must approve/i);
    expect(document.querySelector("[role=alertdialog]")?.textContent).not.toMatch(/takes effect immediately/i);
    fireEvent.click(screen.getByText("Refer for recovery"));
    await waitFor(() => expect(screen.getByText(/sent for approval/i)).toBeInTheDocument());
  });
});
