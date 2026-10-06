import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

const approveVisitRequestMock = vi.fn();
const rejectVisitRequestMock = vi.fn();
const fetchVisitRequestsMock = vi.fn();

vi.mock("../_data/client", () => ({
  approveVisitRequest: (...args: unknown[]) => approveVisitRequestMock(...args),
  rejectVisitRequest: (...args: unknown[]) => rejectVisitRequestMock(...args),
  fetchVisitRequests: (...args: unknown[]) => fetchVisitRequestsMock(...args),
}));

import { HostPortal } from "./HostPortal";
import type { VisitRequest } from "../_data/types";

const pendingRequest: VisitRequest = {
  id: "vr-1",
  status: "pending_approval",
  purpose: "Vendor meeting",
  scheduledAt: new Date().toISOString(),
  visitorName: "Priya Singh",
  visitorPhone: "+911234500001",
  visitorEmail: null,
  hostEmployeeId: "host-1",
  locationId: "loc-1",
  passType: "single",
  visitorCategory: "standard",
  permittedAreas: [],
  rejectionReason: null,
  trackingRef: "TRK-001",
  createdAt: new Date().toISOString(),
};

describe("HostPortal", () => {
  beforeEach(() => {
    approveVisitRequestMock.mockReset();
    rejectVisitRequestMock.mockReset();
    fetchVisitRequestsMock.mockReset();
    fetchVisitRequestsMock.mockResolvedValue([]);
  });

  it("renders the pending approval queue", () => {
    render(
      <HostPortal pending={[pendingRequest]} pendingSource="api" expectedToday={[]} expectedTodaySource="api" />,
    );
    expect(screen.getByText("Awaiting approval (1)")).toBeInTheDocument();
    expect(screen.getByText("Priya Singh")).toBeInTheDocument();
  });

  it("approves a visit request via the confirm dialog and refreshes the queue", async () => {
    approveVisitRequestMock.mockResolvedValue(undefined);
    render(
      <HostPortal pending={[pendingRequest]} pendingSource="api" expectedToday={[]} expectedTodaySource="api" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("alertdialog", { name: "Approve this visit?" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[1]);

    await waitFor(() => expect(approveVisitRequestMock).toHaveBeenCalledWith("vr-1"));
    expect(await screen.findByText(/Approved Priya Singh\./)).toBeInTheDocument();
    expect(screen.queryByText("Priya Singh")).not.toBeInTheDocument();
    expect(fetchVisitRequestsMock).toHaveBeenCalledWith("pending_approval");
  });

  it("requires a reason before a rejection can be confirmed, then rejects the visit request", async () => {
    rejectVisitRequestMock.mockResolvedValue(undefined);
    render(
      <HostPortal pending={[pendingRequest]} pendingSource="api" expectedToday={[]} expectedTodaySource="api" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirmButton = screen.getByRole("button", { name: "Reject request" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), {
      target: { value: "Visitor not on the approved contractor list." },
    });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(rejectVisitRequestMock).toHaveBeenCalledWith("vr-1", "Visitor not on the approved contractor list."),
    );
    expect(await screen.findByText(/Rejected Priya Singh\./)).toBeInTheDocument();
  });

  it("surfaces the server's error message in the dialog when approval fails", async () => {
    approveVisitRequestMock.mockRejectedValue(new Error("VERSION_CONFLICT: request already actioned"));
    render(
      <HostPortal pending={[pendingRequest]} pendingSource="api" expectedToday={[]} expectedTodaySource="api" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[1]);

    await waitFor(() =>
      expect(screen.getByText(/VERSION_CONFLICT: request already actioned/)).toBeInTheDocument(),
    );
    // The queue is left untouched since the mutation failed.
    expect(screen.getByText("Priya Singh")).toBeInTheDocument();
  });

  describe("error vs. empty states (not conflated via a shared EmptyState)", () => {
    it("shows a retryable error state (not a plain empty state) when the initial approval-queue load failed", () => {
      render(<HostPortal pending={[]} pendingSource="error" expectedToday={[]} expectedTodaySource="api" />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Could not load the approval queue.");
      expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByText("Nothing awaiting approval")).not.toBeInTheDocument();
    });

    it("recovers the queue when the error state's own retry succeeds", async () => {
      render(<HostPortal pending={[]} pendingSource="error" expectedToday={[]} expectedTodaySource="api" />);
      const alert = screen.getByRole("alert");

      fetchVisitRequestsMock.mockResolvedValueOnce([pendingRequest]);
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Priya Singh")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fetchVisitRequestsMock).toHaveBeenCalledWith("pending_approval");
    });

    it("shows the genuine empty state (not an error) when the queue loaded successfully with zero rows", () => {
      render(<HostPortal pending={[]} pendingSource="api" expectedToday={[]} expectedTodaySource="api" />);
      expect(screen.getByText("Nothing awaiting approval")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows a retryable error state for expected-today when the load failed, distinct from a genuine empty result", () => {
      render(<HostPortal pending={[]} pendingSource="api" expectedToday={[]} expectedTodaySource="error" />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("We couldn't load today's expected visitors.");
      expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByText("No visitors expected today")).not.toBeInTheDocument();
    });
  });

  // GAP-VISITOR-HOST-02 (DPDP): the visitor phone is masked, never printed raw.
  it("masks the visitor phone in the approval card", () => {
    render(<HostPortal pending={[{ ...pendingRequest, visitorPhone: "9876543210" }]} pendingSource="api" expectedToday={[]} expectedTodaySource="api" />);
    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
  });

  // GAP-VISITOR-HOST-01: Approve/Reject are offered only on the signed-in
  // host's own requests (defence-in-depth over the server's assertOwnsRequest).
  it("hides Approve/Reject on a request raised for another host", () => {
    const mine = { ...pendingRequest, id: "mine", hostEmployeeId: "me", visitorName: "My Visitor" };
    const theirs = { ...pendingRequest, id: "theirs", hostEmployeeId: "other", visitorName: "Their Visitor" };
    render(
      <HostPortal
        pending={[mine, theirs]}
        pendingSource="api"
        expectedToday={[]}
        expectedTodaySource="api"
        currentHostId="me"
      />,
    );
    expect(screen.getByText("My Visitor")).toBeInTheDocument();
    expect(screen.getByText("Their Visitor")).toBeInTheDocument();
    // Exactly one Approve + one Reject button (for the owned request only).
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(1);
    expect(screen.getByText(/Raised for another host/)).toBeInTheDocument();
  });

  it("shows Approve/Reject on every row for an elevated approver", () => {
    const a = { ...pendingRequest, id: "a", hostEmployeeId: "x" };
    const b = { ...pendingRequest, id: "b", hostEmployeeId: "y" };
    render(
      <HostPortal
        pending={[a, b]}
        pendingSource="api"
        expectedToday={[]}
        expectedTodaySource="api"
        currentHostId="me"
        canApproveAny
      />,
    );
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
  });

  // GAP-VISITOR-HOST-04 / HOST-05: premises name + restricted-zone list shown.
  it("shows the premises name and the restricted-zone list", () => {
    const r = { ...pendingRequest, locationId: "loc-1", permittedAreas: ["Server room", "Vault"] };
    render(
      <HostPortal
        pending={[r]}
        pendingSource="api"
        expectedToday={[]}
        expectedTodaySource="api"
        locationNames={{ "loc-1": "HQ Tower" }}
      />,
    );
    expect(screen.getByText(/Premises: HQ Tower/)).toBeInTheDocument();
    expect(screen.getByText(/Server room, Vault/)).toBeInTheDocument();
  });

  // GAP-VISITOR-HOST-06: the success toast auto-dismisses.
  it("auto-dismisses the success toast after the timeout", async () => {
    vi.useFakeTimers();
    try {
      approveVisitRequestMock.mockResolvedValue(undefined);
      render(<HostPortal pending={[pendingRequest]} pendingSource="api" expectedToday={[]} expectedTodaySource="api" />);
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[1]);
      // Let the mocked async approve resolve.
      await vi.waitFor(() => expect(approveVisitRequestMock).toHaveBeenCalled());
      await vi.waitFor(() => expect(screen.getByText(/Approved Priya Singh\./)).toBeInTheDocument());
      await act(async () => { vi.advanceTimersByTime(5100); });
      await vi.waitFor(() => expect(screen.queryByText(/Approved Priya Singh\./)).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});
