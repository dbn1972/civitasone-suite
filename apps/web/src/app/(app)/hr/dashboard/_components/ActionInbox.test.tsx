import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActionInbox } from "./ActionInbox";

const ITEM = {
  id: "i1",
  employeeName: "Test Employee",
  leaveTypeCode: "EL",
  leaveTypeName: "Earned Leave",
  fromDate: "2026-09-10",
  toDate: "2026-09-11",
  daysApplied: 2,
  departmentName: "IT",
};

describe("ActionInbox", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  /**
   * UX-016: this used to show the raw backend `error`/`message` (falling
   * back to `Error ${res.status}`) verbatim — the same class of leak
   * useFormError closes fleet-wide (UX-003).
   *
   * GAP-HR-DASHBOARD-01: approve/reject now require confirming a dialog
   * before the PATCH fires — clicking the trigger button alone no longer
   * calls fetch, so these updated regression tests click through the
   * dialog's own "Yes, approve"/"Yes, decline" confirm button before
   * asserting on the (still-open, per the fix) dialog's error region.
   */
  describe("UX-016 clerk-safe errors", () => {
    it("shows a clerk-safe message, never the raw HTTP status, when approve fails", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({}), { status: 500, headers: { "content-type": "application/json" } }),
      );
      // @ts-expect-error minimal fixture, not the full LeaveInboxItem type
      render(<ActionInbox initialItems={[ITEM]} canDecide />);

      fireEvent.click(screen.getByRole("button", { name: /approve leave for test employee/i }));
      fireEvent.click(await screen.findByRole("button", { name: /yes, approve/i }));

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
      expect(alert.textContent).not.toMatch(/\b500\b/);
      // GAP-HR-DASHBOARD-01: the row/buttons must survive a failed attempt
      // (retry, don't remove) -- the trigger is still there behind the
      // still-open dialog.
      expect(screen.getByRole("button", { name: /approve leave for test employee/i })).toBeInTheDocument();
    });

    it("never surfaces a raw backend `error` field verbatim", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "leave-service: employee not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
      // @ts-expect-error minimal fixture, not the full LeaveInboxItem type
      render(<ActionInbox initialItems={[ITEM]} canDecide />);

      fireEvent.click(screen.getByRole("button", { name: /decline leave for test employee/i }));
      fireEvent.change(await screen.findByLabelText(/reason for declining/i), { target: { value: "Insufficient balance" } });
      fireEvent.click(screen.getByRole("button", { name: /yes, decline/i }));

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/We couldn't find this leave application\. It may have been removed or the link may be wrong\./));
      expect(alert.textContent).not.toMatch(/leave-service/);
    });

    it("surfaces the backend's own SELF_APPROVAL_FORBIDDEN message verbatim instead of a generic fallback", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN", message: "Maker-checker: you cannot approve your own leave application." }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      );
      // @ts-expect-error minimal fixture, not the full LeaveInboxItem type
      render(<ActionInbox initialItems={[ITEM]} canDecide />);

      fireEvent.click(screen.getByRole("button", { name: /approve leave for test employee/i }));
      fireEvent.click(await screen.findByRole("button", { name: /yes, approve/i }));

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/cannot approve your own leave application/i));
    });
  });

  describe("GAP-HR-DASHBOARD-01: confirm-gated approve/decline", () => {
    it("does not call fetch until the Approve dialog is confirmed", async () => {
      // @ts-expect-error minimal fixture
      render(<ActionInbox initialItems={[ITEM]} canDecide />);

      fireEvent.click(screen.getByRole("button", { name: /approve leave for test employee/i }));
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      fireEvent.click(await screen.findByRole("button", { name: /yes, approve/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/proxy/v1/hrms/leave-applications/i1/approve",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    it("removes the row once Approve is confirmed and the request succeeds", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      // @ts-expect-error minimal fixture
      render(<ActionInbox initialItems={[ITEM]} canDecide />);

      fireEvent.click(screen.getByRole("button", { name: /approve leave for test employee/i }));
      fireEvent.click(await screen.findByRole("button", { name: /yes, approve/i }));

      await waitFor(() => expect(screen.queryByText("Test Employee")).not.toBeInTheDocument());
      expect(screen.getByText(/inbox clear/i)).toBeInTheDocument();
    });

    it("opens the Decline dialog with Confirm disabled until a reason is entered, then sends the reason in the PATCH body", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      // @ts-expect-error minimal fixture
      render(<ActionInbox initialItems={[ITEM]} canDecide />);

      fireEvent.click(screen.getByRole("button", { name: /decline leave for test employee/i }));
      const confirmBtn = await screen.findByRole("button", { name: /yes, decline/i });
      expect(confirmBtn).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/reason for declining/i), { target: { value: "Overlaps existing approved leave" } });
      expect(confirmBtn).not.toBeDisabled();

      fireEvent.click(confirmBtn);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/proxy/v1/hrms/leave-applications/i1/reject");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toEqual({ reason: "Overlaps existing approved leave" });
    });
  });

  describe("GAP-HR-DASHBOARD-01: canDecide gating", () => {
    it("renders no Approve/Decline buttons for a manager session, and an Open in Approvals link instead", () => {
      // @ts-expect-error minimal fixture
      render(<ActionInbox initialItems={[ITEM]} canDecide={false} />);

      expect(screen.queryByRole("button", { name: /approve leave for test employee/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /decline leave for test employee/i })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /open in approvals/i })).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("shows the inbox-clear empty state when there are no items", () => {
    // No @ts-expect-error needed here: an empty array is assignable to
    // LeaveInboxItem[] regardless of the fixture's shape (unlike the [ITEM]
    // cases above, which omit required fields and so DO need it).
    render(<ActionInbox initialItems={[]} canDecide />);
    expect(screen.getByText(/inbox clear/i)).toBeInTheDocument();
  });
});
