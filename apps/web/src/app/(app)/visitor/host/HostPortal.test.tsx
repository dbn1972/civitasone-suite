import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

  it("renders the empty state when the approval queue API call failed (stale/no data)", () => {
    render(<HostPortal pending={[]} pendingSource="error" expectedToday={[]} expectedTodaySource="api" />);
    expect(screen.getByText("Could not load the approval queue")).toBeInTheDocument();
  });
});
